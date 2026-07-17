/**
 * step action (default) — 单步执行 driver.step()，返回结果。
 */
import type { ActionHandler } from './context';
import { routeStepResult } from './response-builder';

export const stepAction: ActionHandler = async (ctx) => {
  // V18: If scheduler is running, pause it to avoid concurrent step() conflicts
  if (ctx.scheduler.getState() === 'running') {
    ctx.scheduler.pause();
  }
  const stepResult = await ctx.driver.step();
  if (stepResult.done) {
    return routeStepResult(ctx, stepResult, {
      statusOverride: 'done',
      doneNextAction: { tool: 'aza_finish', action: 'ship', reason: 'Auto-loop complete' },
    });
  }
  return routeStepResult(ctx, stepResult, {
    statusOverride: 'step',
    continueNextAction: { tool: 'aza_loop', action: 'next', reason: 'Continue auto-loop' },
  });
};
