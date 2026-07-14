import { LoopController, type LoopControllerOptions } from './loop-controller';
import { AutoLoopDriver, type AutoLoopDriverOptions, type LoopCompleteResult, type StepResult } from './auto-loop-driver';
import { OuterLoop, type OuterLoopResult, createDefaultStoryProvider, createDefaultHumanGate, createDefaultCommit } from './outer-loop';
import { HeartbeatManager, type Heartbeat } from '../state/heartbeat';
import { StateManager } from '../state/state-manager';
import { ResumeGenerator } from '../continuity/resume-generator';
import { CatchupProtocol } from '../continuity/catchup-protocol';
import { ProjectMemory } from '../L2_memory/project-memory';
import { LongTermMemory } from '../L2_memory/long-term-memory';
import {
  WorkerScheduler,
  DEFAULT_TRIGGERS,
  buildDefaultRegistry,
} from '../L0_platform/workers';
import type { LoopResponse, NextAction } from '@azaloop/shared';

export interface AutoLoopEngineOptions {
  /** .aza directory path */
  azaDir: string;
  /** Client name (e.g., 'cursor', 'claude-code') */
  client?: string;
  /** Model name */
  model?: string;
  /** Maximum iterations */
  maxIterations?: number;
  /** Enable auto loop */
  enableAutoLoop?: boolean;
  /** Heartbeat stale threshold in ms (default: 300000 = 5 minutes) */
  heartbeatStaleThresholdMs?: number;
  /** v13 — Worker scheduler heartbeat in ms. Default 270_000 (5 min). */
  workerHeartbeatMs?: number;
  /** v13 — Disable the background worker scheduler. */
  disableWorkerScheduler?: boolean;
}

export interface AutoLoopState {
  is_running: boolean;
  current_story: string | null;
  iteration: number;
  progress: string;
  last_heartbeat: string;
  errors: string[];
}

/**
 * AutoLoopEngine — 全自动循环引擎
 *
 * 管理循环生命周期，消除孤儿进程风险：
 * 1. Heartbeat 超时检测 — 检测并清理过期会话
 * 2. CatchupProtocol — 恢复之前的状态和记忆
 * 3. OuterLoop 集成 — Story 级自动调度
 * 4. 自动恢复 — 中断后自动从 RESUME.md 恢复
 *
 * 核心链路：
 *   启动 → Heartbeat 检测 → CatchupProtocol → OuterLoop/InnerLoop → 完成
 */
export class AutoLoopEngine {
  private loopController: LoopController;
  private autoLoopDriver: AutoLoopDriver;
  private heartbeatManager: HeartbeatManager;
  private stateManager: StateManager;
  private resumeGenerator: ResumeGenerator;
  private catchupProtocol: CatchupProtocol | null = null;
  private projectMemory: ProjectMemory;
  private longTermMemory: LongTermMemory;
  /** v13 — 12 ruflo workers + 270s heartbeat (P1.1: WorkerScheduler wiring). */
  private workerScheduler: WorkerScheduler | null = null;
  private options: Required<AutoLoopEngineOptions>;
  private state: AutoLoopState;

  constructor(options: AutoLoopEngineOptions) {
    this.options = {
      azaDir: options.azaDir,
      client: options.client ?? 'unknown',
      model: options.model ?? 'unknown',
      maxIterations: options.maxIterations ?? 50,
      enableAutoLoop: options.enableAutoLoop ?? true,
      heartbeatStaleThresholdMs: options.heartbeatStaleThresholdMs ?? 300000,
      workerHeartbeatMs: options.workerHeartbeatMs ?? WorkerScheduler.HEARTBEAT_MS,
      disableWorkerScheduler: options.disableWorkerScheduler ?? false,
    };

    this.stateManager = new StateManager(this.options.azaDir);
    this.resumeGenerator = new ResumeGenerator(this.options.azaDir);
    this.heartbeatManager = new HeartbeatManager(this.options.azaDir, this.options.heartbeatStaleThresholdMs);
    this.projectMemory = new ProjectMemory(this.options.azaDir);
    this.longTermMemory = new LongTermMemory(this.options.azaDir);

    this.loopController = new LoopController({
      azaDir: this.options.azaDir,
      enableV12: true,
      enableOuterLoop: this.options.enableAutoLoop,
      maxIterations: this.options.maxIterations,
    });

    // v15 — P1-1: Create AutoLoopDriver to delegate loop execution.
    // AutoLoopEngine handles lifecycle (heartbeat, catchup, workers);
    // AutoLoopDriver handles the loop execution (step, sentinel, PRD gate);
    // LoopController handles state machine and tool routing.
    this.autoLoopDriver = new AutoLoopDriver(this.loopController, {
      maxIterations: this.options.maxIterations,
      enableSentinelDetection: true,
      enableAutoSync: true,
      onPrdReview: async () => ({ approved: true }),
      onEscalate: async (reason, stage) => {
        this.state.errors.push(`Escalated at ${stage}: ${reason}`);
      },
    });

    // v13 — Build the 12-worker registry + scheduler if not disabled.
    if (!this.options.disableWorkerScheduler) {
      const registry = buildDefaultRegistry();
      this.workerScheduler = new WorkerScheduler({
        azaDir: this.options.azaDir,
        stateManager: this.stateManager,
        registry,
        heartbeatMs: this.options.workerHeartbeatMs,
      });
      this.workerScheduler.registerTriggers(DEFAULT_TRIGGERS);
      this.loopController.setWorkerScheduler(this.workerScheduler);
    }

    this.state = {
      is_running: false,
      current_story: null,
      iteration: 0,
      progress: '0%',
      last_heartbeat: '',
      errors: [],
    };
  }

  /**
   * 启动自动循环引擎
   */
  async start(): Promise<{
    started: boolean;
    state: AutoLoopState;
    catchup_result?: any;
  }> {
    try {
      // 1. 检查是否有过期的心跳（孤儿会话检测）
      const staleCleared = await this.heartbeatManager.clearIfStale();
      if (staleCleared) {
        console.warn('[AutoLoopEngine] Cleared stale heartbeat from previous session');
      }

      // 2. 执行 CatchupProtocol 恢复状态
      await this.initializeCatchup();
      const catchupResult = await this.catchupProtocol?.run();

      // 3. 创建新的心跳
      await this.createHeartbeat();

      // 4. 配置 OuterLoop 回调
      this.configureOuterLoop();

      // v13 — P1.1: start the worker scheduler. The 12 ruflo workers
      // begin observing the loop. Periodic `every-270s` workers are
      // scheduled; event-driven workers fire on stage advance / strike /
      // completion via the loop controller fan-out.
      if (this.workerScheduler) {
        this.workerScheduler.start();
      }

      this.state.is_running = true;
      this.state.last_heartbeat = new Date().toISOString();

      return {
        started: true,
        state: { ...this.state },
        catchup_result: catchupResult,
      };
    } catch (error: any) {
      this.state.errors.push(error.message);
      return {
        started: false,
        state: { ...this.state },
      };
    }
  }

  /**
   * 执行一步循环
   *
   * v15 — P1-1: Delegates to AutoLoopDriver.step() for core loop execution,
   * then enriches the result with engine-level state (heartbeat, STATUS.md, journal).
   */
  async step(): Promise<LoopResponse<{ stage: string; progress: string; next_action: NextAction }>> {
    // 更新心跳
    await this.heartbeatManager.touch({
      iteration: this.state.iteration + 1,
    });

    // v15 — Delegate to AutoLoopDriver for sentinel-aware, PRD-gate-aware step execution
    const stepResult = await this.autoLoopDriver.step();

    // 更新状态
    this.state.iteration = stepResult.iteration;
    this.state.current_story = stepResult.stage;
    this.state.progress = `${Math.round((stepResult.iteration / this.options.maxIterations) * 100)}%`;

    // Build the loop result from the driver result
    // V18: Explicitly type result to match the function's return type
    const result: LoopResponse<{ stage: string; progress: string; next_action: NextAction }> = {
      success: true,
      data: {
        stage: stepResult.stage,
        progress: this.state.progress,
        next_action: stepResult.nextAction ?? { tool: 'aza_loop_next', action: 'next', reason: 'Continue' },
      },
      next_action: stepResult.nextAction ?? { tool: 'aza_loop_next', action: 'next', reason: 'Continue' },
      metadata: {
        iteration: stepResult.iteration,
        progress: this.state.progress,
        stage: stepResult.stage,
      },
    };

    // v13 — P4.1: write the live STATUS.md snapshot so the user can
    // observe the loop's progress. Best-effort: never throws.
    try {
      const { writeStatusSnapshot } = await import('../L2_memory/status-snapshot');
      const fs = await import('fs');
      const path = await import('path');
      const openChanges: string[] = [];
      const openspecDir = path.join(this.options.azaDir, 'openspec', 'changes');
      if (fs.existsSync(openspecDir)) {
        for (const f of fs.readdirSync(openspecDir)) {
          if (f !== 'archive') openChanges.push(f);
        }
      }
      const adrDirPath = path.join(this.options.azaDir, 'docs', 'adr');
      if (fs.existsSync(adrDirPath)) {
        for (const f of fs.readdirSync(adrDirPath).filter((f) => f.endsWith('.md'))) {
          openChanges.push(`adr/${f.replace(/\.md$/, '')}`);
        }
      }
      writeStatusSnapshot(this.options.azaDir, {
        currentStage: this.state.current_story ?? 'open',
        iteration: this.state.iteration,
        progress: this.state.progress,
        lastMilestone: `Iteration ${this.state.iteration} complete`,
        nextAction: stepResult.nextAction?.action ?? 'next',
        strikes: this.state.errors?.length ?? 0,
        openChanges,
        client: this.options.client,
        model: this.options.model,
      });
    } catch {
      // best-effort — STATUS.md write failure never blocks the loop
    }

    // v14 — P9.1: auto-append a journal entry on every stage change.
    try {
      const { autoAppendJournalEntry } = await import('../L2_memory/workspace-journal');
      await autoAppendJournalEntry(this.options.azaDir, {
        stage: this.state.current_story ?? 'open',
        summary: `Iteration ${this.state.iteration} complete`,
        iteration: this.state.iteration,
      });
    } catch {
      // best-effort — journal write failure never blocks the loop
    }

    return result;
  }

  /**
   * 运行完整循环直到完成或停止
   *
   * v15 — P1-1: Delegates to AutoLoopDriver.runFull() which handles
   * sentinel detection, PRD review gates, and escalation automatically.
   * Engine-level lifecycle (start heartbeat, catchup, workers) is preserved.
   */
  async runFullLoop(): Promise<{
    completed: boolean;
    total_iterations: number;
    state: AutoLoopState;
    result?: any;
  }> {
    await this.start();

    const driverResult = await this.autoLoopDriver.runFull();

    this.state.iteration = driverResult.totalIterations;
    this.state.current_story = driverResult.finalStage;
    this.state.progress = driverResult.completed ? '100%' : this.state.progress;

    return {
      completed: driverResult.completed,
      total_iterations: driverResult.totalIterations,
      state: { ...this.state },
      result: {
        status: this.autoLoopDriver.getStatus(),
        reason: driverResult.reason,
        finalStage: driverResult.finalStage,
      },
    };
  }

  /**
   * 停止自动循环
   */
  async stop(): Promise<void> {
    this.state.is_running = false;
    await this.heartbeatManager.clear();
    // v13 — P1.1: stop the worker scheduler so timers don't keep the
    // event loop alive. Best-effort: if stop throws we log and proceed
    // so a leaked worker never blocks loop shutdown.
    if (this.workerScheduler) {
      try {
        await this.workerScheduler.stop();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[AutoLoopEngine] workerScheduler.stop failed: ${msg}`);
      }
    }
  }

  /**
   * 获取当前状态
   */
  getState(): AutoLoopState {
    return { ...this.state };
  }

  /**
   * 获取心跳状态
   */
  async getHeartbeatStatus() {
    return this.heartbeatManager.getStatus();
  }

  // ── 私有方法 ──

  private async initializeCatchup(): Promise<void> {
    try {
      this.catchupProtocol = new CatchupProtocol(
        this.stateManager,
        this.resumeGenerator,
        this.projectMemory,
        this.longTermMemory,
      );
    } catch (error) {
      console.warn('[AutoLoopEngine] Failed to initialize CatchupProtocol:', error);
    }
  }

  private async createHeartbeat(): Promise<void> {
    const heartbeat: Heartbeat = {
      session_id: `session-${Date.now()}`,
      client: this.options.client,
      model: this.options.model,
      started_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
      iteration: 0,
    };
    await this.heartbeatManager.write(heartbeat);
  }

  private configureOuterLoop(): void {
    const storyProvider = createDefaultStoryProvider(this.stateManager);
    const humanGate = createDefaultHumanGate(this.stateManager);
    const commit = createDefaultCommit(this.stateManager);

    this.loopController.setOuterLoopCallbacks({
      storyProvider,
      humanGate,
      commit,
    });
  }
}