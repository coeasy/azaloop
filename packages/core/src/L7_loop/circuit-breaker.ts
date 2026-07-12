import type { Stage } from './state-machine';

/**
 * The loop level that the circuit breaker is monitoring.
 */
export type CircuitBreakerLevel = 'phase' | 'inner' | 'outer';

/**
 * The four dimensions monitored by the circuit breaker.
 */
export type CircuitBreakerDimension =
  | 'iteration_count'
  | 'token_spend'
  | 'stagnation'
  | 'no_progress';

/**
 * Configuration thresholds for each circuit-breaker dimension.
 */
export interface CircuitBreakerConfig {
  /** Maximum total iterations before tripping (default 50). */
  maxIterations: number;
  /** Maximum token spend before tripping (default 200_000). */
  tokenBudget: number;
  /** Number of consecutive identical errors before tripping (default 3). */
  stagnationThreshold: number;
  /** Number of consecutive failures (no progress) before tripping (default 5). */
  noProgressThreshold: number;
}

/**
 * Default configuration — can be overridden per breaker instance.
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  maxIterations: 50,
  tokenBudget: 200_000,
  stagnationThreshold: 3,
  noProgressThreshold: 5,
};

/**
 * Result of a circuit-breaker evaluation.
 */
export interface CircuitBreakerResult {
  /** Whether the circuit breaker has tripped (open). */
  tripped: boolean;
  /** Human-readable reason for the trip, if tripped. */
  reason?: string;
  /** The loop level at which the breaker tripped. */
  level: CircuitBreakerLevel;
  /** The dimension that caused the trip, if any. */
  dimension?: CircuitBreakerDimension;
  /** Current metric snapshot at the time of evaluation. */
  metrics: CircuitBreakerMetrics;
}

/**
 * Metrics tracked by the circuit breaker across one or more loop levels.
 */
export interface CircuitBreakerMetrics {
  /** Total iterations observed. */
  iterations: number;
  /** Total tokens spent. */
  tokensSpent: number;
  /** Recent error messages (for stagnation detection). */
  recentErrors: string[];
  /** Number of consecutive failures (no progress made). */
  consecutiveFailures: number;
}

/**
 * Internal record for a single monitored level.
 */
interface LevelState {
  metrics: CircuitBreakerMetrics;
  errorHistory: string[];
  consecutiveFailures: number;
}

/**
 * The circuit breaker monitors four failure dimensions across all three
 * loop levels (phase / inner / outer).
 *
 * When any dimension trips, the breaker returns a {@link CircuitBreakerResult}
 * with `tripped: true`. The consuming loop is expected to escalate:
 *
 *   phase level → inner level → outer level → human
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private levels: Map<CircuitBreakerLevel, LevelState> = new Map();

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.reset();
  }

  /**
   * Reset all tracked state for every level.
   */
  reset(): void {
    for (const level of ['phase', 'inner', 'outer'] as CircuitBreakerLevel[]) {
      this.levels.set(level, {
        metrics: {
          iterations: 0,
          tokensSpent: 0,
          recentErrors: [],
          consecutiveFailures: 0,
        },
        errorHistory: [],
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * Record a successful iteration for a given level.
   */
  recordSuccess(level: CircuitBreakerLevel, tokensUsed: number = 0): void {
    const state = this.getOrCreateState(level);
    state.metrics.iterations++;
    state.metrics.tokensSpent += tokensUsed;
    state.consecutiveFailures = 0;
    state.metrics.consecutiveFailures = 0;
  }

  /**
   * Record a failed iteration for a given level.
   *
   * @param level  The loop level that failed.
   * @param error  The error message (used for stagnation detection).
   * @param tokensUsed  Tokens consumed during the failed attempt.
   */
  recordFailure(level: CircuitBreakerLevel, error: string, tokensUsed: number = 0): void {
    const state = this.getOrCreateState(level);
    state.metrics.iterations++;
    state.metrics.tokensSpent += tokensUsed;
    state.consecutiveFailures++;
    state.metrics.consecutiveFailures = state.consecutiveFailures;

    // Track error for stagnation detection
    state.errorHistory.push(error);
    // Keep last 10 errors to detect repeated patterns
    if (state.errorHistory.length > 10) {
      state.errorHistory = state.errorHistory.slice(-10);
    }
    state.metrics.recentErrors = [...state.errorHistory];
  }

  /**
   * Record a stage completion — resets consecutive failures for the level.
   */
  recordProgress(level: CircuitBreakerLevel, tokensUsed: number = 0): void {
    const state = this.getOrCreateState(level);
    state.metrics.iterations++;
    state.metrics.tokensSpent += tokensUsed;
    state.consecutiveFailures = 0;
    state.metrics.consecutiveFailures = 0;
    state.errorHistory = [];
    state.metrics.recentErrors = [];
  }

  /**
   * Evaluate all four dimensions for a given level.
   */
  check(level: CircuitBreakerLevel): CircuitBreakerResult {
    const state = this.getOrCreateState(level);
    const m = state.metrics;

    // 1. Iteration count
    if (m.iterations >= this.config.maxIterations) {
      return {
        tripped: true,
        reason: `Iteration count (${m.iterations}) reached max (${this.config.maxIterations})`,
        level,
        dimension: 'iteration_count',
        metrics: { ...m, recentErrors: [...m.recentErrors] },
      };
    }

    // 2. Token spend
    if (m.tokensSpent >= this.config.tokenBudget) {
      return {
        tripped: true,
        reason: `Token spend (${m.tokensSpent}) exceeded budget (${this.config.tokenBudget})`,
        level,
        dimension: 'token_spend',
        metrics: { ...m, recentErrors: [...m.recentErrors] },
      };
    }

    // 3. Stagnation — same error repeated N times consecutively
    if (state.errorHistory.length >= this.config.stagnationThreshold) {
      const recent = state.errorHistory.slice(-this.config.stagnationThreshold);
      if (recent.length >= this.config.stagnationThreshold && recent.every(e => e === recent[0])) {
        return {
          tripped: true,
          reason: `Stagnation: same error repeated ${this.config.stagnationThreshold}× — "${recent[0]}"`,
          level,
          dimension: 'stagnation',
          metrics: { ...m, recentErrors: [...m.recentErrors] },
        };
      }
    }

    // 4. No progress — consecutive failures without any progress
    if (state.consecutiveFailures >= this.config.noProgressThreshold) {
      return {
        tripped: true,
        reason: `No progress: ${state.consecutiveFailures} consecutive failures`,
        level,
        dimension: 'no_progress',
        metrics: { ...m, recentErrors: [...m.recentErrors] },
      };
    }

    return {
      tripped: false,
      level,
      metrics: { ...m, recentErrors: [...m.recentErrors] },
    };
  }

  /**
   * Check all levels and return the first tripped result, if any.
   *
   * Priority order: phase → inner → outer.
   */
  checkAll(): CircuitBreakerResult | null {
    for (const level of ['phase', 'inner', 'outer'] as CircuitBreakerLevel[]) {
      const result = this.check(level);
      if (result.tripped) return result;
    }
    return null;
  }

  /**
   * Get the escalation path for a tripped breaker.
   *
   * Escalation order: phase → inner → outer → human.
   */
  getEscalationTarget(level: CircuitBreakerLevel): CircuitBreakerLevel | 'human' {
    const order: CircuitBreakerLevel[] = ['phase', 'inner', 'outer'];
    const idx = order.indexOf(level);
    if (idx < 0 || idx >= order.length - 1) return 'human';
    const next = order[idx + 1];
    return next ?? 'human';
  }

  /**
   * Get current metrics snapshot for a specific level.
   */
  getMetrics(level: CircuitBreakerLevel): CircuitBreakerMetrics {
    const state = this.getOrCreateState(level);
    return { ...state.metrics, recentErrors: [...state.metrics.recentErrors] };
  }

  // ── private helpers ──

  private getOrCreateState(level: CircuitBreakerLevel): LevelState {
    let state = this.levels.get(level);
    if (!state) {
      state = {
        metrics: {
          iterations: 0,
          tokensSpent: 0,
          recentErrors: [],
          consecutiveFailures: 0,
        },
        errorHistory: [],
        consecutiveFailures: 0,
      };
      this.levels.set(level, state);
    }
    return state;
  }
}

/**
 * Convenience type for the stage-specific breaker context used by phase/inner/outer loops.
 */
export interface StageBreakerContext {
  stage: Stage;
  level: CircuitBreakerLevel;
  breaker: CircuitBreaker;
}
