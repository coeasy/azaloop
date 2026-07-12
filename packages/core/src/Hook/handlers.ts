import type { EventBus } from './event-bus';
import type { StateManager } from '../state/state-manager';
import type { ResumeGenerator } from '../continuity/resume-generator';

/**
 * Register all Hook event handlers to the EventBus.
 *
 * This function should be called once during MCP Server initialization,
 * after the EventBus, StateManager, and ResumeGenerator are created.
 *
 * Registered handlers:
 * - `session-start` — logs session start with client/stage info
 * - `pre-tool`       — logs tool name before execution
 * - `post-tool`      — logs iteration/progress after tool execution
 * - `on-error`       — records tool errors to STATE security_findings
 * - `on-stop`        — writes final RESUME.md with full state
 *
 * @param eventBus        - The EventBus to register handlers on.
 * @param stateManager    - The StateManager for reading/updating STATE.
 * @param resumeGenerator - The ResumeGenerator for writing RESUME.md.
 */
export function registerAllHookHandlers(
  eventBus: EventBus,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): void {
  // session-start: log session initialization
  eventBus.on('session-start', async (payload) => {
    const client = payload.data?.client ?? 'unknown';
    const stage = payload.data?.stage ?? 'unknown';
    console.warn(`[Hook] Session started — client: ${client}, stage: ${stage}`);
  });

  // pre-tool: log tool invocation
  eventBus.on('pre-tool', async (payload) => {
    const tool = payload.data?.tool as string;
    console.warn(`[Hook] Pre-tool: ${tool}`);
  });

  // post-tool: log progress after tool execution
  eventBus.on('post-tool', async (payload) => {
    const tool = payload.data?.tool as string;
    const state = stateManager.getState();
    console.warn(
      `[Hook] Post-tool: ${tool} — iteration: ${state.loop.iteration}, progress: ${state.loop.progress}`,
    );
  });

  // on-error: record tool errors to STATE
  eventBus.on('on-error', async (payload) => {
    const tool = payload.data?.tool as string;
    const error = payload.data?.error as string;
    console.error(`[Hook] Error in tool "${tool}": ${error}`);
    try {
      const state = stateManager.getState();
      await stateManager.update({
        security_findings: [
          ...state.security_findings,
          {
            type: 'tool_error',
            severity: 'high',
            detail: `Tool "${tool}" failed: ${error}`,
            timestamp: new Date().toISOString(),
          } as any,
        ],
      });
    } catch {
      // StateManager update may fail if STATE.yaml is not writable
    }
  });

  // on-stop: write final RESUME with full state
  eventBus.on('on-stop', async (payload) => {
    const state = stateManager.getState();
    await resumeGenerator.generate(stateManager, {
      current_stage: state.pipeline.current_stage,
      current_story: state.loop.current_story,
      iteration: state.loop.iteration,
      progress: state.loop.progress,
      last_milestone: payload.timestamp,
    });
    console.warn(
      `[Hook] Stop — final RESUME written for stage: ${state.pipeline.current_stage}`,
    );
  });
}
