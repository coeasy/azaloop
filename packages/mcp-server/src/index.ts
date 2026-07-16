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
  detectClient,
  detectClientSwitch,
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
 *
 * R10 第1轮 (D8)：修复 HOME 软失败 — 不再静默落到 HOME，而是向上查找项目标记。
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
    // Walk up from cwd looking for project markers (.aza, openspec, package.json, etc.)
    const markers = ['.aza', 'openspec', 'package.json', 'pnpm-workspace.yaml'];
    let dir = process.cwd();
    for (let i = 0; i < 10; i++) {
      for (const m of markers) {
        if (fs.existsSync(path.join(dir, m))) {
          return path.resolve(dir);
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break; // reached root
      dir = parent;
    }
    // Hard fail: refuse to write into HOME without explicit override
    throw new Error(
      `[azaloop] workspace resolved to HOME ("${home}"). Set AZA_WORKSPACE=<project-path> ` +
      `or run MCP from the project directory. To allow HOME, set AZA_ALLOW_HOME_WORKSPACE=true.`,
    );
  }
  return raw;
}

function ensureWorkspaceBoot(): string {
  let root: string;
  try {
    root = resolveWorkspaceRoot();
  } catch (err) {
    // R10 D8: workspace resolution failed (HOME guard) — log and fall back to cwd
    console.error(String(err));
    root = process.cwd();
  }
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

/**
 * R10 第1轮：跨客户端自动续航触发器
 *
 * 在 MCP 服务器启动时调用。读取 RESUME.md，判断是否需要自动续跑：
 * 1. 若存在有效 resume 且非终态 → 返回续跑指令（供宿主 AI 执行）
 * 2. 检测客户端切换，记录到 run-ledger
 * 3. 若版本不兼容 → 返回 restart 指令
 *
 * 该函数不直接执行循环（避免阻塞 MCP 启动），而是返回结构化结果，
 * 由宿主 AI 或 MCP tool handler 决定是否调用 aza_session(continue) + aza_loop(full)。
 */
export interface AutoResumeResult {
  should_resume: boolean;
  action: 'resume' | 'restart' | 'noop';
  reason: string;
  client_switched: boolean;
  previous_client: string;
  current_client: string;
  resume_stage: string | null;
  resume_iteration: number;
  next_tool: string | null;
  next_action: string | null;
}

export function autoResumeOnBoot(root?: string): AutoResumeResult {
  const wsRoot = root || resolveWorkspaceRoot();
  const azaDir = path.join(wsRoot, '.aza');
  const currentClient = detectClient().name;

  const noop: AutoResumeResult = {
    should_resume: false,
    action: 'noop',
    reason: 'No resume needed',
    client_switched: false,
    previous_client: 'unknown',
    current_client: currentClient,
    resume_stage: null,
    resume_iteration: 0,
    next_tool: null,
    next_action: null,
  };

  // Synchronously read RESUME.md (sync for boot — avoid async at module load)
  const resumePath = path.join(azaDir, 'RESUME.md');
  if (!fs.existsSync(resumePath)) {
    return noop;
  }

  try {
    const content = fs.readFileSync(resumePath, 'utf8');
    // Quick parse YAML frontmatter
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm || !fm[1]) return noop;
    const data: Record<string, string> = {};
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m && m[1]) {
        let v = (m[2] || '').trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        data[m[1]] = v;
      }
    }
    if (!data.stage && !data.next_tool) return noop;

    const stage = data.stage || 'open';
    const iteration = parseInt(data.iteration || '0', 10);
    const resumeClient = data.client || 'unknown';
    const nextTool = data.next_tool || 'aza_loop';
    const nextAction = data.next_action || 'full';
    const progress = data.progress || '0%';
    const engineVersion = data.engine_version || '0';

    // Terminal state check
    const isTerminal = stage === 'archive' &&
      (nextAction === 'done' || nextAction === 'ship' || progress === '100%');
    const isFresh = stage === 'open' && iteration === 0;
    if (isTerminal || isFresh) return noop;

    // Version compatibility
    const resumeMajor = engineVersion.split('.')[0];
    const engineMajor = '0'; // AZALOOP_ENGINE_VERSION = '0.1.0'
    if (resumeMajor !== engineMajor) {
      return {
        ...noop,
        action: 'restart',
        reason: `Engine version mismatch: resume=${engineVersion} vs current=0.1.0`,
      };
    }

    // Client switch detection
    const switchResult = detectClientSwitch(resumeClient);

    return {
      should_resume: true,
      action: 'resume',
      reason: switchResult.switched
        ? `Auto-resume: ${resumeClient}→${currentClient}, stage=${stage} (iter ${iteration})`
        : `Auto-resume: stage=${stage} (iter ${iteration})`,
      client_switched: switchResult.switched,
      previous_client: resumeClient,
      current_client: currentClient,
      resume_stage: stage,
      resume_iteration: iteration,
      next_tool: nextTool,
      next_action: nextAction,
    };
  } catch {
    return noop;
  }
}

const workspaceRoot = ensureWorkspaceBoot();
// R10 第1轮：启动时检测是否需要自动续跑（跨客户端/跨会话）
const autoResumeResult = autoResumeOnBoot(workspaceRoot);

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
  autoResumeResult,
};
