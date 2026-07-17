/**
 * R12 P6 Plus14 (P1 主链路拆分第14轮) — Manager Bundle 工厂。
 *
 * 借鉴 agency-orchestrator「dependency bundle」+ comet「worktree-aware context」：
 * 把 index.ts 中 60 行的 createBundle + getBundle + ManagerBundle type 抽出为独立模块。
 *
 * 每个项目根对应一个 ManagerBundle（缓存）：
 * - root / azaDir 基础信息
 * - StateManager / ResumeGenerator 持久化组件
 * - EventBus / StrikeSystem / MCPEventSimulator / MCPEventBridge 运行时组件
 *
 * bundle 通过 Map<root, ManagerBundle> 缓存，多项目（monorepo）自动隔离。
 */
import * as path from 'path';
import * as fs from 'fs';
import { resolveWorkspaceRoot } from './workspace-resolver';
import {
  EventBus,
  StateManager,
  ResumeGenerator,
  StrikeSystem,
  MCPEventSimulator,
  MCPEventBridge,
  registerAllHookHandlers,
  type Stage,
} from '@azaloop/core';

export type ManagerBundle = {
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

/**
 * Create a ManagerBundle for the given project root.
 * Ensures .aza directory exists and registers all hook handlers.
 */
export function createBundle(root: string): ManagerBundle {
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

/**
 * Get or create the ManagerBundle for the given args.
 * Workspace root is resolved from args.
 */
export function getBundle(args?: Record<string, unknown>): ManagerBundle {
  const root = resolveWorkspaceRoot(args);
  let bundle = bundles.get(root);
  if (!bundle) {
    bundle = createBundle(root);
    bundles.set(root, bundle);
  }
  return bundle;
}

/** Clear all bundles (used for cache invalidation / testing) */
export function clearAllBundles(): void {
  bundles.clear();
}
