/**
 * progress-ledger.ts
 *
 * V20 增强：二维进度账本（stage × iteration）。
 *
 * 传统进度账本只按总迭代计数（`iteration`）。但在多阶段流水线中
 * 会出现"全局迭代 30，但当前阶段刚开始"的情况——重连会话时
 * 难以判断"我到底有没有动过"。本账本额外记录
 * `stageIteration`（自进入当前 stage 起的局部计数），
 * 并追踪 `lastChangeAt` 以支持"按时间戳恢复"。
 */

/**
 * 单条账本记录：覆盖 stage / iteration / stageIteration / timestamp / state。
 */
export interface LedgerEntry2D {
  stage: string;
  iteration: number;
  stageIteration: number;
  timestamp: number;
  state: string;
  /**
   * V20 / R10 第2轮 (D10)：内容哈希（PRD/contract 等）。
   *
   * 传统账本只看 stage/iteration 是否变化——但若用户在 `design` 阶段
   * 反复修改 PRD，stage 不变、iteration 不变，账本会误判为"无进展"并
   * 触发 hard-stop。引入 contentHash 后，只要内容哈希变化即视为真实
   * 进展，刷新 lastChangeAt，避免误杀。
   */
  contentHash?: string;
}

/**
 * 二维进度账本：阶段级与全局级双计数器。
 *
 * 用法：
 * ```ts
 * const ledger = new ProgressLedger2D();
 * ledger.record('design', 1, 1, 'started');
 * ledger.record('design', 2, 2, 'in_progress');
 * const recent = ledger.recoverFrom(Date.now() - 60_000);
 * ```
 */
export class ProgressLedger2D {
  private entries: LedgerEntry2D[] = [];
  private lastChangeAt: number = Date.now();

  /**
   * 追加一条账本记录。当 `state` 与上一条不同（即发生"真实变化"）
   * 时刷新 `lastChangeAt`，便于检测卡死/无进展。
   *
   * V20 / R10 第2轮 (D10)：新增可选 `contentHash` 参数。
   * 当 PRD/contract 哈希变化时同样视为"真实变化"，避免用户在
   * 同一 stage 反复修改内容却被误判为"无进展"。
   */
  record(stage: string, iteration: number, stageIteration: number, state: string, contentHash?: string): void {
    try {
      const now = Date.now();
      const last = this.entries[this.entries.length - 1];
      // state 变化 或 contentHash 变化 都视为真实进展
      const stateChanged = !last || last.state !== state;
      const hashChanged = !!contentHash && (!last || last.contentHash !== contentHash);
      if (stateChanged || hashChanged) {
        this.lastChangeAt = now;
      }
      this.entries.push({ stage, iteration, stageIteration, timestamp: now, state, contentHash });
    } catch {
      // best-effort：账本是辅助设施，绝不能因为记录失败中断主流程
    }
  }

  /** 最近一次"状态发生变化"的时间戳（毫秒）。 */
  getLastChangeAt(): number { return this.lastChangeAt; }

  /** 返回只读视图，避免外部 mutation。 */
  getEntries(): readonly LedgerEntry2D[] { return this.entries; }

  /**
   * 按时间戳恢复：返回 `timestamp` 之后的所有 entries。
   * 用于跨会话断点续推——只关心"上次同步之后"发生了什么。
   */
  recoverFrom(timestamp: number): LedgerEntry2D[] {
    try {
      return this.entries.filter(e => e.timestamp > timestamp);
    } catch {
      return [];
    }
  }

  /** 序列化为 JSON 字符串。 */
  serialize(): string {
    try {
      return JSON.stringify(this.entries);
    } catch {
      return '[]';
    }
  }

  /** 从 JSON 字符串反序列化。失败时安全地重置为空账本。 */
  deserialize(data: string): void {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        this.entries = parsed as LedgerEntry2D[];
      } else {
        this.entries = [];
      }
    } catch {
      this.entries = [];
    }
  }
}
