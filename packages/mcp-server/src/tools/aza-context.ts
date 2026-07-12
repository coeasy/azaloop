import { ContextInjector, StateManager } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

const contextInjector = new ContextInjector();

export async function handleContextCalibrate(workspacePath?: string): Promise<LoopResponse> {
  const context = contextInjector.calibrate();
  // Load STATE.yaml if it exists for session recovery
  let stateData: any = null;
  try {
    const root = workspacePath ?? process.cwd();
    const azaDir = path.join(root, '.aza');
    const stateManager = new StateManager(azaDir);
    await stateManager.load();
    stateData = stateManager.getState();
  } catch { /* STATE.yaml doesn't exist yet */ }
  return {
    success: true,
    data: { ...context, state: stateData },
    next_action: { tool: 'aza_loop_next', action: 'next', reason: stateData ? `Resuming from ${stateData.pipeline.current_stage}` : 'Context loaded, ready to proceed' },
    metadata: { iteration: stateData?.loop.iteration || 0, progress: stateData?.loop.progress || '0%', stage: stateData?.pipeline.current_stage || 'open' },
  };
}

export async function handleContextStatus(stateManager?: StateManager): Promise<LoopResponse> {
  if (!stateManager) {
    return {
      success: false,
      data: null,
      error: 'StateManager required',
      metadata: { iteration: 0, progress: '', stage: '' },
    };
  }
  const state = stateManager.getState();
  return {
    success: true,
    data: state,
    metadata: { iteration: state.loop.iteration, progress: state.loop.progress, stage: state.pipeline.current_stage },
  };
}
