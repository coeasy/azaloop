/**
 * AzaMeta Action Handlers 公共导出。
 *
 * 暴露给 aza-meta-ext.ts 使用的 thin dispatcher API。
 */
export {
  META_ACTION_REGISTRY,
  listRegisteredMetaActions,
  dispatchMetaWorktree,
  dispatchMetaSwarm,
  dispatchMetaStores,
  dispatchMetaDlp,
  dispatchMetaAction,
} from './dispatcher';
export type { MetaActionContext, MetaActionHandler } from './context';
export { buildMetaContext } from './context';
export { azaDir } from './normalize';
export { worktreeHandler } from './worktree';
export { swarmHandler } from './swarm';
export { storesHandler } from './stores';
export { dlpHandler } from './dlp';
// R12 P6 Plus13: 统一 Meta Action 响应构建器
export {
  buildMetaResponse,
  buildMetaError,
  buildMetaNextAction,
  unknownSubAction,
  dispatchSubAction,
  withMetaErrorBoundary,
  extractSub,
} from './response-builder';
export type {
  MetaResponse,
  MetaResponseOptions,
  SubActionHandler,
  SubActionHandlers,
} from './response-builder';
