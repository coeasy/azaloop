/**
 * R12 P6 Plus4 (P2 退出标准) — Observable Facade 拆分
 *
 * 借鉴 ruflo「12 workers + heartbeat」+ comet「event bridge」：
 *
 * 痛点：loop-controller.ts 中：
 *   - workerScheduler 字段 + setter
 *   - lastObservedStage 字段
 *   - notifyStageAdvance / notifyStrike / notifyCompletion 3 个通知方法
 *   共 ~60 行 散在主类。
 *
 * 解法：抽出 ObservableFacade 工具类，封装 worker scheduler 桥接逻辑。
 *       主类只保留 setWorkerScheduler 5 行 thin shell + 3 个 notify thin shell。
 *
 * 边界：所有状态（workerScheduler / lastObservedStage）由 ObservableFacade 自身持有，
 *       不再依赖 controller 私有字段。
 */

import type { Stage } from '../state-machine';

// ── ObservableFacade 依赖（从 LoopController 注入）──

export interface ObservableFacadeDeps {
  /** Worker scheduler (ruflo 12 workers + 270s heartbeat) */
  workerScheduler: import('../../L0_platform/workers').WorkerScheduler | null;
}

/**
 * 可观察外观：负责把 controller 事件桥接到 worker scheduler。
 *
 * 主要能力：
 *   - stage 转移事件（emitStageAdvance）
 *   - strike 事件（emitStrike）
 *   - completion 事件（emitCompletion）
 *   - lastObservedStage 跟踪（避免重复触发）
 *   - workerScheduler 拥有权
 */
export class ObservableFacade {
  private scheduler: import('../../L0_platform/workers').WorkerScheduler | null;
  /** Last observed stage marker (for transition detection) */
  private lastObservedStage: Stage | null = null;

  constructor(deps: ObservableFacadeDeps) {
    this.scheduler = deps.workerScheduler;
  }

  /**
   * 替换 worker scheduler（runtime 切换 / 测试注入）。
   */
  setScheduler(scheduler: import('../../L0_platform/workers').WorkerScheduler | null): void {
    this.scheduler = scheduler;
  }

  /**
   * v13 — P1.1: notify the worker scheduler of a stage transition.
   * Called by `syncStateFromFile` whenever the loaded stage differs
   * from the last observed stage. Safe to call when no scheduler is
   * wired (no-op). Schedulers without `on-stage-advance` workers simply
   * log the event without running anything.
   */
  notifyStageAdvance(newStage: Stage): void {
    if (!this.scheduler) return;
    if (this.lastObservedStage === newStage) return;
    this.lastObservedStage = newStage;
    try {
      this.scheduler.emitStageAdvance(newStage);
    } catch {
      // best-effort: a misbehaving worker never blocks the loop
    }
  }

  /**
   * v13 — P1.1: notify the worker scheduler that a strike was recorded.
   * Called from the strike system fan-out. `deepdive` is the canonical
   * `on-strike` worker and will produce a root-cause report.
   */
  notifyStrike(reason: string): void {
    if (!this.scheduler) return;
    try {
      this.scheduler.emitStrike(reason);
    } catch {
      // best-effort
    }
  }

  /**
   * v13 — P1.1: notify the worker scheduler that the loop completed.
   * `document` / `audit` / `benchmark` are the canonical `on-completion`
   * workers and will produce final summary reports.
   */
  notifyCompletion(): void {
    if (!this.scheduler) return;
    try {
      this.scheduler.emitCompletion();
    } catch {
      // best-effort
    }
  }
}
