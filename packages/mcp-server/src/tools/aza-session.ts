import { StateManager, ResumeGenerator, EventBus, StrikeSystem, MCPEventSimulator, AuditLog, RunStateManager } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

/**
 * `aza_session_start` — initialize the AzaLoop system on session start.
 * Creates .aza directory, initializes StateManager, ResumeGenerator,
 * and all shared singletons.
 */
export async function handleSessionStart(workspacePath?: string): Promise<LoopResponse> {
  const root = workspacePath ?? process.cwd();
  const azaDir = path.join(root, '.aza');

  try {
    const stateManager = new StateManager(azaDir);
    await stateManager.load();
    const state = stateManager.getState();

    const resumeGenerator = new ResumeGenerator(azaDir);

    const eventBus = new EventBus();
    const strikeSystem = new StrikeSystem();
    const simulator = new MCPEventSimulator(eventBus, stateManager, resumeGenerator, strikeSystem);
    const sessionResult = await simulator.simulateSessionStart();

    const auditLog = new AuditLog(azaDir);
    const runState = new RunStateManager(azaDir, root);
    await runState.load();

    return {
      success: true,
      data: {
        session_started: true,
        state_summary: {
          current_stage: state.pipeline.current_stage,
          iteration: state.loop.iteration,
          progress: state.loop.progress,
          strikes: state.strikes,
        },
        session_event: sessionResult,
        run_state: runState.getState(),
      },
      next_action: {
        tool: 'aza_loop_next',
        action: 'next',
        reason: `Session initialized. Current stage: ${state.pipeline.current_stage}`,
      },
      metadata: {
        iteration: state.loop.iteration,
        progress: state.loop.progress,
        stage: state.pipeline.current_stage,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: '0%', stage: 'open' },
    };
  }
}
