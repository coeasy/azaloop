/**
 * v14 — P8.5: Token Cost Tracker (ruflo pattern).
 *
 * Wraps token consumption with budget enforcement:
 *   - `consume()` always records the consumption and returns whether it
 *     was allowed.
 *   - At 80% of the budget a warning is emitted (per source).
 *   - At 100% of the budget the call is rejected and a strike is
 *     triggered.
 *   - Consumption is tracked per `source` (e.g. `'prd-review'`,
 *     `'task-implement'`) so the loop can attribute cost.
 *
 * The tracker is intentionally side-effect-free except for a
 * `stateManager.update()` callback (so it can persist `tokens_consumed`
 * to STATE.yaml). The callback is optional, allowing the tracker to be
 * used in unit tests without any I/O.
 *
 * Reference:
 *   • ruvnet/ruflo v3.10.33 — token-budget gate (80% warn, 100% reject).
 */

export interface CostTrackerOptions {
  /** Total budget. Default 50_000 tokens. */
  budget?: number;
  /** Warn when consumed >= budget * warnPct. Default 0.8. */
  warnPct?: number;
  /** Reject when consumed >= budget * rejectPct. Default 1.0. */
  rejectPct?: number;
  /** Optional callback fired on every state change. */
  onUpdate?: (consumed: number, budget: number) => void;
  /** Optional callback fired on warning. */
  onWarn?: (consumed: number, budget: number, source: string) => void;
  /** Optional callback fired on rejection. */
  onReject?: (consumed: number, budget: number, source: string) => void;
}

export interface ConsumeResult {
  allowed: boolean;
  warning: boolean;
  consumed: number;
  remaining: number;
  budget: number;
  reason?: string;
}

export interface BudgetUsage {
  consumed: number;
  budget: number;
  remaining: number;
  pct: number;
  warning: boolean;
  rejected: boolean;
  perSource: Record<string, number>;
}

export class CostTracker {
  private budget: number;
  private consumed: number = 0;
  private warnPct: number;
  private rejectPct: number;
  private sources: Map<string, number> = new Map();
  private rejected: boolean = false;
  private onUpdate?: (consumed: number, budget: number) => void;
  private onWarn?: (consumed: number, budget: number, source: string) => void;
  private onReject?: (consumed: number, budget: number, source: string) => void;

  constructor(options: CostTrackerOptions = {}) {
    this.budget = options.budget ?? 50_000;
    this.warnPct = options.warnPct ?? 0.8;
    this.rejectPct = options.rejectPct ?? 1.0;
    this.onUpdate = options.onUpdate;
    this.onWarn = options.onWarn;
    this.onReject = options.onReject;
  }

  /**
   * Record a token consumption. Returns whether the call was allowed and
   * whether a warning was triggered. When `allowed` is false, the
   * consumer should treat the call as a strike.
   */
  consume(tokens: number, source: string = 'default'): ConsumeResult {
    if (!Number.isFinite(tokens) || tokens < 0) {
      return {
        allowed: false,
        warning: false,
        consumed: this.consumed,
        remaining: this.getRemaining(),
        budget: this.budget,
        reason: `invalid token count: ${tokens}`,
      };
    }
    // Once rejected, the tracker stays in a "rejected" terminal state
    // until `reset()` is called. We still record the consumption so the
    // user can see the overshoot.
    const next = this.consumed + tokens;
    const wouldReject = next >= this.budget * this.rejectPct;
    const wasUnderWarn = this.consumed < this.budget * this.warnPct;
    const nowOverWarn = next >= this.budget * this.warnPct;
    const warning = wasUnderWarn && nowOverWarn;
    const allowed = !wouldReject;

    this.consumed = next;
    this.sources.set(source, (this.sources.get(source) ?? 0) + tokens);

    if (wouldReject) this.rejected = true;

    if (this.onUpdate) this.onUpdate(this.consumed, this.budget);
    if (warning && this.onWarn) this.onWarn(this.consumed, this.budget, source);
    if (wouldReject && this.onReject) this.onReject(this.consumed, this.budget, source);

    return {
      allowed,
      warning,
      consumed: this.consumed,
      remaining: this.getRemaining(),
      budget: this.budget,
      reason: wouldReject ? `budget exceeded at source '${source}'` : undefined,
    };
  }

  /** Current consumed tokens. */
  getConsumed(): number {
    return this.consumed;
  }

  /** Remaining tokens (clamped at 0). */
  getRemaining(): number {
    return Math.max(0, this.budget - this.consumed);
  }

  /** Reset consumed / per-source counters and rejection state. */
  reset(): void {
    this.consumed = 0;
    this.sources.clear();
    this.rejected = false;
    if (this.onUpdate) this.onUpdate(0, this.budget);
  }

  /** Snapshot the current usage state. */
  getBudgetUsage(): BudgetUsage {
    return {
      consumed: this.consumed,
      budget: this.budget,
      remaining: this.getRemaining(),
      pct: this.budget === 0 ? 1 : this.consumed / this.budget,
      warning: this.consumed >= this.budget * this.warnPct,
      rejected: this.rejected,
      perSource: Object.fromEntries(this.sources.entries()),
    };
  }

  /** Update the budget. Resets the rejection flag if the new budget is higher. */
  setBudget(newBudget: number): void {
    if (!Number.isFinite(newBudget) || newBudget <= 0) {
      throw new Error('budget must be a positive number');
    }
    this.budget = newBudget;
    if (this.consumed < this.budget) this.rejected = false;
  }
}
