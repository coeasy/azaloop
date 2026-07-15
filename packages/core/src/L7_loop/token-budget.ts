export type Complexity = 'L1' | 'L2' | 'L3' | 'L4';

export interface TokenUsage {
  total: number;
  perTask: number;
  perSession: number;
}

export type BudgetAction = 'continue' | 'summarize' | 'compress' | 'stop';

/**
 * TokenBudget — hard cap on token usage per task and per session.
 *
 * Borrows from karpathy Rule 6:
 * - perTaskLimit: 8K (L1) / 20K (L2) / 40K (L3/L4)
 * - perSessionLimit: 120K soft, 160K hard
 * - 70% → summarize checkpoint
 * - 80% → compress checkpoint
 * - 100% → hard stop
 * - reserveForVerification: 20% reserved for verify stage
 */
export class TokenBudget {
  readonly perTaskLimit: number;
  readonly perSessionLimit: number;
  readonly reserveForVerification = 0.2;
  private usage: TokenUsage = { total: 0, perTask: 0, perSession: 0 };

  constructor(complexity: Complexity = 'L2', perSessionLimit = 120_000) {
    this.perTaskLimit =
      complexity === 'L1' ? 8_000
      : complexity === 'L2' ? 20_000
      : 40_000; // L3/L4
    this.perSessionLimit = perSessionLimit;
  }

  recordUsage(tokens: number): void {
    if (tokens < 0) return;
    this.usage.total += tokens;
    this.usage.perTask += tokens;
    this.usage.perSession += tokens;
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  /**
   * Decide what action to take based on current session usage ratio.
   * - >= 100% → 'stop'
   * - >= 80% → 'compress'
   * - >= 70% → 'summarize'
   * - else → 'continue'
   */
  checkBudget(): BudgetAction {
    const ratio = this.usage.perSession / this.perSessionLimit;
    if (ratio >= 1.0) return 'stop';
    if (ratio >= 0.8) return 'compress';
    if (ratio >= 0.7) return 'summarize';
    return 'continue';
  }

  /**
   * Check per-task budget. Returns true if per-task limit exceeded.
   */
  isPerTaskExceeded(): boolean {
    return this.usage.perTask >= this.perTaskLimit;
  }

  /**
   * Reset per-task counter (called when moving to a new story/task).
   */
  resetPerTask(): void {
    this.usage.perTask = 0;
  }

  /**
   * Get remaining tokens reserved for verification stage.
   */
  getVerificationReserve(): number {
    return Math.floor(this.perSessionLimit * this.reserveForVerification);
  }

  /**
   * Get available tokens for current task (limit - used).
   */
  getRemainingPerTask(): number {
    return Math.max(0, this.perTaskLimit - this.usage.perTask);
  }
}
