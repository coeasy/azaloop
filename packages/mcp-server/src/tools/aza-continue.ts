import { MCPContinueService, StateManager, ResumeGenerator, readTaskBoardSummary, ensureTaskBoard } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

export async function handleContinue(
  baseDir: string,
  extra?: { client?: string; model?: string },
): Promise<LoopResponse> {
  const stateManager = new StateManager(baseDir);
  await stateManager.load();
  if (extra?.client || extra?.model) {
    const state = stateManager.getState();
    await stateManager.update({
      loop: {
        ...state.loop,
        client: extra.client || state.loop.client,
        model: extra.model || state.loop.model,
      },
    });
  }
  const resumeGenerator = new ResumeGenerator(baseDir);
  const continueService = new MCPContinueService(stateManager, resumeGenerator);
  const result = await continueService.continue({
    client: extra?.client,
    model: extra?.model,
  });
  const azaDir = path.isAbsolute(baseDir) ? baseDir : path.join(process.cwd(), baseDir);
  ensureTaskBoard(azaDir);
  const planning = readTaskBoardSummary(azaDir);
  const resume = result.resume;
  // Slim payload — hosts must rehydrate from .aza disk, not chat context
  const slim = {
    resumed: result.resumed,
    message: result.message,
    stage: resume?.current_stage || 'open',
    iteration: resume?.iteration || 0,
    progress: resume?.progress || '0%',
    next_tool: resume?.next_tool,
    next_action: resume?.next_action,
    current_story: resume?.current_story,
    client: resume?.client,
    model: resume?.model,
    planning: planning
      ? {
          summary: {
            ...(typeof (planning as any).summary === 'object' ? (planning as any).summary : {}),
            plan_excerpt: String((planning as any).summary?.plan_excerpt || (planning as any).plan_excerpt || '').slice(0, 240),
            progress_excerpt: String((planning as any).summary?.progress_excerpt || '').slice(0, 160),
            findings_excerpt: String((planning as any).summary?.findings_excerpt || '').slice(0, 120),
            paths: (planning as any).summary?.paths || (planning as any).paths,
          },
          planSha: (planning as any).planSha || (planning as any).summary?.plan_sha256,
        }
      : undefined,
    artifacts: ['.aza/STATE.yaml', '.aza/RESUME.md', '.aza/task_plan.md'],
  };
  return {
    success: true,
    data: slim,
    next_action: result.resume
      ? {
          tool: result.resume.next_tool || 'aza_loop',
          action: result.resume.next_action || 'full',
          reason: `Resuming from ${result.resume.current_stage}`,
        }
      : { tool: 'aza_prd', action: 'review', reason: 'New session, start with PRD' },
    metadata: {
      iteration: result.resume?.iteration || 0,
      progress: result.resume?.progress || '0%',
      stage: result.resume?.current_stage || 'open',
    },
  };
}
