/**
 * R12 P6 Plus14 (P1 主链路拆分第14轮) — index.ts thin shell。
 *
 * 借鉴 spec-kit「registry-driven entry」+ agency-orchestrator「middleware chain entry」：
 * 把原 540 行的 index.ts 拆分为 5 个聚焦子模块：
 *   1. workspace-resolver.ts  — workspace 解析 + HOME guard
 *   2. auto-resume.ts         — 跨客户端自动续航
 *   3. manager-bundle.ts      — ManagerBundle 工厂 + 缓存
 *   4. handler-builder.ts     — 8 个 tool handler 构建
 *   5. tool-call.ts           — MCP tool call 调度（含 5 层 gate）
 *
 * 本文件职责：
 *   - 启动时一次性调用：ensureWorkspaceBoot() + autoResumeOnBoot()
 *   - 默认 bundle 构造（向后兼容）
 *   - TOOL_HANDLERS 缓存（向后兼容）
 *   - listTools() / getToolDefinitions() — MCP tools/list
 *   - 重新导出所有公共 API
 *   - 重新导出 tool-orchestrator（向后兼容）
 */

import { getFormattedToolDefinitions, getFormattedToolDefinitionsForStage, validateRegistryConsistency, STAGE_TOOL_GROUPS } from './tool-registry';
import { ensureWorkspaceBoot } from './workspace-resolver';
import { autoResumeOnBoot, type AutoResumeResult } from './auto-resume';
import { createBundle, getBundle, type ManagerBundle } from './manager-bundle';
import { buildHandlers, type ToolHandler } from './handler-builder';
import { handleToolCall } from './tool-call';

import { isUnifiedTool, UNIFIED_WRITE_TOOLS } from './legacy-router';

const workspaceRoot = ensureWorkspaceBoot();
// R10 第1轮：启动时检测是否需要自动续跑（跨客户端/跨会话）
const autoResumeResult: AutoResumeResult = autoResumeOnBoot(workspaceRoot);

const defaultBundle: ManagerBundle = getBundle();
const stateManager = defaultBundle.stateManager;
const strikeSystem = defaultBundle.strikeSystem;
const resumeGenerator = defaultBundle.resumeGenerator;
const simulator = defaultBundle.simulator;
const bridge = defaultBundle.bridge;

const TOOL_HANDLERS: Record<string, ToolHandler> = buildHandlers(defaultBundle);
// RAW_HANDLERS 是 TOOL_HANDLERS 的别名（向后兼容 — 早期版本可能引用 RAW_HANDLERS）
const RAW_HANDLERS = TOOL_HANDLERS;

const REGISTRY_ERRORS = validateRegistryConsistency(TOOL_HANDLERS);
if (REGISTRY_ERRORS.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(
    `[azaloop] tool-registry consistency issues: ${REGISTRY_ERRORS.length}`,
    REGISTRY_ERRORS.slice(0, 5),
  );
}

export function getRegistryErrors(): readonly string[] {
  return REGISTRY_ERRORS;
}

/**
 * MCP tools/list 入口。
 * 完整工具面 vs 阶段范围：
 *   - AZA_AUTO_APPROVE_PRD=true 或 AZA_STAGE_SCOPED_TOOLS!=true → 完整工具面
 *   - 阶段范围：aza_loop+aza_auto 在 stage=open 时被隐藏（避免 next_action 失效）
 */
export function listTools() {
  // Full-auto / unattended: ALWAYS expose the complete tool surface.
  // Stage-scoped lists previously hid aza_loop+aza_auto at stage=open, breaking
  // next_action after aza_prd(approve). Opt-in only via AZA_STAGE_SCOPED_TOOLS=true.
  const autoMode = process.env.AZA_AUTO_APPROVE_PRD === 'true';
  const scoped = process.env.AZA_STAGE_SCOPED_TOOLS === 'true';
  if (autoMode || !scoped) {
    return getFormattedToolDefinitions();
  }

  try {
    const stage =
      process.env.AZA_STAGE ||
      (() => {
        const { resolveWorkspaceRoot } = require('./workspace-resolver') as typeof import('./workspace-resolver');
        const yaml = path.join(resolveWorkspaceRoot(), '.aza', 'STATE.yaml');
        if (!fs.existsSync(yaml)) return undefined;
        const text = fs.readFileSync(yaml, 'utf8');
        const m = text.match(/current_stage:\s*(\w+)/);
        return m?.[1];
      })();
    if (stage && stage !== 'all') {
      return getFormattedToolDefinitionsForStage(stage);
    }
  } catch {
    /* fall through */
  }
  return getFormattedToolDefinitions();
}

/** Alias used by server.ts tools/list */
export function getToolDefinitions() {
  return listTools();
}

// 抑制未使用 import（向后兼容时通过 RAW_HANDLERS 间接使用）
void UNIFIED_WRITE_TOOLS;
void isUnifiedTool;

// 抑制 path/fs 警告（listTools 的 require 动态加载使用 path/fs）
import * as path from 'path';
import * as fs from 'fs';

// 公共 API 重新导出
export {
  getFormattedToolDefinitions,
  getFormattedToolDefinitionsForStage,
  STAGE_TOOL_GROUPS,
  TOOL_HANDLERS,
  RAW_HANDLERS,
  simulator,
  bridge,
  stateManager,
  autoResumeResult,
};
export { handleToolCall, getBundle, createBundle, buildHandlers };
export { resolveWorkspaceRoot, ensureWorkspaceBoot } from './workspace-resolver';
export { autoResumeOnBoot } from './auto-resume';
export type { AutoResumeResult } from './auto-resume';
export type { ManagerBundle } from './manager-bundle';
export type { ToolHandler };

// R10 第11轮 (P2 主编排解耦) — Tool Orchestrator
export {
  runWithMiddleware,
  orchestratorDispatch,
  toolWhitelistMiddleware,
  shellwardMiddleware,
  autonomyMiddleware,
  processSkillsMiddleware,
  riskRouterMiddleware,
  DEFAULT_MIDDLEWARES,
  TOOL_WHITELIST,
} from './orchestrator/tool-orchestrator';
export type {
  OrchestratorContext,
  Middleware,
  MiddlewareResult,
  MiddlewareBlock,
} from './orchestrator/tool-orchestrator';
