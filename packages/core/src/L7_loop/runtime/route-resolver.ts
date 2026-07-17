/**
 * R12 P6 Plus4 (P2 退出标准) — Route Resolver 拆分
 *
 * 借鉴 comet「action router」+ spec-kit「deterministic routing」：
 *
 * 痛点：loop-controller.ts deterministicRoute 16 行 + 5 种触发条件
 *       散在主类里，每次路由都要重新评估 ctx。
 *
 * 解法：抽出 RouteResolver 工具类 + RouteContext 纯函数。
 *       主类只持有一个 5 行的 `resolveRoute` 委托方法。
 *
 * 边界：所有依赖通过纯函数参数注入，不访问任何 controller 状态。
 */

import type { NextAction } from '@azaloop/shared';
import type { Stage } from '../state-machine';
import type { TokenBudget, BudgetAction } from '../token-budget';

/**
 * 路由上下文：5 个布尔/枚举输入，1 个 NextAction 输出。
 * 不持有任何 controller 状态，确保纯函数可单测。
 */
export interface RouteContext {
  hardStopped: boolean;
  breakerTripped: boolean;
  iterExceeded: boolean;
  strikeHardStop: boolean;
  budgetAction: BudgetAction;
}

/**
 * 纯函数路由：5 种触发条件的短路求值。
 * 输入：当前 stage + 路由上下文
 * 输出：下一步 NextAction 或 null（null = 继续当前 stage）
 *
 * 短路顺序（与原 deterministicRoute 保持一致）：
 *   1. hardStopped       → report
 *   2. breakerTripped    → escalate
 *   3. iterExceeded      → stop
 *   4. strikeHardStop    → escalate
 *   5. budgetAction=stop → stop
 */
export function resolveRoute(stage: Stage, ctx: RouteContext): NextAction | null {
  if (ctx.hardStopped) {
    return { tool: 'aza_loop', action: 'report', reason: 'Hard stop' };
  }
  if (ctx.breakerTripped) {
    return { tool: 'aza_loop', action: 'escalate', reason: 'Circuit breaker tripped' };
  }
  if (ctx.iterExceeded) {
    return { tool: 'aza_loop', action: 'stop', reason: 'Max iterations' };
  }
  if (ctx.strikeHardStop) {
    return { tool: 'aza_loop', action: 'escalate', reason: '3-Strike' };
  }
  if (ctx.budgetAction === 'stop') {
    return { tool: 'aza_loop', action: 'stop', reason: 'Token budget exhausted' };
  }
  return null;
}

/**
 * 从 controller 各组件派生 RouteContext。
 * 提供 5 个 getter 注入，避免直接读取 controller 私有字段。
 */
export interface RouteContextDeps {
  isHardStopped: () => boolean;
  isBreakerTripped: () => boolean;
  isIterExceeded: () => boolean;
  isStrikeHardStop: () => boolean;
  getBudgetAction: () => BudgetAction;
}

export function buildRouteContext(deps: RouteContextDeps): RouteContext {
  return {
    hardStopped: deps.isHardStopped(),
    breakerTripped: deps.isBreakerTripped(),
    iterExceeded: deps.isIterExceeded(),
    strikeHardStop: deps.isStrikeHardStop(),
    budgetAction: deps.getBudgetAction(),
  };
}

/**
 * RouteResolver 类（兼容旧 API，可选使用）。
 * 封装 resolveRoute + buildRouteContext，提供统一入口。
 */
export class RouteResolver {
  constructor(private readonly deps: RouteContextDeps) {}

  /** 直接对给定 ctx 求值 */
  resolve(ctx: RouteContext): NextAction | null {
    return resolveRoute('open' as Stage, ctx);
  }

  /** 收集当前 ctx 并求值 */
  resolveCurrent(): NextAction | null {
    return resolveRoute('open' as Stage, buildRouteContext(this.deps));
  }
}
