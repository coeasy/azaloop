/**
 * AzaMeta Action Dispatcher — 集中路由 meta sub_action → handler。
 *
 * 借鉴 spec-kit「action registry」+ aza-loop-actions 模式：
 * 4 个 meta sub_action（worktree / swarm / stores / dlp）独立注册为 handler，
 * 通过 META_ACTION_REGISTRY 集中路由，aza-meta-ext.ts 退化为 thin dispatcher。
 */
import { buildMetaContext, type MetaActionContext, type MetaActionHandler } from './context';
import { worktreeHandler } from './worktree';
import { swarmHandler } from './swarm';
import { storesHandler } from './stores';
import { dlpHandler } from './dlp';

/**
 * Meta action registry：sub_action category → handler function
 *
 * 与 aza-loop-actions 不同，meta 没有 dispatch 入口函数，
 * 而是通过 4 个 dispatch 函数（dispatchMetaWorktree / Swarm / Stores / Dlp）
 * 分别路由 worktree/swarm/stores/dlp 类别的子命令。
 */
export const META_ACTION_REGISTRY: Record<string, MetaActionHandler> = {
  worktree: worktreeHandler,
  swarm: swarmHandler,
  stores: storesHandler,
  dlp: dlpHandler,
  dlp_scan: dlpHandler,
  dlp_strict: dlpHandler,
};

/**
 * 列出所有已注册的 meta action 类别（用于文档/调试）。
 */
export function listRegisteredMetaActions(): string[] {
  return Object.keys(META_ACTION_REGISTRY);
}

/**
 * Worktree dispatcher：将 action 别名映射到 sub_action，再委托 handler。
 */
export function dispatchMetaWorktree(
  args: Record<string, unknown>,
  action?: string,
): unknown {
  if (action === 'worktree_list') args.sub_action = 'list';
  else if (action === 'worktree_create') args.sub_action = 'create';
  else if (action === 'worktree_remove') args.sub_action = 'remove';
  return worktreeHandler(buildMetaContext(args, undefined, action));
}

/**
 * Swarm dispatcher：将 action 别名映射到 sub_action，再委托 handler。
 */
export function dispatchMetaSwarm(
  args: Record<string, unknown>,
  action?: string,
): unknown {
  if (action === 'swarm_dispatch') args.sub_action = 'dispatch';
  else if (action === 'swarm_report') args.sub_action = 'report';
  else if (action === 'swarm_status') args.sub_action = 'status';
  return swarmHandler(buildMetaContext(args, undefined, action));
}

/**
 * Stores dispatcher：将 action 别名映射到 sub_action，再委托 handler。
 */
export function dispatchMetaStores(
  args: Record<string, unknown>,
  action?: string,
): unknown {
  if (action === 'stores_put') args.sub_action = 'put';
  else if (action === 'stores_search') args.sub_action = 'search';
  return storesHandler(buildMetaContext(args, undefined, action));
}

/**
 * DLP dispatcher：直接委托 handler（无 sub_action 别名）。
 */
export function dispatchMetaDlp(
  args: Record<string, unknown>,
  action?: string,
): unknown {
  if (!args.sub_action) args.sub_action = action || 'dlp_scan';
  return dlpHandler(buildMetaContext(args, undefined, action));
}

/**
 * 通用 dispatcher：按 category 路由到对应 handler。
 * 未知 category 退化为 dlp。
 */
export function dispatchMetaAction(
  category: string,
  ctx: MetaActionContext,
): unknown | Promise<unknown> {
  const handler = META_ACTION_REGISTRY[category] ?? dlpHandler;
  return handler(ctx);
}
