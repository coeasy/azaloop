/**
 * R12 P6 Plus8 (P1 主链路拆分第8轮) — Stores sub_action handler。
 *
 * 借鉴 ruflo「vector store」+ spec-kit「knowledge base」：
 * 把 aza-meta-ext.ts 中 70+ 行的 stores 子命令块抽出为独立 handler。
 *
 * 支持的 sub_action：
 *   - ensure        确保 stores 目录结构存在
 *   - put           写入 / 覆盖 store 文档
 *   - get           按 id 读取
 *   - list          列出某 kind 的所有文档
 *   - delete        按 id 删除
 *   - reindex       重新建立索引
 *   - search        关键词搜索（vector store）
 *   - upsert_vector 直接 upsert 向量
 *   - distill       从项目变更 / 规范提炼 store 文档
 */
import {
  putStoreDoc,
  getStoreDoc,
  listStoreDocs,
  deleteStoreDoc,
  openVectorStore,
  reindexStores,
  ensureStores,
} from '@azaloop/core';
import type { MetaActionContext, MetaActionHandler } from './context';
import {
  buildMetaError,
  buildMetaResponse,
  dispatchSubAction,
  type SubActionHandlers,
} from './response-builder';

export const storesHandler: MetaActionHandler = (ctx: MetaActionContext) => {
  const { args, azaDir, workspace } = ctx;
  const sub = String(args.sub_action || args.op || 'list');
  const kind = (args.kind as 'specs' | 'changes') || 'specs';

  const handlers: SubActionHandlers = {
    ensure: () => buildMetaResponse({ data: ensureStores(azaDir) }),

    put: () => {
      const id = String(args.id || '');
      const body = String(args.body || '');
      if (!id || !body) return buildMetaError('id and body required');
      const doc = putStoreDoc(azaDir, kind, {
        id,
        title: args.title as string | undefined,
        body,
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : undefined,
        meta: args.meta as Record<string, unknown> | undefined,
      });
      return buildMetaResponse({ data: doc });
    },

    get: () => {
      const id = String(args.id || '');
      return buildMetaResponse({ data: getStoreDoc(azaDir, kind, id) });
    },

    list: () => buildMetaResponse({ data: { docs: listStoreDocs(azaDir, kind), kind } }),

    delete: () => {
      const id = String(args.id || '');
      return buildMetaResponse({ data: { deleted: deleteStoreDoc(azaDir, kind, id) } });
    },

    reindex: () => buildMetaResponse({ data: reindexStores(azaDir) }),

    search: () => {
      const q = String(args.query || '');
      const vs = openVectorStore(azaDir);
      return buildMetaResponse({
        data: { hits: vs.search(q, Number(args.limit) || 5), size: vs.size() },
      });
    },

    upsert_vector: () => {
      const key = String(args.key || args.id || '');
      const text = String(args.text || args.body || '');
      if (!key || !text) return buildMetaError('key and text required');
      const vs = openVectorStore(azaDir);
      vs.upsert(key, text);
      return buildMetaResponse({ data: { key, size: vs.size() } });
    },

    distill: () => {
      const { distillProjectChange, distillConventionsToStore } = require('@azaloop/core') as typeof import('@azaloop/core');
      const changeId = args.change_id ? String(args.change_id) : undefined;
      const onlyConv = Boolean(args.conventions_only);
      const result = onlyConv
        ? distillConventionsToStore(azaDir)
        : distillProjectChange(workspace, changeId);
      return buildMetaResponse({
        data: {
          docs: result.docs.length,
          indexed: result.indexed,
          sources: result.sources,
          ids: result.docs.map((d) => d.id),
        },
      });
    },
  };

  return dispatchSubAction(sub, ctx, handlers, 'stores');
};
