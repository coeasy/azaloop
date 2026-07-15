/**
 * AutoLoopScheduler — V17 后台自动循环驱动器
 *
 * 定时器驱动的后台自动循环，无需手动调用 `step()`。
 * 在 PRD 确认后自动启动，自动调用 `loopController.next()` 并处理 `next_action`。
 *
 * V17 改进:
 *   1. 进入 awaiting_agent 前自动保存状态到文件（崩溃后可恢复）
 *   2. reportToolExecuted 验证工具名是否匹配期望的 awaitingAction
 *   3. 添加 awaiting_agent 超时机制（默认 5 分钟）
 *   4. 阶段跟踪从 StateMachine 同步，而非依赖 response.data.stage
 *
 * 工作模式:
 *   1. 当 `next_action` 是 `aza_loop` 驱动动作（next/full/step/auto）时自动继续下一轮
 *   2. 当需要宿主工具时暂停并等待 LLM 执行
 *   3. LLM 执行工具后，调用 `reportToolExecuted()` 通知调度器继续
 *
 * 使用方式:
 *   const scheduler = new AutoLoopScheduler(loopController);
 *   scheduler.start();             // 启动后台调度
 *   scheduler.reportToolExecuted('aza_task_implement');  // LLM 报告工具执行完成
 *   scheduler.stop();              // 停止后台调度
 */

import { LoopController } from './loop-controller';
import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { Stage } from './state-machine';

// ── Types ──

export interface SchedulerStatus {
  running: boolean;
  paused: boolean;
  currentStage: string;
  iteration: number;
  lastAction: NextAction | null;
  awaitingAction: NextAction | null;
  lastError: string | null;
  startedAt: string | null;
}

export interface SchedulerCallbacks {
  onStageChange?: (stage: string) => void;
  onToolAwaiting?: (action: NextAction) => void;
  onComplete?: (result: { stage: string; iteration: number }) => void;
  onError?: (error: Error) => void;
  onStateSync?: () => Promise<void>;
}

function isAutoContinueAction(action: NextAction | null | undefined): boolean {
  if (!action?.tool) return false;
  if (action.tool === 'aza_loop_next') return true;
  if (action.tool === 'aza_loop') {
    return ['next', 'full', 'step', 'auto'].includes(String(action.action || ''));
  }
  return false;
}

export type SchedulerState = 'idle' | 'running' | 'paused' | 'awaiting_agent' | 'completed' | 'error';

/**
 * 后台自动循环调度器。
 *
 * 在后台线程中自动推进循环，遇到需要 LLM 执行工具时暂停。
 * V17: 进入 awaiting_agent 前自动保存状态，reportToolExecuted 验证工具名，
 * 添加超时机制，阶段跟踪从 StateMachine 同步。
 */
export class AutoLoopScheduler {
  private loopController: LoopController;
  private callbacks: SchedulerCallbacks;
  private state: SchedulerState = 'idle';
  private timerId: ReturnType<typeof setInterval> | null = null;
  private iteration: number = 0;
  private currentStage: string = 'open';
  private lastAction: NextAction | null = null;
  private awaitingAction: NextAction | null = null;
  private lastError: string | null = null;
  private startedAt: string | null = null;
  private pollIntervalMs: number;

  /** V17: awaiting_agent 超时（毫秒），默认 5 分钟 */
  private awaitingTimeoutMs: number;
  /** V17: 进入 awaiting_agent 的时间戳，用于超时检测 */
  private awaitingSince: number | null = null;

  /** When awaiting agent, set this to true after the agent reports tool execution. */
  private toolExecutedFlag: boolean = false;
  private toolExecutedName: string | null = null;

  constructor(
    loopController: LoopController,
    callbacks: SchedulerCallbacks = {},
    pollIntervalMs: number = 1000,
    awaitingTimeoutMs: number = 300_000, // 5 分钟
  ) {
    this.loopController = loopController;
    this.callbacks = callbacks;
    this.pollIntervalMs = pollIntervalMs;
    this.awaitingTimeoutMs = awaitingTimeoutMs;
  }

  /**
   * Start the background scheduler.
   * Begins polling the loop controller and advancing the loop.
   */
  start(): void {
    if (this.state === 'running') {
      return;
    }
    this.state = 'running';
    this.startedAt = new Date().toISOString();
    this.iteration = 0;
    this.toolExecutedFlag = false;
    this.awaitingSince = null;

    // Start the polling timer
    this.timerId = setInterval(() => this.tick(), this.pollIntervalMs);
  }

  /**
   * Stop the background scheduler.
   */
  stop(): void {
    this.state = 'idle';
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Pause the scheduler (keeps timer running but skips ticks).
   */
  pause(): void {
    if (this.state === 'running') {
      this.state = 'paused';
    }
  }

  /**
   * Resume the scheduler.
   */
  resume(): void {
    if (this.state === 'paused') {
      this.state = 'running';
    }
  }

  /**
   * V17: Report that the LLM has executed the awaited tool.
   * Validates that toolName matches the expected awaitingAction.tool.
   * Call this after the LLM executes the tool indicated by `getAwaitingAction()`.
   *
   * @param toolName The name of the tool that was executed.
   * @returns true if the tool was accepted, false if it didn't match the expected tool.
   */
  reportToolExecuted(toolName: string): boolean {
    const expected = this.awaitingAction?.tool;
    if (expected && toolName !== expected) {
      console.warn(`[AutoLoopScheduler] Expected tool "${expected}" but got "${toolName}" — ignoring`);
      return false;
    }
    this.toolExecutedFlag = true;
    this.toolExecutedName = toolName;
    return true;
  }

  /**
   * Get the current status of the scheduler.
   */
  getStatus(): SchedulerStatus {
    return {
      running: this.state === 'running',
      paused: this.state === 'paused',
      currentStage: this.currentStage,
      iteration: this.iteration,
      lastAction: this.lastAction,
      awaitingAction: this.awaitingAction,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  /**
   * Get the action the LLM needs to execute, if any.
   */
  getAwaitingAction(): NextAction | null {
    return this.awaitingAction;
  }

  /**
   * Get the current scheduler state.
   */
  getState(): SchedulerState {
    return this.state;
  }

  /**
   * Reset the scheduler to idle state.
   */
  reset(): void {
    this.stop();
    this.state = 'idle';
    this.iteration = 0;
    this.currentStage = 'open';
    this.lastAction = null;
    this.awaitingAction = null;
    this.lastError = null;
    this.startedAt = null;
    this.toolExecutedFlag = false;
    this.toolExecutedName = null;
    this.awaitingSince = null;
  }

  /**
   * V18: Retry from error state. Resets error and resumes running.
   *
   * After an error in tick(), the scheduler enters 'error' state and
   * stops the timer. This method clears the error and restarts the
   * timer, allowing the loop to continue from where it left off.
   *
   * @returns true if retry was successful, false if not in error state.
   */
  retry(): boolean {
    if (this.state !== 'error') return false;
    this.state = 'running';
    this.lastError = null;
    // Restart the timer if it was stopped
    if (!this.timerId) {
      this.timerId = setInterval(() => this.tick(), this.pollIntervalMs);
    }
    return true;
  }

  // ── Private ──

  private async tick(): Promise<void> {
    // Skip if paused or awaiting agent (without tool executed)
    if (this.state === 'paused') {
      return;
    }

    if (this.state === 'awaiting_agent') {
      // V17: Check timeout
      if (this.awaitingSince && Date.now() - this.awaitingSince > this.awaitingTimeoutMs) {
        this.state = 'error';
        this.lastError = `Timeout awaiting ${this.awaitingAction?.tool} — exceeded ${this.awaitingTimeoutMs}ms`;
        this.callbacks.onError?.(new Error(this.lastError));
        this.stop();
        return;
      }
      // Check if the LLM has reported tool execution
      if (this.toolExecutedFlag) {
        this.toolExecutedFlag = false;
        this.toolExecutedName = null;
        this.awaitingAction = null;
        this.awaitingSince = null;
        this.state = 'running';
        // Sync state after tool execution
        try {
          await this.loopController.syncStateFromFile();
        } catch {
          // best-effort
        }
      }
      return;
    }

    if (this.state !== 'running') {
      return;
    }

    try {
      // Call next() to advance the loop
      const response = await this.loopController.next();

      this.iteration++;
      this.lastAction = response.next_action || response.data?.next_action || null;

      if (!this.lastAction) {
        this.lastError = 'No next_action in response';
        return;
      }

      // V17: Sync currentStage from StateMachine instead of response.data.stage
      const machineState = this.loopController.stateMachine.getState();
      this.currentStage = machineState.current_stage;

      const action = this.lastAction;

      // Check if we're done
      if (action.action === 'done' || action.action === 'stop') {
        // V17: Save state before stopping
        try {
          await this.loopController.syncStateToFile();
        } catch {
          // best-effort
        }
        this.state = 'completed';
        this.callbacks.onComplete?.({
          stage: this.currentStage,
          iteration: this.iteration,
        });
        this.stop();
        return;
      }

      // V18: Prioritize explicit awaitingAction; else auto-continue on aza_loop driver actions.
      const explicitAwaiting = response.data?.awaitingAction ?? null;

      if (explicitAwaiting || !isAutoContinueAction(action)) {
        // V18: Use local variable to avoid null-assignment type error
        const awaiting = explicitAwaiting ?? action;
        this.awaitingAction = awaiting;
        this.awaitingSince = Date.now();
        this.state = 'awaiting_agent';
        // V17: Save state to file before awaiting, ensuring crash recovery
        try {
          await this.loopController.syncStateToFile();
        } catch {
          // best-effort
        }
        this.callbacks.onToolAwaiting?.(awaiting);
        return;
      }

      // Auto-continue for aza_loop driver actions
      this.callbacks.onStageChange?.(this.currentStage);

      // V18: next() already calls syncStateToFile(), so we only call onStateSync callback
      // (removing the duplicate syncStateToFile call — see task 4.1)
      try {
        await this.callbacks.onStateSync?.();
      } catch {
        // best-effort
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.lastError = errorMsg;
      this.state = 'error';
      this.callbacks.onError?.(err instanceof Error ? err : new Error(errorMsg));
      this.stop();
    }
  }
}