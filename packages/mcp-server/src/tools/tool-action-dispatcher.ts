/**
 * R12 P6 Plus15 (P1 主链路拆分第15轮) — Tool Action 通用路由调度器。
 *
 * 借鉴 OpenSpec「action router」+ spec-kit「table-driven dispatch」+ gstack「command pattern」：
 * 把 unified-handlers.ts 中 8 个 handleAza* 入口的 `switch (action) { case 'xxx': return ...; default: return fail(action, [...]) }`
 * 重复模式抽到统一 dispatch 工厂。
 *
 * 核心问题：每个 handleAza* 入口都有一个 switch 语句，包含：
 *   1. N 个 case 分支（调用具体业务 handler）
 *   2. 1 个 default 分支（unknown action 错误响应）
 *   3. 重复的 fail() 工具函数
 *
 * 解决：
 * 1. **dispatchAction()** 通用路由：actions map + 业务函数 → 路由结果
 * 2. **ActionDispatchOptions** 统一配置：defaultActions、defaultHandler
 * 3. **defaultFailResponse()** 统一默认失败响应
 * 4. **withActionDispatch()** 装饰器：包裹 handleAza* 函数
 * 5. **buildAllowedActions()** 从 actions map 提取所有 allowed action 列表
 */
import type { LoopResponse } from '@azaloop/shared';

// ── 类型定义 ──

/** 业务 handler 签名：接收 args，返回响应 */
export type ActionHandlerFn = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/** action → handler 映射 */
export type ActionMap = Record<string, ActionHandlerFn>;

/** dispatch options */
export interface ActionDispatchOptions {
  /** action → handler 映射 */
  actions: ActionMap;
  /** default action（当 args.action 缺失时使用） */
  defaultAction?: string;
  /** 未知 action 时调用的 handler（可选，fallback 到默认 fail 响应） */
  defaultHandler?: ActionHandlerFn;
  /** 业务上下文标签（用于 fail 响应中的 tool name） */
  toolName: string;
  /** 接收 args.action 之前的预处理器（可选） */
  preDispatch?: (args: Record<string, unknown>) => void;
}

/** 构造未知 action 错误响应 */
export function defaultFailResponse(
  action: string,
  allowed: string[],
  _tool?: string,
): { success: boolean; error: string; data: null } {
  return {
    success: false,
    error: `Unknown action "${action}". Allowed: ${allowed.join(', ')}`,
    data: null,
  };
}

/** 从 actions map 提取所有 allowed action 列表 */
export function buildAllowedActions(actions: ActionMap): string[] {
  return Object.keys(actions);
}

/**
 * 通用 action dispatch：actions map + args → 路由结果。
 *
 * 用法：
 *   const sessionActions: ActionMap = {
 *     init: (args) => handleInit(...),
 *     start: (args) => handleSessionStart(...),
 *     // ...
 *   };
 *   return dispatchAction(args, { actions: sessionActions, defaultAction: 'calibrate', toolName: 'aza_session' });
 */
export async function dispatchAction(
  args: Record<string, unknown>,
  options: ActionDispatchOptions,
): Promise<unknown> {
  const action = String(args.action ?? options.defaultAction ?? '');
  const { actions, defaultHandler, toolName, preDispatch } = options;

  if (preDispatch) {
    preDispatch(args);
  }

  // 1. 业务 handler
  const handler = actions[action];
  if (handler) {
    return await handler(args);
  }

  // 2. 默认 handler（特殊 fallback）
  if (defaultHandler) {
    return await defaultHandler(args);
  }

  // 3. 未知 action 错误响应
  const allowed = buildAllowedActions(actions);
  if (options.defaultAction && !allowed.includes(options.defaultAction)) {
    allowed.unshift(options.defaultAction);
  }
  return defaultFailResponse(action, allowed, options.toolName);
}

// ── 装饰器模式 ──

/**
 * action dispatch 装饰器：包裹一个 handleAza* 函数，注入 dispatch 逻辑。
 *
 * 用法：
 *   export const handleAzaSession = withActionDispatch(
 *     (args, sm) => { /* ... *\/ },
 *     { actions: sessionActions, defaultAction: 'calibrate', toolName: 'aza_session' }
 *   );
 */
export function withActionDispatch<TArgs extends Record<string, unknown>>(
  factory: (args: TArgs) => ActionMap,
  options: { defaultAction?: string; toolName: string; defaultHandler?: ActionHandlerFn },
) {
  return async (args: TArgs): Promise<unknown> => {
    const actions = factory(args);
    return dispatchAction(args, { ...options, actions });
  };
}

// ── 别名兼容 ──

/** 旧 fail 函数别名（向后兼容） */
export const fail = defaultFailResponse;

// ── LoopResponse 类型守卫 ──

/** 判断响应是否是 LoopResponse 格式 */
export function isLoopResponse(r: unknown): r is LoopResponse {
  return (
    typeof r === 'object' &&
    r !== null &&
    'success' in r &&
    typeof (r as any).success === 'boolean'
  );
}
