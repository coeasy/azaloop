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
  /**
   * R10 第8轮 (D10 深化)：连续多少轮内容哈希相同才判定为"内容停滞"。
   *
   * 与 `noProgressTimeoutMs` 互补：后者按时间检测，前者按迭代次数检测。
   * 例如循环快速空转（每秒 1 轮但内容不变），时间检测 30min 才会触发，
   * 而内容停滞检测 5 轮即可触发，更快暴露死循环。
   */
  contentStagnationThreshold?: number;
}

const DEFAULT_NO_PROGRESS_TIMEOUT_MS: number = 30 * 60 * 1000; // 30 minutes
const DEFAULT_REPEATED_DECISION_THRESHOLD: number = 3;
/**
 * R10 第8轮 (D10 深化)：默认连续 5 轮内容哈希不变即判定停滞。
 * 选取 5 是基于经验——偶发的 LLM 抖动（如重试）通常 1-2 轮即恢复，
 * 5 轮足以滤掉噪声并保留对真实死循环的灵敏度。
 */
const DEFAULT_CONTENT_STAGNATION_THRESHOLD: number = 5;

export class DeadlockDetector {
  private actions: ActionRecord[] = [];
  private threshold: number;
  private noProgressTimeoutMs: number;
  private repeatedDecisionThreshold: number;
  /** R10 第8轮 (D10 深化)：内容停滞检测阈值 */
  private contentStagnationThreshold: number;

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
      this.contentStagnationThreshold = DEFAULT_CONTENT_STAGNATION_THRESHOLD;
    } else {
      this.threshold = config.threshold ?? 3;
      this.noProgressTimeoutMs = config.noProgressTimeoutMs ?? DEFAULT_NO_PROGRESS_TIMEOUT_MS;
      this.repeatedDecisionThreshold =
        config.repeatedDecisionThreshold ?? DEFAULT_REPEATED_DECISION_THRESHOLD;
      this.contentStagnationThreshold =
        config.contentStagnationThreshold ?? DEFAULT_CONTENT_STAGNATION_THRESHOLD;
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

  /**
   * R10 第8轮 (D10 深化)：基于内容哈希序列检测停滞。
   *
   * 与 {@link checkNoProgress} 互补：
   * - `checkNoProgress` 按时间戳检测——循环慢速空转时有效
   * - `checkContentStagnation` 按迭代次数检测——循环快速空转时更灵敏
   *
   * 算法：取 `contentHashes` 末尾 `threshold` 条，若全部相同且非空，
   * 判定为停滞。`undefined` / 空字符串视为"无内容可比"，不计入。
   *
   * 调用方通常从 `ProgressLedger2D.getEntries()` 提取最近 N 轮的
   * `contentHash` 字段传入。
   *
   * @param contentHashes  最近若干轮的内容哈希序列（时间顺序，旧→新）
   * @param threshold      可选：覆盖默认 `contentStagnationThreshold`
   */
  checkContentStagnation(
    contentHashes: Array<string | undefined>,
    threshold?: number,
  ): { deadlocked: boolean; reason?: string; consecutiveCount?: number } {
    const t = threshold ?? this.contentStagnationThreshold;
    if (t <= 0) return { deadlocked: false };
    if (contentHashes.length < t) return { deadlocked: false };

    const window = contentHashes.slice(-t);
    // 任一为空/undefined → 无法判定停滞（可能只是尚未写入内容）
    if (window.some(h => !h || h.length === 0)) {
      return { deadlocked: false };
    }
    const first = window[0];
    if (!first) return { deadlocked: false };
    const allSame = window.every(h => h === first);
    if (allSame) {
      return {
        deadlocked: true,
        reason: `content_stagnation (${t} consecutive iterations with identical contentHash)`,
        consecutiveCount: t,
      };
    }
    return { deadlocked: false };
  }

  /**
   * R10 第8轮 (D10 深化)：便捷重载——直接从 ProgressLedger2D 风格的
   * entries 数组提取 contentHash 序列后调用 {@link checkContentStagnation}。
   */
  checkContentStagnationFromEntries<T extends { contentHash?: string }>(
    entries: readonly T[],
    threshold?: number,
  ): { deadlocked: boolean; reason?: string; consecutiveCount?: number } {
    const hashes = entries.map(e => e.contentHash);
    return this.checkContentStagnation(hashes, threshold);
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
