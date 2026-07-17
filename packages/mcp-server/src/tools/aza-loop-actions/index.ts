/**
 * AzaLoop Action Handlers 公共导出。
 *
 * 暴露给 aza-loop.ts 使用的主调度 API。
 */
export { dispatchAction, listRegisteredActions, ACTION_REGISTRY } from './dispatcher';
export type { ActionHandler, ActionContext } from './context';
export { normalizeRoot } from './normalize';
export {
  buildActionResponse,
  buildErrorResponse,
  routeStepResult,
  routeTerminalAction,
  withErrorBoundary,
} from './response-builder';
export type { ActionResponseOptions, RouteStepOptions, StepOutcome, DriverStepResult } from './response-builder';
