/**
 * R12 P6 Plus14 (P1 主链路拆分第14轮) — Tool Handler 构建器。
 *
 * 借鉴 spec-kit「tool registry」+ agency-orchestrator「handler wrapping」：
 * 把 index.ts 中 60 行的 buildHandlers 抽出为独立模块。
 *
 * 8 个 MCP tool 的 handler 构造：
 * - 注入 workspace_path（避免 OpenSpec 写到 HOME）
 * - 用 bundle.bridge.wrapTool() 包装（注入事件桥）
 * - 提取 getBundle() / resolveWorkspaceRoot() 依赖，便于单测 mock
 */
import {
  handleAzaSession,
  handleAzaPrd,
  handleAzaAuto,
  handleAzaLoop,
  handleAzaSpec,
  handleAzaQuality,
  handleAzaFinish,
  handleAzaMemory,
  handleAzaMeta,
} from './unified-handlers';
import type { ManagerBundle } from './manager-bundle';
import { getBundle } from './manager-bundle';
import { resolveWorkspaceRoot } from './workspace-resolver';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * 注入 workspace_path 并解决 OPENSPEC 写到 HOME 的问题。
 * 所有 handler 必须通过此函数包装。
 */
export function injectWorkspacePath(args: Record<string, unknown>): Record<string, unknown> {
  return { ...args, workspace_path: resolveWorkspaceRoot(args) };
}

/**
 * Build the 8 MCP tool handlers for the given bundle.
 * Each handler is wrapped with bundle.bridge.wrapTool() for event bridging.
 */
export function buildHandlers(bundle: ManagerBundle): Record<string, ToolHandler> {
  const raw: Record<string, ToolHandler> = {
    aza_session: (args) => handleAzaSession(args, getBundle(args).stateManager),
    aza_prd: (args) => {
      const b = getBundle(args);
      // Always stamp workspace_path so OpenSpec/contract land in the project, not HOME.
      const merged = injectWorkspacePath(args);
      return handleAzaPrd(merged, b.stateManager, b.resumeGenerator);
    },
    aza_auto: (args) => {
      const b = getBundle(args);
      const merged = injectWorkspacePath(args);
      return handleAzaAuto(merged, b.stateManager, b.resumeGenerator);
    },
    aza_loop: (args) => handleAzaLoop(injectWorkspacePath(args)),
    aza_spec: (args) => handleAzaSpec(injectWorkspacePath(args)),
    aza_quality: (args) => {
      const merged = {
        ...injectWorkspacePath(args),
        project_root: resolveWorkspaceRoot(args),
      };
      return handleAzaQuality(merged);
    },
    aza_finish: (args) => {
      const b = getBundle(args);
      return handleAzaFinish(injectWorkspacePath(args), b.stateManager, b.resumeGenerator);
    },
    aza_memory: (args) => handleAzaMemory(injectWorkspacePath(args)),
    aza_meta: (args) => handleAzaMeta(injectWorkspacePath(args)),
  };

  return Object.fromEntries(
    Object.entries(raw).map(([name, handler]) => [
      name,
      bundle.bridge.wrapTool(name, handler as any) as ToolHandler,
    ]),
  );
}
