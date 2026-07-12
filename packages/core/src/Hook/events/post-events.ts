/**
 * Post-event handlers — executed after tool/task/phase operations.
 * Consolidated from: post-tool.ts, post-task.ts, post-phase.ts
 */
import type { EventHandler } from '../event-bus';
import { ResumeGenerator } from '../../continuity/resume-generator';
import { StateManager } from '../../state/state-manager';
import { LoopController } from '../../L7_loop/loop-controller';

// ── post-tool ──
export function createPostToolHandler(stateManager?: StateManager, resumeGenerator?: ResumeGenerator): EventHandler {
  return async (payload) => {
    console.warn(`[Hook:post-tool] Tool completed at ${payload.timestamp}`);

    if (resumeGenerator && stateManager) {
      await resumeGenerator.generate(stateManager, {
        last_milestone: payload.timestamp,
      });
    }
  };
}

// ── post-task ──
export function createPostTaskHandler(loopController?: LoopController): EventHandler {
  return async (payload) => {
    const taskId = payload.data?.task_id as string;

    console.warn(`[Hook:post-task] Task completed: ${taskId}`);

    if (loopController) {
      const stageResult = await loopController.next();
      if (stageResult.next_action) {
        console.warn(`[Hook:post-task] Next action: ${stageResult.next_action.tool}:${stageResult.next_action.action}`);
      }
    }
  };
}

// ── post-phase ──
export function createPostPhaseHandler(): EventHandler {
  return async (payload) => {
    const phase = payload.data?.phase as string;
    console.warn(`[Hook:post-phase] Phase completed: ${phase}`);

    const generateDoc = payload.data?.generate_doc as boolean;
    if (generateDoc) {
      console.warn(`[Hook:post-phase] Triggering documentation generation for phase: ${phase}`);
    }
  };
}
