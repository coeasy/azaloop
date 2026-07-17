/**
 * aza_meta worktree / swarm / stores / shellward DLP — thin re-export wrapper.
 *
 * R12 P6 Plus8 (P1 主链路拆分第8轮) — 把 4 个 meta sub_action handler
 * (worktree / swarm / stores / dlp) 从 242 行收敛为 thin re-export + 委托。
 *
 * 实际实现已抽到 `tools/aza-meta-actions/`：
 *   - worktree.ts → worktreeHandler
 *   - swarm.ts    → swarmHandler
 *   - stores.ts   → storesHandler
 *   - dlp.ts      → dlpHandler
 *   - dispatcher.ts → 4 个 dispatchMeta* 函数 + META_ACTION_REGISTRY
 *
 * 兼容保留原始 handleMetaWorktree / handleMetaSwarm / handleMetaStores / handleMetaDlp
 * 导出名（meta-workflow.ts 仍引用），内部 thin shell 委托到新模块。
 */
import {
  worktreeHandler,
  swarmHandler,
  storesHandler,
  dlpHandler,
  buildMetaContext,
} from './aza-meta-actions';

/** Thin shell: handleMetaWorktree → worktreeHandler */
export async function handleMetaWorktree(args: Record<string, unknown>): Promise<unknown> {
  return worktreeHandler(buildMetaContext(args));
}

/** Thin shell: handleMetaSwarm → swarmHandler */
export async function handleMetaSwarm(args: Record<string, unknown>): Promise<unknown> {
  return swarmHandler(buildMetaContext(args));
}

/** Thin shell: handleMetaStores → storesHandler */
export async function handleMetaStores(args: Record<string, unknown>): Promise<unknown> {
  return storesHandler(buildMetaContext(args));
}

/** Thin shell: handleMetaDlp → dlpHandler */
export async function handleMetaDlp(args: Record<string, unknown>): Promise<unknown> {
  return dlpHandler(buildMetaContext(args));
}
