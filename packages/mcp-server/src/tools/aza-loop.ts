import { LoopController, CircuitBreaker, CompletionGate, LoopAudit, ConfigLoader, DEFAULT_BLOCK_COUNT_LIMIT, AutoLoopDriver, AutoLoopScheduler } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

// ── P0-2: Singleton LoopController cache ──
// Each project root has one cached LoopController instance.
// This ensures state machine continuity across MCP tool calls
// within the same session, while allowing different projects
// to have independent controllers.
const controllerCache = new Map<string, LoopController>();

function buildController(projectRoot: string): LoopController {
  const cached = controllerCache.get(projectRoot);
  if (cached) return cached;

  const azaDir = path.join(projectRoot, '.aza');
  const loader = new ConfigLoader(projectRoot);
  const config = loader.getDefaultConfig(); // non-async fallback
  const lc = new LoopController({
    maxIterations: config.loop.max_iterations,
    maxStageIterations: 5,
    enableV12: true,
    azaDir,
    projectRoot,
    config,
  });
  controllerCache.set(projectRoot, lc);
  return lc;
}

/**
 * Clear the controller cache for a given project root.
 * Used during session reset / aza_init to force a fresh controller.
 */
export function clearControllerCache(projectRoot?: string): void {
  if (projectRoot) {
    controllerCache.delete(projectRoot);
  } else {
    controllerCache.clear();
  }
}

// ── Core loop tools ──

export async function handleLoopNext(currentStage?: string, projectRoot?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd());
  return await lc.next(currentStage as any);
}

export async function handleLoopStatus(projectRoot?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd());
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
    metadata: {
      iteration: state.iteration,
      progress: state.progress,
      stage: state.current_stage,
      loop_level: 'outer',
    },
  };
}

export async function handleLoopComplete(stage: string, projectRoot?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd());
  const result = lc.completeStage(stage);
  const state = lc.stateMachine.getState();

  if (!result.success) {
    return {
      success: false,
      data: { stage, progress: state.progress },
      error: result.error,
      next_action: { tool: 'aza_loop_next', action: 'retry', reason: result.error || 'Guard check failed' },
      metadata: { iteration: state.iteration, progress: state.progress, stage: state.current_stage },
    };
  }

  return {
    success: true,
    data: { stage: state.current_stage, progress: state.progress },
    next_action: state.current_stage !== 'archive'
      ? { tool: 'aza_loop_next', action: 'next', reason: `Advanced to ${state.current_stage} stage` }
      : { tool: 'aza_loop_next', action: 'done', reason: 'All stages complete' },
    metadata: { iteration: state.iteration, progress: state.progress, stage: state.current_stage },
  };
}

export async function handleLoopSetCondition(key: string, passed: boolean, projectRoot?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd());
  lc.setCondition(key as any, passed);
  return {
    success: true,
    data: { condition: key, passed },
    metadata: { iteration: lc.stateMachine.getState().iteration, progress: lc.stateMachine.getProgress(), stage: lc.stateMachine.getCurrentStage() },
  };
}

export async function handleLoopResetConditions(projectRoot?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd());
  lc.resetConditions();
  return {
    success: true,
    data: { reset: true },
    metadata: { iteration: lc.stateMachine.getState().iteration, progress: lc.stateMachine.getProgress(), stage: lc.stateMachine.getCurrentStage() },
  };
}

export async function handleLoopStop(reason: string, projectRoot?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd());
  lc.stop('user_requested', reason);
  const state = lc.stateMachine.getState();
  return {
    success: true,
    data: { stopped: true, reason },
    next_action: { tool: 'aza_loop_next', action: 'report', reason: 'Loop stopped by user' },
    metadata: { iteration: state.iteration, progress: state.progress, stage: state.current_stage },
  };
}

export async function handleLoopGetStageIterations(stage: string, projectRoot?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd());
  const count = lc.getStageIterations(stage);
  return {
    success: true,
    data: { stage, iterations: count },
    metadata: { iteration: lc.stateMachine.getState().iteration, progress: lc.stateMachine.getProgress(), stage: lc.stateMachine.getCurrentStage() },
  };
}

// ── V12: Circuit breaker status ──

export async function handleLoopCircuitBreaker(projectRoot?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd());
  const phaseMetrics = lc.circuitBreaker.getMetrics('phase');
  const innerMetrics = lc.circuitBreaker.getMetrics('inner');
  const outerMetrics = lc.circuitBreaker.getMetrics('outer');
  const tripped = lc.circuitBreaker.checkAll();

  return {
    success: true,
    data: {
      tripped: tripped?.tripped ?? false,
      tripped_reason: tripped?.reason,
      tripped_dimension: tripped?.dimension,
      phase: phaseMetrics,
      inner: innerMetrics,
      outer: outerMetrics,
    },
    metadata: {
      iteration: lc.stateMachine.getState().iteration,
      progress: lc.stateMachine.getProgress(),
      stage: lc.stateMachine.getCurrentStage(),
    },
  };
}

// ── V12: Completion gate check ──

export async function handleLoopCompletionGate(projectRoot?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd());
  const state = lc.stateMachine.getState();
  const hasInProgress = Object.values(state.stages).some(s => s.status === 'in_progress');

  const result = lc.completionGate.evaluate({
    gated_mode_enabled: lc.configLoopOptions.enableV12,
    has_in_progress_stage: hasInProgress,
    all_stages_completed: Object.values(state.stages).every(s => s.status === 'completed'),
    stop_hook_active: lc.stopHookActive,
    block_count: lc.blockCount,
    block_count_limit: DEFAULT_BLOCK_COUNT_LIMIT,
    ledger_has_progress: lc.ledgerHasProgress || state.iteration > 0,
    attestation_verified: state.attestation?.verified ?? false,
  });

  return {
    success: true,
    data: {
      can_stop: result.canStop,
      blocked_reason: result.blockedReason,
      conditions: result.conditions,
    },
    metadata: {
      iteration: state.iteration,
      progress: state.progress,
      stage: state.current_stage,
    },
  };
}

// ── V12: Loop audit ──

export async function handleLoopAudit(projectRoot?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd());
  const result = await lc.audit();

  return {
    success: true,
    data: {
      overall_score: result.score,
      level: result.level,
      signals: result.signals,
      recommendations: result.recommendations,
    },
    metadata: {
      iteration: lc.stateMachine.getState().iteration,
      progress: lc.stateMachine.getProgress(),
      stage: lc.stateMachine.getCurrentStage(),
    },
  };
}

// ── P0-4: MCP AutoLoopDriver integration ──

const driverCache = new Map<string, AutoLoopDriver>();

function buildDriver(projectRoot: string): AutoLoopDriver {
  const cached = driverCache.get(projectRoot);
  if (cached) return cached;

  const lc = buildController(projectRoot);
  const driver = new AutoLoopDriver(lc, {
    maxIterations: 50,
    enableSentinelDetection: true,
    onPrdReview: async (stage) => {
      // Auto-approve PRD review in auto-loop mode
      // The PRD content is already validated by the time we reach the gate
      return { approved: true, feedback: 'Auto-approved by auto-loop driver' };
    },
    onEscalate: async (reason, stage) => {
      // Log escalation but don't crash — let the caller handle it
      console.warn(`[AutoLoopDriver] Escalated at stage "${stage}": ${reason}`);
    },
  });
  driverCache.set(projectRoot, driver);
  return driver;
}

// ── V16: AutoLoopScheduler (background auto-loop) ──

const schedulerCache = new Map<string, AutoLoopScheduler>();

function buildScheduler(projectRoot: string): AutoLoopScheduler {
  const cached = schedulerCache.get(projectRoot);
  if (cached) return cached;

  const lc = buildController(projectRoot);
  const scheduler = new AutoLoopScheduler(lc, {
    onStageChange: (stage) => {
      // Log stage changes
      console.log(`[AutoLoopScheduler] Stage changed to "${stage}"`);
    },
    onToolAwaiting: (action) => {
      console.log(`[AutoLoopScheduler] Awaiting agent to execute ${action.tool}: ${action.reason}`);
    },
    onComplete: (result) => {
      console.log(`[AutoLoopScheduler] Completed after ${result.iteration} iterations at stage "${result.stage}"`);
    },
    onError: (error) => {
      console.error(`[AutoLoopScheduler] Error: ${error.message}`);
    },
  });
  schedulerCache.set(projectRoot, scheduler);
  return scheduler;
}

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
): Promise<LoopResponse> {
  const root = projectRoot ?? process.cwd();
  const driver = buildDriver(root);

  // ── V16: Background scheduler actions ──
  const scheduler = schedulerCache.get(root) || buildScheduler(root);

  switch (action ?? 'step') {
    case 'status': {
      // Include scheduler status if available
      const schedulerStatus = scheduler.getStatus();
      return {
        success: true,
        data: {
          status: driver.getStatus(),
          iteration: driver.getIteration(),
          current_stage: driver.getCurrentStage(),
          scheduler: {
            running: schedulerStatus.running,
            paused: schedulerStatus.paused,
            awaitingAction: schedulerStatus.awaitingAction,
            lastError: schedulerStatus.lastError,
          },
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'reset': {
      scheduler.reset();
      driver.reset();
      return {
        success: true,
        data: { status: 'reset', iteration: 0 },
        metadata: { iteration: 0, progress: '0%', stage: 'open' },
      };
    }

    case 'full': {
      const result = await driver.runFull();
      return {
        success: true,
        data: {
          status: driver.getStatus(),
          total_iterations: result.totalIterations,
          final_stage: result.finalStage,
          completed: result.completed,
          reason: result.reason,
        },
        metadata: {
          iteration: result.totalIterations,
          progress: '100%',
          stage: result.finalStage,
        },
      };
    }

    // ── V16: Background scheduler actions ──

    case 'auto': {
      // V18: If switching from step mode, sync driver state to scheduler
      // by reading current stage from the shared LoopController.
      // Start the background scheduler
      scheduler.start();
      return {
        success: true,
        data: {
          status: 'auto_started',
          scheduler_state: scheduler.getState(),
          // V18: Include driver state for client-side sync
          driver_stage: driver.getCurrentStage(),
          driver_iteration: driver.getIteration(),
          message: 'Background auto-loop scheduler started',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'stop': {
      scheduler.stop();
      return {
        success: true,
        data: {
          status: 'stopped',
          scheduler_state: scheduler.getState(),
          message: 'Background auto-loop scheduler stopped',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'pause': {
      scheduler.pause();
      return {
        success: true,
        data: {
          status: 'paused',
          scheduler_state: scheduler.getState(),
          message: 'Background auto-loop scheduler paused',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'resume': {
      scheduler.resume();
      return {
        success: true,
        data: {
          status: 'resumed',
          scheduler_state: scheduler.getState(),
          message: 'Background auto-loop scheduler resumed',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'retry': {
      // V18: Retry from error state
      const retried = scheduler.retry();
      return {
        success: true,
        data: {
          status: retried ? 'retried' : 'not_in_error',
          scheduler_state: scheduler.getState(),
          message: retried
            ? 'Scheduler retried from error state'
            : 'Scheduler not in error state (retry ignored)',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'report_tool': {
      // Report that the LLM has executed the awaited tool
      if (toolName) {
        scheduler.reportToolExecuted(toolName);
        return {
          success: true,
          data: {
            status: 'tool_reported',
            tool_executed: toolName,
            scheduler_state: scheduler.getState(),
            message: `Tool "${toolName}" execution reported to scheduler`,
          },
          metadata: {
            iteration: driver.getIteration(),
            progress: driver.getLoopController().stateMachine.getProgress(),
            stage: driver.getCurrentStage(),
          },
        };
      }
      return {
        success: false,
        data: { status: 'error' },
        error: 'toolName is required for report_tool action',
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'step':
    default: {
      // V18: If scheduler is running, pause it to avoid concurrent step() conflicts
      if (scheduler.getState() === 'running') {
        scheduler.pause();
      }
      const stepResult = await driver.step();
      if (stepResult.done) {
        return {
          success: true,
          data: {
            done: true,
            status: driver.getStatus(),
            action: stepResult.nextAction,
            stage: stepResult.stage,
            iteration: stepResult.iteration,
            // V17: Include awaitingAction if present — this is a pre-action instruction
            // telling the LLM to execute a specific tool before calling step() again.
            awaitingAction: stepResult.awaitingAction,
          },
          next_action: stepResult.nextAction ?? { tool: 'aza_loop_next', action: 'done', reason: 'Auto-loop complete' },
          metadata: {
            iteration: stepResult.iteration,
            progress: driver.getLoopController().stateMachine.getProgress(),
            stage: stepResult.stage,
          },
        };
      }

      return {
        success: true,
        data: {
          done: false,
          status: driver.getStatus(),
          next_action: stepResult.nextAction,
          stage: stepResult.stage,
          iteration: stepResult.iteration,
          // V17: Include awaitingAction if present
          awaitingAction: stepResult.awaitingAction,
        },
        next_action: stepResult.nextAction ?? { tool: 'aza_loop_next', action: 'next', reason: 'Continue auto-loop' },
        metadata: {
          iteration: stepResult.iteration,
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: stepResult.stage,
        },
      };
    }
  }
}
