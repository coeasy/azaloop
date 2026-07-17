/**
 * R12 P6 Plus8 (P1 主链路拆分第8轮) — Worktree sub_action handler。
 *
 * 借鉴 gstack「worktree pool」+ Trellis「workspace isolation」：
 * 把 aza-meta-ext.ts 中 32 行的 worktree 子命令块抽出为独立 handler。
 *
 * 支持的 sub_action：
 *   - list      列出当前 worktree
 *   - create    新建 worktree（带 branch / base 选项）
 *   - remove    移除指定 path
 *   - prune     清理已删除 branch 对应的 worktree
 */
import { WorktreeManager } from '@azaloop/core';
import type { MetaActionContext, MetaActionHandler } from './context';
import {
  buildMetaError,
  buildMetaResponse,
  buildMetaNextAction,
  dispatchSubAction,
  type SubActionHandlers,
} from './response-builder';

export const worktreeHandler: MetaActionHandler = (ctx: MetaActionContext) => {
  const { args, workspace } = ctx;
  const sub = String(args.sub_action || args.op || 'list');
  const mgr = new WorktreeManager({
    enabled: true,
    base_branch: (args.base_branch as string) || 'main',
    worktree_prefix: (args.prefix as string) || 'aza/',
    repo_root: workspace,
  });

  const handlers: SubActionHandlers = {
    list: () => buildMetaResponse({ data: { worktrees: mgr.list() } }),
    create: () => {
      const name = String(args.name || args.branch || 'feature');
      const result = mgr.create(name, {
        branch: args.branch as string | undefined,
        base: args.base as string | undefined,
      });
      return buildMetaResponse({
        success: result.ok,
        data: result,
        error: result.error,
      });
    },
    remove: () => {
      const wtPath = String(args.path || '');
      if (!wtPath) {
        return buildMetaError('path required');
      }
      const result = mgr.remove(wtPath, args.force === true);
      return buildMetaResponse({
        success: result.ok,
        data: result,
        error: result.error,
      });
    },
    prune: () => {
      const result = mgr.prune();
      return buildMetaResponse({
        success: result.ok,
        data: result,
        error: result.error,
      });
    },
  };

  return dispatchSubAction(sub, ctx, handlers, 'worktree');
};
