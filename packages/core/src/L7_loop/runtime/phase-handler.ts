/**
 * R12 P6 Plus (P2 退出标准) — Phase Handler 拆分
 *
 * 借鉴 spec-kit「stage contract」+ agency-orchestrator「task executor」+ ruflo「task harness」：
 *
 * 痛点：loop-controller.nextV12() ~300 行；
 *       drift 检测 + DP gate + break-loop 上下文 + DLP 链 + 路由 + 阶段执行 + 完成门
 *       全部塞在单方法里。
 *
 * 解法：把 nextV12 拆为：
 *   1. guards        — CP1 drift + DP gate（前置守卫）
 *   2. context       — break-loop 历史教训 + DLP 链（上下文注入）
 *   3. router        — deterministicRoute + 路由结果分发
 *   4. executor      — 实际执行 innerLoop.runStage + 阶段推进
 *   5. completer     — 完成门 + 阶段切换
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 */

import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { Stage } from '../state-machine';
import type { StateMachine } from '../state-machine';
import type { InnerLoop, InnerStageResult, StageHandlerProvider } from '../inner-loop';
import type { HardStopManager } from '../hard-stop';
import { HardStopManager as HardStopManagerClass } from '../hard-stop';
import type { CircuitBreaker } from '../circuit-breaker';
import type { StrikeSystem } from '../../L4_discipline/strike-system';
import type { TokenBudget, BudgetAction } from '../token-budget';
import type { DecisionPointRegistry } from '../decision-points';
import type { DlpChainDetector } from '../../L4_discipline/dlp-chain-detector';
import type { RunLedger } from '../../state/run-ledger';
import type { ResumeGenerator } from '../../continuity/resume-generator';
import type { ContextOrchestrator, ContextEntryBundle, ContextEntry } from '../../L2_memory/context-orchestrator';
import type { InjectionEngine } from '../../L9_knowledge/injection-engine';
import type { CompletionGate } from '../completion-gate';
import { DEFAULT_BLOCK_COUNT_LIMIT } from '../completion-gate';
import * as fs from 'fs';
import * as path from 'path';

// ── Phase Handler dependencies (injected from LoopController) ──

export interface PhaseHandlerDeps {
  // ── State holders ──
  stateMachine: StateMachine;
  innerLoop: InnerLoop;
  hardStop: HardStopManager;
  circuitBreaker: CircuitBreaker;
  strikeSystem: StrikeSystem;
  tokenBudget: TokenBudget;
  completionGate: CompletionGate;
  dpRegistry: DecisionPointRegistry;
  dlpDetector: DlpChainDetector | null;
  runLedger: RunLedger | null;
  resumeGen: ResumeGenerator | null;
  contextOrchestrator: ContextOrchestrator | null;
  injectionEngine: InjectionEngine;
  handlerProvider: StageHandlerProvider;
  auditLog: {
    append: (entry: Record<string, unknown>) => void | Promise<void>;
  } | null;

  // ── Config ──
  config: {
    maxIterations: number;
    azaDir: string;
  };

  // ── State readers/writers ──
  blockCount: number;
  stopHookActive: boolean;
  ledgerHasProgress: boolean;
  driftDetected: boolean;
  checkerCache: Map<string, { result: any; timestamp: number }>;
  setHandlerProvider: (provider: StageHandlerProvider) => void;
  setDriftDetected: (v: boolean) => void;
  markLedgerProgress: () => void;
  getWorkDir: () => string | undefined;

  // ── Response builder + stage entry ──
  buildResponse: (
    stage: string,
    nextAction: NextAction,
    isHardStop?: boolean,
    loopLevel?: 'outer' | 'inner' | 'phase',
    awaitingAction?: NextAction,
  ) => LoopResponse<any>;
  getStageEntryAction: (stage: string) => NextAction;
  createRealHandlerProvider: (args: {
    workDir: string | undefined;
    azaDir: string | undefined;
    checkerCache: Map<string, any>;
    contextBundle: ContextEntryBundle | null;
    knowledgeEntries: string[];
  }) => StageHandlerProvider;
}

/**
 * 阶段执行器：负责 V12 三层循环中的「phase」层逻辑。
 *
 * 核心职责：
 *   1. 前置守卫（drift / DP gate）
 *   2. 上下文注入（break-loop 历史教训 + DLP 链检测 + 阶段知识）
 *   3. 路由决策（deterministicRoute + 路由结果分发）
 *   4. 阶段执行（innerLoop.runStage）
 *   5. 完成门 + 阶段切换
 */
export class PhaseHandler {
  constructor(private readonly deps: PhaseHandlerDeps) {}

  /**
   * V12 阶段处理入口。
   * 行为等价于原 LoopController.nextV12() 方法。
   */
  async run(currentStage?: string): Promise<LoopResponse<{
    stage: string;
    progress: string;
    next_action: NextAction;
    awaitingAction?: NextAction;
  }>> {
    const stage = (currentStage || this.deps.stateMachine.getCurrentStage()) as Stage;

    // 1. 前置守卫
    const guardResponse = this.checkGuards(stage);
    if (guardResponse) return guardResponse;

    // 2. 上下文注入（break-loop 历史教训 + DLP 链检测）
    this.injectHistoricalLesson();
    const dlpResponse = await this.checkDlpChain(stage);
    if (dlpResponse) return dlpResponse;

    // 3. 路由决策
    const routeResponse = this.routeByDeterministic(stage);
    if (routeResponse) return routeResponse;

    // 4. 阶段执行
    return this.executeStage(stage);
  }

  // ── 1. 前置守卫 ──

  /**
   * CP1 drift detection + DP gate.
   * 漂移检测：PRD/contract 在 stage 间被外部修改时，强制回到 open 重新生成。
   * DP gate：进入新 stage 前必须通过 Decision Point prerequisite。
   */
  private checkGuards(stage: Stage): LoopResponse<any> | null {
    const { stateMachine, dpRegistry } = this.deps;

    // CP1 drift detection
    if (this.deps.driftDetected && stage !== 'open') {
      this.deps.setDriftDetected(false);
      stateMachine.setStageStatus(stage, 'blocked');
      stateMachine.setStageStatus('open', 'in_progress');
      stateMachine.loadState({ current_stage: 'open' });
      return this.deps.buildResponse('open', {
        tool: 'aza_prd', action: 'modify',
        reason: 'Drift detected: PRD or contract changed out-of-band. Returning to open stage to regenerate.',
      }, false, 'inner');
    }

    // DP gate
    const stageInfo = stateMachine.getStageInfo(stage);
    if (stage !== 'open' && stageInfo.status === 'pending') {
      if (!dpRegistry.canEnterStage(stage)) {
        return this.deps.buildResponse(stage, {
          tool: 'aza_loop', action: 'escalate',
          reason: `DP gate blocked: stage "${stage}" requires its Decision Point to be passed first. Complete the prior stage via aza_loop(action=next) or aza_loop(full).`,
        }, true);
      }
    }

    return null;
  }

  // ── 2. 上下文注入 ──

  /**
   * V20 Task 13b: 读取 break-loop.jsonl，注入「历史教训」上下文。
   */
  private injectHistoricalLesson(): void {
    const { config } = this.deps;
    if (!config.azaDir) return;

    try {
      const breakLoopPath = path.join(config.azaDir, 'spec-conventions', 'break-loop.jsonl');
      if (!fs.existsSync(breakLoopPath)) return;

      const content = fs.readFileSync(breakLoopPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return;

      const lastLine = lines[lines.length - 1] || '';
      const lastBreak = JSON.parse(lastLine);
      const description = lastBreak?.convention?.description ?? '';
      const rootCauseMatch = description.match(/Top root cause: (\w+)/);
      if (rootCauseMatch && rootCauseMatch[1]) {
        const rootCause = rootCauseMatch[1];
        const lessonEntry: ContextEntry = {
          type: 'constraint',
          content: `[历史教训] 上次因 ${rootCause} 触发 3-strike，避免重复此模式`,
          priority: 0.9,
          tokenEstimate: 50,
          metadata: { source: 'break-loop', iteration: lastBreak.iteration },
        };
        this.deps.checkerCache.set('historical_lesson', { result: lessonEntry, timestamp: Date.now() });
      }
    } catch {
      /* best-effort */
    }
  }

  /**
   * V20 Task 11: DLP 链式检测。
   * R10 第2轮 (D1): 用真实 RunLedger 最近 20 条记录替换空数组占位符。
   */
  private async checkDlpChain(stage: Stage): Promise<LoopResponse<any> | null> {
    const { dlpDetector, runLedger, resumeGen, hardStop, stateMachine } = this.deps;
    if (!dlpDetector || !resumeGen) return null;

    try {
      const recentEntries = runLedger?.getRecentEntries(20) ?? [];
      const chainReport = dlpDetector.detectChain(recentEntries);
      if (chainReport.detected) {
        hardStop.stop('security_blocker', `DLP chain detected: ${chainReport.reason}`, stateMachine.getState().iteration);
        return this.deps.buildResponse(stage, {
          tool: 'aza_loop', action: 'stop',
          reason: `DLP chain detected: ${chainReport.reason}`,
        }, true);
      }
    } catch {
      /* best-effort */
    }
    return null;
  }

  // ── 3. 路由决策 ──

  /**
   * V20 Task 6: 纯函数路由 — 所有路由决策集中，无 LLM 调用。
   */
  private routeByDeterministic(stage: Stage): LoopResponse<any> | null {
    const { hardStop, circuitBreaker, stateMachine, strikeSystem, tokenBudget, config } = this.deps;
    const iter = stateMachine.getState().iteration;

    const routeAction: NextAction | null = this.deterministicRoute(stage, {
      hardStopped: hardStop.isStopped(),
      breakerTripped: circuitBreaker.checkAll()?.tripped ?? false,
      iterExceeded: HardStopManagerClass.checkIterations(iter, config.maxIterations).exceeded,
      strikeHardStop: strikeSystem.isHardStop(),
      budgetAction: tokenBudget.checkBudget(),
    });

    if (!routeAction) return null;
    return this.handleRouteAction(stage, routeAction);
  }

  /**
   * 纯函数路由：输入 stage + 状态标志 → 输出 NextAction 或 null。
   */
  private deterministicRoute(
    stage: Stage,
    ctx: {
      hardStopped: boolean;
      breakerTripped: boolean;
      iterExceeded: boolean;
      strikeHardStop: boolean;
      budgetAction: BudgetAction;
    },
  ): NextAction | null {
    if (ctx.hardStopped) return { tool: 'aza_loop', action: 'report', reason: 'Hard stop' };
    if (ctx.breakerTripped) return { tool: 'aza_loop', action: 'escalate', reason: 'Circuit breaker tripped' };
    if (ctx.iterExceeded) return { tool: 'aza_loop', action: 'stop', reason: 'Max iterations' };
    if (ctx.strikeHardStop) return { tool: 'aza_loop', action: 'escalate', reason: '3-Strike' };
    if (ctx.budgetAction === 'stop') return { tool: 'aza_loop', action: 'stop', reason: 'Token budget exhausted' };
    return null;
  }

  /**
   * 根据路由结果返回对应响应。
   */
  private handleRouteAction(stage: Stage, routeAction: NextAction): LoopResponse<any> {
    const { hardStop, stateMachine, circuitBreaker, strikeSystem, config } = this.deps;

    if (routeAction.action === 'report') {
      return this.deps.buildResponse(stage, routeAction, true);
    }

    if (routeAction.action === 'escalate') {
      // Circuit breaker 处理
      if (routeAction.reason.includes('Circuit breaker')) {
        const breakerResult = circuitBreaker.checkAll();
        if (breakerResult) {
          hardStop.stop('max_iterations_exceeded', breakerResult.reason || 'Circuit breaker tripped', stateMachine.getState().iteration);
          stateMachine.setStageStatus(stage, 'blocked', breakerResult.reason);
          stateMachine.loadState({ current_stage: stage });
        }
      }
      // 3-Strike 处理
      if (routeAction.reason.includes('3-Strike')) {
        hardStop.stop('strikes_exceeded', `3-Strike: ${strikeSystem.getStrikeCount()} strikes`, stateMachine.getState().iteration);
        stateMachine.setStageStatus('design', 'in_progress');
        stateMachine.setStageStatus(stage, 'blocked');
        stateMachine.loadState({ current_stage: 'design' });

        // 记录根因
        const rootCause = strikeSystem.getRootCause();
        this.recordBreakLoop(stage, routeAction.reason, rootCause?.cause);
      }
      return this.deps.buildResponse(stage === 'design' ? 'design' : stage, routeAction, true);
    }

    if (routeAction.action === 'stop') {
      if (routeAction.reason.includes('Max iterations')) {
        const iterCheck = HardStopManagerClass.checkIterations(
          stateMachine.getState().iteration, config.maxIterations,
        );
        hardStop.stop('max_iterations_exceeded', iterCheck.detail!, stateMachine.getState().iteration);
      }
      if (routeAction.reason.includes('Token budget')) {
        hardStop.stop('critical_error', 'token budget exhausted', stateMachine.getState().iteration);
      }
      return this.deps.buildResponse(stage, routeAction, true);
    }

    // 未知路由 action：保守处理
    return this.deps.buildResponse(stage, routeAction, true);
  }

  /**
   * V20 Task 13b: 记录 break-loop 根因。
   */
  private async recordBreakLoop(stage: Stage, error: string, cause?: string): Promise<void> {
    try {
      const { breakLoop } = await import('../../L9_knowledge/break-loop');
      await breakLoop({
        stage,
        iteration: this.deps.stateMachine.getState().iteration,
        error,
        lastAction: { tool: 'aza_loop', action: 'escalate', reason: '3-strike escalation' },
        strikeCount: this.deps.strikeSystem.getStrikeCount(),
        extra: cause ? { cause } : undefined,
      }, this.deps.config.azaDir || '.aza');
    } catch {
      /* best-effort */
    }
  }

  // ── 4. 阶段执行 ──

  /**
   * V16: 执行单个 stage，通过 InnerLoop.runStage 调度。
   * V12: 注入阶段上下文（JSONL）和知识。
   */
  private async executeStage(stage: Stage): Promise<LoopResponse<any>> {
    const { stateMachine, innerLoop, contextOrchestrator, injectionEngine, tokenBudget, checkerCache } = this.deps;
    const innerState = stateMachine.getInnerLoopState();
    const storyId = innerState.current_story || `STORY-${stage.toUpperCase()}`;

    // Mark current stage as in_progress
    stateMachine.setStageStatus(stage, 'in_progress');

    // Generate per-stage context (JSONL) and inject knowledge
    let contextBundle: ContextEntryBundle | null = null;
    let knowledgeEntries: string[] = [];
    if (contextOrchestrator) {
      try {
        const bundle = await contextOrchestrator.generateContextFiles(stage);
        const injected = await contextOrchestrator.injectContext(stage);
        let pruned = contextOrchestrator.pruneContext(
          injected,
          tokenBudget.getRemainingPerTask(),
        );

        // 注入历史教训
        const lessonCache = checkerCache.get('historical_lesson');
        if (lessonCache && lessonCache.result) {
          const entries = [...(pruned.entries || [])];
          entries.push(lessonCache.result);
          pruned = {
            ...pruned,
            entries,
            totalTokens: pruned.totalTokens + lessonCache.result.tokenEstimate,
          };
        }

        contextBundle = pruned;
        checkerCache.set(`context:${stage}`, { result: contextBundle, timestamp: Date.now() });
      } catch {
        /* best-effort: context injection is non-fatal */
      }
    }
    knowledgeEntries = injectionEngine.inject({
      stage,
      tags: [stage, storyId],
    });
    if (knowledgeEntries.length > 0) {
      checkerCache.set(`knowledge:${stage}`, { result: knowledgeEntries, timestamp: Date.now() });
    }

    // Update handler provider with fresh context/knowledge
    const workDir = this.deps.getWorkDir();
    const provider = this.deps.createRealHandlerProvider({
      workDir,
      azaDir: this.deps.config.azaDir || undefined,
      checkerCache,
      contextBundle,
      knowledgeEntries,
    });
    this.deps.setHandlerProvider(provider);

    // Execute a single stage via InnerLoop.runStage
    const innerStageResult: InnerStageResult = await innerLoop.runStage(stage, storyId, provider);

    // 5. 完成门 + 阶段切换
    return this.handleStageResult(stage, innerStageResult);
  }

  // ── 5. 完成门 + 阶段切换 ──

  /**
   * V16: 处理 stage 执行结果（成功 / awaiting / 失败）。
   * V18: awaitingAction 透传到 data.awaitingAction。
   */
  private handleStageResult(stage: Stage, innerStageResult: InnerStageResult): LoopResponse<any> {
    // V18: Pass awaitingAction as 5th param so it's propagated in data.awaitingAction
    if (innerStageResult.awaitingAction) {
      return this.deps.buildResponse(stage, {
        tool: innerStageResult.awaitingAction.tool,
        action: innerStageResult.awaitingAction.action,
        reason: innerStageResult.awaitingAction.reason || `Awaiting LLM to execute ${innerStageResult.awaitingAction.tool} for stage "${stage}"`,
      }, false, 'inner', innerStageResult.awaitingAction);
    }

    if (innerStageResult.success) {
      return this.onStageSuccess(stage, innerStageResult);
    }

    // Stage failed
    if (innerStageResult.escalated) {
      this.deps.circuitBreaker.recordFailure('inner', innerStageResult.escalation_reason || 'Stage failed');
      return this.deps.buildResponse(stage, {
        tool: 'aza_loop', action: 'escalate',
        reason: innerStageResult.escalation_reason || `Stage "${stage}" escalated`,
      }, false, 'inner');
    }

    // Not done (needs retry) — return refine action
    this.deps.circuitBreaker.recordFailure('phase', `Stage "${stage}" gate check failed`);

    // Check phase-level stagnation
    const phaseCheck = this.deps.circuitBreaker.check('phase');
    if (phaseCheck.tripped) {
      this.deps.circuitBreaker.recordFailure('inner', `Phase "${stage}" circuit breaker tripped`);
      return this.deps.buildResponse(stage, {
        tool: 'aza_loop', action: 'escalate',
        reason: `Stage "${stage}" circuit breaker tripped: ${phaseCheck.reason}`,
      }, false, 'inner');
    }

    return this.deps.buildResponse(stage, {
      tool: 'aza_spec',
      action: stage === 'design' ? 'design' : stage === 'verify' ? 'verify' : 'implement',
      reason: `Stage "${stage}" needs refinement (iteration ${innerStageResult.iteration})`,
    }, false, 'phase');
  }

  /**
   * 阶段成功后的处理：完成门 + 阶段切换。
   */
  private onStageSuccess(stage: Stage, innerStageResult: InnerStageResult): LoopResponse<any> {
    const { stateMachine, completionGate, blockCount, stopHookActive, ledgerHasProgress } = this.deps;

    this.deps.circuitBreaker.recordProgress('inner');
    this.deps.markLedgerProgress();

    // Check if all stages completed
    const state = stateMachine.getState();
    const allCompleted = Object.entries(state.stages).every(
      ([name, s]) => s.status === 'completed' || (name === 'archive' && stage === 'archive'),
    );
    const attestationVerified = state.attestation?.verified ?? false;

    if (allCompleted && stage === 'archive') {
      const gateResult = completionGate.evaluate({
        gated_mode_enabled: true,
        has_in_progress_stage: false,
        all_stages_completed: allCompleted,
        stop_hook_active: stopHookActive,
        block_count: blockCount,
        block_count_limit: DEFAULT_BLOCK_COUNT_LIMIT,
        ledger_has_progress: ledgerHasProgress,
        attestation_verified: attestationVerified,
      });
      if (gateResult.canStop) {
        stateMachine.setStageStatus('archive', 'completed');
        return this.deps.buildResponse('archive', {
          tool: 'aza_loop', action: 'done',
          reason: 'All stages complete — project archived',
        });
      } else {
        return this.deps.buildResponse(stage, {
          tool: 'aza_quality', action: 'check',
          reason: `CompletionGate blocked: ${gateResult.blockedReason}`,
        });
      }
    }

    // Advance to next stage
    const STAGES: Stage[] = ['open', 'design', 'build', 'verify', 'archive'];
    const idx = STAGES.indexOf(stage);
    if (idx >= 0 && idx < STAGES.length - 1) {
      const nextStage = STAGES[idx + 1]!;
      stateMachine.setStageStatus(stage, 'completed');
      stateMachine.setStageStatus(nextStage, 'in_progress');
      stateMachine.setPhaseLoopState({
        current: nextStage,
        iteration: 0,
        history: [],
      });
      return this.deps.buildResponse(nextStage, this.deps.getStageEntryAction(nextStage), false, 'inner');
    }

    // archive stage — stay on same stage, next iteration
    return this.deps.buildResponse(stage, this.deps.getStageEntryAction(stage), false, 'inner');
  }
}
