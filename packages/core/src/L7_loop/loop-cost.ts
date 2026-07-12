/**
 * LoopCost — Token budget estimator for the three-level loop.
 *
 * Borrows from loop-engineering's loop-cost pattern: estimates token
 * consumption per cycle based on loop mode, frequency, and stage complexity.
 *
 * Used by `aza_budget` MCP tool to output budget reports and help
 * users understand token economics of their loop runs.
 */

/**
 * Cost estimate for a single loop level.
 */
export interface LevelCostEstimate {
  /** Loop level identifier */
  level: 'outer' | 'inner' | 'phase';
  /** Estimated tokens per cycle */
  tokens_per_cycle: number;
  /** Number of cycles expected */
  expected_cycles: number;
  /** Total estimated tokens for this level */
  total_tokens: number;
}

/**
 * Cost estimate for a specific pipeline stage.
 */
export interface StageCostEstimate {
  /** Pipeline stage */
  stage: string;
  /** Maker token cost per iteration */
  maker_tokens: number;
  /** Checker token cost per iteration */
  checker_tokens: number;
  /** Optimizer token cost per iteration (only on gate failure) */
  optimizer_tokens: number;
  /** Expected iterations for this stage */
  expected_iterations: number;
  /** Total estimated tokens for this stage */
  total_tokens: number;
}

/**
 * Full budget report for a loop run.
 */
export interface BudgetReport {
  /** Total estimated tokens for the full pipeline */
  total_estimate: number;
  /** Token budget (from config) */
  budget: number;
  /** Whether the estimate is within budget */
  within_budget: boolean;
  /** Budget utilization percentage */
  utilization_pct: number;
  /** Per-level breakdown */
  levels: LevelCostEstimate[];
  /** Per-stage breakdown */
  stages: StageCostEstimate[];
  /** Recommendations for budget optimization */
  recommendations: string[];
}

/**
 * Options for the cost estimator.
 */
export interface LoopCostOptions {
  /** Token budget (from config). Default: 100000 */
  budget?: number;
  /** Maximum phase iterations per stage. Default: 5 */
  maxPhaseIterations?: number;
  /** Number of stories. Default: 1 */
  storyCount?: number;
  /** Gate failure rate estimate (0.0-1.0). Default: 0.3 */
  gateFailureRate?: number;
  /** Whether to enable outer loop. Default: false */
  enableOuterLoop?: boolean;
}

// Default token costs per operation (heuristic estimates)
const DEFAULT_COSTS = {
  maker_per_iteration: 2000,
  checker_per_iteration: 800,
  optimizer_per_iteration: 1500,
  context_injection: 500,
  state_sync: 100,
  outer_loop_overhead: 500,
};

/**
 * The LoopCost estimator.
 */
export class LoopCost {
  private options: Required<LoopCostOptions>;

  constructor(options: LoopCostOptions = {}) {
    this.options = {
      budget: options.budget ?? 100000,
      maxPhaseIterations: options.maxPhaseIterations ?? 5,
      storyCount: options.storyCount ?? 1,
      gateFailureRate: options.gateFailureRate ?? 0.3,
      enableOuterLoop: options.enableOuterLoop ?? false,
    };
  }

  /**
   * Estimate token cost for the full pipeline.
   */
  estimate(): BudgetReport {
    const stages = this.estimateStages();
    const levels = this.estimateLevels(stages);
    const totalEstimate = levels.reduce((sum, l) => sum + l.total_tokens, 0);

    const withinBudget = totalEstimate <= this.options.budget;
    const utilizationPct = this.options.budget > 0
      ? Math.round((totalEstimate / this.options.budget) * 100)
      : 0;

    const recommendations = this.generateRecommendations(totalEstimate, stages);

    return {
      total_estimate: totalEstimate,
      budget: this.options.budget,
      within_budget: withinBudget,
      utilization_pct: utilizationPct,
      levels,
      stages,
      recommendations,
    };
  }

  /**
   * Estimate cost for a single next() call at a given stage.
   */
  estimateNextCall(stage: string, iteration: number): number {
    const baseCost = DEFAULT_COSTS.maker_per_iteration + DEFAULT_COSTS.checker_per_iteration;
    const contextCost = DEFAULT_COSTS.context_injection;
    const stateCost = DEFAULT_COSTS.state_sync;

    // Higher iterations likely need more optimizer calls
    const optimizerProb = iteration > 1 ? this.options.gateFailureRate : 0;
    const optimizerCost = Math.round(DEFAULT_COSTS.optimizer_per_iteration * optimizerProb);

    return baseCost + contextCost + stateCost + optimizerCost;
  }

  /**
   * Estimate remaining budget after consuming given tokens.
   */
  remainingBudget(consumedTokens: number): { remaining: number; cycles_remaining: number } {
    const remaining = Math.max(0, this.options.budget - consumedTokens);
    const avgCostPerCycle = this.estimate().total_estimate /
      (5 * this.options.maxPhaseIterations * this.options.storyCount);
    const cyclesRemaining = avgCostPerCycle > 0
      ? Math.floor(remaining / avgCostPerCycle)
      : 0;
    return { remaining, cycles_remaining: cyclesRemaining };
  }

  // ── Private helpers ──

  private estimateStages(): StageCostEstimate[] {
    const stageNames = ['open', 'design', 'build', 'verify', 'archive'];
    const stageMultipliers: Record<string, number> = {
      open: 0.5,      // PRD generation is lighter
      design: 0.8,    // Design involves analysis
      build: 1.5,     // Build is the heaviest (code generation)
      verify: 1.2,    // Verify runs tsc + tests
      archive: 0.3,   // Archive is lightweight docs
    };

    return stageNames.map(stage => {
      const mult = stageMultipliers[stage] ?? 1.0;
      const makerTokens = Math.round(DEFAULT_COSTS.maker_per_iteration * mult);
      const checkerTokens = Math.round(DEFAULT_COSTS.checker_per_iteration * mult);
      const optimizerTokens = Math.round(DEFAULT_COSTS.optimizer_per_iteration * mult);

      // First iteration always runs maker+checker.
      // Subsequent iterations run on gate failure (probability = gateFailureRate).
      const expectedIters = 1 + this.options.gateFailureRate * (this.options.maxPhaseIterations - 1);
      const roundedIters = Math.round(expectedIters * 10) / 10;

      const totalTokens = Math.round(
        (makerTokens + checkerTokens) * roundedIters +
        optimizerTokens * this.options.gateFailureRate * (roundedIters - 1) +
        DEFAULT_COSTS.context_injection + DEFAULT_COSTS.state_sync
      );

      return {
        stage,
        maker_tokens: makerTokens,
        checker_tokens: checkerTokens,
        optimizer_tokens: optimizerTokens,
        expected_iterations: roundedIters,
        total_tokens: totalTokens,
      };
    });
  }

  private estimateLevels(stages: StageCostEstimate[]): LevelCostEstimate[] {
    const phaseTokens = stages.reduce((sum, s) => sum + s.total_tokens, 0);

    const innerTokens = phaseTokens * this.options.storyCount;

    const outerCycles = this.options.enableOuterLoop ? this.options.storyCount : 1;
    const outerOverhead = this.options.enableOuterLoop
      ? DEFAULT_COSTS.outer_loop_overhead * outerCycles
      : 0;
    const outerTokens = innerTokens + outerOverhead;

    return [
      {
        level: 'phase',
        tokens_per_cycle: Math.round(phaseTokens / 5), // per stage
        expected_cycles: 5 * this.options.maxPhaseIterations * this.options.storyCount,
        total_tokens: phaseTokens,
      },
      {
        level: 'inner',
        tokens_per_cycle: Math.round(innerTokens / this.options.storyCount),
        expected_cycles: this.options.storyCount,
        total_tokens: innerTokens,
      },
      {
        level: 'outer',
        tokens_per_cycle: Math.round(outerTokens / outerCycles),
        expected_cycles: outerCycles,
        total_tokens: outerTokens,
      },
    ];
  }

  private generateRecommendations(totalEstimate: number, stages: StageCostEstimate[]): string[] {
    const recs: string[] = [];

    if (totalEstimate > this.options.budget) {
      const overPct = Math.round(((totalEstimate - this.options.budget) / this.options.budget) * 100);
      recs.push(`Budget exceeded by ${overPct}% — consider reducing maxPhaseIterations or storyCount.`);
    }

    if (this.options.gateFailureRate > 0.5) {
      recs.push(`High gate failure rate (${Math.round(this.options.gateFailureRate * 100)}%) inflates cost — improve maker quality to reduce retries.`);
    }

    const buildStage = stages.find(s => s.stage === 'build');
    if (buildStage && buildStage.total_tokens > totalEstimate * 0.4) {
      recs.push('Build stage dominates cost (>40%) — consider breaking into smaller stories.');
    }

    if (this.options.maxPhaseIterations > 3) {
      recs.push(`MaxPhaseIterations=${this.options.maxPhaseIterations} is high — most stages pass in 1-2 iterations.`);
    }

    if (recs.length === 0) {
      recs.push('Budget estimate is within limits. No optimization needed.');
    }

    return recs;
  }
}
