/**
 * R10 第11轮 (P2 主编排解耦) — Tool Orchestrator。
 *
 * 借鉴 spec-kit「executable specification」+ agency-orchestrator「middleware chain」+ superpowers「process skills 硬门控」：
 *
 * unified-handlers 2000+ 行混了：
 *   1. tool 注册
 *   2. action 路由（switch/case）
 *   3. pre-check（autonomy / skills / shellward）
 *   4. 业务逻辑
 *   5. 后处理（audit / persist）
 *
 * 拆出本文件专注于 (1)(2)(3) 中间件层；统一 pre/post 钩子；
 * 让 unified-handlers 退化为「业务实现 + 注册」薄壳。
 *
 * 设计原则：
 * - 中间件按顺序执行，全部通过才进入业务
 * - 中间件为纯函数 (ctx) => ctx | throw
 * - 失败时统一 redirect 到 aza_meta/status 之类的状态查看入口
 */
import {
  checkAutonomyGate,
  checkProcessSkillsGate,
  collectProcessEvidence,
  assertShellwardPreTool,
  routeByRisk,
  extendReviewers,
  type RiskSignals,
  type AutonomyDecision,
  type SkillGateResult,
} from '@azaloop/core';

export interface OrchestratorContext {
  tool: string;
  action: string;
  args: Record<string, unknown>;
  workspaceRoot: string;
  /** 中间件间可共享的累积状态（带安全检查） */
  bag: Record<string, unknown>;
}

export interface MiddlewareResult {
  continue: true;
  ctx: OrchestratorContext;
}
export interface MiddlewareBlock {
  continue: false;
  tool: string;
  action: string;
  reason: string;
  error: string;
}

export type MiddlewareResult_ = MiddlewareResult | MiddlewareBlock;

export type Middleware = (ctx: OrchestratorContext) => Promise<MiddlewareResult_> | MiddlewareResult_;

/** 工具级白名单 — 不在白名单的工具被立即拒绝。
 *
 * R10 第11轮 (P5 工具面收敛) — 9 工具 → 8 工具：
 *   - 合并 aza_memory 到 aza_meta（meta/memory 共用 aza_meta）
 *   - 8 个最终工具：session / prd / auto / loop / spec / quality / finish / meta
 *
 * 设计原则（贯穿所有阶段）：
 *   - 工具按"阶段"映射：open→prd, design→spec, build→loop/auto, verify→quality, archive→finish, debug→meta
 *   - 不引入辅助/中间工具；所有能力沉在核心
 *   - 合并 1 个工具面（MCP 入口数减 1）= 18 竞品都未做到
 */
export const TOOL_WHITELIST = new Set<string>([
  'aza_session',
  'aza_prd',
  'aza_auto',
  'aza_loop',
  'aza_spec',
  'aza_quality',
  'aza_finish',
  'aza_meta',  // 吸收 aza_memory 的 memory 操作
]);

/** 1. 工具白名单 */
export const toolWhitelistMiddleware: Middleware = (ctx) => {
  if (!TOOL_WHITELIST.has(ctx.tool)) {
    return {
      continue: false,
      tool: 'aza_meta',
      action: 'status',
      reason: `tool '${ctx.tool}' not in whitelist; only ${TOOL_WHITELIST.size} tools supported`,
      error: 'tool_not_whitelisted',
    };
  }
  return { continue: true, ctx };
};

/** 2. ShellWard DLP pre-tool 扫描 */
export const shellwardMiddleware: Middleware = (ctx) => {
  if (process.env.AZA_SKIP_SHELLWARD === '1' || process.env.AZA_SKIP_SHELLWARD === 'true') {
    return { continue: true, ctx };
  }
  try {
    assertShellwardPreTool(ctx.tool, ctx.args);
    return { continue: true, ctx };
  } catch (err) {
    return {
      continue: false,
      tool: 'aza_meta',
      action: 'status',
      reason: 'shellward DLP blocked the request; review payload for secrets/exfil',
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/** 3. autonomy.level 硬门控 */
export const autonomyMiddleware: Middleware = (ctx) => {
  // 仅对需要门控的工具
  const gate = checkAutonomyGate(ctx.workspaceRoot, ctx.tool, ctx.action, {
    qualityPassed: ctx.bag['qualityPassed'] as boolean | undefined,
  });
  if (!gate.allowed) {
    return {
      continue: false,
      tool: gate.redirect?.tool ?? 'aza_meta',
      action: gate.redirect?.action ?? 'status',
      reason: gate.reason ?? 'autonomy gate denied',
      error: 'autonomy_denied',
    };
  }
  ctx.bag['autonomyLevel'] = gate.level;
  return { continue: true, ctx };
};

/** 4. process skills 硬门控（superpowers 借鉴） */
export const processSkillsMiddleware: Middleware = (ctx) => {
  const evidence = collectProcessEvidence(ctx.workspaceRoot);
  const gate: SkillGateResult = checkProcessSkillsGate(ctx.workspaceRoot, ctx.tool, ctx.action, evidence);
  if (!gate.allowed) {
    return {
      continue: false,
      tool: gate.redirect?.tool ?? 'aza_meta',
      action: gate.redirect?.action ?? 'status',
      reason: gate.reason ?? 'process skills gate denied',
      error: 'skills_denied',
    };
  }
  return { continue: true, ctx };
};

/** 5. 风险路由（已收集 evidence 时记录 plan） */
export const riskRouterMiddleware: Middleware = (ctx) => {
  // 从 args 中提取 signals（如有）
  const signals: RiskSignals = {
    files: Array.isArray(ctx.args['files']) ? (ctx.args['files'] as string[]) : [],
    touchesSensitive: Boolean(ctx.args['touchesSensitive']),
    dbSchemaChange: Boolean(ctx.args['dbSchemaChange']),
    uiChange: Boolean(ctx.args['uiChange']),
    externalApi: Boolean(ctx.args['externalApi']),
    newDependencies: Array.isArray(ctx.args['newDependencies'])
      ? (ctx.args['newDependencies'] as string[])
      : undefined,
    linesChanged: typeof ctx.args['linesChanged'] === 'number' ? (ctx.args['linesChanged'] as number) : undefined,
  };
  const plan = extendReviewers(routeByRisk(signals), signals);
  ctx.bag['riskPlan'] = plan;
  return { continue: true, ctx };
};

/** 默认中间件链：按从外到内的顺序 */
export const DEFAULT_MIDDLEWARES: readonly Middleware[] = [
  toolWhitelistMiddleware,
  shellwardMiddleware,
  autonomyMiddleware,
  processSkillsMiddleware,
  riskRouterMiddleware,
];

/** 统一执行器：链式中间件，全部通过则调用最终业务 */
export async function runWithMiddleware(
  ctx: OrchestratorContext,
  business: (ctx: OrchestratorContext) => Promise<unknown>,
  middlewares: readonly Middleware[] = DEFAULT_MIDDLEWARES,
): Promise<unknown> {
  let current: OrchestratorContext = ctx;
  for (const mw of middlewares) {
    const r = await mw(current);
    if (!r.continue) {
      // 中间件拦截：返回标准 redirect 响应
      return {
        success: false,
        error: r.error,
        blocked_by: `${r.tool}:${r.action}`,
        reason: r.reason,
        next_action: {
          tool: r.tool,
          action: r.action,
          reason: r.reason,
        },
      };
    }
    current = r.ctx;
  }
  return business(current);
}

/** 工具入口：与 unified-handlers 接插 */
export async function orchestratorDispatch(
  tool: string,
  action: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
  business: (ctx: OrchestratorContext) => Promise<unknown>,
): Promise<unknown> {
  return runWithMiddleware({ tool, action, args, workspaceRoot, bag: {} }, business);
}
