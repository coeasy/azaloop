/**
 * R12 P6 Plus13 (P1 主链路拆分第13轮) — 统一 Meta Action 响应构建器。
 *
 * 借鉴 spec-kit「response shape contract」+ gstack「command pattern」+ ruflo「sub_action router」：
 * 把 aza-meta-actions/* 中重复的 `{ success, data, error, next_action }` 四元组
 * + sub_action 路由 + 未知子命令错误响应抽到统一工厂。
 *
 * 统一行为：
 * 1. **buildMetaResponse()** 统一四元组构造：data + nextAction → 标准 meta response
 * 2. **buildMetaError()** 统一错误响应：error message → 标准 meta error
 * 3. **unknownSubAction()** 统一未知子命令错误：sub name + 类别 → 友好错误响应
 * 4. **buildMetaNextAction()** 统一 next_action 构造：tool + action + reason → NextAction
 * 5. **dispatchSubAction()** 统一 sub_action 路由：sub + handlers map → 路由结果
 *
 * 与 aza-loop-actions/response-builder.ts 区别：
 * - meta response 的 data 是 unknown（不强约束），可承载任意 sub_action 业务数据
 * - meta next_action 通常是同一个 tool 的其他 sub_action
 * - meta 经常需要处理"未知 sub_action"错误
 */
import type { NextAction } from '@azaloop/shared';
import type { MetaActionContext, MetaActionHandler } from './context';

// ── 基础类型 ──

/** meta response 的标准形状 */
export interface MetaResponse {
  success: boolean;
  data: unknown;
  error?: string;
  next_action?: NextAction;
  metadata?: Record<string, unknown>;
}

// ── 1. buildMetaResponse — 统一四元组构造 ──

export interface MetaResponseOptions {
  /** 业务数据 payload */
  data: unknown;
  /** 下一步动作（可省略） */
  nextAction?: NextAction;
  /** 成功标志（默认 true） */
  success?: boolean;
  /** 错误消息（success=false 时使用） */
  error?: string;
  /** 自定义 metadata */
  metadata?: Record<string, unknown>;
}

/**
 * 构造标准 Meta 响应：data + nextAction → MetaResponse。
 *
 * 用法：
 *   return buildMetaResponse({
 *     data: { worktrees: mgr.list() },
 *   });
 */
export function buildMetaResponse(options: MetaResponseOptions = { data: null }): MetaResponse {
  return {
    success: options.success ?? true,
    data: options.data,
    next_action: options.nextAction,
    error: options.error,
    metadata: options.metadata,
  };
}

// ── 2. buildMetaError — 统一错误响应 ──

/**
 * 构造 Meta 错误响应（success=false）。
 *
 * 用法：
 *   return buildMetaError('task_id required');
 *   return buildMetaError('id and body required', { data: null });
 */
export function buildMetaError(
  error: string,
  options: { data?: unknown; nextAction?: NextAction } = {},
): MetaResponse {
  return {
    success: false,
    error,
    data: options.data ?? null,
    next_action: options.nextAction,
  };
}

// ── 3. unknownSubAction — 统一未知子命令错误 ──

/**
 * 构造未知子命令错误响应（带 sub 名 + 类别）。
 *
 * 用法：
 *   return unknownSubAction(sub, 'worktree');
 *   // → { success: false, error: 'Unknown worktree sub_action "xyz"', data: null }
 */
export function unknownSubAction(sub: string, category: string): MetaResponse {
  return buildMetaError(`Unknown ${category} sub_action "${sub}"`);
}

// ── 4. buildMetaNextAction — 统一 next_action 构造 ──

/**
 * 构造 Meta next_action（通常指向同 tool 的其他 sub_action）。
 *
 * 用法：
 *   return buildMetaResponse({
 *     data: { ... },
 *     nextAction: buildMetaNextAction('swarm_dispatch', 'Dispatch a parallel swarm task'),
 *   });
 */
export function buildMetaNextAction(
  action: string,
  reason: string,
  tool: string = 'aza_meta',
  extras: Partial<NextAction> = {},
): NextAction {
  return { tool, action, reason, ...extras };
}

// ── 5. dispatchSubAction — 统一 sub_action 路由 ──

/**
 * sub_action handler 签名：接收 sub + ctx → MetaResponse。
 */
export type SubActionHandler = (sub: string, ctx: MetaActionContext) => MetaResponse | Promise<MetaResponse>;

/**
 * sub_action handlers map：sub name → handler。
 */
export type SubActionHandlers = Record<string, SubActionHandler>;

/**
 * 统一 sub_action 路由：sub + handlers map → 路由结果。
 *
 * 用法：
 *   const handlers: SubActionHandlers = {
 *     list: (sub, ctx) => buildMetaResponse({ data: { worktrees: getMgr(ctx).list() } }),
 *     create: (sub, ctx) => buildMetaResponse({ data: getMgr(ctx).create(...) }),
 *     // ...
 *   };
 *   return dispatchSubAction(sub, ctx, handlers, 'worktree');
 */
export async function dispatchSubAction(
  sub: string,
  ctx: MetaActionContext,
  handlers: SubActionHandlers,
  category: string,
): Promise<MetaResponse> {
  const handler = handlers[sub];
  if (!handler) {
    return unknownSubAction(sub, category);
  }
  try {
    return await handler(sub, ctx);
  } catch (err: any) {
    return buildMetaError(err?.message || `${category} ${sub} failed`);
  }
}

// ── 6. errorBoundary — 统一 try/catch 包装 ──

/**
 * 错误边界：handler 抛出异常时返回统一错误响应。
 *
 * 用法：
 *   export const worktreeHandler: MetaActionHandler = withMetaErrorBoundary((ctx) => {
 *     // 可能抛错的业务逻辑
 *   }, 'worktree');
 */
export function withMetaErrorBoundary(
  handler: MetaActionHandler,
  category: string = 'meta',
): MetaActionHandler {
  return (ctx) => {
    try {
      const result = handler(ctx);
      if (result instanceof Promise) {
        return result.catch((err: any) => buildMetaError(err?.message || `${category} failed`));
      }
      return result;
    } catch (err: any) {
      return buildMetaError(err?.message || `${category} failed`);
    }
  };
}

// ── 7. extractSub — 统一 sub_action 提取 ──

/**
 * 从 args 中提取 sub_action（兼容多种参数命名）。
 *
 * 用法：
 *   const sub = extractSub(args, 'list');
 *   // → args.sub_action || args.op || 'list'
 */
export function extractSub(args: Record<string, unknown>, defaultSub: string = 'list'): string {
  return String(args.sub_action || args.op || defaultSub);
}
