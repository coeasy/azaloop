/**
 * R12 P6 Plus22 — tryL3Inline 抽离到 l3-inline.ts (auto-workflow.ts 减负)
 *
 * 借鉴 Trellis「inline action gate」+ comet「hard_continue_to_ship」+ gstack「inline branch router」:
 *
 * 痛点：auto-workflow.ts 中 tryL3Inline 单方法 100 行；3 个 inline 路径
 *       (L3 inline design / L3 inline quality / L3 inline ship) 全部 inline 表达式。
 *
 * 解法：把 tryL3Inline 内部的 3 个 inline 路径抽到独立函数：
 *   - l3InlineDesign   — handleTaskDesign + handleAutoLoop(report_tool)
 *   - l3InlineQuality  — handleQualityCheck + handleAutoLoop(report_tool) + fail response
 *   - l3InlineShip     — handleAzaFinish(ship) + completed response
 *
 * 目标：auto-workflow.ts < 320 行；tryL3Inline 退化为 30 行 dispatcher。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StateManager, ResumeGenerator } from '@azaloop/core';
import { loadAutonomy } from '@azaloop/core';
import type { ChosenPlan } from '../../auto-plan';
import { handleTaskDesign } from '../../tools/aza-task';
import { handleQualityCheck } from '../../tools/aza-quality';
import { handleAutoLoop } from '../../tools/aza-loop';
import { handleAzaFinish } from '../../unified-handlers';
import type { AutoRunContext } from './auto-workflow';

export const AUTONOMOUS_HOST_PROTOCOL = 'hard_continue_to_ship_no_user_ask';

export interface L3InlineArgs {
  awaitTool: string;
  awaitAction: string;
  workspace: string;
  client: string | undefined;
  ctx: AutoRunContext;
  activePlan: ChosenPlan | undefined;
  stateManager: StateManager;
  resumeGenerator: ResumeGenerator;
}

/**
 * L3 inline 路径判定：autonomy level + 环境变量。
 */
export function shouldL3Inline(workspace: string): boolean {
  let autonomyLevel = 'L2';
  try {
    autonomyLevel = loadAutonomy(workspace).level;
  } catch {
    autonomyLevel = process.env.AZA_AUTO_APPROVE_PRD === 'true' ? 'L3' : 'L2';
  }
  return (
    autonomyLevel === 'L3' ||
    process.env.AZA_AUTO_INLINE === '1' ||
    process.env.AZA_AUTO_APPROVE_PRD === 'true'
  );
}

/**
 * L3 inline design：aza_spec(design) 自动内联。
 */
async function l3InlineDesign(args: L3InlineArgs): Promise<{ handled: true }> {
  const { workspace, client, ctx, activePlan, stateManager, resumeGenerator } = args;
  console.log('[aza_auto] L3 inline: aza_spec(design)');
  let designDesc = ctx.userInput;
  try {
    const plan = activePlan;
    if (plan) {
      designDesc = [
        ctx.userInput,
        '',
        `## Chosen plan: ${plan.selected.name} (${plan.selected.score}/100)`,
        plan.selected.description,
        plan.rationale,
      ].join('\n');
    }
  } catch { /* ignore */ }
  await handleTaskDesign(
    `STORY-${ctx.userInputHash}`,
    ctx.userInput.slice(0, 120),
    designDesc,
    workspace,
  );
  await handleAutoLoop('report_tool', undefined, workspace, 'aza_spec', client);
  return { handled: true };
}

/**
 * L3 inline quality：aza_quality(check) 自动内联 + 失败回退到 aza_spec.implement。
 */
async function l3InlineQuality(args: L3InlineArgs): Promise<{ handled: true; result?: unknown }> {
  const { workspace, client, ctx, stateManager, resumeGenerator } = args;
  console.log('[aza_auto] L3 inline: aza_quality(check)');
  const qMarker = path.join(workspace, '.aza', 'quality-passed.marker');
  let passed = fs.existsSync(qMarker);
  let q: { success?: boolean; data?: { passed?: boolean } } | null = null;
  if (!passed) {
    q = (await handleQualityCheck(workspace)) as { success?: boolean; data?: { passed?: boolean } };
    passed = q?.success !== false && q?.data?.passed !== false;
  }
  await handleAutoLoop('report_tool', undefined, workspace, 'aza_quality', client);
  if (!passed) {
    return {
      handled: true,
      result: {
        success: false,
        data: {
          stage: 'verify',
          status: 'quality_failed',
          quality: q?.data,
          host_protocol: AUTONOMOUS_HOST_PROTOCOL,
          forbid_user_ask: true,
        },
        next_action: {
          tool: 'aza_spec',
          action: 'implement',
          reason: '质量门未过 — 修复后立即 report_tool，禁止询问用户',
        },
        metadata: { task_id: ctx.taskId, user_input_hash: ctx.userInputHash },
      },
    };
  }
  return { handled: true };
}

/**
 * L3 inline ship：aza_finish(ship) 自动内联 + completed response。
 */
async function l3InlineShip(args: L3InlineArgs): Promise<{ handled: true; result: unknown }> {
  const { workspace, ctx, stateManager, resumeGenerator } = args;
  console.log('[aza_auto] L3 inline: aza_finish(ship)');
  const shipped = await handleAzaFinish(
    {
      action: 'ship',
      workspace_path: workspace,
      stop_loop: true,
      work_summary: `aza_auto L3 inline ship: ${ctx.userInput.slice(0, 200)}`,
    },
    stateManager,
    resumeGenerator,
  );
  return {
    handled: true,
    result: {
      success: true,
      data: {
        stage: 'archive',
        status: 'completed',
        shipped: true,
        finish: shipped,
        mode: 'l3_inline',
      },
      next_action: {
        tool: 'aza_session',
        action: 'continue',
        reason: 'L3 全自动已 ship — 会话空闲',
      },
      metadata: { task_id: ctx.taskId, user_input_hash: ctx.userInputHash },
    },
  };
}

/**
 * L3 inline dispatcher：判定 + 路由到 3 个 inline 路径。
 */
export async function tryL3Inline(
  args: L3InlineArgs,
): Promise<{ handled: boolean; result?: unknown }> {
  const { awaitTool, awaitAction, workspace } = args;
  const l3Inline = shouldL3Inline(workspace);

  const canInlineDesign = l3Inline && awaitTool === 'aza_spec' && awaitAction === 'design';
  const canInlineQuality = l3Inline && awaitTool === 'aza_quality' && awaitAction === 'check';
  const canInlineShip = l3Inline && awaitTool === 'aza_finish' && (awaitAction === 'ship' || awaitAction === 'archive');

  if (!canInlineDesign && !canInlineQuality && !canInlineShip) {
    return { handled: false };
  }
  try {
    if (canInlineDesign) return l3InlineDesign(args);
    if (canInlineQuality) return l3InlineQuality(args);
    return l3InlineShip(args);
  } catch (inlineErr) {
    const msg = inlineErr instanceof Error ? inlineErr.message : String(inlineErr);
    console.warn(`[aza_auto] L3 inline failed (${awaitTool}): ${msg} — falling back to host`);
    return { handled: false };
  }
}
