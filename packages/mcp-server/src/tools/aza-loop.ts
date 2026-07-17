import { LoopController, CircuitBreaker, CompletionGate, LoopAudit, DEFAULT_BLOCK_COUNT_LIMIT } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
// R12 P6 Plus23: 抽离 buildController/buildDriver/buildScheduler + 4 个 cache 变量到 controller-builder.ts
import {
  buildController,
  buildDriver,
  buildScheduler,
  clearControllerCache,
  CACHES,
} from './controller-builder';
// R12 P6 Plus7: 引入 action dispatcher（handleAutoLoop 拆分为 10 个独立 action）
import { normalizeRoot } from './aza-loop-actions';

// ── Re-export for backward compat (其它文件可能 import 自 aza-loop) ──
export {
  buildController,
  buildDriver,
  buildScheduler,
  clearControllerCache,
  CACHES,
} from './controller-builder';

// ── PRD approve helper ──

import * as path from 'path';
import * as fs from 'fs';

/**
 * After PRD approve: unlock open→design spine.
 * Sets guard condition, records DP-0/DP-1, and writes an aza_prd_approve audit marker
 * so DecisionPointRegistry.canEnterStage('design') passes T18.
 */
export async function markPrdApproved(projectRoot?: string, client?: string): Promise<void> {
  const root = normalizeRoot(projectRoot ?? process.cwd());
  const lc = buildController(root, client);
  lc.setCondition('prd_valid', true);
  // Fresh story: clear stage-completion markers so makers await real work again.
  // When task-epoch is present (new aza_auto user_input), also park stale design.md
  // so lean-design auto-complete cannot skip design for the new requirement.
  try {
    const azaDir = path.join(root, '.aza');
    for (const f of ['build-complete.marker', 'quality-passed.marker']) {
      const p = path.join(azaDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const epochPath = path.join(azaDir, 'task-epoch');
    if (fs.existsSync(epochPath)) {
      const designPath = path.join(azaDir, 'design.md');
      if (fs.existsSync(designPath)) {
        const prev = path.join(azaDir, 'design.prev.md');
        try {
          if (fs.existsSync(prev)) fs.unlinkSync(prev);
          fs.renameSync(designPath, prev);
        } catch {
          try {
            fs.unlinkSync(designPath);
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch {
    /* best-effort */
  }

  const iteration = lc.stateMachine.getState().iteration;
  await lc.dpRegistry.record('DP-0', 'init', 'open', 'passed', {
    iteration,
    reason: 'PRD approved — open stage unlocked',
  });
  await lc.dpRegistry.record('DP-1', 'open', 'design', 'passed', {
    iteration,
    reason: 'PRD approved — design stage unlocked',
  });
  await lc.dpRegistry.markToolEvent('aza_prd_approve', {
    iteration,
    reason: 'PRD approved via aza_prd(approve)',
  });
}

// ── Core loop tools ──

export async function handleLoopNext(currentStage?: string, projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  return await lc.next(currentStage as any);
}

export async function handleLoopStatus(projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  const state = lc.stateMachine.getState();
  const phaseState = lc.stateMachine.getPhaseLoopState();
  const innerState = lc.stateMachine.getInnerLoopState();
  const outerState = lc.stateMachine.getOuterLoopState();

  return {
    success: true,
    data: {
      current_stage: state.current_stage,
      stages: state.stages,
      iteration: state.iteration,
      phase: phaseState,
      inner: innerState,
      outer: outerState,
      attestation: lc.stateMachine.getAttestation(),
    },
  };
}

export async function handleLoopComplete(stage: string, projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  const result = await lc.completeStage(stage as any);
  return { success: true, data: { stage, completed: true, result } };
}

export async function handleLoopSetCondition(key: string, passed: boolean, projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  lc.setCondition(key as any, passed);
  return { success: true, data: { condition: key, passed } };
}

export async function handleLoopResetConditions(projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  lc.resetConditions();
  return { success: true, data: { reset: true } };
}

export async function handleLoopStop(reason: string, projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  // stop(reason: StopReason, detail: string) — detail is the human-readable reason
  lc.stop(reason as any, reason);
  return { success: true, data: { stopped: true, reason } };
}

export async function handleLoopGetStageIterations(stage: string, projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  const state = lc.stateMachine.getState();
  const stageData = state.stages?.[stage as keyof typeof state.stages];
  return {
    success: true,
    data: {
      stage,
      iterations: (stageData as any)?.iterations ?? 0,
      current_iteration: (stageData as any)?.current_iteration ?? 0,
    },
  };
}

export async function handleLoopCircuitBreaker(projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  // CircuitBreaker(config) takes 0-1 args; check(level) returns CircuitBreakerResult
  const cb = new CircuitBreaker({ maxIterations: 100, tokenBudget: 100000, stagnationThreshold: 3, noProgressThreshold: 5 } as any);
  const result = cb.checkAll();
  return {
    success: true,
    data: {
      tripped: result?.tripped ?? false,
      reason: result?.reason,
      level: result?.level,
    },
  };
}

export async function handleLoopCompletionGate(projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  // CompletionGate takes 0 args; evaluate(input) returns CompletionGateResult { canStop, conditions }
  const gate = new CompletionGate();
  const state = lc.stateMachine.getState();
  const result = gate.evaluate({
    gated_mode_enabled: true,
    has_in_progress_stage: Object.values(state.stages || {}).some((s: any) => s?.status === 'in_progress'),
    all_stages_completed: Object.values(state.stages || {}).every((s: any) => s?.status === 'completed'),
    stop_hook_active: false,
    block_count_under_limit: true,
    has_progress_since_last_block: true,
  } as any);
  return {
    success: true,
    data: {
      passed: result.canStop,
      blocked_reason: result.blockedReason,
      conditions: result.conditions,
    },
  };
}

export async function handleLoopAudit(projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  // LoopAudit takes SignalDefinition[] (not LoopController) and evaluate(input)
  const audit = new LoopAudit();
  const report = audit.evaluate({
    prd_approved: lc.getCondition?.('prd_valid') === true,
    stage_advanced: (lc.stateMachine.getState().current_stage ?? 'open') !== 'open',
    has_iteration: (lc.stateMachine.getState().iteration ?? 0) > 0,
  });
  return {
    success: true,
    data: {
      report,
      block_count_limit: DEFAULT_BLOCK_COUNT_LIMIT,
    },
  };
}

// ── AutoLoopDriver integration (P0-4) ──

/**
 * Handle the auto-loop MCP tool.
 *
 * Supports:
 *   - action: "step" (default) — single step, returns next_action
 *   - action: "full" — run until completion
 *   - action: "status" — return current driver status
 *   - action: "reset" — reset the driver
 *   - action: "auto" — V16: start background scheduler
 *   - action: "stop" — V16: stop background scheduler
 *   - action: "pause" — V16: pause background scheduler
 *   - action: "resume" — V16: resume background scheduler
 *   - action: "report_tool" — V16: report tool execution to scheduler
 */
export async function handleAutoLoop(
  action?: string,
  currentStage?: string,
  projectRoot?: string,
  toolName?: string,
  client?: string,
): Promise<LoopResponse> {
  const root = normalizeRoot(projectRoot ?? process.cwd());

  // P1-4: oneshot mode — skip multi-story outer board; single task then stop
  const oneshot =
    process.env.AZALOOP_MODE === 'oneshot' ||
    process.env.AZA_MODE === 'oneshot' ||
    process.env.PLANNING_DISABLED === 'true';
  if (oneshot && (action === 'full' || action === 'auto')) {
    const driver = buildDriver(root, client);
    const step = await driver.step();
    if (step.awaitingAction) {
      return {
        success: true,
        data: {
          status: 'awaiting_agent',
          mode: 'oneshot',
          awaitingAction: step.awaitingAction,
        },
      };
    }
    if (step.done) {
      return { success: true, data: { status: 'completed', mode: 'oneshot' } };
    }
    return { success: true, data: { status: 'continuing', mode: 'oneshot', step } };
  }

  // V16: scheduler-backed auto mode
  if (action === 'auto' || action === 'stop' || action === 'pause' || action === 'resume' || action === 'report_tool') {
    const scheduler = buildScheduler(root, client);
    // Map action to individual scheduler methods (AutoLoopScheduler has no handleAction)
    if (action === 'auto') {
      scheduler.start();
      return { success: true, data: { state: scheduler.getState(), status: scheduler.getStatus() } };
    }
    if (action === 'stop') {
      scheduler.stop();
      return { success: true, data: { state: scheduler.getState(), status: scheduler.getStatus() } };
    }
    if (action === 'pause') {
      scheduler.pause();
      return { success: true, data: { state: scheduler.getState(), status: scheduler.getStatus() } };
    }
    if (action === 'resume') {
      scheduler.resume();
      return { success: true, data: { state: scheduler.getState(), status: scheduler.getStatus() } };
    }
    // report_tool
    const ok = scheduler.reportToolExecuted(toolName || '');
    return { success: true, data: { reported: ok, tool_name: toolName } };
  }

  // V17: step / full / status / reset — driver-backed
  const driver = buildDriver(root, client);
  switch (action) {
    case 'step': {
      const step = await driver.step();
      return { success: true, data: step };
    }
    case 'full': {
      const result = await driver.runFull();
      return { success: true, data: result };
    }
    case 'status': {
      return {
        success: true,
        data: {
          status: driver.getStatus(),
          iteration: driver.getIteration(),
          current_stage: driver.getCurrentStage(),
          max_iterations: driver.getMaxIterations(),
        },
      };
    }
    case 'reset': {
      clearControllerCache(root);
      return { success: true, data: { reset: true, root } };
    }
    default: {
      // Default: step
      const step = await driver.step();
      return { success: true, data: step };
    }
  }
}
