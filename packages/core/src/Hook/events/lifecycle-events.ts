/**
 * Lifecycle event handlers — session start, error, stop, completion gate.
 * Consolidated from: session-start.ts, on-error.ts, on-stop.ts, completion-gate.ts
 */
import type { EventHandler } from '../event-bus';
import { ContextInjector } from '../../continuity/context-injector';
import { StrikeSystem } from '../../L4_discipline/strike-system';
import { ResumeGenerator } from '../../continuity/resume-generator';
import { StateManager } from '../../state/state-manager';
import {
  CompletionGate,
  DEFAULT_BLOCK_COUNT_LIMIT,
} from '../../L7_loop/completion-gate';
import type {
  CompletionGateInput,
  CompletionGateResult,
} from '../../L7_loop/completion-gate';

// ── session-start ──
export function createSessionStartHandler(contextInjector?: ContextInjector): EventHandler {
  return async (payload) => {
    const context = contextInjector?.calibrate();

    if (context) {
      console.warn(`[Hook:session-start] Loaded ${context.constitution.length} constitution rules`);
      console.warn(`[Hook:session-start] Role: ${context.role.slice(0, 60)}...`);
    }

    console.warn(`[Hook:session-start] Session started at ${payload.timestamp}`);
  };
}

// ── on-error ──
export function createOnErrorHandler(strikeSystem?: StrikeSystem): EventHandler {
  return async (payload) => {
    const error = payload.data?.error as string;
    const tool = payload.data?.tool as string;

    console.error(`[Hook:on-error] Error in ${tool}: ${error}`);

    if (strikeSystem) {
      const strike = strikeSystem.record('assumed_without_verification', `Error in ${tool}: ${error}`, 0);
      console.warn(`[Hook:on-error] Strike recorded: ${strike.reason} (${strikeSystem.getStrikeCount()}/3)`);

      if (strikeSystem.isHardStop()) {
        console.error(`[Hook:on-error] HARD STOP — 3 strikes reached`);
      }
    }
  };
}

// ── on-stop ──
export function createOnStopHandler(stateManager?: StateManager, resumeGenerator?: ResumeGenerator): EventHandler {
  return async (payload) => {
    console.warn(`[Hook:on-stop] Stopping session at ${payload.timestamp}`);

    if (resumeGenerator && stateManager) {
      const state = stateManager.getState();
      await resumeGenerator.generate(stateManager, {
        current_stage: state.pipeline.current_stage,
        current_story: state.loop.current_story,
        iteration: state.loop.iteration,
        progress: state.loop.progress,
        client: state.loop.client,
        model: state.loop.model,
        last_milestone: payload.timestamp,
      });
      console.warn(`[Hook:on-stop] Resume file written for stage: ${state.pipeline.current_stage}`);
    }
  };
}

// ── completion-gate ──

/**
 * Session state consumed by the completion-gate event handler.
 */
export interface CompletionGateState {
  gated_mode_enabled: boolean;
  has_in_progress_stage: boolean;
  stop_hook_active: boolean;
  block_count: number;
  block_count_limit?: number;
  ledger_has_progress: boolean;
}

export interface CompletionGateEventResult {
  canStop: boolean;
  blockedReason?: string;
}

/**
 * Check whether the session can safely stop.
 */
export function handle(state: CompletionGateState): CompletionGateEventResult {
  const gate = new CompletionGate();

  const input: CompletionGateInput = {
    gated_mode_enabled: state.gated_mode_enabled,
    has_in_progress_stage: state.has_in_progress_stage,
    all_stages_completed: (state as any).all_stages_completed ?? false,
    stop_hook_active: state.stop_hook_active,
    block_count: state.block_count,
    block_count_limit: state.block_count_limit ?? DEFAULT_BLOCK_COUNT_LIMIT,
    ledger_has_progress: state.ledger_has_progress,
    attestation_verified: (state as any).attestation_verified ?? false,
  };

  const result: CompletionGateResult = gate.evaluate(input);

  return {
    canStop: result.canStop,
    blockedReason: result.blockedReason,
  };
}

/**
 * Create an EventBus handler for the completion-gate check.
 */
export function createCompletionGateHandler(): EventHandler {
  return async (payload) => {
    const raw = (payload.data?.state ?? payload.data) as
      | CompletionGateState
      | undefined;

    if (!raw) {
      console.warn('[Hook:completion-gate] No state provided in payload — skipping');
      return;
    }

    const result = handle(raw);

    if (result.canStop) {
      console.warn('[Hook:completion-gate] Session may stop — all conditions satisfied');
    } else {
      console.warn(`[Hook:completion-gate] Stop blocked: ${result.blockedReason}`);
    }
  };
}
