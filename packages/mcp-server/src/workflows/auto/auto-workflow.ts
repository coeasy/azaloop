/**
 * R10 第12轮 (P6 主编排解耦) — Auto Workflow 子模块。
 *
 * 借鉴 spec-kit「executable specification」+ agency-orchestrator「workflow runtime」+ ruflo「harness」：
 *
 * 痛点：unified-handlers.ts 2000+ 行；handleAzaAuto 单方法 528 行；
 *       恢复决策、初始化、循环驱动、L3 inline、异常处理混在一起。
 *
 * 解法：把 handleAzaAuto 拆为：
 *   1. prepareAutoRun  — 入口参数 + recovery decision + reset / restore
 *   2. initAutoTask    — 全新会话的 session + auto-pick + PRD + approve + resume
 *   3. runAutoLoop     — AutoLoopDriver.step 主循环 + L3 inline
 *   4. handleAutoStep  — 单步异常恢复 + L3 inline 设计/质量/ship
 *
 * 目标：unified-handlers.ts < 800 行；handleAzaAuto < 60 行 thin shell。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StateManager, ResumeGenerator, ContextOrchestrator } from '@azaloop/core';
import { loadAutonomy } from '@azaloop/core';
import {
  autoSelectBestPlan,
  deleteChosenPlan,
  isAutoPickEnabled,
  loadChosenPlan,
  type ChosenPlan,
} from '../../auto-plan';
import { hasResidualTaskArtifacts, resetArtifacts } from './artifact-reset';
import { createTaskIdentity } from './task-identity';
import { handleAzaPrd, handleAzaSession } from '../../unified-handlers';
import { handleTaskDesign } from '../../tools/aza-task';
import { handleQualityCheck } from '../../tools/aza-quality';
import { handleAutoLoop, markPrdApproved, buildDriver } from '../../tools/aza-loop';

export const AUTONOMOUS_HOST_PROTOCOL = 'hard_continue_to_ship_no_user_ask';

export interface AutoRunInput {
  args: Record<string, unknown>;
  stateManager: StateManager;
  resumeGenerator: ResumeGenerator;
}

export interface AutoRunContext {
  userInput: string;
  workspace: string;
  client: string | undefined;
  maxIterations: number;
  taskId: string;
  userInputHash: string;
  taskIdentity: ReturnType<typeof createTaskIdentity>;
}

export interface AutoRecoveryResult {
  isRecovery: boolean;
  activePlan: ChosenPlan | undefined;
  autoPlanSelected: boolean;
  autoPlanPath: string | undefined;
  resetReason: string | undefined;
  resumeData: Awaited<ReturnType<ResumeGenerator['read']>>;
}

/**
 * 准备 auto run 上下文：参数解析、task identity、recovery decision。
 */
export async function prepareAutoRun(input: AutoRunInput): Promise<{
  ctx: AutoRunContext;
  recovery: AutoRecoveryResult;
}> {
  const { args, stateManager, resumeGenerator } = input;
  const userInput = String(args.user_input ?? '').trim();
  if (!userInput) {
    throw new Error('user_input is required for aza_auto');
  }
  const workspace =
    (args.workspace_path as string) ||
    stateManager.azaDir?.replace(/[\\/]\.aza$/, '') ||
    process.cwd();
  const maxIterations = Number(args.max_iterations ?? 50);
  const client = typeof args.client === 'string' ? args.client.trim() : undefined;

  const taskIdentity = createTaskIdentity(
    userInput,
    typeof args.task_id === 'string' ? args.task_id : undefined,
  );
  const userInputHash = taskIdentity.fingerprint;
  const taskId = taskIdentity.task_id;

  // 校验 workspace/.aza 一致性
  const workspaceRoot = path.resolve(workspace);
  const expectedAzaDir = path.join(workspaceRoot, '.aza');
  const azaDir = path.resolve(stateManager.azaDir);
  const resumeAzaDir = path.resolve(resumeGenerator.azaDir);
  const norm = (v: string) => (process.platform === 'win32' ? v.toLowerCase() : v);
  if (norm(azaDir) !== norm(expectedAzaDir) || norm(resumeAzaDir) !== norm(expectedAzaDir)) {
    throw new Error(
      `workspace/.aza mismatch: expected ${expectedAzaDir}, state=${azaDir}, resume=${resumeAzaDir}`,
    );
  }

  const resumeData = await resumeGenerator.read();
  const { decideRecovery } = await import('./recovery-policy');
  const recoveryDecision = decideRecovery(taskIdentity, resumeData, {
    terminalEvidence:
      resumeData?.current_stage === 'archive' &&
      fs.existsSync(path.join(azaDir, 'quality-passed.marker')),
  });
  const isRecovery = recoveryDecision.kind === 'same_task';
  const hasResiduals = recoveryDecision.kind === 'fresh' && (await hasResidualTaskArtifacts(azaDir));
  const resetReason =
    recoveryDecision.kind === 'new_task'
      ? recoveryDecision.reason
      : hasResiduals
        ? 'residual_artifacts'
        : undefined;

  let activePlan: ChosenPlan | undefined;
  let autoPlanSelected = false;
  let autoPlanPath: string | undefined;

  if (recoveryDecision.kind === 'fresh' && !resetReason) {
    deleteChosenPlan(workspace);
  }

  if (recoveryDecision.kind === 'same_task') {
    activePlan = loadChosenPlan(workspace, taskIdentity.fingerprint) || undefined;
    if (activePlan) {
      autoPlanSelected = true;
      autoPlanPath = path.join(workspace, '.aza', 'chosen-plan.md');
    }
  }

  if (resetReason) {
    console.warn(`[aza_auto] Fresh start (${resetReason}). Resetting stale task artifacts.`);
    await resetArtifacts(
      { aza_dir: azaDir, next_fingerprint: userInputHash, reason: resetReason },
      {
        clearRuntime: async () => {
          const { clearControllerCache } = await import('../../tools/aza-loop');
          clearControllerCache(workspaceRoot);
        },
        resetState: async () => {
          await stateManager.resetVNext();
        },
      },
    );
    autoPlanSelected = false;
    autoPlanPath = undefined;
    activePlan = undefined;
  } else if (resumeData) {
    console.log(
      `[aza_auto] Recovery mode: resuming from stage ${resumeData.current_stage}, ` +
        `iteration ${resumeData.iteration}, task=${resumeData.task_id}`,
    );
  }

  return {
    ctx: { userInput, workspace, client, maxIterations, taskId, userInputHash, taskIdentity },
    recovery: {
      isRecovery,
      activePlan,
      autoPlanSelected,
      autoPlanPath,
      resetReason,
      resumeData,
    },
  };
}

/**
 * 全新会话的初始化：session + auto-pick + PRD draft + approve。
 */
export async function initAutoTask(
  ctx: AutoRunContext,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<{ activePlan: ChosenPlan | undefined; autoPlanMeta: Record<string, unknown> | undefined }> {
  const { userInput, workspace, client } = ctx;
  await handleAzaSession(
    { action: 'calibrate', workspace_path: workspace, user_input: userInput },
    stateManager,
  );

  let activePlan: ChosenPlan | undefined;
  let autoPlanMeta: Record<string, unknown> | undefined;
  try {
    if (isAutoPickEnabled(workspace)) {
      const picked = autoSelectBestPlan(workspace, userInput);
      activePlan = picked.plan;
      autoPlanMeta = {
        selected: picked.plan.selected.name,
        score: picked.plan.selected.score,
        plan_path: picked.plan_path,
        options: picked.plan.ranked_options.map((o) => ({
          name: o.name,
          score: o.score,
          base_score: o.base_score,
        })),
      };
      console.log(
        `[aza_auto] Auto-picked plan: ${picked.plan.selected.name} (${picked.plan.selected.score})`,
      );
    }
  } catch (pickErr) {
    console.warn(
      `[aza_auto] auto-pick skipped: ${pickErr instanceof Error ? pickErr.message : String(pickErr)}`,
    );
  }

  const prdDescription = activePlan ? autoPlanMeta?.['_enriched'] as string || userInput : userInput;
  const draftResult = await handleAzaPrd(
    {
      action: 'draft',
      title: userInput.slice(0, 120),
      description: prdDescription,
      workspace_path: workspace,
      user_input: userInput,
    },
    stateManager,
    resumeGenerator,
  );
  void draftResult;
  void autoPlanMeta;

  await handleAzaPrd(
    { action: 'approve', workspace_path: workspace, auto_approve: true },
    stateManager,
    resumeGenerator,
  );
  await markPrdApproved(workspace, client);

  // 写入 task_id + user_input_hash 到 RESUME
  try {
    await resumeGenerator.generate(stateManager, {
      task_id: ctx.taskId,
      user_input_hash: ctx.userInputHash,
    });
  } catch { /* best-effort */ }

  // stash auto-pick marker
  try {
    const azaDir = stateManager.azaDir || `${workspace}/.aza`;
    await fs.promises.writeFile(
      `${azaDir}/auto-pick.marker`,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          task_id: ctx.taskId,
          ...(autoPlanMeta || { skipped: true }),
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch { /* best-effort */ }

  return { activePlan, autoPlanMeta };
}

/**
 * 主循环单步：上下文裁剪 + step + 异常恢复。
 */
export type Driver = {
  step: () => Promise<{
    stage: string;
    iteration: number;
    awaitingAction?: { tool: string; action: string; reason?: string } | null;
    done?: boolean;
    nextAction?: { tool: string; action: string; reason?: string } | null;
  }>;
};
export async function runAutoLoopStep(
  driver: Driver,
  i: number,
  workspace: string,
  lastStage: string,
  stateManager: StateManager,
): Promise<{ stepResult: Awaited<ReturnType<Driver['step']>>; lastStage: string; lastIteration: number; failed: boolean; errMsg?: string }> {
  // R3: 每 5 步做一次上下文裁剪
  if (i > 0 && i % 5 === 0) {
    try {
      const azaDir = `${workspace}/.aza`;
      const { ContextOrchestrator } = await import('@azaloop/core');
      const orchestrator = new ContextOrchestrator(azaDir) as ContextOrchestrator;
      const bundle = await orchestrator.injectContext(lastStage as Parameters<ContextOrchestrator['injectContext']>[0]);
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
    } catch { /* best-effort */ }
  }
  try {
    const stepResult = await driver.step();
    return { stepResult, lastStage: stepResult.stage, lastIteration: stepResult.iteration, failed: false };
  } catch (stepErr) {
    try { await stateManager.save(); } catch { /* best-effort */ }
    const errMsg = stepErr instanceof Error ? stepErr.message : String(stepErr);
    console.error(`[aza_auto] Step ${i + 1} failed: ${errMsg}. State saved for recovery.`);
    return { stepResult: { stage: lastStage, iteration: 0 }, lastStage, lastIteration: 0, failed: true, errMsg };
  }
}

export { buildDriver };
// R12 P6 Plus22: tryL3Inline re-exported from l3-inline.ts for backward compat
export { tryL3Inline } from './l3-inline';
