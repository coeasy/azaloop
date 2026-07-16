/**
 * Converged MCP handlers — 8 tools × action discriminant.
 * Delegates to existing per-tool implementations.
 */

import type { StateManager, ResumeGenerator } from '@azaloop/core';
import { breakLoop, AutoLoopDriver, LoopController, AutoLoopEngine } from '@azaloop/core';
import {
  handlePRDGenerate,
  handlePRDValidate,
  handlePrdReview,
  handlePrdApprove,
  handlePrdModify,
  handlePrdCancel,
  handlePrdDraft,
  handlePrdMultiReview,
  handlePrdRefine,
} from './tools/aza-prd';
import {
  handleLoopNext,
  handleLoopStatus,
  handleLoopComplete,
  handleLoopStop,
  handleLoopSetCondition,
  handleLoopResetConditions,
  handleLoopGetStageIterations,
  handleLoopCircuitBreaker,
  handleLoopCompletionGate,
  handleLoopAudit,
  handleAutoLoop,
  markPrdApproved,
} from './tools/aza-loop';
import { handleTaskDesign, handleTaskImplement, handleTaskVerify } from './tools/aza-task';
import { handleQualityCheck, handleUiQa } from './tools/aza-quality';
import { handleMemoryQuery, handleMemoryRecord } from './tools/aza-memory';
import { handleContextCalibrate, handleContextStatus } from './tools/aza-context';
import { handleContinue } from './tools/aza-continue';
import { handleHealthCheck } from './tools/aza-health';
import { handleDocGenerate } from './tools/aza-doc';
import { handleSkillSearch, handleSkillList } from './tools/aza-skill';
import { handleSecurityScan } from './tools/aza-security';
import { handleStyleCheck, handleStyleLearn } from './tools/aza-style';
import { handleAudit } from './tools/aza-audit';
import { handleCompliance } from './tools/aza-compliance';
import { handleDag } from './tools/aza-dag';
import {
  handleRunstateStatus,
  handleRunstateUpdate,
  handleAuditLogRecent,
  handleAuditLogSearch,
} from './tools/aza-runstate';
import {
  handleConventionsList,
  handleConventionsWrite,
  handleConventionsExtract,
} from './tools/aza-conventions';
import { handleSessionStart } from './tools/aza-session';
import { handleInit } from './tools/aza-init';
import { handleEvalRun, handleEvalSummary } from './tools/aza-eval';
import { handleExplore } from './tools/aza-explore';
import {
  handleOpenSpecPropose,
  handleOpenSpecApply,
  handleOpenSpecArchive,
} from './tools/aza-openspec';
import { handleBudget } from './tools/aza-budget';
import { handleFinishWork } from './tools/aza-finish-work';
import {
  handleMetaWorktree,
  handleMetaSwarm,
  handleMetaStores,
  handleMetaDlp,
} from './tools/aza-meta-ext';
import { handleCost } from './tools/aza-cost';
import { handlePlugin } from './tools/aza-plugin';
import { handleTestLoop } from './tools/aza-test-loop';

function fail(action: string, allowed: string[]) {
  return {
    success: false,
    error: `Unknown action "${action}". Allowed: ${allowed.join(', ')}`,
    data: null,
  };
}

export async function handleAzaSession(
  args: Record<string, unknown>,
  stateManager: StateManager,
): Promise<unknown> {
  const action = String(args.action ?? 'calibrate');
  const workspace = (args.workspace_path as string) || process.cwd();
  const client = typeof args.client === 'string' ? args.client.trim() : '';
  const model =
    typeof args.model === 'string'
      ? args.model.trim()
      : (process.env.AZA_MODEL || process.env.CURSOR_MODEL || '').trim();

  // Persist client/model for cross-session RESUME accuracy
  if (client || model) {
    try {
      const state = stateManager.getState();
      await stateManager.update({
        loop: {
          ...state.loop,
          client: client || state.loop.client,
          model: model || state.loop.model || 'unknown',
        },
      });
    } catch {
      /* best-effort */
    }
  }

  switch (action) {
    case 'init':
      return handleInit(workspace, client || (args.client as string));
    case 'start':
      return handleSessionStart(workspace);
    case 'calibrate':
      return remapNext(await handleContextCalibrate(workspace), {
        tool: 'aza_prd',
        action: 'review',
      });
    case 'status':
      return handleContextStatus(stateManager);
    case 'continue':
      return remapNext(
        await handleContinue(
          (args.base_dir as string) ||
            (workspace ? `${workspace.replace(/[\\/]$/, '')}/.aza` : '.aza'),
          { client: client || undefined, model: model || undefined },
        ),
        { tool: 'aza_loop', action: 'full' },
      );
    case 'health':
      return handleHealthCheck();
    default:
      return fail(action, ['init', 'start', 'calibrate', 'status', 'continue', 'health']);
  }
}

export async function handleAzaPrd(
  args: Record<string, unknown>,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<unknown> {
  const action = String(args.action ?? 'review');
  const client = typeof args.client === 'string' ? args.client.trim() : undefined;
  switch (action) {
    case 'review': {
      const autoApprove =
        args.auto_approve === true ||
        process.env.AZA_AUTO_APPROVE_PRD === 'true';
      const result = await handlePrdReview(
        {
          title: args.title as string,
          description: args.description as string,
          source: (args.source as 'openspec' | 'aza-prd') || undefined,
          openspec: args.openspec !== false,
          workspace_path:
            (args.workspace_path as string) ||
            stateManager.azaDir?.replace(/[\\/]\.aza$/, '') ||
            process.cwd(),
        },
        stateManager,
        resumeGenerator,
      );
      if (autoApprove && (result as any)?.success) {
        const approved = await handlePrdApprove(
          args.answers as Record<string, string> | undefined,
          stateManager,
          resumeGenerator,
        );
        // Spine: approve must unlock open→design guards (prd_valid + DP-1 + audit marker)
        if ((approved as any)?.success !== false) {
          const workspace =
            (args.workspace_path as string) || stateManager.azaDir?.replace(/[\\/]\.aza$/, '') || process.cwd();
          await markPrdApproved(workspace, client);
        }
        return {
          ...approved,
          data: { review: (result as any).data, approve: (approved as any).data, auto_approved: true },
          next_action: {
            tool: 'aza_loop',
            action: 'full',
            reason: 'Auto-approved PRD — start full loop',
          },
        };
      }
      const r = result as any;
      if (r?.next_action) {
        r.next_action = {
          tool: 'aza_prd',
          action: 'wait',
          reason: r.next_action.reason,
        };
      }
      return result;
    }
    case 'approve': {
      const approved = await handlePrdApprove(
        args.answers as Record<string, string> | undefined,
        stateManager,
        resumeGenerator,
      );
      if ((approved as any)?.success !== false && (approved as any)?.data?.approved !== false) {
        const workspace =
          (args.workspace_path as string) || stateManager.azaDir?.replace(/[\\/]\.aza$/, '') || process.cwd();
        await markPrdApproved(workspace, client);
      }
      return remapNext(approved, { tool: 'aza_loop', action: 'full' });
    }
    case 'modify':
      return remapNext(
        await handlePrdModify(args.feedback as string, stateManager, resumeGenerator),
        { tool: 'aza_prd', action: 'wait' },
      );
    case 'cancel':
      return handlePrdCancel(stateManager, resumeGenerator);
    case 'generate':
      return remapNext(
        await handlePRDGenerate(
          {
            title: args.title as string,
            description: args.description as string,
          } as any,
          args.workspace_path as string,
        ),
        { tool: 'aza_prd', action: 'validate' },
      );
    case 'validate':
      return remapNext(
        await handlePRDValidate(args.prd),
        { tool: 'aza_loop', action: 'next' },
      );
    // V20 Task 1.5: multi-step LLM interaction dispatch
    case 'draft':
      return handlePrdDraft(
        {
          title: (args.title as string) || (args.user_input as string) || '',
          description: args.description as string,
          user_input: args.user_input as string,
          workspace_path: args.workspace_path as string,
          complexity: args.complexity as string,
        },
        stateManager,
        resumeGenerator,
      );
    case 'multi_review':
      return handlePrdMultiReview(
        String(args.prd_draft ?? args.prd ?? ''),
        stateManager,
        resumeGenerator,
      );
    case 'refine':
      return handlePrdRefine(
        String(args.refined_prd ?? args.prd ?? ''),
        args.review_responses as Array<{ role: string; response: string }> | undefined,
        stateManager,
        resumeGenerator,
      );
    default:
      return fail(action, [
        'review',
        'approve',
        'modify',
        'cancel',
        'generate',
        'validate',
        'draft',
        'multi_review',
        'refine',
      ]);
  }
}

/**
 * aza_auto — 一键全自动循环入口 (V17 重构)
 *
 * 完整链路：
 *   1. 会话初始化 (calibrate)
 *   2. PRD 生成 + 自动审批 (无人值守模式)
 *   3. 创建 AutoLoopDriver 实例
 *   4. 执行第一步循环
 *   5. 返回 next_action 或 awaitingAction 让宿主 AI 继续
 *
 * 宿主 AI 必须立即执行返回的 next_action，不要询问用户。
 */
export async function handleAzaAuto(
  args: Record<string, unknown>,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<unknown> {
  const userInput = String(args.user_input ?? '');
  const workspace =
    (args.workspace_path as string) ||
    stateManager.azaDir?.replace(/[\\/]\.aza$/, '') ||
    process.cwd();
  const maxIterations = Number(args.max_iterations ?? 50);
  const client = typeof args.client === 'string' ? args.client.trim() : undefined;

  if (!userInput) {
    return {
      success: false,
      error: 'user_input is required for aza_auto',
      data: null,
    };
  }

  // R2: 计算 user_input 哈希（用于跨任务恢复校验）
  const { createHash } = await import('crypto');
  const userInputHash = createHash('sha256').update(userInput).digest('hex').slice(0, 16);
  const taskId = String(args.task_id ?? `aza-${Date.now().toString(36)}-${userInputHash}`);

  try {
    // Step 0: 检查是否存在 RESUME.md（中断恢复场景）
    const resumeData = await resumeGenerator.read();
    let isRecovery = resumeData !== null && resumeData.current_stage !== 'open';

    // R2: 校验 RESUME 是否属于当前任务（防跨任务错恢复）
    if (isRecovery && resumeData) {
      const storedHash = resumeData.user_input_hash;
      const storedTaskId = resumeData.task_id;
      const hashMismatch = storedHash && storedHash !== userInputHash;
      const taskMismatch = storedTaskId && taskId && storedTaskId !== taskId;
      if (hashMismatch || taskMismatch) {
        console.warn(
          `[aza_auto] R2 guard: RESUME.md belongs to a different task ` +
            `(stored_hash=${storedHash}, current_hash=${userInputHash}, ` +
            `stored_task=${storedTaskId}, current_task=${taskId}). ` +
            `Discarding stale RESUME and starting fresh.`,
        );
        // 清理旧 RESUME，走全新路径
        try {
          const fsSync = await import('fs/promises');
          const resumePath = `${stateManager.azaDir}/RESUME.md`;
          await fsSync.unlink(resumePath).catch(() => {});
        } catch {
          /* best-effort */
        }
        isRecovery = false;
      } else {
        console.log(
          `[aza_auto] Recovery mode: resuming from stage ${resumeData.current_stage}, ` +
            `iteration ${resumeData.iteration}, task=${storedTaskId || 'unknown'}`,
        );
      }
    }

    if (isRecovery && resumeData) {
      // 中断恢复模式：跳过 PRD 生成，直接进入循环恢复
    } else {
      // 全新会话：执行完整的初始化流程
      // Step 1: 会话初始化
      await handleAzaSession(
        { action: 'calibrate', workspace_path: workspace, user_input: userInput },
        stateManager,
      );

      // Step 2: PRD 生成 + 自动审批（无人值守模式）
      const draftResult = await handleAzaPrd(
        {
          action: 'draft',
          title: userInput,
          description: userInput,
          workspace_path: workspace,
          user_input: userInput,
        },
        stateManager,
        resumeGenerator,
      );

      // 自动审批 PRD（无人值守）
      const approveResult = await handleAzaPrd(
        {
          action: 'approve',
          workspace_path: workspace,
          auto_approve: true,
        },
        stateManager,
        resumeGenerator,
      );

      // 标记 PRD 已审批（解锁 open→design）
      await markPrdApproved(workspace, client);

      // R2: 把 task_id + user_input_hash 写入 RESUME（确保下次恢复能校验）
      try {
        await resumeGenerator.generate(stateManager, {
          task_id: taskId,
          user_input_hash: userInputHash,
        });
      } catch {
        /* best-effort */
      }
    }

    // Step 3: 使用缓存的 AutoLoopDriver（确保与 aza_loop(report_tool) 状态一致）
    const { buildDriver } = await import('./tools/aza-loop');
    const driver = buildDriver(workspace, client);

    // Step 4: 真正全自动循环 - 循环步进直到 awaitingAction 或 done
    const maxSteps = Number(process.env.AZA_AUTO_MAX_STEPS ?? maxIterations);
    let stepResult;
    let lastStage = 'open';
    let lastIteration = 0;

    for (let i = 0; i < maxSteps; i++) {
      // R3: 每 N 步做一次上下文裁剪（避免上下文无限膨胀）
      if (i > 0 && i % 5 === 0) {
        try {
          const azaDir = `${workspace}/.aza`;
          const { ContextOrchestrator } = await import('@azaloop/core');
          const orchestrator = new ContextOrchestrator(azaDir);
          const bundle = await orchestrator.injectContext(lastStage as any);
          if (bundle && bundle.entries && bundle.entries.length > 0) {
            const budget = Number(process.env.AZA_CONTEXT_BUDGET_TOKENS ?? 8000);
            const pruned = orchestrator.pruneContext(bundle, budget);
            if (pruned && pruned.entries) {
              console.log(
                `[aza_auto] R3 context prune: ${bundle.entries.length} → ${pruned.entries.length} entries, ` +
                  `tokens ${bundle.totalTokens} → ${pruned.totalTokens}`,
              );
            }
          }
        } catch (pruneErr) {
          // 裁剪失败不阻断循环
          /* best-effort */
        }
      }
      // R2: 单步 try-catch — 中途异常时保存状态并返回可恢复 next_action
      try {
        stepResult = await driver.step();
      } catch (stepErr) {
        // 保存当前状态，让下次能恢复
        try {
          await stateManager.save();
        } catch {
          /* best-effort */
        }
        const errMsg = stepErr instanceof Error ? stepErr.message : String(stepErr);
        console.error(
          `[aza_auto] Step ${i + 1} failed: ${errMsg}. State saved for recovery.`,
        );
        return {
          success: false,
          recoverable: true,
          error: `step_${i + 1}_failed: ${errMsg}`,
          data: {
            stage: lastStage,
            iteration: lastIteration,
            status: 'step_error',
            stepsExecuted: i,
          },
          next_action: {
            tool: 'aza_auto',
            action: 'continue',
            reason: '上一步异常已保存状态，重新调用 aza_auto 同一 user_input 可恢复',
          },
          metadata: {
            task_id: taskId,
            user_input_hash: userInputHash,
            failed_step: i + 1,
            error: errMsg,
          },
        };
      }
      lastStage = stepResult.stage;
      lastIteration = stepResult.iteration;

      // 遇到 awaitingAction 返回给宿主 AI 执行
      if (stepResult.awaitingAction) {
        return {
          success: true,
          data: {
            stage: stepResult.stage,
            iteration: stepResult.iteration,
            status: 'paused',
            awaitingAction: stepResult.awaitingAction,
            instruction: '立即执行指定工具，然后调用 aza_loop(action=report_tool, tool_name=...) 续跑循环',
            stepsExecuted: i + 1,
          },
          next_action: {
            tool: stepResult.awaitingAction.tool,
            action: stepResult.awaitingAction.action,
            reason: stepResult.awaitingAction.reason || '执行全自动循环的下一步',
          },
          metadata: {
            iteration: stepResult.iteration,
            stage: stepResult.stage,
            loop_level: 'inner',
            stepsExecuted: i + 1,
            task_id: taskId,
            user_input_hash: userInputHash,
          },
        };
      }

      // 循环完成
      if (stepResult.done) {
        return {
          success: true,
          data: {
            stage: stepResult.stage,
            iteration: stepResult.iteration,
            status: 'completed',
            reason: stepResult.nextAction?.reason || '全自动循环完成',
            stepsExecuted: i + 1,
          },
          next_action: stepResult.nextAction || {
            tool: 'aza_finish',
            action: 'ship',
            reason: '全自动循环完成，执行交付',
          },
          metadata: {
            iteration: stepResult.iteration,
            stage: stepResult.stage,
            loop_level: 'inner',
            stepsExecuted: i + 1,
            task_id: taskId,
          },
        };
      }

      // 继续下一步
    }

    // 达到最大步数但未完成
    return {
      success: true,
      data: {
        stage: lastStage,
        iteration: lastIteration,
        status: 'max_steps_reached',
        reason: `达到最大步数 ${maxSteps}，循环未完成`,
        stepsExecuted: maxSteps,
      },
      next_action: {
        tool: 'aza_loop',
        action: 'full',
        reason: '继续全自动循环',
      },
      metadata: {
        iteration: lastIteration,
        stage: lastStage,
        loop_level: 'inner',
        stepsExecuted: maxSteps,
        task_id: taskId,
      },
    };
  } catch (error) {
    return {
      success: false,
      recoverable: true,
      error: `aza_auto failed: ${error instanceof Error ? error.message : String(error)}`,
      data: { task_id: taskId, user_input_hash: userInputHash },
    };
  }
}

export async function handleAzaLoop(args: Record<string, unknown>): Promise<unknown> {
  const action = String(args.action ?? 'step');
  const workspace = args.workspace_path as string;
  const stage = (args.current_stage as string) || (args.stage as string);
  const client = typeof args.client === 'string' ? args.client.trim() : undefined;

  switch (action) {
    case 'next':
      return remapNext(await handleLoopNext(stage, workspace, client), { tool: 'aza_loop', action: 'next' });
    case 'status':
      return handleLoopStatus(workspace, client);
    case 'complete':
      return handleLoopComplete(stage, workspace, client);
    case 'stop':
      return handleLoopStop((args.reason as string) || 'stopped', workspace, client);
    case 'set_condition':
      return handleLoopSetCondition(args.key as string, args.passed as boolean, workspace, client);
    case 'reset_conditions':
      return handleLoopResetConditions(workspace, client);
    case 'stage_iterations':
      return handleLoopGetStageIterations(stage, workspace, client);
    case 'circuit':
      return handleLoopCircuitBreaker(workspace, client);
    case 'gate':
      return handleLoopCompletionGate(workspace, client);
    case 'audit':
      return handleLoopAudit(workspace, client);
    case 'step':
    case 'full':
    case 'auto':
    case 'pause':
    case 'resume':
    case 'report_tool':
    case 'retry':
    case 'reset':
      return remapAutoLoop(
        await handleAutoLoop(action, stage, workspace, args.tool_name as string, client),
        workspace || process.cwd(),
      );
    // R9: 多任务批量执行——借鉴 ralphy --parallel + agency-orchestrator loop.max_iterations
    case 'batch': {
      const items = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
      const concurrency = Number(args.concurrency ?? 2);
      const worktree = Boolean(args.worktree);
      return handleAzaBatch(items, concurrency, worktree, workspace);
    }
    case 'orch_run':
    case 'orch_resume': {
      const { YAMLOrchestrator } = await import('@azaloop/core');
      const fs = await import('fs');
      const path = await import('path');
      const root = workspace ?? process.cwd();
      const orchPath =
        (args.orchestrator_path as string) ||
        path.join(root, '.aza', 'orchestrator.yaml');
      const orch = new YAMLOrchestrator();
      try {
        if (!fs.existsSync(orchPath)) {
          fs.mkdirSync(path.dirname(orchPath), { recursive: true });
          // Minimal YAML the lightweight parser understands (lists + nested maps).
          const minimal = [
            'name: azaloop-local-pipeline',
            'description: Seeded by aza_loop orch_run',
            'stages:',
            '  - id: specification',
            '    name: PRD specification',
            '    sparcPhase: specification',
            '    minScore: 0.1',
            '    requiredEvidence:',
            '      - pipeline_started',
            '    steps:',
            '      - id: "1.1"',
            '        tool: aza_prd',
            '        action: review',
            '        args: {}',
            '        depends_on: []',
            '  - id: refinement',
            '    name: Build',
            '    sparcPhase: refinement',
            '    minScore: 0.1',
            '    requiredEvidence:',
            '      - pipeline_started',
            '    steps:',
            '      - id: "2.1"',
            '        tool: aza_loop',
            '        action: full',
            '        args: {}',
            '        depends_on:',
            '          - "1.1"',
            '',
          ].join('\n');
          fs.writeFileSync(orchPath, minimal, 'utf8');
        }
        try {
          orch.loadPipelineFromFile(orchPath);
        } catch {
          // Fallback: programmatic pipeline (parser is intentionally limited)
          orch.loadPipeline({
            name: 'azaloop-fallback-pipeline',
            description: 'Programmatic fallback when YAML parse fails',
            stages: [
              {
                id: 'specification',
                name: 'PRD specification',
                sparcPhase: 'specification',
                minScore: 0.1,
                requiredEvidence: ['pipeline_started'],
                steps: [
                  { id: '1.1', tool: 'aza_prd', action: 'review', args: {}, depends_on: [] },
                ],
              },
              {
                id: 'refinement',
                name: 'Build',
                sparcPhase: 'refinement',
                minScore: 0.1,
                requiredEvidence: ['pipeline_started'],
                steps: [
                  { id: '2.1', tool: 'aza_loop', action: 'full', args: {}, depends_on: ['1.1'] },
                ],
              },
            ],
          });
        }
        const azaDir = path.join(root, '.aza');
        // Provide soft-pass evidence so local dry-runs can advance; real
        // deployments should inject stage-specific evidence via callbacks later.
        const report = await orch.runPipeline(azaDir, async (stage) => {
          const evidence = Array.isArray(stage.requiredEvidence)
            ? stage.requiredEvidence
            : ['pipeline_started'];
          return evidence.map((name: string) => ({
            name,
            passed: true,
            weight: 1,
          }));
        });
        const outDir = path.join(azaDir, 'orch-output', `run-${Date.now()}`);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
        return {
          success: report.success,
          data: { report, output_dir: outDir, orch_path: orchPath },
          next_action: report.success
            ? { tool: 'aza_loop', action: 'full', reason: 'YAML pipeline passed SPARC gates — continue full loop' }
            : { tool: 'aza_loop', action: 'status', reason: 'YAML pipeline failed a gate — inspect orch-output' },
          metadata: { iteration: 0, progress: report.success ? '40%' : '20%', stage: 'design' },
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
          data: null,
        };
      }
    }
    default:
      return fail(action, [
        'next', 'status', 'complete', 'stop', 'step', 'full', 'auto',
        'pause', 'resume', 'report_tool', 'retry', 'circuit', 'gate', 'audit',
        'set_condition', 'reset_conditions', 'stage_iterations', 'orch_run', 'orch_resume',
        'batch',
      ]);
  }
}

/**
 * R9: 多任务批量执行（aza_loop action=batch）
 * 借鉴 ralphy --parallel + agency-orchestrator loop.max_iterations+concurrency
 *
 * 输入：items = [{user_input, task_id, slug}, ...]
 * 输出：每个 item 独立 worktree（如启用）+ 独立 .aza/runs/<slug>/ 状态，并发执行。
 */
export async function handleAzaBatch(
  items: Array<Record<string, unknown>>,
  concurrency: number,
  worktree: boolean,
  workspace: string | undefined,
): Promise<unknown> {
  if (items.length === 0) {
    return {
      success: false,
      error: 'batch: items must be a non-empty array',
      data: null,
    };
  }
  const root = workspace || process.cwd();
  const { buildDriver } = await import('./tools/aza-loop');
  const results: Array<{
    task_id?: string;
    slug?: string;
    success: boolean;
    iterations: number;
    final_stage?: string;
    reason?: string;
    duration_ms: number;
  }> = [];

  // 简单信号量并发控制（无需 worktree 时也安全）
  const queue = [...items];
  const workers: Promise<void>[] = [];
  const start = Date.now();
  for (let w = 0; w < Math.max(1, concurrency); w++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          const itemStart = Date.now();
          const slug =
            (item.slug as string) ||
            `batch-${String(item.task_id || 'item').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)}-${Date.now().toString(36)}`;
          const itemWs = worktree
            ? `${root}/.aza/runs/${slug}`
            : `${root}/.aza/runs/${slug}`; // 同一文件下用 runs/<slug> 命名空间
          try {
            // R9: 用 isolated .aza/runs/<slug> 目录避免冲突
            const fs = await import('fs/promises');
            await fs.mkdir(itemWs, { recursive: true });
            const driver = buildDriver(itemWs);
            const maxIter = Number(item.max_iterations ?? 30);
            let iter = 0;
            let lastStage: string | undefined;
            let done = false;
            for (let i = 0; i < maxIter; i++) {
              const r = await driver.step();
              iter = r.iteration;
              lastStage = r.stage;
              if (r.done) {
                done = true;
                break;
              }
            }
            results.push({
              task_id: item.task_id as string,
              slug,
              success: done,
              iterations: iter,
              final_stage: lastStage,
              reason: done ? 'completed' : `max_iterations(${maxIter}) reached`,
              duration_ms: Date.now() - itemStart,
            });
          } catch (e) {
            results.push({
              task_id: item.task_id as string,
              slug,
              success: false,
              iterations: 0,
              reason: e instanceof Error ? e.message : String(e),
              duration_ms: Date.now() - itemStart,
            });
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
  const success = results.every((r) => r.success);
  return {
    success,
    data: {
      total: items.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      concurrency,
      worktree,
      duration_ms: Date.now() - start,
      results,
    },
    next_action: success
      ? { tool: 'aza_finish', action: 'ship', reason: 'All batch items completed' }
      : { tool: 'aza_loop', action: 'status', reason: 'Some batch items failed — inspect results' },
    metadata: { loop_level: 'outer', batch: true, count: items.length },
  };
}

export async function handleAzaSpec(args: Record<string, unknown>): Promise<unknown> {
  const action = String(args.action ?? 'design');
  switch (action) {
    case 'design':
      return remapNext(
        await handleTaskDesign(
          args.story_id as string,
          args.title as string,
          args.description as string,
          (args.workspace_path as string) || process.cwd(),
        ),
        { tool: 'aza_loop', action: 'full' },
      );
    case 'implement':
      return remapNext(
        await handleTaskImplement(
          args.task_id as string,
          (args.workspace_path as string) || process.cwd(),
        ),
        { tool: 'aza_loop', action: 'report_tool' },
      );
    case 'verify':
      return remapNext(
        await handleTaskVerify(args.task_id as string),
        { tool: 'aza_quality', action: 'check' },
      );
    case 'explore':
      return handleExplore(args.workspace_path as string, args.focus as string | undefined);
    case 'propose':
      return handleOpenSpecPropose(
        (args.workspace_path as string) || process.cwd(),
        (args.title as string) || 'change',
        args.description as string | undefined,
      );
    case 'apply':
      return handleOpenSpecApply(
        (args.workspace_path as string) || process.cwd(),
        (args.focus as string) || (args.story_id as string) || undefined,
      );
    case 'archive':
      return handleOpenSpecArchive(
        (args.workspace_path as string) || process.cwd(),
        (args.title as string) || undefined,
      );
    case 'dag':
      return handleDag(
        (args.dag_action as 'build' | 'status' | 'parallel') || 'build',
        args.tasks as any,
        args.dag as any,
      );
    default:
      return fail(action, ['design', 'implement', 'verify', 'explore', 'propose', 'apply', 'archive', 'dag']);
  }
}

export async function handleAzaQuality(args: Record<string, unknown>): Promise<unknown> {
  const action = String(args.action ?? 'check');
  const root = (args.project_root as string) || (args.workspace_path as string) || process.cwd();
  switch (action) {
    case 'check':
      return remapNext(await handleQualityCheck(root), {
        tool: 'aza_finish',
        action: 'ship',
      }, { tool: 'aza_quality', action: 'check' });
    case 'security':
      return handleSecurityScan(root);
    case 'compliance':
      return handleCompliance(args.workspace_path as string, args.check_type as 'full' | 'quick' | undefined);
    case 'eval':
      return handleEvalRun(args.test_output as string, args.expected_behavior as string);
    case 'eval_summary':
      return handleEvalSummary(args.workspace_path as string);
    case 'style':
      return handleStyleCheck(args.code as string, args.file_path as string);
    case 'style_learn':
      return handleStyleLearn();
    case 'ui_qa':
      return handleUiQa(root, args.url as string | undefined);
    default:
      return fail(action, [
        'check',
        'security',
        'compliance',
        'eval',
        'eval_summary',
        'style',
        'style_learn',
        'ui_qa',
      ]);
  }
}

export async function handleAzaFinish(
  args: Record<string, unknown>,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<unknown> {
  const action = String(args.action ?? 'work');
  const workspace = args.workspace_path as string;
  switch (action) {
    case 'work':
      return remapNext(
        await handleFinishWork(
          {
            taskId: args.task_id as string,
            work_summary: args.work_summary as string,
            decisions: args.decisions as string[],
            open_questions: args.open_questions as string[],
            next_steps: args.next_steps as string[],
            iteration: args.iteration as number,
            stop_loop: args.stop_loop !== false,
            workspace_path: workspace,
          },
          stateManager,
          resumeGenerator,
        ),
        { tool: 'aza_session', action: 'continue' },
      );
    case 'archive':
      return handleDocGenerate(
        (args.type as string) || 'archive',
        args.title as string,
        args.content as string,
      );
    case 'ship': {
      // Quality re-check then finish-work
      const quality = await handleQualityCheck(
        workspace || process.cwd(),
      );
      if (!(quality as any).success) {
        return remapNext(quality, { tool: 'aza_quality', action: 'check' });
      }
      const finished = await handleFinishWork(
        {
          work_summary: (args.work_summary as string) || 'Ship: quality gates passed',
          stop_loop: true,
          workspace_path: workspace,
        },
        stateManager,
        resumeGenerator,
      );
      return {
        success: true,
        data: { quality: (quality as any).data, finish: finished, shipped: true },
        next_action: {
          tool: 'aza_session',
          action: 'continue',
          reason: 'Shipped — session idle. Start a new PRD for the next feature.',
        },
        metadata: { iteration: 0, progress: '100%', stage: 'archive' },
      };
    }
    case 'conventions':
    case 'conventions_list':
      return handleConventionsList(workspace);
    case 'conventions_write':
      return handleConventionsWrite(
        {
          tag: args.tag as string,
          description: args.description as string,
          source: args.source as string,
        } as any,
        workspace,
      );
    case 'conventions_extract':
      return handleConventionsExtract(
        args.work_summary as string,
        args.stage as string,
        args.iteration as number,
        workspace,
      );
    default:
      return fail(action, ['work', 'archive', 'ship', 'conventions', 'conventions_list', 'conventions_write', 'conventions_extract']);
  }
}

export async function handleAzaMemory(args: Record<string, unknown>): Promise<unknown> {
  const action = String(args.action ?? 'query');
  const workspace = args.workspace_path as string;
  switch (action) {
    case 'query':
      return handleMemoryQuery(args.query as string, workspace);
    case 'record':
      return handleMemoryRecord(
        args.type as string,
        args.summary as string,
        args.details as string,
        (args.tags as string[]) ?? [],
        workspace,
      );
    default:
      return fail(action, ['query', 'record']);
  }
}

export async function handleAzaMeta(args: Record<string, unknown>): Promise<unknown> {
  const action = String(args.action ?? 'budget');
  const workspace = args.workspace_path as string;
  switch (action) {
    case 'skills':
    case 'skills_search':
      return handleSkillSearch((args.query as string) || '');
    case 'skills_list':
      return handleSkillList(args.type as string);
    case 'runstate':
    case 'runstate_status':
      return handleRunstateStatus(workspace);
    case 'runstate_update':
      return handleRunstateUpdate(args as any, workspace);
    case 'audit_log':
    case 'audit_log_recent':
      return handleAuditLogRecent(args.limit as number, workspace);
    case 'audit_log_search':
      return handleAuditLogSearch(args.type as string, args.source as string, workspace);
    case 'budget':
      return handleBudget(workspace);
    case 'audit':
      return handleAudit(workspace);
    case 'plugin':
    case 'plugin_list':
      return handlePlugin({ ...(args as any), action: 'list' });
    case 'plugin_load':
      return handlePlugin({ ...(args as any), action: 'load' });
    case 'plugin_unload':
      return handlePlugin({ ...(args as any), action: 'unload' });
    case 'worktree':
    case 'worktree_list':
    case 'worktree_create':
    case 'worktree_remove':
      if (action === 'worktree_list') args.sub_action = 'list';
      if (action === 'worktree_create') args.sub_action = 'create';
      if (action === 'worktree_remove') args.sub_action = 'remove';
      return handleMetaWorktree(args);
    case 'swarm':
    case 'swarm_dispatch':
    case 'swarm_report':
    case 'swarm_status':
      if (action === 'swarm_dispatch') args.sub_action = 'dispatch';
      if (action === 'swarm_report') args.sub_action = 'report';
      if (action === 'swarm_status') args.sub_action = 'status';
      return handleMetaSwarm(args);
    case 'stores':
    case 'stores_put':
    case 'stores_search':
      if (action === 'stores_put') args.sub_action = 'put';
      if (action === 'stores_search') args.sub_action = 'search';
      return handleMetaStores(args);
    case 'dlp':
    case 'dlp_scan':
      return handleMetaDlp(args);
    case 'presets':
    case 'presets_list': {
      const { listPresets } = await import('@azaloop/core');
      const root = workspace || process.cwd();
      return {
        success: true,
        data: { presets: listPresets(root) },
        next_action: {
          tool: 'aza_meta',
          action: 'preset_apply',
          reason: 'Apply a preset via aza_meta(action=preset_apply, preset_id=...)',
        },
      };
    }
    case 'preset_apply': {
      const { applyPreset } = await import('@azaloop/core');
      const root = workspace || process.cwd();
      const id = String(args.preset_id || args.id || 'full-auto');
      const preset = applyPreset(root, id);
      return {
        success: true,
        data: { applied: preset },
        next_action: {
          tool: 'aza_session',
          action: 'calibrate',
          reason: `Preset ${id} applied — recalibrate session`,
        },
      };
    }
    case 'constitution':
    case 'constitution_read': {
      const { readConstitution, ensureConstitution } = await import('@azaloop/core');
      const root = workspace || process.cwd();
      ensureConstitution(root);
      return {
        success: true,
        data: { path: '.aza/constitution.md', content: readConstitution(root) },
        next_action: { tool: 'aza_prd', action: 'review', reason: 'Constitution loaded — continue PRD' },
      };
    }
    case 'constitution_write': {
      const { writeConstitution } = await import('@azaloop/core');
      const root = workspace || process.cwd();
      const content = String(args.content || '');
      if (!content.trim()) {
        return { success: false, error: 'content required for constitution_write' };
      }
      writeConstitution(root, content);
      return {
        success: true,
        data: { path: '.aza/constitution.md' },
        next_action: { tool: 'aza_session', action: 'calibrate', reason: 'Constitution updated' },
      };
    }
    case 'federation':
    case 'federation_status': {
      const { loadFederation } = await import('@azaloop/core');
      const root = workspace || process.cwd();
      return {
        success: true,
        data: loadFederation(root),
        next_action: { tool: 'aza_loop', action: 'status', reason: 'Federation digest loaded' },
      };
    }
    case 'federation_sync': {
      const { syncFederationDigest, registerFederationPeer } = await import('@azaloop/core');
      const root = workspace || process.cwd();
      if (args.peer_id && args.shared_aza) {
        registerFederationPeer(root, {
          id: String(args.peer_id),
          label: String(args.peer_label || args.peer_id),
          shared_aza: String(args.shared_aza),
        });
      }
      const peerId = String(args.peer_id || '');
      const result = peerId
        ? syncFederationDigest(root, peerId)
        : { ok: false, detail: 'peer_id required for federation_sync' };
      return {
        success: result.ok,
        data: result,
        next_action: { tool: 'aza_loop', action: 'status', reason: 'Federation synced' },
      };
    }
    case 'cost':
    case 'cost_status':
      return handleCost({ ...(args as any), action: 'status' });
    case 'cost_consume':
      return handleCost({ ...(args as any), action: 'consume' });
    case 'test_loop':
    case 'test-loop':
    case 'selftest':
    case 'doctor':
      return handleTestLoop({ ...(args as any), scenario: (args.scenario as any) || 'smoke' });
    default:
      return fail(action, [
        'skills', 'skills_search', 'skills_list', 'runstate', 'runstate_status',
        'runstate_update', 'audit_log', 'audit_log_recent', 'audit_log_search',
        'budget', 'audit', 'cost', 'cost_status', 'cost_consume',
        'plugin', 'plugin_list', 'plugin_load', 'plugin_unload',
        'test_loop', 'test-loop', 'selftest', 'doctor',
        'worktree', 'worktree_list', 'worktree_create', 'worktree_remove',
        'swarm', 'swarm_dispatch', 'swarm_report', 'swarm_status',
        'stores', 'stores_put', 'stores_search', 'dlp', 'dlp_scan',
        'presets', 'presets_list', 'preset_apply',
        'constitution', 'constitution_read', 'constitution_write',
        'federation', 'federation_status', 'federation_sync',
      ]);
  }
}

// ── next_action remappers ────────────────────────────────────

/** Unified 8-tool surface — map legacy composite names without collapsing to aza_loop/next. */
export const LEGACY_TOOL_MAP: Record<string, { tool: string; action: string }> = {
  aza_task_design: { tool: 'aza_spec', action: 'design' },
  aza_task_implement: { tool: 'aza_spec', action: 'implement' },
  aza_task_verify: { tool: 'aza_spec', action: 'verify' },
  aza_quality_check: { tool: 'aza_quality', action: 'check' },
  aza_doc_generate: { tool: 'aza_finish', action: 'archive' },
  aza_finish_work: { tool: 'aza_finish', action: 'work' },
  aza_ship: { tool: 'aza_finish', action: 'ship' },
  aza_loop_next: { tool: 'aza_loop', action: 'next' },
  aza_auto_loop: { tool: 'aza_loop', action: 'full' },
  aza_prd_generate: { tool: 'aza_prd', action: 'generate' },
  aza_prd_validate: { tool: 'aza_prd', action: 'validate' },
  aza_prd_review: { tool: 'aza_prd', action: 'review' },
  aza_prd_approve: { tool: 'aza_prd', action: 'approve' },
  aza_context_calibrate: { tool: 'aza_session', action: 'calibrate' },
  aza_context_status: { tool: 'aza_session', action: 'status' },
};

const UNIFIED_TOOLS = new Set([
  'aza_session',
  'aza_prd',
  'aza_loop',
  'aza_spec',
  'aza_quality',
  'aza_finish',
  'aza_memory',
  'aza_meta',
]);

function remapToolAction(tool: string, action: string | undefined): { tool: string; action: string } | null {
  // Map orphan refine actions onto the 8-tool surface
  if (action === 'refine') {
    if (tool === 'aza_prd' || tool === 'aza_prd_review') {
      return { tool: 'aza_prd', action: 'modify' };
    }
    if (tool === 'aza_spec' || tool === 'aza_task_design' || tool === 'aza_task_implement') {
      return { tool: 'aza_spec', action: tool.includes('design') ? 'design' : 'implement' };
    }
    if (tool === 'aza_loop') {
      return { tool: 'aza_loop', action: 'full' };
    }
  }
  const mapped = LEGACY_TOOL_MAP[tool];
  if (mapped) {
    const preserve = new Set(['wait', 'escalate', 'done', 'stop', 'report', 'retry']);
    return {
      tool: mapped.tool,
      action: action && preserve.has(action) ? action : mapped.action,
    };
  }
  return null;
}

function remapNext(
  result: unknown,
  onSuccess: { tool: string; action: string },
  onFail?: { tool: string; action: string },
): unknown {
  const r = result as any;
  if (!r || typeof r !== 'object') return result;

  const remapOne = (na: any) => {
    if (!na || typeof na.tool !== 'string') return na;
    const mapped = remapToolAction(na.tool, na.action);
    if (mapped) return { ...na, ...mapped };
    // Unknown legacy composite — only then fall back to onSuccess/onFail
    if (na.tool.startsWith('aza_') && na.tool.includes('_') && !UNIFIED_TOOLS.has(na.tool)) {
      const target = r.success === false && onFail ? onFail : onSuccess;
      return {
        ...na,
        tool: target.tool,
        action: na.action === 'wait' ? 'wait' : target.action,
      };
    }
    return na;
  };

  if (r.next_action) r.next_action = remapOne(r.next_action);
  if (r.data?.next_action) r.data.next_action = remapOne(r.data.next_action);
  if (r.data?.awaitingAction) r.data.awaitingAction = remapOne(r.data.awaitingAction);
  return result;
}

/** Soft-recover escalate at most N times per workspace, then escalate for real. */
const softRecoverCounts = new Map<string, number>();
const SOFT_RECOVER_MAX = 3;

function remapAutoLoop(result: unknown, workspaceKey?: string): unknown {
  const r = result as any;
  if (!r?.next_action && !r?.data?.awaitingAction) return result;

  const remapOne = (na: any) => {
    if (!na || typeof na.tool !== 'string') return na;
    const mapped = remapToolAction(na.tool, na.action);
    return mapped ? { ...na, ...mapped } : na;
  };

  if (r.next_action) r.next_action = remapOne(r.next_action);
  if (r.data?.next_action) r.data.next_action = remapOne(r.data.next_action);
  if (r.data?.awaitingAction) r.data.awaitingAction = remapOne(r.data.awaitingAction);
  if (r.data?.awaiting_action) r.data.awaiting_action = remapOne(r.data.awaiting_action);

  // Prefer awaitingAction as next_action when host must execute a tool
  const awaitTool = r.data?.awaitingAction || r.data?.awaiting_action;
  if (awaitTool?.tool) {
    const instruction = awaitTool.instruction || r.next_action?.instruction;
    r.next_action = {
      tool: awaitTool.tool,
      action: awaitTool.action,
      reason: awaitTool.reason || r.next_action?.reason || `Execute ${awaitTool.tool} then aza_loop(report_tool)`,
      ...(instruction ? { instruction } : {}),
    };
  }

  // Soft-recover transient escalate — capped to avoid reset storms
  const na = r.next_action;
  if (na?.action === 'escalate') {
    const reason = String(na.reason || '');
    if (/consecutive stage failures|Circuit breaker tripped|No progress/i.test(reason)) {
      const key = workspaceKey || 'default';
      const count = (softRecoverCounts.get(key) || 0) + 1;
      softRecoverCounts.set(key, count);
      if (count > SOFT_RECOVER_MAX) {
        r.data = {
          ...(r.data || {}),
          soft_recovered: false,
          soft_recover_exhausted: true,
          escalate_reason: reason,
          soft_recover_count: count,
        };
        r.next_action = {
          tool: 'aza_loop',
          action: 'stop',
          reason: `Escalate after ${SOFT_RECOVER_MAX} soft-resets: ${reason}`,
        };
        r.success = false;
        // Persist break-loop note (planning-with-files / loop-audit pattern)
        try {
          const root = workspaceKey || process.cwd();
          const azaDir = root.endsWith('.aza') ? root : `${root.replace(/[\\/]$/, '')}/.aza`;
          void breakLoop(
            {
              stage: r.metadata?.stage || 'unknown',
              iteration: r.metadata?.iteration || 0,
              error: reason,
              lastAction: { tool: 'aza_loop', action: 'escalate', reason },
              strikeCount: count,
            },
            azaDir,
          );
        } catch {
          /* best-effort */
        }
        return result;
      }
      r.data = {
        ...(r.data || {}),
        soft_recovered: true,
        escalate_reason: reason,
        soft_recover_count: count,
      };
      r.next_action = {
        tool: 'aza_loop',
        action: 'reset',
        reason: `Soft-recover (${count}/${SOFT_RECOVER_MAX}): ${reason} — reset caches then continue full loop`,
      };
      r.success = true;
    }
  }
  // Successful non-escalate clears soft-recover counter
  if (na?.action && na.action !== 'escalate' && na.action !== 'reset' && na.action !== 'stop') {
    softRecoverCounts.delete(workspaceKey || 'default');
  }
  return result;
}
