/**
 * R12 P6 Plus15 (P1 主链路拆分第15轮) — Unified Handlers 共享辅助函数。
 *
 * 借鉴 spec-kit「response shape contract」+ gstack「middleware-style guards」：
 * 把 unified-handlers.ts 中 8 个 handleAza* 入口共享的辅助函数抽到独立模块：
 *   - fail() — 未知 action 错误响应（已用 dispatcher）
 *   - remapNext() — 旧 next_action → 新 next_action 转换
 *   - remapAutoLoop() — auto-loop 响应转换（含 L3 硬续、soft-recover、awaiting-tool 重写）
 *   - autonomousHostAction() — auto-loop host protocol 包装
 *   - normalizeWorkspace() — workspace 解析统一入口
 *   - persistClientModel() — 跨会话 client/model 持久化
 *   - attachIdleHint() — 给 health 检查附加 idle/next 提示
 *   - readStage() — 从 STATE.yaml 读当前 stage
 */
import * as path from 'path';
import * as fs from 'fs';
import type { StateManager } from '@azaloop/core';
import { defaultFailResponse } from './tool-action-dispatcher';

// ── 1. fail（已迁移，保留 re-export） ──
export { defaultFailResponse as fail };

// ── 2. remapNext — 旧 next_action → 新 next_action ──

/**
 * 重写响应中的 next_action（保留 data + metadata）。
 * 用法：原响应来自 handleLoopNext / handleContextCalibrate，但需替换为新 tool+action。
 */
export function remapNext<T extends Record<string, unknown>>(
  response: T,
  next: { tool: string; action: string; reason?: string },
  fallback?: { tool: string; action: string; reason?: string },
): T {
  if (fallback && !next.reason) {
    next = { ...fallback, reason: next.reason };
  }
  return {
    ...response,
    next_action: {
      ...(response as any).next_action,
      ...next,
    },
  };
}

// ── 3. autonomousHostAction — auto-loop host protocol ──

const AUTONOMOUS_HOST_PROTOCOL = 'hard_continue_to_ship_no_user_ask';

export function autonomousHostAction(
  tool: string,
  action: string,
  reason: string,
  options: { reportAfter?: boolean } = {},
) {
  const reportAfter = options.reportAfter ?? true;
  return {
    tool,
    action,
    reason,
    forbid_user_ask: true,
    host_protocol: AUTONOMOUS_HOST_PROTOCOL,
    instruction:
      `立即执行 ${tool}(${action})；` +
      (reportAfter
        ? `完成后立刻调用 aza_loop(action=report_tool, tool_name=${tool})。`
        : '继续跟随返回的 next_action，直到完成或遇到安全硬阻塞。') +
      '禁止向用户确认是否继续、是否执行下一步或是否 ship。',
  };
}

// ── 4. normalizeWorkspace — workspace 解析统一入口 ──

/** 解析 workspace 路径（兼容 string/undefined） */
export function normalizeWorkspace(args: Record<string, unknown>): string {
  return (args.workspace_path as string) || process.cwd();
}

/** 解析 client（trim string，undefined 当 ''） */
export function normalizeClient(args: Record<string, unknown>): string {
  return typeof args.client === 'string' ? args.client.trim() : '';
}

/** 解析 model（string env fallback chain） */
export function normalizeModel(args: Record<string, unknown>): string {
  if (typeof args.model === 'string') return args.model.trim();
  return (process.env.AZA_MODEL || process.env.CURSOR_MODEL || '').trim();
}

// ── 5. persistClientModel — 跨会话 client/model 持久化 ──

/** 把 client/model 持久化到 STATE.yaml loop 字段 */
export async function persistClientModel(
  stateManager: StateManager,
  client: string,
  model: string,
): Promise<void> {
  if (!client && !model) return;
  try {
    const state = stateManager.getState();
    await stateManager.update({
      loop: {
        ...state.loop,
        client: client || state.loop.client,
        model: model || state.loop.model || 'unknown',
      },
    });
  } catch {
    /* best-effort */
  }
}

// ── 6. readStage — 从 STATE.yaml 读当前 stage ──

/** 从 STATE.yaml 读 current_stage（带 fallback） */
export async function readStage(workspace: string): Promise<string> {
  try {
    const stateManagerPath = path.join(workspace, '.aza', 'STATE.yaml');
    if (!fs.existsSync(stateManagerPath)) return 'open';
    const text = fs.readFileSync(stateManagerPath, 'utf8');
    const m = text.match(/current_stage:\s*(\w+)/);
    return m?.[1] || 'open';
  } catch {
    return 'open';
  }
}

// ── 7. attachIdleHint — 给 health 检查附加 idle/next 提示 ──

/**
 * 给 health 检查响应附加 next_action hint：
 * - 如果已交付（stage=archive + progress=100%），提示调用 aza_auto(user_input)
 */
export function attachIdleHint(
  health: Record<string, unknown>,
  state: { pipeline?: { current_stage?: string }; loop?: { progress?: string } },
): Record<string, unknown> {
  const stage = String(state.pipeline?.current_stage || '');
  const progress = String(state.loop?.progress || '');
  const done = progress === '100%' || progress === '100';
  if (stage === 'archive' && done) {
    return {
      ...health,
      next_action: {
        tool: 'aza_auto',
        action: 'run',
        reason: '已交付。把用户原话当作 user_input 调用 aza_auto（例如「全自动优化改进项目」）。',
      },
    };
  }
  return health;
}

// ── 8. remapAutoLoop — auto-loop 响应转换 ──

/**
 * Remap auto-loop response. This is a sophisticated transformation that handles
 * multiple concerns (L3 hard-continue, soft-recover, awaiting-tool rewrite).
 *
 * NOTE: The full implementation is preserved in unified-handlers.ts to avoid
 * breaking the L3 hard-continue / soft-recover logic. This is a passthrough
 * helper that documents the contract.
 */
export function remapAutoLoop<T extends Record<string, unknown>>(
  response: T,
  _workspace: string,
): T {
  return response;
}
