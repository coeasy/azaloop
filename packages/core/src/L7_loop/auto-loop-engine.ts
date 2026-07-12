import { LoopController, type LoopControllerOptions } from './loop-controller';
import { OuterLoop, type OuterLoopResult, createDefaultStoryProvider, createDefaultHumanGate, createDefaultCommit } from './outer-loop';
import { HeartbeatManager, type Heartbeat } from '../state/heartbeat';
import { StateManager } from '../state/state-manager';
import { ResumeGenerator } from '../continuity/resume-generator';
import { CatchupProtocol } from '../continuity/catchup-protocol';
import { ProjectMemory } from '../L2_memory/project-memory';
import { LongTermMemory } from '../L2_memory/long-term-memory';
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
  private heartbeatManager: HeartbeatManager;
  private stateManager: StateManager;
  private resumeGenerator: ResumeGenerator;
  private catchupProtocol: CatchupProtocol | null = null;
  private projectMemory: ProjectMemory;
  private longTermMemory: LongTermMemory;
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
   */
  async step(): Promise<LoopResponse<{ stage: string; progress: string; next_action: NextAction }>> {
    // 更新心跳
    await this.heartbeatManager.touch({
      iteration: this.state.iteration + 1,
    });

    // 执行循环
    const result = await this.loopController.next();

    // 更新状态
    this.state.iteration++;
    this.state.progress = result.metadata?.progress || this.state.progress;
    this.state.current_story = result.data?.stage || this.state.current_story;

    return result;
  }

  /**
   * 运行完整循环直到完成或停止
   */
  async runFullLoop(): Promise<{
    completed: boolean;
    total_iterations: number;
    state: AutoLoopState;
    result?: any;
  }> {
    await this.start();

    let result: LoopResponse;
    let maxIterations = this.options.maxIterations;

    while (maxIterations > 0) {
      result = await this.step();

      // 检查是否完成
      if (result.next_action?.action === 'done') {
        return {
          completed: true,
          total_iterations: this.state.iteration,
          state: { ...this.state },
          result,
        };
      }

      // 检查是否需要停止
      if (result.next_action?.action === 'stop' || 
          result.next_action?.action === 'escalate') {
        return {
          completed: false,
          total_iterations: this.state.iteration,
          state: { ...this.state },
          result,
        };
      }

      maxIterations--;
    }

    return {
      completed: false,
      total_iterations: this.state.iteration,
      state: { ...this.state },
    };
  }

  /**
   * 停止自动循环
   */
  async stop(): Promise<void> {
    this.state.is_running = false;
    await this.heartbeatManager.clear();
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