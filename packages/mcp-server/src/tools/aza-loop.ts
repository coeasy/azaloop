import { LoopController, CircuitBreaker, CompletionGate, LoopAudit, ConfigLoader, DEFAULT_BLOCK_COUNT_LIMIT } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

function buildController(projectRoot: string): LoopController {
  const azaDir = path.join(projectRoot, '.aza');
  const loader = new ConfigLoader(projectRoot);
  const config = loader.getDefaultConfig(); // non-async fallback
  return new LoopController({
    maxIterations: config.loop.max_iterations,
    maxStageIterations: 5,
    enableV12: true,
    azaDir,
    projectRoot,
    config,
  });
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
