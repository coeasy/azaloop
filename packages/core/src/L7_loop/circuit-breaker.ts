import type { Stage } from './state-machine';
import { CostTracker } from './cost-tracker';

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
 * R7: 错误签名归一化——把不同形式但同根因的错误折叠成一个签名。
 * 借鉴 loop-engineering "错误签名去重" 模式：
 *   - 去除数字、路径、引号、时间戳、UUID
 *   - 统一空白
 *   - 截断到 80 字符
 * 这样 "TypeError: undefined.foo at /Users/x/y/z:123" 与
 *      "TypeError: undefined.foo at /var/lib/w:456" 会被识别为同一签名。
 */
export function errorSignature(error: string): string {
  if (!error || typeof error !== 'string') return '<empty>';
  return error
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>') // UUID
    .replace(/\/[^\s)]+:\d+/g, '<path>') // 文件路径:行号 (先于数字归一化)
    .replace(/\b\d+\b/g, '<n>') // 数字
    .replace(/['"`][^'"`]*?['"`]/g, '<str>') // 引号内容
    .replace(/at\s+<path>/g, '') // stack 行
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .toLowerCase() || '<empty>';
}

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
  /**
   * Optional callback invoked when the breaker signals a workload downgrade.
   * The argument is the half-workload factor (e.g. `0.5` for 50%).
   */
  onHalfWorkload?: (factor: number) => void;

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

    // R7: 用 errorSignature 归一化后再存，跳过数字/路径差异
    const signature = errorSignature(error);
    state.errorHistory.push(signature);
    // Keep last 10 signatures to detect repeated patterns
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

  /**
   * Cold-start recovery: when the breaker has been broken, automatically
   * notify the caller to downgrade to a fraction of the normal workload
   * (default 50%) and then re-execute the supplied function.
   *
   * The `onHalfWorkload` callback is invoked synchronously with the
   * effective factor before `fn` is awaited, so callers have a chance
   * to shrink their working set / batch size / etc.
   */
  async coldStartRetry<T>(
    fn: () => Promise<T>,
    options?: { halfWorkloadFactor?: number },
  ): Promise<T> {
    const factor = options?.halfWorkloadFactor ?? 0.5;
    if (this.onHalfWorkload) {
      this.onHalfWorkload(factor);
    }
    return await fn();
  }

  /**
   * Explicitly break the circuit for a level and notify the caller to
   * degrade workload. Returns the {@link CircuitBreakerResult} that
   * caused the break (or a synthetic one if the caller broke manually).
   */
  break(
    level: CircuitBreakerLevel,
    options?: { halfWorkloadFactor?: number; reason?: string },
  ): CircuitBreakerResult {
    const factor = options?.halfWorkloadFactor ?? 0.5;
    if (this.onHalfWorkload) {
      this.onHalfWorkload(factor);
    }
    const state = this.getOrCreateState(level);
    return {
      tripped: true,
      reason: options?.reason ?? `Circuit broken at level "${level}"`,
      level,
      dimension: 'no_progress',
      metrics: { ...state.metrics, recentErrors: [...state.metrics.recentErrors] },
    };
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

  /**
   * R7: 与 CostTracker 联动——若外部 CostTracker 报告超 budget，
   * 即使 circuit-breaker 自身 token 维度未触发，也提前熔断。
   */
  attachCostTracker(tracker: CostTracker, opts?: { earlyTripRatio?: number }): void {
    const early = opts?.earlyTripRatio ?? 0.95;
    const original = this.recordSuccess.bind(this);
    this.recordSuccess = (level, tokensUsed = 0) => {
      original(level, tokensUsed);
      const usage = tracker.getBudgetUsage();
      const ratio = usage.budget > 0 ? usage.consumed / usage.budget : 0;
      if (ratio >= early) {
        // Cost 接近上限 → 在此级强制降级（coldStartRetry 信号）
        this.break(level, { reason: `CostTracker near limit (${(ratio * 100).toFixed(1)}%)` });
      }
    };
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
