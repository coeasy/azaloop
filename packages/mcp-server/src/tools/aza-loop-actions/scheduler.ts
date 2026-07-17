/**
 * Scheduler 启停 actions：auto / stop / pause / resume / retry
 * 全部封装为简单的 scheduler 调用 + 标准 metadata。
 */
import type { ActionHandler, ActionContext } from './context';
import { buildActionResponse } from './response-builder';

function buildSchedulerResponse(
  ctx: ActionContext,
  status: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return buildActionResponse(ctx, {
    data: {
      status,
      scheduler_state: ctx.scheduler.getState(),
      message,
      ...extra,
    },
  });
}

/** auto: 启动后台 auto-loop scheduler */
export const autoAction: ActionHandler = async (ctx) => {
  ctx.scheduler.start();
  return buildSchedulerResponse(
    ctx,
    'auto_started',
    'Background auto-loop scheduler started',
    {
      driver_stage: ctx.driver.getCurrentStage(),
      driver_iteration: ctx.driver.getIteration(),
    },
  );
};

/** stop: 停止 scheduler */
export const stopAction: ActionHandler = async (ctx) => {
  ctx.scheduler.stop();
  return buildSchedulerResponse(ctx, 'stopped', 'Background auto-loop scheduler stopped');
};

/** pause: 暂停 scheduler */
export const pauseAction: ActionHandler = async (ctx) => {
  ctx.scheduler.pause();
  return buildSchedulerResponse(ctx, 'paused', 'Background auto-loop scheduler paused');
};

/** resume: 恢复 scheduler */
export const resumeAction: ActionHandler = async (ctx) => {
  ctx.scheduler.resume();
  return buildSchedulerResponse(ctx, 'resumed', 'Background auto-loop scheduler resumed');
};

/** retry: 从错误状态重试 */
export const retryAction: ActionHandler = async (ctx) => {
  const retried = ctx.scheduler.retry();
  return buildSchedulerResponse(
    ctx,
    retried ? 'retried' : 'not_in_error',
    retried
      ? 'Scheduler retried from error state'
      : 'Scheduler not in error state (retry ignored)',
  );
};
