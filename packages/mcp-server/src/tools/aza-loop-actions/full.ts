/**
 * full action — Host-LLM cooperative full mode: advance until awaitingAction or done.
 */
import type { ActionHandler } from './context';
import { buildActionResponse, routeStepResult, routeTerminalAction } from './response-builder';

export const fullAction: ActionHandler = async (ctx) => {
  // Do NOT burn maxIterations while waiting for the Cursor agent.
  const maxSteps = 20;
  let last: Awaited<ReturnType<typeof ctx.driver.step>> | null = null;
  for (let i = 0; i < maxSteps; i++) {
    last = await ctx.driver.step();
    // 状态 1: awaitingAction — host agent 需要执行外部 tool
    if (last.awaitingAction) {
      return buildActionResponse(ctx, {
        data: {
          status: 'awaiting_agent',
          awaitingAction: last.awaitingAction,
          done: false,
          iteration: last.iteration,
          stage: last.stage,
        },
        nextAction: last.awaitingAction,
        metadata: {
          iteration: last.iteration,
          progress: ctx.driver.getLoopController().stateMachine.getProgress(),
          stage: last.stage,
        },
      });
    }
    // 状态 2: done — 终态分发（real completion / escalate / stop / unknown）
    if (last.done) {
      return routeTerminalAction(ctx, last);
    }
    // 状态 3: continue — 下一轮迭代
  }
  // maxSteps reached without awaiting/done
  return buildActionResponse(ctx, {
    data: {
      status: 'awaiting_agent',
      reason: `Reached maxSteps (${maxSteps}) without terminal condition`,
      done: false,
      iteration: last?.iteration,
      stage: last?.stage,
    },
    nextAction: {
      tool: 'aza_loop',
      action: 'full',
      reason: 'Continue full-auto loop',
    },
  });
};
