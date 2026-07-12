import type { Stage } from './state-machine';
import type { MakerFn, CheckerFn, OptimizerFn } from './phase-loop';
import type { StageHandlers, StageHandlerProvider } from './inner-loop';
import type { PhaseGateInput, PhaseGateEvaluation } from './phase-gates';

/**
 * Options for default stage handlers.
 */
export interface DefaultHandlersOptions {
  /** Working directory path for file read/write operations. */
  workDir?: string;
  /** Additional context passed to the maker. */
  context?: Record<string, unknown>;
}

/**
 * Default maker: produces work summaries for each stage.
 *
 * - open:    Generates PRD draft
 * - design:  Generates architecture design
 * - build:   Generates code implementation
 * - verify:  Runs quality verification
 * - archive: Generates documentation
 */
export function createDefaultMaker(options?: DefaultHandlersOptions): MakerFn {
  return async (stage: Stage, iteration: number) => {
    const workMap: Record<Stage, string> = {
      open: `PRD draft v${iteration} — requirements analyzed and stories generated`,
      design: `Architecture design v${iteration} — 7 diagrams + component breakdown`,
      build: `Implementation v${iteration} — code written with unit tests`,
      verify: `Quality verification v${iteration} — 5 gates executed`,
      archive: `Documentation v${iteration} — 6 documents generated + spec sync`,
    };
    return {
      work: workMap[stage] || `Work for ${stage} v${iteration}`,
      tokensUsed: 500 + iteration * 100,
    };
  };
}

/**
 * Default checker: returns PhaseGateInput metrics for each stage.
 *
 * Returns "optimistic" metrics (first iteration passes) to verify
 * the three-level loop flow itself is correct.
 * In production, replace with actual tool-call-based checkers.
 */
export function createDefaultChecker(options?: DefaultHandlersOptions): CheckerFn {
  return async (stage: Stage, _work: string) => {
    const inputMap: Record<Stage, PhaseGateInput> = {
      open: { p0_issues: 0, p1_issues: 1 },
      design: { diagrams_complete: 7, design_review_passed: true },
      build: { tdd_enforced: true, unit_test_pass_pct: 100 },
      verify: { gates_passed: 5, security_optional_downgrade: false },
      archive: { documents_complete: 6, spec_sync_done: true },
    };
    return {
      input: inputMap[stage] || {},
      tokensUsed: 200,
    };
  };
}

/**
 * Default optimizer: adjusts work when a gate fails.
 *
 * Appends improvement notes to the work summary.
 */
export function createDefaultOptimizer(options?: DefaultHandlersOptions): OptimizerFn {
  return async (stage: Stage, work: string, evaluation: PhaseGateEvaluation) => {
    const failedChecks = evaluation.results
      .filter(r => !r.result.passed)
      .map(r => r.result.detail);
    const optimizedWork = `${work}\n[Optimized] Addressed: ${failedChecks.join('; ')}`;
    return {
      work: optimizedWork,
      tokensUsed: 300,
    };
  };
}

/**
 * Create a default StageHandlerProvider.
 *
 * Assembles maker/checker/optimizer for all 5 stages.
 * This enables InnerLoop.run() and OuterLoop.run() to operate
 * without external handler injection.
 */
export function createDefaultHandlerProvider(
  options?: DefaultHandlersOptions,
): StageHandlerProvider {
  const maker = createDefaultMaker(options);
  const checker = createDefaultChecker(options);
  const optimizer = createDefaultOptimizer(options);

  return (_stage: Stage): StageHandlers => ({
    maker,
    checker,
    optimizer,
  });
}
