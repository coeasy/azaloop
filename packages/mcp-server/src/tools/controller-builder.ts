/**
 * R12 P6 Plus23 — aza-loop.ts 抽离 buildController/buildDriver/buildScheduler + 4 个 cache 变量
 *
 * 借鉴 Trellis「resource factory cluster」+ gstack「controller builder cluster」:
 *
 * 痛点：aza-loop.ts 510 行；buildController (130 行) + buildDriver (32 行) +
 *       buildScheduler (30 行) + seedOuterBoardFromPrd (66 行) + 4 个 cache 变量
 *       全部内联在主文件中，与 10 个 handleLoop* handler 混在一起。
 *
 * 解法：把 controller/driver/scheduler 3 个 builder + 4 个 cache 变量 +
 *       seedOuterBoardFromPrd 抽到 controller-builder.ts：
 *   - export CACHES         — { controllerCache, driverCache, schedulerCache, stateMtimeCache, allCaches }
 *   - export buildController(projectRoot, client)
 *   - export buildDriver(projectRoot, client)
 *   - export buildScheduler(projectRoot, client)
 *   - export seedOuterBoardFromPrd(root, lc) (内部 helper)
 *
 * 目标：aza-loop.ts < 350 行；handleLoop* 10 个 handler + handleAutoLoop 占据主体。
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  LoopController,
  AutoLoopDriver,
  AutoLoopScheduler,
  ConfigLoader,
  createDefaultStoryProvider,
  createDefaultHumanGate,
  createDefaultCommit,
} from '@azaloop/core';
import { dispatchAction, normalizeRoot } from './aza-loop-actions';
import {
  cacheKey,
  stateYamlMtime,
  getOrBuild,
  clearRootCaches,
  clearAllCaches,
} from './loop-cache';

// ── 4 个 cache 变量 + allCaches ──

const controllerCache = new Map<string, LoopController>();
const driverCache = new Map<string, AutoLoopDriver>();
const schedulerCache = new Map<string, AutoLoopScheduler>();
/** Track STATE.yaml mtime so cross-session/cross-client writes invalidate cache. */
const stateMtimeCache = new Map<string, number>();
/** 级联失效列表：controller 失效时同时清空 driver/scheduler（反之亦然） */
const allCaches = [controllerCache, driverCache, schedulerCache, stateMtimeCache];

export const CACHES = {
  controller: controllerCache,
  driver: driverCache,
  scheduler: schedulerCache,
  stateMtime: stateMtimeCache,
  all: allCaches,
};

// ── seedOuterBoardFromPrd (内部 helper) ──

/**
 * Populate outer.board from .aza/prd.json and/or openspec/changes when empty.
 *
 * 修复 9.8.4-1 根因：必须先加载磁盘真实状态再写。否则新建控制器的
 * StateManager 还持有默认 open/pending 状态，sm.update 会把跨会话恢复的
 * 真实进度（如 build:in_progress/blocked）整体覆盖成默认态，导致无限
 * escalated/秒回。改为先 await sm.load() 再合并，仅当 outer.board 为空时补充。
 */
async function seedOuterBoardFromPrd(root: string, lc: LoopController): Promise<void> {
  const sm = lc.stateManager;
  if (!sm) return;
  // 关键：先加载磁盘真实状态，避免用默认态覆盖已恢复进度
  try {
    await sm.load();
  } catch {
    /* best-effort */
  }
  const state = (sm.getState?.() as any) || {};
  const board = state.loops?.outer?.board;
  // Active work — do not touch
  if (board?.pending?.length || board?.in_progress?.length) return;
  // Already finished stories on board — do not resurrect into pending
  if (board?.done?.length) return;

  const ids: string[] = [];

  // Prefer PRD stories
  const prdPath = path.join(root, '.aza', 'prd.json');
  if (fs.existsSync(prdPath)) {
    try {
      const prd = JSON.parse(fs.readFileSync(prdPath, 'utf8'));
      const stories = Array.isArray(prd.stories) ? prd.stories : [];
      for (const s of stories) {
        const id = String(s.id || s.title || '').trim();
        if (id) ids.push(id);
      }
    } catch {
      /* ignore */
    }
  }

  // Also seed from openspec/changes/*/tasks.md change ids
  const changesDir = path.join(root, 'openspec', 'changes');
  if (fs.existsSync(changesDir)) {
    try {
      const dirs = fs.readdirSync(changesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== 'archive')
        .map((d) => d.name);
      for (const name of dirs) {
        const changeId = `openspec:${name}`;
        if (!ids.includes(changeId) && !ids.includes(name)) ids.push(changeId);
      }
    } catch {
      /* ignore */
    }
  }

  if (ids.length < 2) return;
  const current = state.loop?.current_story || ids[0];
  const pending = ids.filter((id: string) => id !== current);
  void sm.update?.({
    loops: {
      ...state.loops,
      outer: {
        ...(state.loops?.outer || {}),
        board: {
          pending,
          in_progress: current ? [current] : [],
          done: [],
          blocked: [],
        },
      },
    },
  });
}

// ── buildController ──

/**
 * P0-2: Singleton LoopController cache via Mtime-aware LoopCache.
 * Each project root has one cached LoopController instance.
 * This ensures state machine continuity across MCP tool calls
 * within the same session, while allowing different projects
 * to have independent controllers.
 */
export function buildController(projectRoot: string, client?: string): LoopController {
  const root = normalizeRoot(projectRoot);
  const key = cacheKey(root, client);
  const mtime = stateYamlMtime(root);

  return getOrBuild(key, mtime, stateMtimeCache, {
    name: 'controller',
    cache: controllerCache,
    // 级联失效：controller 失效时同时清空 driver/scheduler，确保三 cache 强一致
    cascadeCaches: [driverCache as Map<string, unknown>, schedulerCache as Map<string, unknown>],
    build: () => {
      const azaDir = path.join(root, '.aza');
      const loader = new ConfigLoader(root);
      // R11: 真实读取 azaloop.yaml（loadSync 会解析文件；缺失则回退默认）
      const config = loader.loadSync();
      const outerEnabled =
        (config as any).loop?.outer_enabled !== false &&
        process.env.AZA_OUTER_LOOP !== 'false';
      // R10: maxStageIterations 配置化（9.8.4-2）。优先级：AZA_MAX_STAGE_ITERATIONS 环境变量 > azaloop.yaml loop.max_stage_iterations > 默认 20
      const envMaxStage = Number(process.env.AZA_MAX_STAGE_ITERATIONS);
      const maxStageIterations =
        Number.isFinite(envMaxStage) && envMaxStage > 0
          ? envMaxStage
          : Number((config as any).loop?.max_stage_iterations) || 20;

      const lc = new LoopController({
        projectRoot: root,
        azaDir,
        config,
        outerEnabled,
        maxStageIterations,
        autonomyLevel: (config as any).loop?.autonomy_level || 'L2',
      } as any);
      (lc as any).configLoopOptions = { azaDir, projectRoot: root, config };
      void dispatchAction; // keep import referenced; dispatcher is invoked in handleAutoLoop/handler side
      // Wire default OuterLoop callbacks for sequential story batch (board advance)
      if (outerEnabled && lc.stateManager) {
        const sm = lc.stateManager;
        lc.setOuterLoopCallbacks({
          storyProvider: createDefaultStoryProvider(sm),
          humanGate: createDefaultHumanGate(sm),
          commit: createDefaultCommit(sm),
        });
      }
      // Seed outer board from PRD stories when empty (async fire-and-forget;
      // loads disk state first so it never clobbers recovered progress — 9.8.4-1)
      void seedOuterBoardFromPrd(root, lc).catch(() => {
        /* best-effort */
      });
      return lc;
    },
  });
}

// ── buildDriver (P0-4: MCP AutoLoopDriver integration) ──

export function buildDriver(projectRoot: string, client?: string): AutoLoopDriver {
  const root = normalizeRoot(projectRoot);
  const key = cacheKey(root, client);
  const mtime = stateYamlMtime(root);

  return getOrBuild(key, mtime, stateMtimeCache, {
    name: 'driver',
    cache: driverCache,
    // 级联失效：driver 失效时同时清空 controller/scheduler（强一致）
    cascadeCaches: [controllerCache as Map<string, unknown>, schedulerCache as Map<string, unknown>],
    build: () => {
      const lc = buildController(root, client);
      return new AutoLoopDriver(lc, {
        maxIterations: 50,
        enableSentinelDetection: true,
        onPrdReview: async (_stage) => {
          // Respect unattended flag — do not hard-code approve
          const auto = process.env.AZA_AUTO_APPROVE_PRD === 'true';
          return {
            approved: auto,
            feedback: auto
              ? 'Auto-approved via AZA_AUTO_APPROVE_PRD'
              : 'PRD review requires aza_prd(approve) or AZA_AUTO_APPROVE_PRD=true',
          };
        },
        onEscalate: async (reason, stage) => {
          // Log escalation but don't crash — let the caller handle it
          console.warn(`[AutoLoopDriver] Escalated at stage "${stage}": ${reason}`);
        },
      });
    },
  });
}

// ── buildScheduler (V16: AutoLoopScheduler background auto-loop) ──

export function buildScheduler(projectRoot: string, client?: string): AutoLoopScheduler {
  const root = normalizeRoot(projectRoot);
  const key = cacheKey(root, client);
  const mtime = stateYamlMtime(root);

  return getOrBuild(key, mtime, stateMtimeCache, {
    name: 'scheduler',
    cache: schedulerCache,
    // 级联失效：scheduler 失效时同时清空 controller/driver（强一致）
    cascadeCaches: [controllerCache as Map<string, unknown>, driverCache as Map<string, unknown>],
    build: () => {
      const lc = buildController(root, client);
      return new AutoLoopScheduler(lc, {
        onStageChange: (stage) => {
          // Log stage changes
          console.log(`[AutoLoopScheduler] Stage changed to "${stage}"`);
        },
        onToolAwaiting: (action) => {
          console.log(`[AutoLoopScheduler] Awaiting agent to execute ${action.tool}: ${action.reason}`);
        },
        onComplete: (result) => {
          console.log(`[AutoLoopScheduler] Completed after ${result.iteration} iterations at stage "${result.stage}"`);
        },
        onError: (error) => {
          console.error(`[AutoLoopScheduler] Error: ${error.message}`);
        },
      });
    },
  });
}

// ── Cache cleanup helpers (re-export for backward compat) ──

export function clearControllerCache(projectRoot?: string): void {
  if (projectRoot) {
    const root = normalizeRoot(projectRoot);
    // 清除所有与该 root 相关的键（含 client::root 形式）
    clearRootCaches(root, allCaches);
  } else {
    clearAllCaches(allCaches);
  }
}
