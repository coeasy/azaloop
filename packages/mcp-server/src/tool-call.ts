/**
 * R12 P6 Plus14 (P1 主链路拆分第14轮) — Tool Call 调度器。
 *
 * 借鉴 spec-kit「middleware-style guards」+ OpenSpec「gate chain」+ agency-orchestrator「dispatcher」：
 * 把 index.ts 中 110 行的 handleToolCall 抽出为独立模块。
 *
 * 调度链：
 * 1. resolveToolCall() — 旧 tool name 路由到新 tool
 * 2. getBundle() — 解析 workspace + 加载 bundle
 * 3. buildHandlers() — 构建 8 个 tool handler
 * 4. checkStageTool() — stage guard（防止在 design 阶段调用 implement）
 * 5. assertShellwardPreTool() — DLP 预扫（默认启用）
 * 6. checkAutonomyGate() — autonomy 硬门（L1 禁 / L2 ship 必 quality）
 * 7. checkProcessSkillsGate() — skills 硬门（implement 必 design+plan，ship 必 quality）
 * 8. handler() — 实际执行
 * 9. 错误捕获 → 统一 { success: false, error } 响应
 */
import * as path from 'path';
import * as fs from 'fs';
import {
  checkStageTool,
  assertShellwardPreTool,
  checkAutonomyGate,
  checkProcessSkillsGate,
  type Stage,
} from '@azaloop/core';
import { resolveToolCall, UNIFIED_WRITE_TOOLS, isUnifiedTool } from './legacy-router';
import { resolveWorkspaceRoot } from './workspace-resolver';
import { getBundle } from './manager-bundle';
import { buildHandlers, type ToolHandler } from './handler-builder';
import { TOOL_HANDLERS } from './index';

/** call history 缓存（最多 50 条，循环复用） */
const CALL_HISTORY: string[] = [];

/** 记录一次 tool call（用于 stage guard 历史） */
function recordCall(toolName: string): void {
  CALL_HISTORY.push(toolName);
  if (CALL_HISTORY.length > 50) CALL_HISTORY.shift();
}

/** 构造 stage guard 失败响应 */
function stageGuardResponse(guardResult: ReturnType<typeof checkStageTool>, bundle: ReturnType<typeof getBundle>) {
  if (guardResult.redFlag) {
    bundle.strikeSystem.record(
      'red_flag',
      `Red Flag ${guardResult.redFlag.id}: ${guardResult.reason}`,
      0,
    );
  }
  return {
    success: false,
    error: guardResult.reason,
    data: null,
    next_action: {
      tool: guardResult.redirectTool || 'aza_loop',
      action: 'full',
      reason: guardResult.reason,
    },
  };
}

/** 构造 shellward 失败响应 */
function shellwardResponse(err: unknown) {
  return {
    success: false,
    error: err instanceof Error ? err.message : String(err),
    data: null,
    next_action: {
      tool: 'aza_meta',
      action: 'dlp_scan',
      reason: 'ShellWard blocked tool args — sanitize payload or set AZA_SHELLWARD=0 to bypass',
    },
  };
}

/** 构造 autonomy gate 失败响应 */
function autonomyGateResponse(autoGate: ReturnType<typeof checkAutonomyGate>) {
  return {
    success: false,
    error: autoGate.reason,
    data: { autonomy_level: autoGate.level },
    next_action: autoGate.redirect || {
      tool: 'aza_meta',
      action: 'loop_ready',
      reason: autoGate.reason || 'autonomy gate',
    },
  };
}

/** 构造 process skills gate 失败响应 */
function skillGateResponse(skillGate: ReturnType<typeof checkProcessSkillsGate>) {
  return {
    success: false,
    error: skillGate.reason,
    data: { skill: skillGate.skill },
    next_action: skillGate.redirect || {
      tool: 'aza_spec',
      action: 'design',
      reason: skillGate.reason || 'process skill gate',
    },
  };
}

/** 构造 unknown tool 错误响应 */
function unknownToolResponse(toolName: string) {
  return { success: false, error: `Unknown tool: ${toolName}`, data: null };
}

/** 构造 handler 异常响应 */
function handlerErrorResponse(err: unknown) {
  return {
    success: false,
    error: err instanceof Error ? err.message : String(err),
    data: null,
  };
}

/** 解析当前 stage（从 STATE.yaml） */
async function resolveCurrentStage(bundle: ReturnType<typeof getBundle>): Promise<Stage> {
  let currentStage: Stage = 'open';
  try {
    const fileState = await bundle.stateManager.load();
    currentStage = (fileState.pipeline.current_stage as Stage) || 'open';
  } catch {
    // default open
  }
  return currentStage;
}

/**
 * MCP tool call 统一调度入口。
 * 应用 5 层 gate 后调用对应 handler。
 */
export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const resolved = resolveToolCall(toolName, args);
  const canonical = resolved.tool;
  const bundle = getBundle(resolved.args);
  // Re-wrap against the correct workspace bridge when agents pass workspace_path
  const handlers = buildHandlers(bundle);
  const handler: ToolHandler | undefined = handlers[canonical] || TOOL_HANDLERS[canonical];

  if (!handler) {
    return unknownToolResponse(toolName);
  }

  // ── Gate 1: stage guard ──
  const currentStage = await resolveCurrentStage(bundle);
  const guardResult = checkStageTool(canonical, currentStage, CALL_HISTORY);
  if (!guardResult.allowed) {
    return stageGuardResponse(guardResult, bundle);
  }

  // ── Gate 2: shellward DLP ──
  const shellwardOff =
    process.env.AZA_SHELLWARD === '0' || process.env.AZA_SHELLWARD === 'false';
  if (!shellwardOff) {
    try {
      assertShellwardPreTool(canonical, resolved.args as Record<string, unknown>);
    } catch (err) {
      return shellwardResponse(err);
    }
  }

  // ── Gate 3: autonomy gate ──
  const action = String((resolved.args as Record<string, unknown>).action ?? '');
  const wsRoot = resolveWorkspaceRoot(resolved.args as Record<string, unknown>);
  const autoGate = checkAutonomyGate(wsRoot, canonical, action, {
    qualityPassed: fs.existsSync(path.join(wsRoot, '.aza', 'quality-passed.marker')),
  });
  if (!autoGate.allowed) {
    return autonomyGateResponse(autoGate);
  }

  // ── Gate 4: process skills gate ──
  const skillGate = checkProcessSkillsGate(wsRoot, canonical, action);
  if (!skillGate.allowed) {
    return skillGateResponse(skillGate);
  }

  recordCall(canonical);

  // unused imports 抑制
  void UNIFIED_WRITE_TOOLS;
  void isUnifiedTool;

  // ── 实际调用 ──
  try {
    return await handler(resolved.args);
  } catch (err) {
    return handlerErrorResponse(err);
  }
}
