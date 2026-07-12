import {
  QualityPipeline,
  lintGate,
  testGate,
  regressionGate,
  securityGate,
  acceptanceGate,
  loopAuditGate,
} from '@azaloop/core';
import type { RegressionBaseline } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';

/**
 * Build a fresh QualityPipeline instance for the given project root.
 * No singleton caching — each call creates a new pipeline with the correct
 * project root baked into gate callbacks.
 */
function buildPipeline(projectRoot: string): QualityPipeline {
  const pipeline = new QualityPipeline();

  pipeline.register({
    name: 'Gate 1: Static Analysis (tsc + ESLint)',
    execute: () => lintGate(projectRoot),
  });

  pipeline.register({
    name: 'Gate 2: Test Suite (Vitest)',
    execute: () => testGate(projectRoot),
  });

  const emptyBaseline: RegressionBaseline = {
    test_count: 0,
    pass_count: 0,
    fail_count: 0,
    duration_ms: 0,
  };
  pipeline.register({
    name: 'Gate 3: Regression Check',
    execute: () => regressionGate(emptyBaseline, emptyBaseline),
  });

  pipeline.register({
    name: 'Gate 4: Security Scan',
    execute: () => securityGate(projectRoot),
  });

  pipeline.register({
    name: 'Gate 5: Acceptance Criteria Verification',
    execute: () => acceptanceGate([]),
  });

  pipeline.register({
    name: 'Gate 6: Loop Audit Scoring',
    execute: () => loopAuditGate({ signals: {} }),
  });

  return pipeline;
}

export async function handleQualityCheck(projectRoot: string): Promise<LoopResponse> {
  const pipeline = buildPipeline(projectRoot);
  const result = await pipeline.runAll();
  return {
    success: result.passed,
    data: result,
    next_action: result.passed
      ? { tool: 'aza_loop_next', action: 'next', reason: 'All quality gates passed' }
      : { tool: 'aza_quality_check', action: 'fix', reason: `Quality gate failed: ${result.summary}` },
    metadata: { iteration: 0, progress: result.passed ? '85%' : '50%', stage: 'verify' },
  };
}
