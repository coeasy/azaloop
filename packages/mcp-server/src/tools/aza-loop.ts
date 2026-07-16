import { LoopController, CircuitBreaker, CompletionGate, LoopAudit, ConfigLoader, DEFAULT_BLOCK_COUNT_LIMIT, AutoLoopDriver, AutoLoopScheduler, createDefaultStoryProvider, createDefaultHumanGate, createDefaultCommit } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';
import * as fs from 'fs';

// ── P0-2: Singleton LoopController cache ──
// Each project root has one cached LoopController instance.
// This ensures state machine continuity across MCP tool calls
// within the same session, while allowing different projects
// to have independent controllers.
const controllerCache = new Map<string, LoopController>();
const driverCache = new Map<string, AutoLoopDriver>();
const schedulerCache = new Map<string, AutoLoopScheduler>();
/** Track STATE.yaml mtime so cross-session/cross-client writes invalidate cache. */
const stateMtimeCache = new Map<string, number>();

function normalizeRoot(projectRoot: string): string {
  try {
    return path.resolve(projectRoot || process.cwd());
  } catch {
    return projectRoot || process.cwd();
  }
}

/** 跨客户端隔离键：client::root，避免同一进程内多客户端共享同一份内存循环状态。 */
function cacheKey(root: string, client?: string): string {
  return client ? `${client}::${root}` : root;
}

function stateYamlMtime(root: string): number {
  try {
    return fs.statSync(path.join(root, '.aza', 'STATE.yaml')).mtimeMs;
  } catch {
    return 0;
  }
}

function buildController(projectRoot: string, client?: string): LoopController {
  const root = normalizeRoot(projectRoot);
  const key = cacheKey(root, client);
  const mtime = stateYamlMtime(root);
  const cached = controllerCache.get(key);
  if (cached) {
    const prev = stateMtimeCache.get(key) ?? 0;
    if (prev && mtime && mtime !== prev) {
      // Disk changed outside this process (other client/session) — drop cache
      controllerCache.delete(key);
      driverCache.delete(key);
      schedulerCache.delete(key);
    } else {
      stateMtimeCache.set(key, mtime);
      return cached;
    }
  }

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
      : (config.loop.max_stage_iterations ?? 20);
  const lc = new LoopController({
    maxIterations: config.loop.max_iterations,
    maxStageIterations,
    enableV12: true,
    enableOuterLoop: outerEnabled,
    azaDir,
    projectRoot: root,
    config,
  });
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
  controllerCache.set(key, lc);
  stateMtimeCache.set(key, mtime);
  return lc;
}

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
  const state = sm.getState?.() || {};
  const board = state.loops?.outer?.board;
  if (board?.pending?.length || board?.in_progress?.length) return;

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

/**
 * Clear the controller cache for a given project root.
 * Used during session reset / aza_init to force a fresh controller.
 */
export function clearControllerCache(projectRoot?: string): void {
  if (projectRoot) {
    const root = normalizeRoot(projectRoot);
    // 清除所有与该 root 相关的键（含 client::root 形式）
    for (const k of [controllerCache, driverCache, schedulerCache, stateMtimeCache]) {
      for (const key of [...k.keys()]) {
        if (key === root || key.endsWith(`::${root}`)) {
          k.delete(key);
        }
      }
    }
  } else {
    controllerCache.clear();
    driverCache.clear();
    schedulerCache.clear();
    stateMtimeCache.clear();
  }
}

/**
 * After PRD approve: unlock open→design spine.
 * Sets guard condition, records DP-0/DP-1, and writes an aza_prd_approve audit marker
 * so DecisionPointRegistry.canEnterStage('design') passes T18.
 */
export async function markPrdApproved(projectRoot?: string, client?: string): Promise<void> {
  const root = normalizeRoot(projectRoot ?? process.cwd());
  const lc = buildController(root, client);
  lc.setCondition('prd_valid', true);
  // Fresh story: clear stage-completion markers so makers await real work again.
  try {
    const azaDir = path.join(root, '.aza');
    for (const f of ['build-complete.marker', 'quality-passed.marker']) {
      const p = path.join(azaDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch {
    /* best-effort */
  }

  const iteration = lc.stateMachine.getState().iteration;
  await lc.dpRegistry.record('DP-0', 'init', 'open', 'passed', {
    iteration,
    reason: 'PRD approved — open stage unlocked',
  });
  await lc.dpRegistry.record('DP-1', 'open', 'design', 'passed', {
    iteration,
    reason: 'PRD approved — design stage unlocked',
  });
  await lc.dpRegistry.markToolEvent('aza_prd_approve', {
    iteration,
    reason: 'PRD approved via aza_prd(approve)',
  });
}

// ── Core loop tools ──

export async function handleLoopNext(currentStage?: string, projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  return await lc.next(currentStage as any);
}

export async function handleLoopStatus(projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  const state = lc.stateMachine.getState();
  const phaseState = lc.stateMachine.getPhaseLoopState();
  const innerState = lc.stateMachine.getInnerLoopState();
  const outerState = lc.stateMachine.getOuterLoopState();

  return {
    success: true,
    data: {
      current_stage: state.current_stage,
      stages: state.stages,
      iteration: state.iteration,
      phase: phaseState,
      inner: innerState,
      outer: outerState,
      attestation: lc.stateMachine.getAttestation(),
    },
    metadata: {
      iteration: state.iteration,
      progress: state.progress,
      stage: state.current_stage,
      loop_level: 'outer',
    },
  };
}

export async function handleLoopComplete(stage: string, projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  const result = lc.completeStage(stage);
  const state = lc.stateMachine.getState();

  if (!result.success) {
    return {
      success: false,
      data: { stage, progress: state.progress },
      error: result.error,
      next_action: { tool: 'aza_loop', action: 'retry', reason: result.error || 'Guard check failed' },
      metadata: { iteration: state.iteration, progress: state.progress, stage: state.current_stage },
    };
  }

  return {
    success: true,
    data: { stage: state.current_stage, progress: state.progress },
    next_action: state.current_stage !== 'archive'
      ? { tool: 'aza_loop', action: 'next', reason: `Advanced to ${state.current_stage} stage` }
      : { tool: 'aza_loop', action: 'done', reason: 'All stages complete' },
    metadata: { iteration: state.iteration, progress: state.progress, stage: state.current_stage },
  };
}

export async function handleLoopSetCondition(key: string, passed: boolean, projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  lc.setCondition(key as any, passed);
  return {
    success: true,
    data: { condition: key, passed },
    metadata: { iteration: lc.stateMachine.getState().iteration, progress: lc.stateMachine.getProgress(), stage: lc.stateMachine.getCurrentStage() },
  };
}

export async function handleLoopResetConditions(projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  lc.resetConditions();
  return {
    success: true,
    data: { reset: true },
    metadata: { iteration: lc.stateMachine.getState().iteration, progress: lc.stateMachine.getProgress(), stage: lc.stateMachine.getCurrentStage() },
  };
}

export async function handleLoopStop(reason: string, projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  lc.stop('user_requested', reason);
  const state = lc.stateMachine.getState();
  return {
    success: true,
    data: { stopped: true, reason },
    next_action: { tool: 'aza_loop', action: 'report', reason: 'Loop stopped by user' },
    metadata: { iteration: state.iteration, progress: state.progress, stage: state.current_stage },
  };
}

export async function handleLoopGetStageIterations(stage: string, projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  const count = lc.getStageIterations(stage);
  return {
    success: true,
    data: { stage, iterations: count },
    metadata: { iteration: lc.stateMachine.getState().iteration, progress: lc.stateMachine.getProgress(), stage: lc.stateMachine.getCurrentStage() },
  };
}

// ── V12: Circuit breaker status ──

export async function handleLoopCircuitBreaker(projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  const phaseMetrics = lc.circuitBreaker.getMetrics('phase');
  const innerMetrics = lc.circuitBreaker.getMetrics('inner');
  const outerMetrics = lc.circuitBreaker.getMetrics('outer');
  const tripped = lc.circuitBreaker.checkAll();

  return {
    success: true,
    data: {
      tripped: tripped?.tripped ?? false,
      tripped_reason: tripped?.reason,
      tripped_dimension: tripped?.dimension,
      phase: phaseMetrics,
      inner: innerMetrics,
      outer: outerMetrics,
    },
    metadata: {
      iteration: lc.stateMachine.getState().iteration,
      progress: lc.stateMachine.getProgress(),
      stage: lc.stateMachine.getCurrentStage(),
    },
  };
}

// ── V12: Completion gate check ──

export async function handleLoopCompletionGate(projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  const state = lc.stateMachine.getState();
  const hasInProgress = Object.values(state.stages).some(s => s.status === 'in_progress');

  const result = lc.completionGate.evaluate({
    gated_mode_enabled: lc.configLoopOptions.enableV12,
    has_in_progress_stage: hasInProgress,
    all_stages_completed: Object.values(state.stages).every(s => s.status === 'completed'),
    stop_hook_active: lc.stopHookActive,
    block_count: lc.blockCount,
    block_count_limit: DEFAULT_BLOCK_COUNT_LIMIT,
    ledger_has_progress: lc.ledgerHasProgress || state.iteration > 0,
    attestation_verified: state.attestation?.verified ?? false,
  });

  return {
    success: true,
    data: {
      can_stop: result.canStop,
      blocked_reason: result.blockedReason,
      conditions: result.conditions,
    },
    metadata: {
      iteration: state.iteration,
      progress: state.progress,
      stage: state.current_stage,
    },
  };
}

// ── V12: Loop audit ──

export async function handleLoopAudit(projectRoot?: string, client?: string): Promise<LoopResponse> {
  const lc = buildController(projectRoot ?? process.cwd(), client);
  const result = await lc.audit();

  return {
    success: true,
    data: {
      overall_score: result.score,
      level: result.level,
      signals: result.signals,
      recommendations: result.recommendations,
    },
    metadata: {
      iteration: lc.stateMachine.getState().iteration,
      progress: lc.stateMachine.getProgress(),
      stage: lc.stateMachine.getCurrentStage(),
    },
  };
}

// ── P0-4: MCP AutoLoopDriver integration ──

export function buildDriver(projectRoot: string, client?: string): AutoLoopDriver {
  const root = normalizeRoot(projectRoot);
  const key = cacheKey(root, client);
  const cached = driverCache.get(key);
  if (cached) return cached;

  const lc = buildController(root, client);
  const driver = new AutoLoopDriver(lc, {
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
  driverCache.set(key, driver);
  return driver;
}

// ── V16: AutoLoopScheduler (background auto-loop) ──

function buildScheduler(projectRoot: string, client?: string): AutoLoopScheduler {
  const root = normalizeRoot(projectRoot);
  const key = cacheKey(root, client);
  const cached = schedulerCache.get(key);
  if (cached) return cached;

  const lc = buildController(root, client);
  const scheduler = new AutoLoopScheduler(lc, {
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
  schedulerCache.set(key, scheduler);
  return scheduler;
}

/**
 * Handle the auto-loop MCP tool.
 *
 * Supports:
 *   - action: "step" (default) — single step, returns next_action
 *   - action: "full" — run until completion
 *   - action: "status" — return current driver status
 *   - action: "reset" — reset the driver
 *   - action: "auto" — V16: start background scheduler
 *   - action: "stop" — V16: stop background scheduler
 *   - action: "pause" — V16: pause background scheduler
 *   - action: "resume" — V16: resume background scheduler
 *   - action: "report_tool" — V16: report tool execution to scheduler
 */
export async function handleAutoLoop(
  action?: string,
  currentStage?: string,
  projectRoot?: string,
  toolName?: string,
  client?: string,
): Promise<LoopResponse> {
  const root = normalizeRoot(projectRoot ?? process.cwd());

  // P1-4: oneshot mode — skip multi-story outer board; single task then stop
  const oneshot =
    process.env.AZALOOP_MODE === 'oneshot' ||
    process.env.AZA_MODE === 'oneshot' ||
    process.env.PLANNING_DISABLED === 'true';
  if (oneshot && (action === 'full' || action === 'auto')) {
    const driver = buildDriver(root, client);
    const step = await driver.step();
    if (step.awaitingAction) {
      return {
        success: true,
        data: {
          status: 'awaiting_agent',
          mode: 'oneshot',
          awaitingAction: step.awaitingAction,
          done: false,
          iteration: step.iteration,
          stage: step.stage,
        },
        next_action: step.awaitingAction,
        metadata: {
          iteration: step.iteration,
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: step.stage,
        },
      };
    }
    return {
      success: true,
      data: {
        status: step.done ? 'oneshot_done' : 'oneshot_step',
        mode: 'oneshot',
        done: !!step.done,
        iteration: step.iteration,
        stage: step.stage,
      },
      next_action: step.done
        ? { tool: 'aza_finish', action: 'ship', reason: 'Oneshot complete — ship' }
        : step.nextAction ?? { tool: 'aza_loop', action: 'step', reason: 'Oneshot: continue step' },
      metadata: {
        iteration: step.iteration,
        progress: driver.getLoopController().stateMachine.getProgress(),
        stage: step.stage,
      },
    };
  }

  const driver = buildDriver(root, client);

  // ── V16: Background scheduler actions ──
  const scheduler = schedulerCache.get(root) || buildScheduler(root, client);

  switch (action ?? 'step') {
    case 'status': {
      // R10 / 跨会话恢复：status 必须反映磁盘 STATE.yaml 的真实阶段，
      // 而非内存默认 'open'（清缓存/崩溃重建后尤其容易失真）。
      // 先按磁盘重建内存状态，再报告真实 stage（修复 9.8.4-1）。
      await driver.syncStageFromDisk();
      const lcState = driver.getLoopController().stateMachine.getState();
      const realStage: string = lcState.current_stage || driver.getCurrentStage();
      const anyActive = Object.values(lcState.stages as Record<string, any>).some(
        (s: any) => s?.status === 'in_progress' || s?.status === 'blocked',
      );
      // 内存 driver 状态为 idle 但磁盘存在活跃阶段 → 标记为 recovered，避免误导客户端以为需从 open 重来
      const effectiveStatus =
        driver.getStatus() === 'idle' && anyActive ? 'recovered' : driver.getStatus();
      const schedulerStatus = scheduler.getStatus();
      return {
        success: true,
        data: {
          status: effectiveStatus,
          stage: realStage,
          iteration: lcState.iteration,
          progress: lcState.progress,
          current_stage: realStage,
          scheduler: {
            running: schedulerStatus.running,
            paused: schedulerStatus.paused,
            awaitingAction: schedulerStatus.awaitingAction,
            lastError: schedulerStatus.lastError,
          },
        },
        metadata: {
          iteration: lcState.iteration,
          progress: lcState.progress,
          stage: realStage,
        },
      };
    }

    case 'reset': {
      const normalized = normalizeRoot(root);
      scheduler.reset();
      driver.reset();
      // Drop cached controller so a fresh PRD cycle does not inherit strikes/circuits.
      clearControllerCache(normalized);
      driverCache.delete(normalized);
      schedulerCache.delete(normalized);
      return {
        success: true,
        data: { status: 'reset', iteration: 0, cache_cleared: true },
        next_action: {
          tool: 'aza_loop',
          action: 'full',
          reason: 'Caches cleared — continue full-auto loop (cross-session safe)',
        },
        metadata: { iteration: 0, progress: '0%', stage: 'open' },
      };
    }

    case 'full': {
      // Host-LLM cooperative full mode: advance until awaitingAction or done.
      // Do NOT burn maxIterations while waiting for the Cursor agent.
      const maxSteps = 20;
      let last: Awaited<ReturnType<typeof driver.step>> | null = null;
      for (let i = 0; i < maxSteps; i++) {
        last = await driver.step();
        if (last.awaitingAction) {
          return {
            success: true,
            data: {
              status: 'awaiting_agent',
              awaitingAction: last.awaitingAction,
              done: false,
              iteration: last.iteration,
              stage: last.stage,
            },
            next_action: last.awaitingAction,
            metadata: {
              iteration: last.iteration,
              progress: driver.getLoopController().stateMachine.getProgress(),
              stage: last.stage,
            },
          };
        }
        if (last.done) {
          // 区分真正的完成（action=done）与失败终止（stop / escalate）。
          // 失败升级（如 3-Strike、DP gate 阻塞）绝不能被伪装成 success/completed，
          // 否则客户端会误以为任务成功而 ship 未完成的产物。
          const terminalAction = last.nextAction?.action;
          const isRealCompletion = terminalAction === 'done';
          const isEscalation = terminalAction === 'escalate';
          const isStop = terminalAction === 'stop';
          if (isRealCompletion) {
            return {
              success: true,
              data: {
                status: 'completed',
                done: true,
                nextAction: last.nextAction,
                iteration: last.iteration,
                stage: last.stage,
              },
              next_action: last.nextAction ?? {
                tool: 'aza_finish',
                action: 'ship',
                reason: 'Loop completed — ship delivery',
              },
              metadata: {
                iteration: last.iteration,
                progress: '100%',
                stage: last.stage,
              },
            };
          }
          // escalate / stop：明确失败终止，done=false，绝不 ship
          return {
            success: false,
            data: {
              status: isEscalation ? 'escalated' : 'stopped',
              done: false,
              reason:
                last.nextAction?.reason ??
                (isEscalation ? 'Loop escalated (e.g. 3-Strike) — not completed' : 'Loop stopped before completion'),
              nextAction: last.nextAction,
              iteration: last.iteration,
              stage: last.stage,
            },
            next_action: {
              tool: 'aza_loop',
              action: 'reset',
              reason: 'Loop did not complete cleanly — inspect .aza and reset/retry',
            },
            metadata: {
              iteration: last.iteration,
              progress: driver.getLoopController().stateMachine.getProgress(),
              stage: last.stage,
            },
          };
        }
        // Continue stepping while engine self-advances without host tools
      }
      // R10: 驱动已到达 maxIterations 上限 → 明确终态（stop），
      // 不要再误导宿主“paused → 再调 full”，避免跨调用空转。
      const exhausted = driver.getIteration() >= driver.getMaxIterations();
      if (exhausted) {
        return {
          success: false,
          data: {
            status: 'stopped',
            done: false,
            reason: `Driver exhausted after ${driver.getMaxIterations()} iterations — no clean completion`,
            last,
          },
          next_action: {
            tool: 'aza_loop',
            action: 'stop',
            reason: 'Iteration budget exhausted — stop the loop (no ship on incomplete)',
          },
          metadata: {
            iteration: driver.getIteration(),
            progress: driver.getLoopController().stateMachine.getProgress(),
            stage: driver.getCurrentStage(),
          },
        };
      }
      return {
        success: true,
        data: {
          status: 'paused',
          done: false,
          message: 'Paused after internal steps — call aza_loop(full) again to continue (not stuck)',
          resume_hint: 'aza_loop(action=full)',
          last,
        },
        next_action: last?.nextAction ?? {
          tool: 'aza_loop',
          action: 'full',
          reason: 'Continue full loop — call aza_loop(full) again',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    // ── V16: Background scheduler actions ──

    case 'auto': {
      // V18: If switching from step mode, sync driver state to scheduler
      // by reading current stage from the shared LoopController.
      // Start the background scheduler
      scheduler.start();
      return {
        success: true,
        data: {
          status: 'auto_started',
          scheduler_state: scheduler.getState(),
          // V18: Include driver state for client-side sync
          driver_stage: driver.getCurrentStage(),
          driver_iteration: driver.getIteration(),
          message: 'Background auto-loop scheduler started',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'stop': {
      scheduler.stop();
      return {
        success: true,
        data: {
          status: 'stopped',
          scheduler_state: scheduler.getState(),
          message: 'Background auto-loop scheduler stopped',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'pause': {
      scheduler.pause();
      return {
        success: true,
        data: {
          status: 'paused',
          scheduler_state: scheduler.getState(),
          message: 'Background auto-loop scheduler paused',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'resume': {
      scheduler.resume();
      return {
        success: true,
        data: {
          status: 'resumed',
          scheduler_state: scheduler.getState(),
          message: 'Background auto-loop scheduler resumed',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'retry': {
      // V18: Retry from error state
      const retried = scheduler.retry();
      return {
        success: true,
        data: {
          status: retried ? 'retried' : 'not_in_error',
          scheduler_state: scheduler.getState(),
          message: retried
            ? 'Scheduler retried from error state'
            : 'Scheduler not in error state (retry ignored)',
        },
        metadata: {
          iteration: driver.getIteration(),
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: driver.getCurrentStage(),
        },
      };
    }

    case 'report_tool': {
      // Report that the LLM has executed the awaited tool, then continue the driver
      if (!toolName) {
        return {
          success: false,
          data: { status: 'error' },
          error: 'toolName is required for report_tool action',
          next_action: { tool: 'aza_loop', action: 'full', reason: 'Provide tool_name then report_tool' },
          metadata: {
            iteration: driver.getIteration(),
            progress: driver.getLoopController().stateMachine.getProgress(),
            stage: driver.getCurrentStage(),
          },
        };
      }
      // Deadlock detection must cover cooperative host↔report ping-pong
      driver.getLoopController().recordAction(toolName, 'report_tool');
      scheduler.reportToolExecuted(toolName);
      // Cooperative spine: advance driver so host gets the next awaitingAction
      const stepResult = await driver.step();
      if (stepResult.awaitingAction) {
        driver.getLoopController().recordAction(
          stepResult.awaitingAction.tool,
          stepResult.awaitingAction.action || 'await',
        );
        return {
          success: true,
          data: {
            status: 'awaiting_agent',
            tool_executed: toolName,
            awaitingAction: stepResult.awaitingAction,
            done: false,
            iteration: stepResult.iteration,
            stage: stepResult.stage,
          },
          next_action: stepResult.awaitingAction,
          metadata: {
            iteration: stepResult.iteration,
            progress: driver.getLoopController().stateMachine.getProgress(),
            stage: stepResult.stage,
          },
        };
      }
      if (stepResult.done) {
        return {
          success: true,
          data: {
            status: 'completed',
            tool_executed: toolName,
            done: true,
            iteration: stepResult.iteration,
            stage: stepResult.stage,
          },
          next_action: stepResult.nextAction ?? {
            tool: 'aza_finish',
            action: 'ship',
            reason: 'Loop completed after report_tool — ship delivery',
          },
          metadata: {
            iteration: stepResult.iteration,
            progress: '100%',
            stage: stepResult.stage,
          },
        };
      }
      return {
        success: true,
        data: {
          status: 'tool_reported',
          tool_executed: toolName,
          done: false,
          iteration: stepResult.iteration,
          stage: stepResult.stage,
        },
        next_action: stepResult.nextAction ?? {
          tool: 'aza_loop',
          action: 'full',
          reason: 'Tool reported — continue full loop',
        },
        metadata: {
          iteration: stepResult.iteration,
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: stepResult.stage,
        },
      };
    }

    case 'step':
    default: {
      // V18: If scheduler is running, pause it to avoid concurrent step() conflicts
      if (scheduler.getState() === 'running') {
        scheduler.pause();
      }
      const stepResult = await driver.step();
      if (stepResult.done) {
        return {
          success: true,
          data: {
            done: true,
            status: driver.getStatus(),
            action: stepResult.nextAction,
            stage: stepResult.stage,
            iteration: stepResult.iteration,
            // V17: Include awaitingAction if present — this is a pre-action instruction
            // telling the LLM to execute a specific tool before calling step() again.
            awaitingAction: stepResult.awaitingAction,
          },
          next_action: stepResult.nextAction ?? { tool: 'aza_loop', action: 'done', reason: 'Auto-loop complete' },
          metadata: {
            iteration: stepResult.iteration,
            progress: driver.getLoopController().stateMachine.getProgress(),
            stage: stepResult.stage,
          },
        };
      }

      return {
        success: true,
        data: {
          done: false,
          status: driver.getStatus(),
          next_action: stepResult.nextAction,
          stage: stepResult.stage,
          iteration: stepResult.iteration,
          // V17: Include awaitingAction if present
          awaitingAction: stepResult.awaitingAction,
        },
        next_action: stepResult.nextAction ?? { tool: 'aza_loop', action: 'next', reason: 'Continue auto-loop' },
        metadata: {
          iteration: stepResult.iteration,
          progress: driver.getLoopController().stateMachine.getProgress(),
          stage: stepResult.stage,
        },
      };
    }
  }
}
