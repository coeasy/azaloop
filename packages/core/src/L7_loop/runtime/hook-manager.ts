/**
 * R12 P6 Plus4 (P2 退出标准) — Hook Manager 拆分
 *
 * 借鉴 gstack「v12 block count」+ comet「stop hook」：
 *
 * 痛点：loop-controller.ts 中：
 *   - blockCount / stopHookActive / ledgerHasProgress 3 个状态字段
 *   - incrementBlockCount / resetBlockCount / setStopHook / markLedgerProgress 4 个 setter
 *   共 ~25 行 散在主类。
 *
 * 解法：抽出 HookManager 工具类，封装 V12 block count / stop hook / ledger 进度跟踪。
 *       主类只持有 HookManager + 4 个 thin shell setter。
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 */

// ── HookManager 依赖（从 LoopController 注入）──

export interface HookManagerDeps {
  /** Current block count */
  getBlockCount: () => number;
  setBlockCount: (n: number) => void;
  /** Stop hook active state */
  getStopHookActive: () => boolean;
  setStopHookActive: (v: boolean) => void;
  /** Ledger has progress flag */
  getLedgerHasProgress: () => boolean;
  setLedgerHasProgress: (v: boolean) => void;
}

/**
 * V12 Hook Manager：负责 block count / stop hook / ledger progress 状态管理。
 */
export class HookManager {
  constructor(private readonly deps: HookManagerDeps) {}

  /** Block count: get current value */
  getBlockCount(): number {
    return this.deps.getBlockCount();
  }

  /** Block count: increment + reset ledger progress (block means no progress) */
  incrementBlockCount(): void {
    this.deps.setBlockCount(this.deps.getBlockCount() + 1);
    this.deps.setLedgerHasProgress(false);
  }

  /** Block count: reset to 0 + mark ledger has progress (recovery) */
  resetBlockCount(): void {
    this.deps.setBlockCount(0);
    this.deps.setLedgerHasProgress(true);
  }

  /** Stop hook: enable / disable */
  setStopHook(active: boolean): void {
    this.deps.setStopHookActive(active);
  }

  /** Ledger: mark as having progress (called by inner stages) */
  markLedgerProgress(): void {
    this.deps.setLedgerHasProgress(true);
  }
}
