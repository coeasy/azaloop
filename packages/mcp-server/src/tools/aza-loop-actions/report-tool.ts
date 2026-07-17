/**
 * report_tool action — Host-LLM 报告已执行 awaited tool，然后继续 driver。
 */
import type { ActionHandler } from './context';
import { buildErrorResponse, routeStepResult } from './response-builder';

export const reportToolAction: ActionHandler = async (ctx) => {
  const { toolName } = ctx;
  if (!toolName) {
    return buildErrorResponse(ctx, 'toolName is required for report_tool action', {
      nextAction: { tool: 'aza_loop', action: 'full', reason: 'Provide tool_name then report_tool' },
    });
  }
  // Deadlock detection must cover cooperative host↔report ping-pong
  ctx.driver.getLoopController().recordAction(toolName, 'report_tool');
  ctx.scheduler.reportToolExecuted(toolName);
  // Cooperative spine: advance driver so host gets the next awaitingAction
  const stepResult = await ctx.driver.step();
  if (stepResult.awaitingAction) {
    ctx.driver.getLoopController().recordAction(
      stepResult.awaitingAction.tool,
      stepResult.awaitingAction.action || 'await',
    );
  }
  return routeStepResult(ctx, stepResult, {
    statusOverride: stepResult.done ? 'completed' : 'tool_reported',
    doneNextAction: {
      tool: 'aza_finish',
      action: 'ship',
      reason: 'Loop completed after report_tool — ship delivery',
    },
    continueNextAction: {
      tool: 'aza_loop',
      action: 'full',
      reason: 'Tool reported — continue full loop',
    },
    extraData: { tool_executed: toolName },
  });
};
