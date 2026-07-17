/**
 * R12 P6 Plus20 — aza_finish sub-action handlers 工厂 (unified-handlers.ts 减负)
 *
 * 借鉴 aza-prd-actions.ts (R12 P6 Plus19) + aza-loop-actions/* (R12 P6 Plus12) +
 * Trellis「convention registry」+ agency-orchestrator「sub-action registry」:
 *
 * 痛点：unified-handlers.ts 中 handleAzaFinish 单方法 104 行；7 个 sub-action
 *       (work/archive/ship/conventions/conventions_list/conventions_write/conventions_extract)
 *       全部 inline ActionMap lambdas，主文件肿大。
 *
 * 解法：把 handleAzaFinish 内部的 7 个 sub-action 抽到 buildFinishActions 工厂：
 *   - work              — handleFinishWork + remapNext(session.continue)
 *   - archive           — handleFinishWork (stop_loop=false) + remapNext(finish.ship)
 *   - ship              — handleQualityCheck + handleFinishWork + next_action(continue)
 *   - conventions       — handleConventionsList (alias)
 *   - conventions_list  — handleConventionsList
 *   - conventions_write — handleConventionsWrite
 *   - conventions_extract — handleConventionsExtract
 *
 * 目标：unified-handlers.ts handleAzaFinish < 20 行 thin shell。
 */

import type { StateManager, ResumeGenerator } from '@azaloop/core';
import { handleFinishWork } from './aza-finish-work';
import { handleQualityCheck } from './aza-quality';
import {
  handleConventionsList,
  handleConventionsWrite,
  handleConventionsExtract,
} from './aza-conventions';
import { remapNext } from '../auto-loop-remap';
import type { ActionMap } from './tool-action-dispatcher';

export interface FinishActionContext {
  args: Record<string, unknown>;
  stateManager: StateManager;
  resumeGenerator: ResumeGenerator;
  workspace: string;
}

/**
 * 构造 7 个 sub-action ActionMap — 抽出后统一在 handleAzaFinish 中调用。
 */
export function buildFinishActions(ctx: FinishActionContext): ActionMap {
  const { args, stateManager, resumeGenerator, workspace } = ctx;

  return {
    work: async () =>
      remapNext(
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
      ),
    archive: async () => {
      // Full-auto spine: archive = finish-work (Trellis-style), NOT doc generate.
      // Previously routed to handleDocGenerate(type=archive) → "Unknown doc type".
      return remapNext(
        await handleFinishWork(
          {
            taskId: args.task_id as string,
            work_summary:
              (args.work_summary as string) ||
              'Archive: stage complete — artifacts persisted',
            decisions: args.decisions as string[],
            open_questions: args.open_questions as string[],
            next_steps: args.next_steps as string[],
            iteration: args.iteration as number,
            stop_loop: false,
            workspace_path: workspace,
          },
          stateManager,
          resumeGenerator,
        ),
        { tool: 'aza_finish', action: 'ship' },
      );
    },
    ship: async () => {
      // Quality re-check then finish-work
      const quality = await handleQualityCheck(workspace || process.cwd());
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
    },
    conventions: () => handleConventionsList(workspace),
    conventions_list: () => handleConventionsList(workspace),
    conventions_write: () =>
      handleConventionsWrite(
        {
          tag: args.tag as string,
          description: args.description as string,
          source: args.source as string,
        } as any,
        workspace,
      ),
    conventions_extract: () =>
      handleConventionsExtract(
        args.work_summary as string,
        args.stage as string,
        args.iteration as number,
        workspace,
      ),
  };
}
