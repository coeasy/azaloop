import { MCPContinueService, StateManager, ResumeGenerator } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';

export async function handleContinue(baseDir: string): Promise<LoopResponse> {
  const stateManager = new StateManager(baseDir);
  await stateManager.load();
  const resumeGenerator = new ResumeGenerator(baseDir);
  const continueService = new MCPContinueService(stateManager, resumeGenerator);
  const result = await continueService.continue();
  return {
    success: true,
    data: result,
    next_action: result.resume
      ? { tool: 'aza_loop_next', action: 'next', reason: `Resuming from ${result.resume.current_stage}` }
      : { tool: 'aza_prd_generate', action: 'generate', reason: 'New session, start with PRD' },
    metadata: {
      iteration: result.resume?.iteration || 0,
      progress: result.resume?.progress || '0%',
      stage: result.resume?.current_stage || 'open',
    },
  };
}
