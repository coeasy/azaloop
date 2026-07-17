/**
 * R12 P6 Plus2 (P2 退出标准) — Next V11 拆分
 *
 * 借鉴 spec-kit「legacy compatibility」+ comet「fallback path」：
 *
 * 痛点：loop-controller.ts nextV11() ~70 行；V11 兼容路径（boolean guard）
 *       嵌入主类，难以独立测试和维护。
 *
 * 解法：抽出 NextV11 工具类，封装 boolean guard check 逻辑。
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 */

import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { Stage } from '../state-machine';
import type { StateMachine } from '../state-machine';
import type { StageGuards } from '../guards';
import { HardStopManager } from '../hard-stop';
import type { HardStopManager as HardStopManagerType } from '../hard-stop';
import type { StrikeSystem } from '../../L4_discipline/strike-system';

// ── NextV11 依赖（从 LoopController 注入）──

export interface NextV11Deps {
  stateMachine: StateMachine;
  guards: StageGuards;
  hardStop: HardStopManagerType;
  strikeSystem: StrikeSystem;
  /** Stage iteration counter (mutable map) */
  getStageIteration: (stage: Stage) => number;
  setStageIteration: (stage: Stage, n: number) => void;
  /** Config */
  maxIterations: number;
  maxStageIterations: number;
  maxStrikes: number;
  /** Build a standard LoopResponse */
  buildResponse: (
    stage: string,
    nextAction: NextAction,
    isHardStop?: boolean,
    loopLevel?: 'outer' | 'inner' | 'phase',
  ) => LoopResponse<any>;
  /** Get stage entry action */
  getStageEntryAction: (stage: string) => NextAction;
  /** Notify worker scheduler of completion (v13 P1.1) */
  notifyCompletion: () => void;
}

/**
 * V11 兼容路径：boolean guard check。
 */
export class NextV11 {
  constructor(private readonly deps: NextV11Deps) {}

  /**
   * V11 兼容路径。
   * 行为等价于原 LoopController.nextV11() 方法。
   */
  run(currentStage?: string): LoopResponse<{ stage: string; progress: string; next_action: NextAction }> {
    const {
      stateMachine, guards, hardStop, strikeSystem, buildResponse,
      getStageIteration, setStageIteration, maxIterations, maxStageIterations, maxStrikes,
      getStageEntryAction, notifyCompletion,
    } = this.deps;
    const stage: Stage = (currentStage as Stage) || stateMachine.getCurrentStage();

    // 1. Hard stop check
    if (hardStop.isStopped()) {
      return buildResponse(stage, {
        tool: 'aza_loop', action: 'report',
        reason: `Hard stop: ${hardStop.getRecord()?.reason}`,
      }, true);
    }

    // 2. Max iterations check
    const iterCheck = HardStopManager.checkIterations(
      stateMachine.getState().iteration, maxIterations,
    );
    if (iterCheck.exceeded) {
      hardStop.stop('max_iterations_exceeded', iterCheck.detail!, stateMachine.getState().iteration);
      return buildResponse(stage, {
        tool: 'aza_loop', action: 'stop', reason: iterCheck.detail!,
      }, true);
    }

    // 3. Per-stage iteration check
    const currentStageIter = getStageIteration(stage);
    if (currentStageIter >= maxStageIterations) {
      hardStop.stop('max_iterations_exceeded',
        `Stage "${stage}" exceeded max stage iterations (${maxStageIterations})`,
        stateMachine.getState().iteration);
      return buildResponse(stage, {
        tool: 'aza_loop', action: 'escalate',
        reason: `Stage ${stage} stuck after ${currentStageIter} attempts`,
      }, true);
    }

    // 4. Strike system check
    const strikeCheck = HardStopManager.checkStrikes(
      strikeSystem.getStrikeCount(), maxStrikes,
    );
    if (strikeCheck.exceeded) {
      hardStop.stop('strikes_exceeded', strikeCheck.detail!, stateMachine.getState().iteration);
      return buildResponse(stage, {
        tool: 'aza_loop', action: 'escalate', reason: strikeCheck.detail!,
      }, true);
    }

    // 5. Boolean guard check
    const guardResult = guards.checkStage(stage as any);
    if (guardResult.allowed) {
      stateMachine.setStageStatus(stage as any, 'completed');
      if (stage === 'archive') {
        // v13 — P1.1: notify the worker scheduler that the loop is done
        notifyCompletion();
        return buildResponse(stage, {
          tool: 'aza_loop', action: 'done', reason: 'All stages complete',
        });
      }
      stateMachine.advance();
      const advancedStage = stateMachine.getCurrentStage();
      stateMachine.setStageStatus(advancedStage, 'in_progress');
      return buildResponse(advancedStage, getStageEntryAction(advancedStage));
    }

    // 6. Not allowed — refine
    setStageIteration(stage, currentStageIter + 1);
    stateMachine.setStageStatus(stage as any, 'in_progress');

    return buildResponse(stage, {
      tool: guardResult.refine_tool || 'aza_spec',
      action: (guardResult.refine_action === 'refine'
        ? (stage === 'design' ? 'design' : stage === 'verify' ? 'verify' : 'implement')
        : (guardResult.refine_action || (stage === 'design' ? 'design' : 'implement'))),
      reason: guardResult.reason || `Quality checks not passed for stage "${stage}"`,
    });
  }
}
