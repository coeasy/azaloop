/**
 * status action — 报告当前 loop 状态（driver + scheduler）。
 */
import type { ActionHandler, ActionContext } from './context';
import { buildActionResponse } from './response-builder';

export const statusAction: ActionHandler = async (ctx: ActionContext) => {
  // R10 / 跨会话恢复：status 必须反映磁盘 STATE.yaml 的真实阶段
  await ctx.driver.syncStageFromDisk();
  const lcState = ctx.driver.getLoopController().stateMachine.getState();
  const realStage: string = lcState.current_stage || ctx.driver.getCurrentStage();
  const anyActive = Object.values(lcState.stages as Record<string, any>).some(
    (s: any) => s?.status === 'in_progress' || s?.status === 'blocked',
  );
  // 内存 driver 状态为 idle 但磁盘存在活跃阶段 → 标记为 recovered
  const effectiveStatus =
    ctx.driver.getStatus() === 'idle' && anyActive ? 'recovered' : ctx.driver.getStatus();
  const schedulerStatus = ctx.scheduler.getStatus();
  return buildActionResponse(ctx, {
    data: {
      status: effectiveStatus,
      stage: realStage,
      iteration: lcState.iteration,
      progress: lcState.progress,
      current_stage: realStage,
      scheduler: {
        running: schedulerStatus.running,
        paused: schedulerStatus.paused,
        awaitingAction: schedulerStatus.awaitingAction,
        lastError: schedulerStatus.lastError,
      },
    },
    metadata: {
      iteration: lcState.iteration,
      progress: lcState.progress,
      stage: realStage,
    },
  });
};
