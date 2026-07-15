import { getFormattedToolDefinitions, getFormattedToolDefinitionsForStage, STAGE_TOOL_GROUPS, validateRegistryConsistency } from './tool-registry';
import { resolveToolCall, UNIFIED_WRITE_TOOLS, isUnifiedTool } from './legacy-router';
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

import {
  MCPEventBridge,
  MCPEventSimulator,
  EventBus,
  StateManager,
  StrikeSystem,
  ResumeGenerator,
  registerAllHookHandlers,
  checkStageTool,
} from '@azaloop/core';
import type { Stage } from '@azaloop/core';
import * as path from 'path';
import * as fs from 'fs';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Resolve the project workspace. Cursor user-level MCP often starts with cwd=HOME,
 * which previously wrote OpenSpec into ~/openspec and .aza into ~/.aza — appearing
 * as "azaloop not taking effect" in the repo.
 */
export function resolveWorkspaceRoot(args?: Record<string, unknown>): string {
  const fromArgs = typeof args?.workspace_path === 'string' ? args.workspace_path.trim() : '';
  const fromEnv = (process.env.AZA_WORKSPACE || process.env.AZA_PROJECT_ROOT || '').trim();
  let raw = fromArgs || fromEnv || process.cwd();
  raw = path.resolve(raw);

  // Reject HOME / user profile as workspace unless explicitly forced
  const home = path.resolve(process.env.USERPROFILE || process.env.HOME || '');
  const forceHome = process.env.AZA_ALLOW_HOME_WORKSPACE === 'true';
  if (!forceHome && home && path.resolve(raw) === home) {
    // Prefer AZA_WORKSPACE if set; otherwise look for a nearby project marker
    const markers = ['.aza', 'openspec', 'package.json', 'pnpm-workspace.yaml'];
    const candidates = [
      process.env.AZA_WORKSPACE,
      process.env.AZA_PROJECT_ROOT,
      // Walk up from process.cwd() is already home — no-op; require explicit path
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      const resolved = path.resolve(c);
      if (resolved !== home) return resolved;
    }
    // Soft fail: still return home but stamp a warning via env for health checks
    process.env.AZA_WORKSPACE_WARNING = 'workspace_resolved_to_home';
  }
  return raw;
}

function ensureWorkspaceBoot(): string {
  const root = resolveWorkspaceRoot();
  try {
    if (path.resolve(process.cwd()) !== root && fs.existsSync(root)) {
      process.chdir(root);
    }
  } catch {
    /* best-effort */
  }
  const azaDir = path.join(root, '.aza');
  try {
    fs.mkdirSync(azaDir, { recursive: true });
  } catch {
    /* best-effort */
  }
  return root;
}

const workspaceRoot = ensureWorkspaceBoot();

type ManagerBundle = {
  root: string;
  azaDir: string;
  stateManager: StateManager;
  resumeGenerator: ResumeGenerator;
  eventBus: EventBus;
  strikeSystem: StrikeSystem;
  simulator: MCPEventSimulator;
  bridge: MCPEventBridge;
};

const bundles = new Map<string, ManagerBundle>();

function createBundle(root: string): ManagerBundle {
  const azaDir = path.join(root, '.aza');
  try {
    fs.mkdirSync(azaDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const eventBus = new EventBus();
  const stateManager = new StateManager(azaDir);
  const strikeSystem = new StrikeSystem();
  const resumeGenerator = new ResumeGenerator(azaDir);
  const simulator = new MCPEventSimulator(eventBus, stateManager, resumeGenerator, strikeSystem);
  const bridge = new MCPEventBridge(simulator, {
    stageResolver: async () => {
      try {
        const fileState = await stateManager.load();
        return (fileState.pipeline.current_stage as Stage) || 'open';
      } catch {
        return 'open';
      }
    },
    workspaceRoot: root,
  });
  registerAllHookHandlers(eventBus, stateManager, resumeGenerator);
  return {
    root,
    azaDir,
    stateManager,
    resumeGenerator,
    eventBus,
    strikeSystem,
    simulator,
    bridge,
  };
}

function getBundle(args?: Record<string, unknown>): ManagerBundle {
  const root = resolveWorkspaceRoot(args);
  let bundle = bundles.get(root);
  if (!bundle) {
    bundle = createBundle(root);
    bundles.set(root, bundle);
  }
  return bundle;
}

const defaultBundle = getBundle();
const stateManager = defaultBundle.stateManager;
const strikeSystem = defaultBundle.strikeSystem;
const resumeGenerator = defaultBundle.resumeGenerator;
const simulator = defaultBundle.simulator;
const bridge = defaultBundle.bridge;

function buildHandlers(bundle: ManagerBundle): Record<string, ToolHandler> {
  const raw: Record<string, ToolHandler> = {
    aza_session: (args) => handleAzaSession(args, getBundle(args).stateManager),
    aza_prd: (args) => {
      const b = getBundle(args);
      // Always stamp workspace_path so OpenSpec/contract land in the project, not HOME.
      const merged = {
        ...args,
        workspace_path: resolveWorkspaceRoot(args),
      };
      return handleAzaPrd(merged, b.stateManager, b.resumeGenerator);
    },
    aza_auto: (args) => {
      const b = getBundle(args);
      const merged = {
        ...args,
        workspace_path: resolveWorkspaceRoot(args),
      };
      return handleAzaAuto(merged, b.stateManager, b.resumeGenerator);
    },
    aza_loop: (args) =>
      handleAzaLoop({
        ...args,
        workspace_path: resolveWorkspaceRoot(args),
      }),
    aza_spec: (args) =>
      handleAzaSpec({
        ...args,
        workspace_path: resolveWorkspaceRoot(args),
      }),
    aza_quality: (args) =>
      handleAzaQuality({
        ...args,
        workspace_path: resolveWorkspaceRoot(args),
        project_root: resolveWorkspaceRoot(args),
      }),
    aza_finish: (args) => {
      const b = getBundle(args);
      return handleAzaFinish(
        { ...args, workspace_path: resolveWorkspaceRoot(args) },
        b.stateManager,
        b.resumeGenerator,
      );
    },
    aza_memory: (args) =>
      handleAzaMemory({
        ...args,
        workspace_path: resolveWorkspaceRoot(args),
      }),
    aza_meta: (args) =>
      handleAzaMeta({
        ...args,
        workspace_path: resolveWorkspaceRoot(args),
      }),
  };

  return Object.fromEntries(
    Object.entries(raw).map(([name, handler]) => [
      name,
      bundle.bridge.wrapTool(name, handler as any) as ToolHandler,
    ]),
  );
}

const TOOL_HANDLERS: Record<string, ToolHandler> = buildHandlers(defaultBundle);
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

const CALL_HISTORY: string[] = [];

export async function handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const resolved = resolveToolCall(toolName, args);
  const canonical = resolved.tool;
  const bundle = getBundle(resolved.args);
  // Re-wrap against the correct workspace bridge when agents pass workspace_path
  const handlers = buildHandlers(bundle);
  const handler = handlers[canonical] || TOOL_HANDLERS[canonical];

  if (!handler) {
    return { success: false, error: `Unknown tool: ${toolName}`, data: null };
  }

  let currentStage: Stage = 'open';
  try {
    const fileState = await bundle.stateManager.load();
    currentStage = (fileState.pipeline.current_stage as Stage) || 'open';
  } catch {
    // default open
  }

  const guardResult = checkStageTool(canonical, currentStage, CALL_HISTORY);
  if (!guardResult.allowed) {
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

  CALL_HISTORY.push(canonical);
  if (CALL_HISTORY.length > 50) CALL_HISTORY.shift();

  void UNIFIED_WRITE_TOOLS;
  void isUnifiedTool;
  void workspaceRoot;

  try {
    return await handler(resolved.args);
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
      data: null,
    };
  }
}

export function listTools() {
  // P2-1: prefer stage-scoped tool list when AZA_STAGE / STATE stage is known
  try {
    const stage =
      process.env.AZA_STAGE ||
      (() => {
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

export {
  getFormattedToolDefinitions,
  getFormattedToolDefinitionsForStage,
  STAGE_TOOL_GROUPS,
  TOOL_HANDLERS,
  RAW_HANDLERS,
  simulator,
  bridge,
  stateManager,
};
