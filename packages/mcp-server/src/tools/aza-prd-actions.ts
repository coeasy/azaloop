/**
 * R12 P6 Plus19 — aza_prd sub-action handlers 工厂 (unified-handlers.ts 减负)
 *
 * 借鉴 aza-loop-actions/* (R12 P6 Plus12) + agency-orchestrator「sub-action registry」+ ruflo「action map」:
 *
 * 痛点：unified-handlers.ts 中 handleAzaPrd 单方法 131 行；9 个 sub-action
 *       (review/approve/modify/cancel/explore/generate/validate/draft/multi_review/refine)
 *       全部 inline ActionMap lambdas，主文件肿大。
 *
 * 解法：把 handleAzaPrd 内部的 9 个 sub-action 抽到 buildPrdActions 工厂：
 *   - review    — handlePrdReview + optional autoApprove + markPrdApproved
 *   - approve   — handlePrdApprove + markPrdApproved + remapNext
 *   - modify    — handlePrdModify + remapNext
 *   - cancel    — handlePrdCancel
 *   - explore   — handleExplore (read-only) + remapNext
 *   - generate  — handlePRDGenerate + remapNext
 *   - validate  — handlePRDValidate + remapNext
 *   - draft     — handlePrdDraft (multi-step LLM)
 *   - multi_review — handlePrdMultiReview (multi-role review)
 *   - refine    — handlePrdRefine
 *
 * 目标：unified-handlers.ts handleAzaPrd < 30 行 thin shell。
 */

import type { StateManager, ResumeGenerator } from '@azaloop/core';
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
} from './aza-prd';
import { markPrdApproved } from './aza-loop';
import { remapNext } from '../auto-loop-remap';
import type { ActionMap } from './tool-action-dispatcher';

export interface PrdActionContext {
  args: Record<string, unknown>;
  stateManager: StateManager;
  resumeGenerator: ResumeGenerator;
  resolveWorkspace: () => string;
  client: string | undefined;
}

/**
 * 构造 9 个 sub-action ActionMap — 抽出后统一在 handleAzaPrd 中调用。
 */
export function buildPrdActions(ctx: PrdActionContext): ActionMap {
  const { args, stateManager, resumeGenerator, resolveWorkspace, client } = ctx;

  return {
    review: async () => {
      const autoApprove =
        args.auto_approve === true || process.env.AZA_AUTO_APPROVE_PRD === 'true';
      const result = await handlePrdReview(
        {
          title: args.title as string,
          description: args.description as string,
          source: (args.source as 'openspec' | 'aza-prd') || undefined,
          openspec: args.openspec !== false,
          workspace_path: resolveWorkspace(),
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
          await markPrdApproved(resolveWorkspace(), client);
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
    },
    approve: async () => {
      const approved = await handlePrdApprove(
        args.answers as Record<string, string> | undefined,
        stateManager,
        resumeGenerator,
      );
      if ((approved as any)?.success !== false && (approved as any)?.data?.approved !== false) {
        await markPrdApproved(resolveWorkspace(), client);
      }
      return remapNext(approved, { tool: 'aza_loop', action: 'full' });
    },
    modify: async () =>
      remapNext(
        await handlePrdModify(args.feedback as string, stateManager, resumeGenerator),
        { tool: 'aza_prd', action: 'wait' },
      ),
    cancel: () => handlePrdCancel(stateManager, resumeGenerator),
    explore: async () => {
      // OpenSpec/Trellis-aligned: read-only options, no change folder write
      const { handleExplore } = await import('./aza-explore');
      return remapNext(
        await handleExplore(
          (args.workspace_path as string) || process.cwd(),
          (args.focus as string) || (args.description as string) || (args.title as string),
        ),
        { tool: 'aza_prd', action: 'review' },
      );
    },
    generate: async () =>
      remapNext(
        await handlePRDGenerate(
          {
            title: args.title as string,
            description: args.description as string,
          } as any,
          args.workspace_path as string,
        ),
        { tool: 'aza_prd', action: 'validate' },
      ),
    validate: async () =>
      remapNext(await handlePRDValidate(args.prd), { tool: 'aza_loop', action: 'next' }),
    // V20 Task 1.5: multi-step LLM interaction dispatch
    draft: () =>
      handlePrdDraft(
        {
          title: (args.title as string) || (args.user_input as string) || '',
          description: args.description as string,
          user_input: args.user_input as string,
          workspace_path: args.workspace_path as string,
          complexity: args.complexity as string,
        },
        stateManager,
        resumeGenerator,
      ),
    multi_review: () =>
      handlePrdMultiReview(
        String(args.prd_draft ?? args.prd ?? ''),
        stateManager,
        resumeGenerator,
      ),
    refine: () =>
      handlePrdRefine(
        String(args.refined_prd ?? args.prd ?? ''),
        args.review_responses as Array<{ role: string; response: string }> | undefined,
        stateManager,
        resumeGenerator,
      ),
  };
}
