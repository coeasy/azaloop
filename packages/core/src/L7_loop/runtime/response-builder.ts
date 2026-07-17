/**
 * R12 P6 Plus3 (P2 退出标准) — Response Builder 拆分
 *
 * 借鉴 spec-kit「response contract」+ comet「action router」：
 *
 * 痛点：loop-controller.ts buildResponse (~35 行) + getStageEntryAction (~10 行)
 *       散在主类里，每次返回响应都要重新计算 metadata。
 *
 * 解法：抽出 ResponseBuilder 工具类，封装 LoopResponse 构造逻辑 + stage entry 路由。
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 */

import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { StateMachine } from '../state-machine';

// ── ResponseBuilder 依赖（从 LoopController 注入）──

export interface ResponseBuilderDeps {
  stateMachine: StateMachine;
}

/**
 * 响应构建器：负责构造 LoopResponse + stage 入口 action 路由。
 */
export class ResponseBuilder {
  constructor(private readonly deps: ResponseBuilderDeps) {}

  /**
   * 构造 LoopResponse，包含完整 metadata。
   * V18: When awaitingAction is non-null, propagate into data.awaitingAction.
   */
  build(
    stage: string,
    nextAction: NextAction,
    isHardStop = false,
    loopLevel: 'outer' | 'inner' | 'phase' = 'phase',
    /** V18: pre-action instruction for the LLM */
    awaitingAction?: NextAction,
  ): LoopResponse<{ stage: string; progress: string; next_action: NextAction; awaitingAction?: NextAction }> {
    const { stateMachine } = this.deps;
    const state = stateMachine.getState();
    const phaseState = stateMachine.getPhaseLoopState();
    return {
      success: !isHardStop,
      data: {
        stage,
        progress: state.progress,
        next_action: nextAction,
        ...(awaitingAction ? { awaitingAction } : {}),
      },
      next_action: nextAction,
      error: isHardStop ? nextAction.reason : undefined,
      metadata: {
        iteration: state.iteration,
        progress: state.progress,
        stage,
        loop_level: loopLevel,
        phase_iteration: phaseState.iteration,
      },
    };
  }

  /**
   * 获取 stage 入口 action — 决定进入该 stage 时宿主应执行的首个 tool。
   */
  getStageEntryAction(stage: string): NextAction {
    const actions: Record<string, NextAction> = {
      open: { tool: 'aza_prd', action: 'review', reason: 'Entering open stage — review/approve PRD first' },
      design: { tool: 'aza_spec', action: 'design', reason: 'Entering design stage — design stories' },
      build: { tool: 'aza_spec', action: 'implement', reason: 'Entering build stage — implement with tests' },
      verify: { tool: 'aza_quality', action: 'check', reason: 'Entering verify stage — run quality gates' },
      archive: { tool: 'aza_finish', action: 'ship', reason: 'Entering archive stage — ship delivery' },
    };
    return actions[stage] || { tool: 'aza_loop', action: 'full', reason: `Continue in ${stage} stage` };
  }
}
