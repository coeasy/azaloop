/**
 * R12 P6 Plus12 (P1 主链路拆分第12轮) — 统一 Action 响应构建器。
 *
 * 借鉴 gstack「response shape registry」+ agency-orchestrator「step result router」：
 * 把 aza-loop-actions/* 中重复的 success/data/next_action/metadata 四元组 + driver.step()
 * 结果分发模式抽到统一工厂。
 *
 * 统一行为：
 * 1. **buildActionResponse()** 统一 4 元组构造：data + nextAction + ctx → LoopResponse
 * 2. **routeStepResult()** 统一 step 结果分发：driver.step() 后的 awaitingAction/done/continue 三态
 * 3. **routeTerminalAction()** 统一终态路由：done 后的 done/escalate/stop/unknown 四态
 * 4. **buildErrorResponse()** 统一错误响应：error message → LoopResponse
 *
 * 借鉴 ruflo「response shape contract」：所有 action handler 返回的 LoopResponse 结构一致，
 * 客户端（Cursor/Trae/OpenCode）解析逻辑可以统一。
 */
import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { ActionContext, ActionHandler } from './context';
import { buildMetadata } from './context';

// ── 基础类型 ──

/** driver.step() 的返回类型（推断） */
export type DriverStepResult = Awaited<ReturnType<ActionContext['driver']['step']>>;

// ── 1. buildActionResponse — 统一 4 元组构造 ──

export interface ActionResponseOptions {
  /** 业务数据 payload */
  data: Record<string, unknown>;
  /** 下一步动作（可省略，默认无 next_action） */
  nextAction?: NextAction | null;
  /** 成功标志（默认 true） */
  success?: boolean;
  /** 错误消息（success=false 时使用） */
  error?: string;
  /** 自定义 metadata（默认用 buildMetadata(ctx)） */
  metadata?: { iteration: number; progress: string; stage?: string };
}

/**
 * 构造标准 Action 响应：data + nextAction + ctx → LoopResponse。
 *
 * 用法：
 *   return buildActionResponse(ctx, {
 *     data: { status: 'paused' },
 *     nextAction: { tool: 'aza_loop', action: 'resume', reason: '...' },
 *   });
 */
export function buildActionResponse(
  ctx: ActionContext,
  options: ActionResponseOptions,
): LoopResponse {
  return {
    success: options.success ?? true,
    data: options.data,
    next_action: options.nextAction ?? undefined,
    error: options.error,
    metadata: options.metadata ?? buildMetadata(ctx),
  };
}

// ── 2. routeStepResult — 统一 step 结果分发 ──

/**
 * driver.step() 的三态：
 *   - awaiting: 需要 host agent 执行外部 tool
 *   - done: loop 真正完成（real completion）
 *   - continue: 继续推进（done=false 且无 awaitingAction）
 */
export type StepOutcome = 'awaiting' | 'done' | 'continue';

export interface RouteStepOptions {
  /** 完成后默认 next_action（done 时使用） */
  doneNextAction?: NextAction;
  /** continue 时默认 next_action（fallback） */
  continueNextAction?: NextAction;
  /** status 字段重写（如 report_tool 改成 'tool_reported'） */
  statusOverride?: string;
  /** 附加 data 字段（如 tool_executed） */
  extraData?: Record<string, unknown>;
}

/**
 * 统一 driver.step() 结果分发。
 *
 * 用法：
 *   const step = await ctx.driver.step();
 *   return routeStepResult(ctx, step, {
 *     doneNextAction: { tool: 'aza_finish', action: 'ship', reason: '...' },
 *     continueNextAction: { tool: 'aza_loop', action: 'next', reason: '...' },
 *   });
 */
export function routeStepResult(
  ctx: ActionContext,
  step: DriverStepResult,
  options: RouteStepOptions = {},
): LoopResponse {
  // 状态 1: awaitingAction — host agent 需要执行外部 tool
  if (step.awaitingAction) {
    return buildActionResponse(ctx, {
      data: {
        status: options.statusOverride ?? 'awaiting_agent',
        awaitingAction: step.awaitingAction,
        done: false,
        iteration: step.iteration,
        stage: step.stage,
        ...options.extraData,
      },
      nextAction: step.awaitingAction,
    });
  }

  // 状态 2: done — 终态（real completion）
  if (step.done) {
    return buildActionResponse(ctx, {
      data: {
        status: options.statusOverride ?? 'completed',
        done: true,
        nextAction: step.nextAction,
        iteration: step.iteration,
        stage: step.stage,
        ...options.extraData,
      },
      nextAction: step.nextAction ?? options.doneNextAction,
    });
  }

  // 状态 3: continue — 继续推进
  return buildActionResponse(ctx, {
    data: {
      status: options.statusOverride ?? 'continue',
      done: false,
      nextAction: step.nextAction,
      iteration: step.iteration,
      stage: step.stage,
      ...options.extraData,
    },
    nextAction:
      step.nextAction ??
      options.continueNextAction ?? { tool: 'aza_loop', action: 'next', reason: 'Continue auto-loop' },
  });
}

// ── 3. routeTerminalAction — 统一终态路由 ──

/**
 * driver.step() done=true 时，nextAction.action 的四态：
 *   - done: 真正完成（推荐 ship）
 *   - escalate: 升级到人工（3-strike 或 DP gate block）
 *   - stop: 用户停止
 *   - 其它: 未知终态（安全起见当 escalate）
 */
export function routeTerminalAction(
  ctx: ActionContext,
  step: DriverStepResult,
  fallbackDone?: NextAction,
): LoopResponse {
  const terminalAction = step.nextAction?.action;
  const isRealCompletion = terminalAction === 'done';
  const isEscalation = terminalAction === 'escalate';
  const isStop = terminalAction === 'stop';

  if (isRealCompletion) {
    return buildActionResponse(ctx, {
      data: {
        status: 'completed',
        done: true,
        nextAction: step.nextAction,
        iteration: step.iteration,
        stage: step.stage,
      },
      nextAction: step.nextAction ??
        fallbackDone ?? {
          tool: 'aza_finish',
          action: 'ship',
          reason: 'Auto-loop complete — ship delivery',
        },
    });
  }
  if (isEscalation) {
    return buildActionResponse(ctx, {
      success: false,
      data: {
        status: 'escalated',
        reason: 'Loop ended with escalation (3-strike or DP gate block)',
        nextAction: step.nextAction,
        iteration: step.iteration,
        stage: step.stage,
      },
      nextAction: step.nextAction ?? {
        tool: 'aza_loop',
        action: 'escalate',
        reason: '3-strike or DP gate block — human review required',
      },
    });
  }
  if (isStop) {
    return buildActionResponse(ctx, {
      success: false,
      data: {
        status: 'stopped',
        reason: 'Loop ended with stop',
        nextAction: step.nextAction,
        iteration: step.iteration,
        stage: step.stage,
      },
      nextAction: step.nextAction ?? {
        tool: 'aza_loop',
        action: 'stop',
        reason: 'Loop stopped — manual review required',
      },
    });
  }
  // Unknown terminal action — treat as escalated for safety
  return buildActionResponse(ctx, {
    success: false,
    data: {
      status: 'unknown_terminal',
      reason: `Loop ended with unknown action: ${terminalAction ?? 'undefined'}`,
      nextAction: step.nextAction,
      iteration: step.iteration,
      stage: step.stage,
    },
    nextAction: step.nextAction ?? {
      tool: 'aza_loop',
      action: 'escalate',
      reason: 'Unknown terminal action — review required',
    },
  });
}

// ── 4. buildErrorResponse — 统一错误响应 ──

/**
 * 构造错误响应（success=false，保留 metadata 便于客户端显示）。
 */
export function buildErrorResponse(
  ctx: ActionContext,
  error: string,
  options?: {
    data?: Record<string, unknown>;
    nextAction?: NextAction;
  },
): LoopResponse {
  return buildActionResponse(ctx, {
    success: false,
    data: options?.data ?? { status: 'error' },
    error,
    nextAction: options?.nextAction,
  });
}

// ── 5. errorBoundary — 统一 try/catch 包装 ──

/**
 * 错误边界：handler 抛出异常时返回统一错误响应。
 *
 * 用法：
 *   export const myAction: ActionHandler = withErrorBoundary(async (ctx) => {
 *     // 可能抛错的业务逻辑
 *   }, { fallback: 'my_action failed' });
 */
export function withErrorBoundary(
  handler: ActionHandler,
  options: { fallback?: string } = {},
): ActionHandler {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (err: any) {
      return buildErrorResponse(ctx, err?.message || options.fallback || 'Action failed');
    }
  };
}
