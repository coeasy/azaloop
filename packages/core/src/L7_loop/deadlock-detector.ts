export interface ActionRecord {
  tool: string;
  action: string;
  timestamp: string;
  iteration: number;
}

/**
 * Configuration options for {@link DeadlockDetector}.
 *
 * The legacy `threshold` field (a plain number) is still accepted by the
 * constructor and is mapped onto `stagnationThreshold` for backward
 * compatibility with existing call sites.
 */
export interface DeadlockDetectorConfig {
  /** Number of consecutive identical tool:action records before a deadlock is reported. */
  threshold?: number;
  /** Maximum time (ms) without any progress before a no-progress deadlock is reported. */
  noProgressTimeoutMs?: number;
  /** Number of times the same decision point may repeat within the recent window before a deadlock is reported. */
  repeatedDecisionThreshold?: number;
}

const DEFAULT_NO_PROGRESS_TIMEOUT_MS: number = 30 * 60 * 1000; // 30 minutes
const DEFAULT_REPEATED_DECISION_THRESHOLD: number = 3;

export class DeadlockDetector {
  private actions: ActionRecord[] = [];
  private threshold: number;
  private noProgressTimeoutMs: number;
  private repeatedDecisionThreshold: number;

  /**
   * Backwards-compatible constructor.
   *
   * Accepts either a number (legacy `threshold`) or a {@link DeadlockDetectorConfig}
   * object. The new fields have sensible defaults so existing call sites that pass
   * a plain number continue to work unchanged.
   */
  constructor(config: number | DeadlockDetectorConfig = {}) {
    if (typeof config === 'number') {
      this.threshold = config;
      this.noProgressTimeoutMs = DEFAULT_NO_PROGRESS_TIMEOUT_MS;
      this.repeatedDecisionThreshold = DEFAULT_REPEATED_DECISION_THRESHOLD;
    } else {
      this.threshold = config.threshold ?? 3;
      this.noProgressTimeoutMs = config.noProgressTimeoutMs ?? DEFAULT_NO_PROGRESS_TIMEOUT_MS;
      this.repeatedDecisionThreshold =
        config.repeatedDecisionThreshold ?? DEFAULT_REPEATED_DECISION_THRESHOLD;
    }
  }

  record(tool: string, action: string, iteration: number): void {
    this.actions.push({ tool, action, timestamp: new Date().toISOString(), iteration });
  }

  isDeadlocked(): boolean {
    if (this.actions.length < this.threshold) return false;
    const recent = this.actions.slice(-this.threshold);
    const first = recent[0];
    if (!first) return false;
    // Same tool:action repeated
    if (recent.every(a => a.tool === first.tool && a.action === first.action)) {
      return true;
    }
    // Ping-pong: A→B→A→B… (cooperative report_tool ↔ host tool)
    if (this.actions.length >= this.threshold * 2) {
      const window = this.actions.slice(-this.threshold * 2);
      const keys = window.map(a => `${a.tool}:${a.action}`);
      const unique = new Set(keys);
      if (unique.size === 2) {
        const a = keys[0];
        const b = keys[1];
        if (a !== b && keys.every((k, i) => k === (i % 2 === 0 ? a : b))) {
          return true;
        }
      }
    }
    return false;
  }

  getRepeatedAction(): { tool: string; action: string } | null {
    if (!this.isDeadlocked()) return null;
    const recent = this.actions.slice(-this.threshold);
    const first = recent[0];
    return first ? { tool: first.tool, action: first.action } : null;
  }

  /**
   * Check whether the loop has been running without any observable progress for
   * longer than `noProgressTimeoutMs` milliseconds.
   *
   * @param lastChangeAt  Timestamp (ms since epoch) of the last observed change
   *                      in iteration state.
   * @param now           Optional reference time for the check. Defaults to `Date.now()`.
   */
  checkNoProgress(
    lastChangeAt: number,
    now: number = Date.now(),
  ): { deadlocked: boolean; reason?: string } {
    const elapsed = now - lastChangeAt;
    if (elapsed > this.noProgressTimeoutMs) {
      return {
        deadlocked: true,
        reason: `no_progress_timeout (${elapsed}ms > ${this.noProgressTimeoutMs}ms)`,
      };
    }
    return { deadlocked: false };
  }

  /**
   * Check whether the same decision point has been re-entered at least
   * `repeatedDecisionThreshold` times within the most recent decisions.
   */
  checkRepeatedDecision(
    decisionPoint: string,
    recentDecisions: string[],
  ): { deadlocked: boolean; reason?: string } {
    const window = recentDecisions.slice(-this.repeatedDecisionThreshold);
    const count = window.filter(d => d === decisionPoint).length;
    if (count >= this.repeatedDecisionThreshold) {
      return {
        deadlocked: true,
        reason: `repeated_decision (${decisionPoint} appeared ${count} times)`,
      };
    }
    return { deadlocked: false };
  }

  clear(): void {
    this.actions = [];
  }

  getActionCount(): number {
    return this.actions.length;
  }

  getRecentActions(n: number): ActionRecord[] {
    return this.actions.slice(-n);
  }
}
