/**
 * R12 P6 Plus (P2 退出标准) — Next Orchestrator 拆分
 *
 * 借鉴 spec-kit「executable specification」+ agency-orchestrator「workflow runtime」+ ruflo「harness」：
 *
 * 痛点：loop-controller.ts 1601 行；`next()` 主方法包含 deadlock 探测、内容停滞、
 *       进度记录、路由分发、OuterLoop、cold-start 重试等 6 段逻辑共 ~160 行。
 *
 * 解法：把 `next()` 拆为「主编排器 (NextOrchestrator) + 阶段执行器 (PhaseHandler) + 状态机操作器 (StateOps)」
 *   1. NextOrchestrator (本文件) — 主编排：sync + 探测 + 记录 + 路由 + 重试
 *   2. PhaseHandler — 阶段执行：nextV12 / nextV11 拆分
 *   3. StateOps — 状态机操作：buildResponse / getStageEntryAction 等
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 */

import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { Stage } from '../state-machine';
import type { ProgressLedger2D } from '../progress-ledger';
import type { DeadlockDetector } from '../deadlock-detector';
import type { HardStopManager } from '../hard-stop';
import type { CircuitBreaker } from '../circuit-breaker';
import type { StrikeSystem } from '../../L4_discipline/strike-system';
import type { TokenBudget, BudgetAction } from '../token-budget';
import { StateMachine } from '../state-machine';
import * as fs from 'fs';
import * as path from 'path';

// ── Orchestrator dependencies (injected from LoopController) ──

export interface NextOrchestratorDeps {
  // ── State holders (read/write shared state) ──
  stateMachine: StateMachine;
  ledger2d: ProgressLedger2D;
  deadlockDetector: DeadlockDetector;
  hardStop: HardStopManager;
  circuitBreaker: CircuitBreaker;
  strikeSystem: StrikeSystem;
  tokenBudget: TokenBudget;

  // ── Config / state snapshot ──
  config: {
    maxIterations: number;
    enableOuterLoop: boolean;
    enableV12: boolean;
    azaDir: string;
  };
  /** Original options including projectRoot */
  options: {
    projectRoot?: string;
  };
  /** aza directory for content/quality markers */
  azaDir?: string;

  // ── Stage iteration map (per-stage counter) ──
  getStageIteration: (stage: Stage) => number;
  setStageIteration: (stage: Stage, n: number) => void;

  // ── Last hashes (drift detection) ──
  getLastHashes: () => { prd?: string; contract?: string };
  setLastHashes: (h: { prd?: string; contract?: string }) => void;

  // ── Audit log appender (best-effort) ──
  auditAppend?: (entry: Record<string, unknown>) => void;

  // ── Routing dispatchers ──
  dispatchV12: (currentStage?: string) => Promise<LoopResponse<any>>;
  dispatchV11: (currentStage?: string) => LoopResponse<any>;
  dispatchOuterLoop: () => Promise<LoopResponse<any>>;
  buildOuterLoopResponse: (outerResult: any) => LoopResponse<any>;

  // ── State sync (file ↔ memory) ──
  syncStateFromFile: () => Promise<void>;
  syncStateToFile: () => Promise<void>;

  // ── Response builder ──
  buildResponse: (
    stage: string,
    nextAction: NextAction,
    isHardStop?: boolean,
    loopLevel?: 'outer' | 'inner' | 'phase',
  ) => LoopResponse<any>;

  // ── OuterLoop board advance (sequential multi-story) ──
  advanceOuterBoardIfNeeded: (result: LoopResponse<any>) => Promise<void>;
}

/**
 * 主编排器：负责 next() 的全部调度逻辑。
 *
 * 核心职责：
 *   1. 同步状态（文件 → 内存）
 *   2. 死锁检测（no-progress + content stagnation）
 *   3. 进度账本记录
 *   4. 路由分发（OuterLoop / V12 / V11）
 *   5. Cold-start 异常重试
 *   6. 同步状态（内存 → 文件）
 */
export class NextOrchestrator {
  constructor(private readonly deps: NextOrchestratorDeps) {}

  /**
   * 主入口：next() 的全部编排逻辑。
   * 行为等价于原 LoopController.next() 方法。
   */
  async run(currentStage?: string): Promise<LoopResponse<{
    stage: string;
    progress: string;
    next_action: NextAction;
    awaitingAction?: NextAction;
  }>> {
    const { stateMachine, ledger2d, deadlockDetector, hardStop, circuitBreaker } = this.deps;

    // 1. 同步文件状态到内存
    await this.deps.syncStateFromFile();

    // 2. G4: No-progress deadlock check
    const noProgress = deadlockDetector.checkNoProgress(ledger2d.getLastChangeAt());
    if (noProgress.deadlocked) {
      hardStop.stop(
        'max_iterations_exceeded',
        `no_progress_recovery: ${noProgress.reason ?? 'no progress detected'}`,
        stateMachine.getState().iteration,
      );
      return this.deps.buildResponse(stateMachine.getCurrentStage(), {
        tool: 'aza_loop',
        action: 'stop',
        reason: noProgress.reason ?? 'no_progress_recovery',
      }, true);
    }

    // 3. R10 第8轮 (D10 深化): 内容哈希停滞检测
    const stagnationResponse = this.checkContentStagnation();
    if (stagnationResponse) return stagnationResponse;

    // 4. G1: Record iteration into 2D progress ledger
    this.recordProgress(currentStage);

    // 5. 主循环：路由 + cold-start retry
    let result: LoopResponse<any>;
    try {
      if (
        this.deps.config.enableOuterLoop &&
        process.env.AZA_OUTER_LOOP_DRIVER === 'true'
      ) {
        const outerResult = await this.deps.dispatchOuterLoop();
        result = this.deps.buildOuterLoopResponse(outerResult);
      } else {
        result = this.deps.config.enableV12
          ? await this.deps.dispatchV12(currentStage)
          : this.deps.dispatchV11(currentStage);
      }

      // Sequential multi-story
      if (this.deps.config.enableOuterLoop && result.success) {
        await this.deps.advanceOuterBoardIfNeeded(result);
      }
    } catch (err) {
      // G5: Cold-start retry
      const message = err instanceof Error ? err.message : String(err);
      try {
        result = await circuitBreaker.coldStartRetry(async () => {
          return await this.deps.dispatchV12(currentStage);
        });
      } catch (retryErr) {
        const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
        return this.deps.buildResponse(stateMachine.getCurrentStage(), {
          tool: 'aza_loop',
          action: 'stop',
          reason: `next() failed: ${message}; coldStartRetry failed: ${retryMessage}`,
        }, true);
      }
    }

    // 6. 同步内存状态到文件
    await this.deps.syncStateToFile();
    return result;
  }

  /**
   * R10 第8轮 (D10 深化)：内容哈希停滞检测。
   * 与 checkNoProgress 互补：循环可能快速空转（每秒 1 轮但内容不变），
   * 时间检测 30min 才会触发，内容检测 5 轮即可触发，更快暴露死循环。
   *
   * EXCEED: 若已进入 archive/verify 且质量门已过，视为「完成」而非 stagnation hard-stop。
   */
  private checkContentStagnation(): LoopResponse<any> | null {
    const entries = this.deps.ledger2d.getEntries();
    if (entries.length < 5) return null;

    const stagnation = this.deps.deadlockDetector.checkContentStagnationFromEntries(entries);
    if (!stagnation.deadlocked) return null;

    const stageNow = this.deps.stateMachine.getCurrentStage();
    const azaDir = this.deps.azaDir;
    let qualityOk = false;
    try {
      qualityOk = !!(
        azaDir &&
        (fs.existsSync(`${azaDir}/quality-passed.marker`) ||
          fs.existsSync(`${azaDir}/build-complete.marker`))
      );
    } catch {
      qualityOk = false;
    }

    // EXCEED: archive/verify + 质量门过 = 完成
    if (qualityOk && (stageNow === 'archive' || stageNow === 'verify')) {
      return this.deps.buildResponse(stageNow, {
        tool: 'aza_finish',
        action: 'ship',
        reason: 'content unchanged but quality/build markers present — treat as complete, ship',
      }, true);
    }

    // Hard stop
    this.deps.hardStop.stop(
      'max_iterations_exceeded',
      `content_stagnation_recovery: ${stagnation.reason ?? 'content unchanged across iterations'}`,
      this.deps.stateMachine.getState().iteration,
    );

    // 审计记录
    try {
      this.deps.auditAppend?.({
        type: 'hard_stop',
        source: 'deadlock-detector.checkContentStagnation',
        details: {
          reason: stagnation.reason,
          consecutiveCount: stagnation.consecutiveCount,
          lastChangeAt: this.deps.ledger2d.getLastChangeAt(),
          iteration: this.deps.stateMachine.getState().iteration,
        },
      });
    } catch {
      /* best-effort */
    }

    return this.deps.buildResponse(this.deps.stateMachine.getCurrentStage(), {
      tool: 'aza_loop',
      action: 'stop',
      reason: stagnation.reason ?? 'content_stagnation_recovery',
    }, true);
  }

  /**
   * G1: Record iteration into 2D progress ledger.
   * R10 第2轮 (D10): 把 PRD/contract 哈希一起记入账本。
   */
  private recordProgress(currentStage?: string): void {
    const stageForRecord = (currentStage as Stage | undefined) ?? this.deps.stateMachine.getCurrentStage();
    const stageIter = this.deps.getStageIteration(stageForRecord);

    // R10 第2轮 (D10): 把内容哈希拼接传入，ProgressLedger2D 会在哈希变化时刷新 lastChangeAt
    const lastHashes = this.deps.getLastHashes();
    let stageContentHash: string | undefined;
    if (lastHashes.prd || lastHashes.contract) {
      stageContentHash = [lastHashes.prd, lastHashes.contract]
        .filter(Boolean).join('|') || undefined;
    }
    this.deps.ledger2d.record(
      stageForRecord,
      this.deps.stateMachine.getState().iteration,
      stageIter,
      'in_progress',
      stageContentHash,
    );
  }
}
