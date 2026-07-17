/**
 * AzaLoop Action Dispatcher — 集中路由 action name → handler function。
 *
 * 借鉴 spec-kit「action registry」模式：每个 action 是独立函数，
 * 通过 registry 集中注册和路由。
 */
import type { ActionHandler, ActionContext } from './context';
import { statusAction } from './status';
import { resetAction } from './reset';
import { fullAction } from './full';
import { autoAction, stopAction, pauseAction, resumeAction, retryAction } from './scheduler';
import { reportToolAction } from './report-tool';
import { stepAction } from './step';

/**
 * Action registry：action name → handler function
 */
export const ACTION_REGISTRY: Record<string, ActionHandler> = {
  status: statusAction,
  reset: resetAction,
  full: fullAction,
  auto: autoAction,
  stop: stopAction,
  pause: pauseAction,
  resume: resumeAction,
  retry: retryAction,
  report_tool: reportToolAction,
  step: stepAction,
};

/**
 * 列出所有已注册的 action name（用于文档/调试）。
 */
export function listRegisteredActions(): string[] {
  return Object.keys(ACTION_REGISTRY);
}

/**
 * 主调度：按 action name 路由到对应 handler。
 * 未知 action 退化为 step。
 */
export async function dispatchAction(action: string | undefined, ctx: ActionContext) {
  const name = action ?? 'step';
  const handler: ActionHandler = ACTION_REGISTRY[name] ?? ACTION_REGISTRY.step!;
  return handler(ctx);
}
