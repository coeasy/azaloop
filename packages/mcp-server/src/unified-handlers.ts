/**
 * Converged MCP handlers — 8 tools × action discriminant.
 * Delegates to existing per-tool implementations.
 */

import * as path from 'path';
import type { StateManager, ResumeGenerator } from '@azaloop/core';
import { AutoLoopDriver, LoopController, AutoLoopEngine, loadAutonomy } from '@azaloop/core';
// R12 P6 Plus19: aza_prd 9 个 sub-action 全部抽到 tools/aza-prd-actions.ts，这里不再直接 import
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
} from './tools/aza-loop';
import { handleTaskDesign, handleTaskImplement, handleTaskVerify } from './tools/aza-task';
import { handleQualityCheck, handleUiQa } from './tools/aza-quality';
import { handleMemoryQuery, handleMemoryRecord, handleMemoryPromote } from './tools/aza-memory';
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
// R12 P6 Plus20: aza_conventions 3 个 handler 全部抽到 tools/aza-finish-actions.ts，这里不再直接 import
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
// R12 P6 Plus20: handleFinishWork 全部抽到 tools/aza-finish-actions.ts，这里不再直接 import
import {
  handleMetaWorktree,
  handleMetaSwarm,
  handleMetaStores,
  handleMetaDlp,
} from './tools/aza-meta-ext';
import { handleCost } from './tools/aza-cost';
import { handlePlugin } from './tools/aza-plugin';
import { handleTestLoop } from './tools/aza-test-loop';
import {
  autoSelectBestPlan,
  deleteChosenPlan,
  isAutoPickEnabled,
  loadChosenPlan,
  type ChosenPlan,
} from './auto-plan';
import {
  hasResidualTaskArtifacts,
  resetArtifacts,
} from './workflows/auto/artifact-reset';
import { decideRecovery } from './workflows/auto/recovery-policy';
import { createTaskIdentity } from './workflows/auto/task-identity';
// R12 P6 (P1 主编排解耦) — handleAzaAuto 已拆为 workflows/auto/auto-workflow.ts
// 这里只保留 thin shell：参数解析 + 恢复决策 + 初始化 + 主循环调度
import {
  prepareAutoRun,
  initAutoTask,
} from './workflows/auto/auto-workflow';
// R12 P6 Plus21: handleAzaAuto 主循环迭代器抽离到 workflows/auto/auto-loop-main.ts
import { runAutoLoopMain, buildAutoLoopErrorResponse } from './workflows/auto/auto-loop-main';
// R12 P6: handleAzaMeta 已拆为 workflows/meta/meta-workflow.ts
import {
  dispatchMetaWorktree,
  dispatchMetaSwarm,
  dispatchMetaStores,
  handleCompetitiveRefresh,
  handlePresetsList,
  handlePresetApply,
  handleConstitutionRead,
  handleConstitutionWrite,
  handleFederationStatus,
  handleFederationSync,
  handleLoopReady,
  dispatchCost,
  dispatchPlugin,
  dispatchTestLoop,
} from './workflows/meta/meta-workflow';
// R12 P6: handleAzaLoop batch/orchestrator 已拆为 workflows/loop/loop-workflow.ts
import { handleLoopBatch, handleLoopOrchestrator } from './workflows/loop/loop-workflow';
import { handleAzaBatchImpl } from './workflows/loop/batch-workflow';
// R12 P6 Plus15: 抽取共享辅助函数（fail / normalize*）
import {
  fail,
  normalizeWorkspace,
  normalizeClient,
  normalizeModel,
  persistClientModel,
  readStage,
  attachIdleHint,
} from './tools/unified-handlers-helpers';
// R12 P6 Plus15: 通用 action dispatch（替换每个 handleAza* 的 switch 语句）
import { dispatchAction, type ActionMap } from './tools/tool-action-dispatcher';
// R12 P6 Plus17: auto-loop remap + soft-recover gate（取代原 remapNext/remapAutoLoop 内联 122 行）
import { remapNext, remapAutoLoop } from './auto-loop-remap';
// R12 P6 Plus21: 4 个 response builder 全部迁移到 workflows/auto/auto-loop-main.ts，这里不再直接 import
// R12 P6 Plus19: aza_prd 9 个 sub-action 工厂（review/approve/modify/cancel/explore/generate/validate/draft/multi_review/refine）
import { buildPrdActions } from './tools/aza-prd-actions';
// R12 P6 Plus20: aza_finish 7 个 sub-action 工厂（work/archive/ship/conventions/conventions_list/conventions_write/conventions_extract）
import { buildFinishActions } from './tools/aza-finish-actions';
// R12: host-contract 边界——验证宿主回执后推进流程
import { HostActionLedger } from './workflows/auto/host-contract';
import type { HostReportV1 } from '@azaloop/shared';

// R12: re-export legacy tool map for backward-compatible consumers/tests.
export { LEGACY_TOOL_MAP } from './legacy-router';




export async function handleAzaSession(
  args: Record<string, unknown>,
  stateManager: StateManager,
): Promise<unknown> {
  const workspace = normalizeWorkspace(args);
  const client = normalizeClient(args);
  const model = normalizeModel(args);

  // Persist client/model for cross-session RESUME accuracy
  await persistClientModel(stateManager, client, model);

  // R12 P6 Plus15: 通用 action dispatch（替换 switch/case）
  const actions: ActionMap = {
    init: (a) => handleInit(workspace, client || (a.client as string)),
    start: () => handleSessionStart(workspace),
    calibrate: async () =>
      remapNext(await handleContextCalibrate(workspace), {
        tool: 'aza_prd',
        action: 'review',
      }),
    status: () => handleContextStatus(stateManager),
    continue: async () =>
      remapNext(
        await handleContinue(
          (args.base_dir as string) ||
            (workspace ? `${workspace.replace(/[\\/]$/, '')}/.aza` : '.aza'),
          { client: client || undefined, model: model || undefined },
        ),
        { tool: 'aza_loop', action: 'full' },
      ),
    health: async () => {
      const health = await handleHealthCheck();
      // Attach idle/next hint from pipeline so hosts don't keep shipping completed work
      try {
        const st = await stateManager.load();
        return attachIdleHint(health as Record<string, unknown>, st as any);
      } catch {
        return health;
      }
    },
  };

  return dispatchAction(args, {
    actions,
    defaultAction: 'calibrate',
    toolName: 'aza_session',
  });
}

export async function handleAzaPrd(
  args: Record<string, unknown>,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<unknown> {
  // R12 P6 Plus19: thin shell — 9 个 sub-action 全部在 tools/aza-prd-actions.ts 的 buildPrdActions 工厂
  const client = normalizeClient(args) || undefined;
  const resolveWorkspace = () =>
    (args.workspace_path as string) ||
    stateManager.azaDir?.replace(/[\\/]\.aza$/, '') ||
    process.cwd();

  return dispatchAction(args, {
    actions: buildPrdActions({ args, stateManager, resumeGenerator, resolveWorkspace, client }),
    defaultAction: 'review',
    toolName: 'aza_prd',
  });
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
  // R12 P6 Plus21: thin shell — 主循环迭代器抽到 workflows/auto/auto-loop-main.ts
  const userInput = String(args.user_input ?? '').trim();
  if (!userInput) {
    return { success: false, error: 'user_input is required for aza_auto', data: null };
  }
  try {
    const { ctx, recovery } = await prepareAutoRun({ args, stateManager, resumeGenerator });
    let { activePlan, autoPlanSelected, autoPlanPath, isRecovery, resetReason } = {
      activePlan: recovery.activePlan,
      autoPlanSelected: recovery.autoPlanSelected,
      autoPlanPath: recovery.autoPlanPath,
      isRecovery: recovery.isRecovery,
      resetReason: recovery.resetReason,
    };
    void resetReason;

    if (!(isRecovery && recovery.resumeData)) {
      const initRes = await initAutoTask(ctx, stateManager, resumeGenerator);
      if (initRes.activePlan) {
        activePlan = initRes.activePlan;
        autoPlanSelected = true;
      }
    }

    // 重新盖印 hash 到 RESUME
    try {
      await resumeGenerator.generate(stateManager, {
        task_id: ctx.taskId,
        user_input_hash: ctx.userInputHash,
      });
    } catch { /* best-effort */ }

    return runAutoLoopMain({
      ctx, stateManager, resumeGenerator,
      activePlan, autoPlanSelected, autoPlanPath,
    });
  } catch (error) {
    return buildAutoLoopErrorResponse(error);
  }
}

/**
 * Verify a host tool-execution report against the issued action contract
 * and, only when it matches, advance the workflow via `executor`.
 *
 * The contract boundary guarantees the loop never advances on a
 * malformed or mismatched report: tool_name / task_fingerprint
 * divergence is rejected before `executor` is ever invoked.
 */
export async function executeVerifiedHostReport(
  workspace: string,
  report: HostReportV1,
  executor: () => Promise<unknown>,
): Promise<unknown> {
  const azaDir = path.join(workspace, '.aza');
  const ledger = new HostActionLedger(azaDir);
  return ledger.executeReport(report, executor);
}

export async function handleAzaLoop(args: Record<string, unknown>): Promise<unknown> {
  const workspace = args.workspace_path as string;
  const stage = (args.current_stage as string) || (args.stage as string);
  const client = normalizeClient(args) || undefined;

  // R12 P6 Plus15: 通用 action dispatch（替换 switch/case）
  // step/full/auto/pause/resume/report_tool/retry/reset 共享同一 auto-loop 路径
  const autoLoopActions = [
    'step', 'full', 'auto', 'pause', 'resume', 'report_tool', 'retry', 'reset',
  ];
  const actions: ActionMap = {
    next: async () =>
      remapNext(await handleLoopNext(stage, workspace, client), { tool: 'aza_loop', action: 'next' }),
    status: () => handleLoopStatus(workspace, client),
    complete: () => handleLoopComplete(stage, workspace, client),
    stop: () => handleLoopStop((args.reason as string) || 'stopped', workspace, client),
    set_condition: () => handleLoopSetCondition(args.key as string, args.passed as boolean, workspace, client),
    reset_conditions: () => handleLoopResetConditions(workspace, client),
    stage_iterations: () => handleLoopGetStageIterations(stage, workspace, client),
    circuit: () => handleLoopCircuitBreaker(workspace, client),
    gate: () => handleLoopCompletionGate(workspace, client),
    audit: () => handleLoopAudit(workspace, client),
    // R9: 多任务批量执行——借鉴 ralphy --parallel + agency-orchestrator loop.max_iterations
    batch: () => handleLoopBatch(args, workspace, handleAzaBatch),
    orch_run: () => handleLoopOrchestrator(args, workspace),
    orch_resume: () => handleLoopOrchestrator(args, workspace),
  };

  // auto-loop actions 共享同一路径（含 L3 硬续）
  for (const act of autoLoopActions) {
    actions[act] = async () => {
      let loopResult = remapAutoLoop(
        await handleAutoLoop(act, stage, workspace, args.tool_name as string, client),
        workspace || process.cwd(),
      );
      // L3 硬续：report_tool 后若下一跳是 quality/ship，同轮内联到 ship（禁止再问用户）
      if (act === 'report_tool') {
        const { maybeHardContinueToShip } = await import('./l3-hard-continue');
        loopResult = await maybeHardContinueToShip(loopResult, workspace || process.cwd(), {
          handleQualityCheck,
          handleAutoLoop,
          handleAzaFinish,
          remapAutoLoop,
        });
      }
      return loopResult;
    };
  }

  return dispatchAction(args, {
    actions,
    defaultAction: 'step',
    toolName: 'aza_loop',
  });
}

/**
 * R9: 多任务批量执行（aza_loop action=batch）
 * 借鉴 ralphy --parallel + agency-orchestrator loop.max_iterations+concurrency
 *
 * 输入：items = [{user_input, task_id, slug}, ...]
 * 输出：每个 item 独立 worktree（如启用）+ 独立 .aza/runs/<slug>/ 状态，并发执行。
 */
// R12 P6: handleAzaBatch thin shell — 业务全部在 workflows/loop/batch-workflow.ts
export async function handleAzaBatch(
  items: Array<Record<string, unknown>>,
  concurrency: number,
  worktree: boolean,
  workspace: string | undefined,
): Promise<unknown> {
  return handleAzaBatchImpl(items, concurrency, worktree, workspace);
}

export async function handleAzaSpec(args: Record<string, unknown>): Promise<unknown> {
  // R12 P6 Plus15: 通用 action dispatch（替换 switch/case）
  const actions: ActionMap = {
    design: async () =>
      remapNext(
        await handleTaskDesign(
          args.story_id as string,
          args.title as string,
          args.description as string,
          (args.workspace_path as string) || process.cwd(),
        ),
        { tool: 'aza_loop', action: 'full' },
      ),
    implement: async () =>
      remapNext(
        await handleTaskImplement(
          args.task_id as string,
          (args.workspace_path as string) || process.cwd(),
        ),
        { tool: 'aza_loop', action: 'report_tool' },
      ),
    verify: async () =>
      remapNext(
        await handleTaskVerify(args.task_id as string),
        { tool: 'aza_quality', action: 'check' },
      ),
    explore: () => handleExplore(args.workspace_path as string, args.focus as string | undefined),
    propose: () =>
      handleOpenSpecPropose(
        (args.workspace_path as string) || process.cwd(),
        (args.title as string) || 'change',
        args.description as string | undefined,
      ),
    apply: () =>
      handleOpenSpecApply(
        (args.workspace_path as string) || process.cwd(),
        (args.focus as string) || (args.story_id as string) || undefined,
      ),
    archive: () =>
      handleOpenSpecArchive(
        (args.workspace_path as string) || process.cwd(),
        (args.title as string) || undefined,
      ),
    dag: () =>
      handleDag(
        (args.dag_action as 'build' | 'status' | 'parallel') || 'build',
        args.tasks as any,
        args.dag as any,
      ),
  };

  return dispatchAction(args, {
    actions,
    defaultAction: 'design',
    toolName: 'aza_spec',
  });
}

export async function handleAzaQuality(args: Record<string, unknown>): Promise<unknown> {
  const root = (args.project_root as string) || (args.workspace_path as string) || process.cwd();

  // R12 P6 Plus15: 通用 action dispatch（替换 switch/case）
  const actions: ActionMap = {
    check: async () =>
      remapNext(
        await handleQualityCheck(root),
        { tool: 'aza_finish', action: 'ship' },
        { tool: 'aza_quality', action: 'check' },
      ),
    security: () => handleSecurityScan(root),
    compliance: () => handleCompliance(args.workspace_path as string, args.check_type as 'full' | 'quick' | undefined),
    eval: () => handleEvalRun(args.test_output as string, args.expected_behavior as string),
    eval_summary: () => handleEvalSummary(args.workspace_path as string),
    style: () => handleStyleCheck(args.code as string, args.file_path as string),
    style_learn: () => handleStyleLearn(),
    ui_qa: () => handleUiQa(root, args.url as string | undefined),
  };

  return dispatchAction(args, {
    actions,
    defaultAction: 'check',
    toolName: 'aza_quality',
  });
}

export async function handleAzaFinish(
  args: Record<string, unknown>,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<unknown> {
  // R12 P6 Plus20: thin shell — 7 个 sub-action 全部在 tools/aza-finish-actions.ts 的 buildFinishActions 工厂
  const workspace = args.workspace_path as string;

  return dispatchAction(args, {
    actions: buildFinishActions({ args, stateManager, resumeGenerator, workspace }),
    defaultAction: 'work',
    toolName: 'aza_finish',
  });
}

export async function handleAzaMemory(args: Record<string, unknown>): Promise<unknown> {
  const workspace = args.workspace_path as string;

  // R12 P6 Plus16: 通用 action dispatch（替换 switch/case）
  const actions: ActionMap = {
    query: () =>
      handleMemoryQuery(
        args.query as string,
        workspace,
        args.layer as string | undefined,
      ),
    record: () =>
      handleMemoryRecord(
        args.type as string,
        args.summary as string,
        args.details as string,
        (args.tags as string[]) ?? [],
        workspace,
      ),
    promote: () =>
      handleMemoryPromote(
        args.episode_id as string | undefined,
        workspace,
        args.summary as string | undefined,
        args.details as string | undefined,
        (args.tags as string[]) ?? undefined,
      ),
  };

  return dispatchAction(args, {
    actions,
    defaultAction: 'query',
    toolName: 'aza_memory',
  });
}

// R12 P6: handleAzaMeta thin shell — 业务全部在 workflows/meta/meta-workflow.ts
// R12 P6 Plus16: 通用 action dispatch（替换 switch/case）
export async function handleAzaMeta(args: Record<string, unknown>): Promise<unknown> {
  const workspace = args.workspace_path as string;

  // skills / skills_search 共享；runstate / runstate_status 共享；
  // audit_log / audit_log_recent 共享；loop_ready / loop-ready 共享；
  // plugin 多个 alias 共享 dispatchPlugin；worktree 多个 alias 共享 dispatchMetaWorktree；
  // swarm 多个 alias 共享 dispatchMetaSwarm；stores 多个 alias 共享 dispatchMetaStores；
  // dlp / dlp_scan 共享 handleMetaDlp；presets / presets_list 共享 handlePresetsList；
  // constitution / constitution_read 共享 handleConstitutionRead；
  // federation / federation_status 共享 handleFederationStatus；
  // cost / cost_status / cost_consume 共享 dispatchCost；
  // test_loop / test-loop / selftest / doctor 共享 dispatchTestLoop
  const actions: ActionMap = {
    skills: () => handleSkillSearch((args.query as string) || ''),
    skills_search: () => handleSkillSearch((args.query as string) || ''),
    skills_list: () => handleSkillList(args.type as string),
    runstate: () => handleRunstateStatus(workspace),
    runstate_status: () => handleRunstateStatus(workspace),
    runstate_update: () => handleRunstateUpdate(args as Record<string, unknown>, workspace),
    audit_log: () => handleAuditLogRecent(args.limit as number, workspace),
    audit_log_recent: () => handleAuditLogRecent(args.limit as number, workspace),
    audit_log_search: () => handleAuditLogSearch(args.type as string, args.source as string, workspace),
    budget: () => handleBudget(workspace),
    loop_ready: () => handleLoopReady(workspace),
    'loop-ready': () => handleLoopReady(workspace),
    audit: () => handleAudit(workspace),
    plugin: (a) => dispatchPlugin(a.action as string, a),
    plugin_list: (a) => dispatchPlugin(a.action as string, a),
    plugin_load: (a) => dispatchPlugin(a.action as string, a),
    plugin_unload: (a) => dispatchPlugin(a.action as string, a),
    worktree: (a) => dispatchMetaWorktree(a, a.action as string),
    worktree_list: (a) => dispatchMetaWorktree(a, a.action as string),
    worktree_create: (a) => dispatchMetaWorktree(a, a.action as string),
    worktree_remove: (a) => dispatchMetaWorktree(a, a.action as string),
    swarm: (a) => dispatchMetaSwarm(a, a.action as string),
    swarm_dispatch: (a) => dispatchMetaSwarm(a, a.action as string),
    swarm_report: (a) => dispatchMetaSwarm(a, a.action as string),
    swarm_status: (a) => dispatchMetaSwarm(a, a.action as string),
    competitive_refresh: () => handleCompetitiveRefresh(workspace, args),
    stores: (a) => dispatchMetaStores(a, a.action as string),
    stores_put: (a) => dispatchMetaStores(a, a.action as string),
    stores_search: (a) => dispatchMetaStores(a, a.action as string),
    dlp: () => handleMetaDlp(args),
    dlp_scan: () => handleMetaDlp(args),
    presets: () => handlePresetsList(workspace),
    presets_list: () => handlePresetsList(workspace),
    preset_apply: () => handlePresetApply(workspace, args),
    constitution: () => handleConstitutionRead(workspace),
    constitution_read: () => handleConstitutionRead(workspace),
    constitution_write: () => handleConstitutionWrite(workspace, args),
    federation: () => handleFederationStatus(workspace),
    federation_status: () => handleFederationStatus(workspace),
    federation_sync: () => handleFederationSync(workspace, args),
    cost: (a) => dispatchCost(a.action as string, a),
    cost_status: (a) => dispatchCost(a.action as string, a),
    cost_consume: (a) => dispatchCost(a.action as string, a),
    test_loop: () => dispatchTestLoop(args),
    'test-loop': () => dispatchTestLoop(args),
    selftest: () => dispatchTestLoop(args),
    doctor: () => dispatchTestLoop(args),
  };

  return dispatchAction(args, {
    actions,
    defaultAction: 'budget',
    toolName: 'aza_meta',
  });
}

// R12 P6 Plus17: LEGACY_TOOL_MAP / UNIFIED_TOOLS_SET / remapToolAction 已抽到 legacy-router.ts
// remapNext / remapAutoLoop / soft-recover gate 已抽到 auto-loop-remap.ts
