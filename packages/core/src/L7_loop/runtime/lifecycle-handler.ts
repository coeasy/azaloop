/**
 * R12 P6 Plus3 (P2 退出标准) — Lifecycle Handler 拆分
 *
 * 借鉴 spec-kit「stage lifecycle」+ comet「stage transitions」：
 *
 * 痛点：loop-controller.ts 公共方法密集：
 *       recordAction / completeStage / forceAdvance / reset / stop /
 *       getStageIterations / setCondition / getCondition / resetConditions /
 *       setHandlerProvider ~120 行混在主类里。
 *
 * 解法：抽出 LifecycleHandler 工具类，封装 stage 生命周期管理 + 条件注册 + handler 设置。
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 */

import type { Stage } from '../state-machine';
import type { StateMachine } from '../state-machine';
import type { DeadlockDetector } from '../deadlock-detector';
import type { StrikeSystem } from '../../L4_discipline/strike-system';
import type { HardStopManager, StopReason } from '../hard-stop';
import type { CircuitBreaker } from '../circuit-breaker';
import type { TokenBudget } from '../token-budget';
import type { StageGuards, GuardConditionKey } from '../guards';
import type { DecisionPointRegistry } from '../decision-points';
import type { StageHandlerProvider } from '../inner-loop';

// ── LifecycleHandler 依赖（从 LoopController 注入）──

export interface LifecycleHandlerDeps {
  stateMachine: StateMachine;
  deadlockDetector: DeadlockDetector;
  strikeSystem: StrikeSystem;
  hardStop: HardStopManager;
  circuitBreaker: CircuitBreaker;
  tokenBudget: TokenBudget;
  guards: StageGuards;
  dpRegistry: DecisionPointRegistry;
  /** Conditions registry (mutable map) */
  getConditions: () => Map<GuardConditionKey, boolean>;
  /** Stage iterations registry (mutable map) */
  getStageIterations: () => Map<string, number>;
  /** Block count (mutable) */
  getBlockCount: () => number;
  setBlockCount: (n: number) => void;
  /** Ledger has progress (mutable) */
  getLedgerHasProgress: () => boolean;
  setLedgerHasProgress: (v: boolean) => void;
  /** Stop hook active (mutable) */
  getStopHookActive: () => boolean;
  setStopHookActive: (v: boolean) => void;
  /** Handler provider (mutable) */
  getHandlerProvider: () => StageHandlerProvider;
  setHandlerProvider: (p: StageHandlerProvider) => void;
  /** Sync state to file */
  syncStateToFile: () => Promise<void>;
  /** Notify worker scheduler of strike */
  notifyStrike: (reason: string) => void;
}

/**
 * 生命周期处理器：负责 stage 生命周期 + 条件注册 + handler 设置。
 */
export class LifecycleHandler {
  constructor(private readonly deps: LifecycleHandlerDeps) {}

  // ── Action tracking ──

  /**
   * 记录 action 到 deadlock detector。
   * 若检测到重复，触发 strike + notify worker。
   */
  recordAction(tool: string, action: string): void {
    const { deadlockDetector, strikeSystem, stateMachine, notifyStrike } = this.deps;
    deadlockDetector.record(tool, action, stateMachine.getState().iteration);
    if (deadlockDetector.isDeadlocked()) {
      const repeated = deadlockDetector.getRepeatedAction();
      if (repeated) {
        strikeSystem.record('deadlock_detected', `Deadlock: repeated ${repeated.tool}:${repeated.action}`, stateMachine.getState().iteration);
        // v13 — P1.1: notify the worker scheduler of the strike
        notifyStrike(`deadlock_detected: ${repeated.tool}:${repeated.action}`);
        deadlockDetector.clear();
      }
    }
  }

  // ── Stage completion ──

  /**
   * 完成 stage，触发 stage 推进 + DP 记录 + 文件落盘。
   */
  completeStage(stage: string): { success: boolean; error?: string } {
    const { guards, stateMachine, tokenBudget, dpRegistry, syncStateToFile } = this.deps;
    const guardResult = guards.checkStage(stage as any);
    if (!guardResult.allowed) {
      return { success: false, error: guardResult.reason || `Cannot complete stage "${stage}": quality gates not passed` };
    }
    if (stage === 'archive') {
      stateMachine.setStageStatus('archive', 'completed');
      // Fire-and-forget DP-5
      void dpRegistry.record('DP-5', 'archive', 'done', 'passed', {
        iteration: stateMachine.getState().iteration,
        reason: 'Archive stage completed',
      });
      void syncStateToFile();
      return { success: true };
    }
    stateMachine.setStageStatus(stage as any, 'completed');
    stateMachine.advance();
    const nextStage = stateMachine.getCurrentStage();
    stateMachine.setStageStatus(nextStage, 'in_progress');
    // R10 第5轮 (D5): 进入新 stage 时重置 per-task 预算
    tokenBudget.resetPerTask();

    const dpMap: Record<string, { id: 'DP-0' | 'DP-1' | 'DP-2' | 'DP-3' | 'DP-4'; from: any; to: any }> = {
      open: { id: 'DP-1', from: 'open', to: 'design' },
      design: { id: 'DP-2', from: 'design', to: 'build' },
      build: { id: 'DP-3', from: 'build', to: 'verify' },
      verify: { id: 'DP-4', from: 'verify', to: 'archive' },
    };
    const dp = dpMap[stage];
    if (dp) {
      void dpRegistry.record(dp.id, dp.from, dp.to, 'passed', {
        iteration: stateMachine.getState().iteration,
        reason: `Stage "${stage}" completed → "${nextStage}"`,
      });
    }
    void syncStateToFile();
    return { success: true };
  }

  // ── Forced advance ──

  /**
   * 强制推进到下一 stage（绕过 quality gates）。
   * 返回新的当前 stage。
   */
  forceAdvance(stage: string): string | null {
    const { stateMachine } = this.deps;
    stateMachine.setStageStatus(stage as any, 'completed');
    return stateMachine.advance();
  }

  // ── Reset / Stop ──

  /**
   * 重置 controller 状态。
   * 调用方负责在 stop 后重新初始化。
   */
  reset(): void {
    const { hardStop, circuitBreaker, strikeSystem, setBlockCount, setLedgerHasProgress, setStopHookActive } = this.deps;
    hardStop.reset();
    circuitBreaker.reset();
    strikeSystem.clear();
    this.deps.stateMachine; // ensure captured
    setBlockCount(0);
    setLedgerHasProgress(false);
    setStopHookActive(false);
  }

  /**
   * 触发 hard stop。
   */
  stop(reason: StopReason, detail: string): void {
    const { hardStop, stateMachine } = this.deps;
    hardStop.stop(reason, detail, stateMachine.getState().iteration);
  }

  // ── Stage iteration counter ──

  /**
   * 获取指定 stage 的迭代计数。
   */
  getStageIterations(stage: string): number {
    return this.deps.getStageIterations().get(stage) || 0;
  }

  // ── Conditions (V11 compatibility) ──

  /**
   * 设置 condition 标志。
   */
  setCondition(key: GuardConditionKey, passed: boolean): void {
    this.deps.getConditions().set(key, passed);
  }

  /**
   * 获取 condition 标志。
   */
  getCondition(key: GuardConditionKey): boolean {
    return this.deps.getConditions().get(key) === true;
  }

  /**
   * 重置所有 conditions。
   */
  resetConditions(): void {
    this.deps.getConditions().clear();
  }

  // ── Handler provider ──

  /**
   * 设置 handler provider（同时同步到 innerLoop）。
   */
  setHandlerProvider(provider: StageHandlerProvider): void {
    this.deps.setHandlerProvider(provider);
  }
}
