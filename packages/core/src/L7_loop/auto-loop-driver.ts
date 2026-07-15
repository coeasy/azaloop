/**
 * AutoLoopDriver — 通用自动循环驱动器 (V17)
 *
 * 提供程序化的 next_action 链执行能力，不依赖 LLM agent 自觉遵守规则。
 * 可被任何客户端（Trae、Cursor、CLI、MCP 等）使用，确保全自动循环执行。
 *
 * 核心链路：
 *   loopController.next() → next_action → 执行工具 → loopController.next() → ... → done
 *
 * V17 改进:
 *   - StepResult 新增 awaitingAction 字段，支持 V16 单阶段调度的事前指令
 *   - step() 方法检测 V16 awaitingAction 并返回，让调用者知道需要 LLM 执行工具
 *
 * 两种模式：
 *   1. runFull(): 同步运行直到完成（适用于 CLI、后台线程）
 *   2. step():    单步执行（适用于 MCP 逐次调用）
 *
 * 与 P0-2 的 LoopController 缓存配合，确保跨调用的状态连续性。
 */

import { LoopController } from './loop-controller';
import { detectSentinel, type SentinelMatch } from './completion-sentinel';
import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { Stage } from './state-machine';

// ── Types ──

export interface AutoLoopDriverOptions {
  /** Maximum iterations before automatic stop (safety cap). Default: 50. */
  maxIterations?: number;
  /** Whether to auto-detect <promise> sentinels and act on them. Default: true. */
  enableSentinelDetection?: boolean;
  /** Whether to auto-sync state to file after each step. Default: true. */
  enableAutoSync?: boolean;
  /** Callback invoked when a PRD review gate is needed. */
  onPrdReview?: (stage: string) => Promise<PrdReviewResult>;
  /** Callback invoked when the loop escalates. */
  onEscalate?: (reason: string, stage: string) => Promise<void>;
  /** Callback invoked on each step iteration. */
  onStep?: (step: StepInfo) => Promise<void>;
  /** Callback invoked when the loop completes. */
  onComplete?: (result: LoopCompleteResult) => Promise<void>;
}

export interface PrdReviewResult {
  approved: boolean;
  cancelled?: boolean;
  feedback?: string;
}

export interface StepInfo {
  iteration: number;
  stage: string;
  action: NextAction;
  result: LoopResponse;
  sentinel?: SentinelMatch;
  totalIterations: number;
}

export interface LoopCompleteResult {
  totalIterations: number;
  finalStage: string;
  completed: boolean;
  reason: string;
}

/**
 * V20 Task 2: Paused result returned when the loop yields to the host AI
 * mid-execution (awaitingAction). The host must execute the specified tool
 * then call aza_loop(action=report_tool) to resume. Extends LoopCompleteResult
 * so existing callers keep accessing common fields without narrowing.
 */
export interface LoopPausedResult extends LoopCompleteResult {
  status: 'paused';
  awaitingAction: NextAction;
  instruction: string;
}

export type LoopDriverStatus = 'idle' | 'running' | 'paused' | 'completed' | 'escalated' | 'stopped';

/**
 * V17: StepResult from a single step() call.
 * Added `awaitingAction` field for V16 single-stage scheduling pre-action instructions.
 */
export interface StepResult {
  done: boolean;
  nextAction: NextAction | null;
  stage: string;
  iteration: number;
  /** V17: If the V16 single-stage scheduler returned an awaitingAction, this is the pre-action instruction. */
  awaitingAction: NextAction | null;
}

// ── AutoLoopDriver ──

export class AutoLoopDriver {
  private loopController: LoopController;
  private options: Required<AutoLoopDriverOptions>;
  private status: LoopDriverStatus = 'idle';
  private iteration: number = 0;
  private currentStage: Stage = 'open';
  private lastResult: LoopResponse | null = null;

  constructor(
    loopController: LoopController,
    options: AutoLoopDriverOptions = {},
  ) {
    this.loopController = loopController;
    this.options = {
      maxIterations: options.maxIterations ?? 50,
      enableSentinelDetection: options.enableSentinelDetection ?? true,
      enableAutoSync: options.enableAutoSync ?? true,
      onPrdReview: options.onPrdReview ?? (async () => ({ approved: true })),
      onEscalate: options.onEscalate ?? (async () => {}),
      onStep: options.onStep ?? (async () => {}),
      onComplete: options.onComplete ?? (async () => {}),
    };
  }

  /**
   * Get the current driver status.
   */
  getStatus(): LoopDriverStatus {
    return this.status;
  }

  /**
   * Get the current loop iteration count.
   */
  getIteration(): number {
    return this.iteration;
  }

  /**
   * Get the current stage.
   */
  getCurrentStage(): Stage {
    return this.currentStage;
  }

  /**
   * Get the underlying LoopController instance.
   */
  getLoopController(): LoopController {
    return this.loopController;
  }

  /**
   * Run the full auto-loop synchronously until completion.
   *
   * Flow:
   *   1. Call loopController.next() to get the next action
   *   2. Detect sentinels in the output
   *   3. Handle PRD review gate if needed
   *   4. Record action for deadlock detection
   *   5. Repeat until done/stop/escalate
   */
  async runFull(): Promise<LoopCompleteResult | LoopPausedResult> {
    this.status = 'running';
    this.iteration = 0;

    while (this.iteration < this.options.maxIterations) {
      const stepResult = await this.step();
      // V20 Task 2: don't break — return paused with continuation instruction
      if (stepResult.awaitingAction) {
        this.status = 'paused';
        return {
          status: 'paused',
          awaitingAction: stepResult.awaitingAction,
          instruction: '执行指定工具后立即调用 aza_loop(action=report_tool) 续跑',
          totalIterations: this.iteration,
          finalStage: this.currentStage,
          completed: false,
          reason: 'Paused: awaiting host tool execution',
        };
      }
      if (stepResult.done) {
        break;
      }
    }

    // Return the completion result
    return {
      totalIterations: this.iteration,
      finalStage: this.currentStage,
      completed: (this.status as LoopDriverStatus) === 'completed',
      reason: this.getCompletionReason(),
    };
  }

  /**
   * V20 Task 2: Continuous mode for single-conversation execution.
   *
   * Like runFull but never breaks on awaitingAction — instead returns
   * a paused result with instruction so the host AI can continue
   * the loop in the same conversation.
   */
  async runContinuous(maxIterations: number = 50): Promise<LoopCompleteResult | LoopPausedResult> {
    for (let i = 0; i < maxIterations; i++) {
      const stepResult = await this.step();
      if (stepResult.awaitingAction) {
        this.status = 'paused';
        return {
          status: 'paused',
          awaitingAction: stepResult.awaitingAction,
          instruction: '执行指定工具后立即调用 aza_loop(action=report_tool) 续跑',
          totalIterations: this.iteration,
          finalStage: this.currentStage,
          completed: false,
          reason: 'Paused: awaiting host tool execution',
        };
      }
      if (stepResult.done) {
        return {
          totalIterations: this.iteration,
          finalStage: this.currentStage,
          completed: this.status === 'completed',
          reason: this.getCompletionReason(),
        };
      }
    }
    return {
      totalIterations: this.iteration,
      finalStage: this.currentStage,
      completed: false,
      reason: `Max iterations (${maxIterations}) reached`,
    };
  }

  /**
   * V17: Execute a single step of the auto-loop.
   *
   * Returns whether the loop is done, the next action, and any awaitingAction
   * from V16 single-stage scheduling. Callers should check `awaitingAction`
   * and execute the specified tool before calling step() again.
   *
   * When `awaitingAction` is non-null, the LLM must execute the specified tool
   * (e.g. aza_task_implement) before calling step() again.
   */
  async step(): Promise<StepResult> {
    if (this.iteration >= this.options.maxIterations) {
      this.status = 'stopped';
      return {
        done: true,
        nextAction: { tool: 'aza_loop', action: 'stop', reason: `Max iterations (${this.options.maxIterations}) reached` },
        stage: this.currentStage,
        iteration: this.iteration,
        awaitingAction: null,
      };
    }

    this.status = 'running';

    // 1. Call loopController.next() to get the next action
    const result = await this.loopController.next(this.currentStage);
    this.lastResult = result;
    this.iteration++;

    const action = result.next_action ?? result.data?.next_action ?? null;
    const stage = result.data?.stage ?? this.currentStage;
    this.currentStage = stage as Stage;

    // V18: Check for awaitingAction in the response (V16 single-stage scheduling)
    // No longer needs `as any` — buildResponse now propagates awaitingAction in data.
    const awaitingAction = result.data?.awaitingAction ?? null;

    // 2. Sentinel detection — if enabled, scan the output for <promise> sentinels
    let sentinel: SentinelMatch | undefined;
    if (this.options.enableSentinelDetection) {
      try {
        const output = (result as any)?.output_text ?? (result as any)?.data?.output_text ?? '';
        if (typeof output === 'string' && output.length > 0) {
          sentinel = detectSentinel(output);
          if (sentinel.matched) {
            // Enrich result metadata with sentinel info
            (result as any).metadata = {
              ...((result as any).metadata ?? {}),
              completion_sentinel: sentinel.matched,
              sentinel_offset: sentinel.offset,
              sentinel_in_tail: sentinel.inTail,
            };
          }
        }
      } catch {
        // best-effort
      }
    }

    // 3. Build step info for callbacks
    const stepInfo: StepInfo = {
      iteration: this.iteration,
      stage,
      action: action ?? { tool: 'aza_loop', action: 'next', reason: 'Continue' },
      result,
      sentinel,
      totalIterations: this.options.maxIterations,
    };

    // 4. Call the onStep callback
    await this.options.onStep(stepInfo);

    // 5. Handle the action
    if (!action) {
      this.status = 'stopped';
      await this.options.onComplete({
        totalIterations: this.iteration,
        finalStage: stage,
        completed: false,
        reason: 'No next_action returned',
      });
      return { done: true, nextAction: null, stage, iteration: this.iteration, awaitingAction: null };
    }

    // V17: If awaitingAction is set, return it as a pre-action instruction
    // The LLM must execute this tool before calling step() again.
    if (awaitingAction) {
      return {
        done: false,
        nextAction: action,
        stage,
        iteration: this.iteration,
        awaitingAction,
      };
    }

    // Handle terminal actions
    if (action.action === 'done') {
      this.status = 'completed';
      await this.options.onComplete({
        totalIterations: this.iteration,
        finalStage: stage,
        completed: true,
        reason: action.reason ?? 'All stages complete',
      });
      return { done: true, nextAction: action, stage, iteration: this.iteration, awaitingAction: null };
    }

    if (action.action === 'stop') {
      this.status = 'stopped';
      await this.options.onComplete({
        totalIterations: this.iteration,
        finalStage: stage,
        completed: false,
        reason: action.reason ?? 'Loop stopped',
      });
      return { done: true, nextAction: action, stage, iteration: this.iteration, awaitingAction: null };
    }

    if (action.action === 'escalate') {
      this.status = 'escalated';
      await this.options.onEscalate(action.reason ?? 'Unknown escalation', stage);
      return { done: true, nextAction: action, stage, iteration: this.iteration, awaitingAction: null };
    }

    // Handle sentinel-driven actions
    if (sentinel?.matched === 'taskComplete') {
      this.status = 'completed';
      await this.options.onComplete({
        totalIterations: this.iteration,
        finalStage: stage,
        completed: true,
        reason: `Sentinel: ${sentinel.matched} — task complete`,
      });
      return { done: true, nextAction: action, stage, iteration: this.iteration, awaitingAction: null };
    }

    if (sentinel?.matched === 'taskFailed') {
      this.status = 'escalated';
      await this.options.onEscalate(`Sentinel: ${sentinel.matched} — task failed`, stage);
      return { done: true, nextAction: action, stage, iteration: this.iteration, awaitingAction: null };
    }

    // Handle PRD review gate
    if (action.tool === 'aza_prd_review') {
      const prdResult = await this.options.onPrdReview(stage);
      if (prdResult.cancelled || !prdResult.approved) {
        this.status = 'stopped';
        return { done: true, nextAction: action, stage, iteration: this.iteration, awaitingAction: null };
      }
      // PRD approved — continue to next step
    }

    // Record action for deadlock detection
    this.loopController.recordAction(action.tool, action.action);

    // Not done — continue to next step
    return { done: false, nextAction: action, stage, iteration: this.iteration, awaitingAction: null };
  }

  /**
   * Reset the driver to initial state.
   */
  reset(): void {
    this.status = 'idle';
    this.iteration = 0;
    this.currentStage = 'open';
    this.lastResult = null;
    this.loopController.reset();
  }

  /**
   * Stop the loop at the next opportunity.
   */
  stop(reason: string = 'User requested stop'): void {
    this.status = 'stopped';
    this.loopController.stop('user_requested', reason);
  }

  // ── Private helpers ──

  private getCompletionReason(): string {
    switch (this.status) {
      case 'completed':
        return 'All stages completed successfully';
      case 'escalated':
        return 'Loop escalated to user';
      case 'stopped':
        return 'Loop stopped by user or max iterations';
      default:
        return 'Unknown completion reason';
    }
  }
}