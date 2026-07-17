/**
 * R10 第11轮 (P1 状态收敛)：TransitionPlanner — 纯函数状态转换器。
 *
 * 借鉴 comet「pure resume probe」+ planning-with-files「deterministic plan」：
 * 把 loop-controller 里的状态推导逻辑抽到纯函数，相同输入必得相同输出，
 * 可独立测试、可缓存、可重放。
 *
 * 设计原则：
 * - 零 I/O：不读盘、不写盘、不发请求
 * - 零副作用：不修改输入 state
 * - 确定性：相同 (state, event) → 相同 (nextState, action)
 * - 可序列：所有输入输出都是 JSON 兼容
 *
 * 职责边界：
 * - 接收：当前 RunState + 触发事件（stage_result / tool_response / tick / user_input）
 * - 输出：下一个 RunState + 推荐的 next_action
 * - 不做：实际执行 next_action（那是 executor 的事）
 * - 不做：I/O 操作（那是 runtime 的事）
 */

import type { Stage } from '../state-machine';

export type TransitionEvent =
  | { kind: 'stage_result'; stage: Stage; passed: boolean; error?: string }
  | { kind: 'tool_response'; tool: string; action: string; success: boolean; blocked?: boolean; reason?: string }
  | { kind: 'tick'; iteration: number; ts: number }
  | { kind: 'user_input'; text: string; ts: number }
  | { kind: 'awaiting_action_resolved'; iteration: number };

export type TransitionAction =
  | { kind: 'next'; tool: string; action: string; reason: string }
  | { kind: 'stop'; reason: 'gate_blocked' | 'max_iterations' | 'deadlock' | 'circuit_open' | 'completed' | 'aborted' }
  | { kind: 'back_to'; stage: Stage; reason: string }
  | { kind: 'noop'; reason: string };

export interface TransitionInput {
  /** 当前 stage */
  currentStage: Stage;
  /** 当前 iteration */
  iteration: number;
  /** 累计失败次数 */
  failures: number;
  /** circuit breaker 是否打开 */
  circuitOpen: boolean;
  /** 已知 awaiting action 的 tool/action */
  awaitingAction?: { tool: string; action: string };
  /** 已经通过的 stage 集合 */
  completedStages: ReadonlySet<Stage>;
  /** 已经尝试的 iteration 数（用于 max_iterations gate） */
  maxIterations: number;
  /** 终止 stage（一般是 archive） */
  terminalStage: Stage;
}

export interface TransitionResult {
  nextStage: Stage;
  nextIteration: number;
  action: TransitionAction;
  /** 是否触发了硬门禁（用于 audit log） */
  hardGate?: string;
}

/**
 * 默认 stage 顺序（借鉴 spec-kit constitution-driven 流程）。
 * open → design → build → verify → archive
 */
export const DEFAULT_STAGE_ORDER: readonly Stage[] = ['open', 'design', 'build', 'verify', 'archive'];

/**
 * 工具 → 下一个 stage 的映射表（缺省按 stage_order 推进）。
 */
const TOOL_TO_NEXT_STAGE: Record<string, Stage> = {
  aza_spec_design: 'build',
  aza_spec_implement: 'verify',
  aza_spec_apply: 'verify',
  aza_quality_check: 'archive',
  aza_finish_ship: 'archive',
  aza_finish_archive: 'archive',
};

/**
 * R10 第11轮 (P1) 核心：纯函数 transition planner。
 *
 * 相同 (input, event) 必须返回相同 result — 这是可测试性的硬保证。
 */
export function planTransition(input: TransitionInput, event: TransitionEvent): TransitionResult {
  // 1. 硬终止条件：max iterations
  if (input.iteration >= input.maxIterations) {
    return {
      nextStage: input.currentStage,
      nextIteration: input.iteration,
      action: { kind: 'stop', reason: 'max_iterations' },
      hardGate: 'max_iterations',
    };
  }

  // 2. 硬终止条件：circuit breaker 打开
  if (input.circuitOpen) {
    return {
      nextStage: input.currentStage,
      nextIteration: input.iteration,
      action: { kind: 'stop', reason: 'circuit_open' },
      hardGate: 'circuit_open',
    };
  }

  // 3. 终止 stage 已完成 → 整体完成
  if (input.completedStages.has(input.terminalStage)) {
    return {
      nextStage: input.terminalStage,
      nextIteration: input.iteration,
      action: { kind: 'stop', reason: 'completed' },
    };
  }

  // 4. 事件驱动 transition
  switch (event.kind) {
    case 'stage_result': {
      if (!event.passed) {
        // 失败：留在当前 stage + 建议重试或后退
        return {
          nextStage: input.currentStage,
          nextIteration: input.iteration + 1,
          action: {
            kind: 'next',
            tool: input.awaitingAction?.tool ?? 'aza_loop',
            action: input.awaitingAction?.action ?? 'next',
            reason: `stage ${event.stage} failed: ${event.error ?? 'unknown'}; retry`,
          },
          hardGate: 'stage_failed',
        };
      }
      // 成功：推进到下一个 stage
      const nextStage = advanceStage(input.currentStage, input.completedStages, input.terminalStage);
      return {
        nextStage,
        nextIteration: input.iteration + 1,
        action: {
          kind: 'next',
          tool: 'aza_loop',
          action: 'next',
          reason: `stage ${event.stage} passed; advance to ${nextStage}`,
        },
      };
    }

    case 'tool_response': {
      const key = `${event.tool}_${event.action}`;
      const nextStage = TOOL_TO_NEXT_STAGE[key] ?? input.currentStage;
      // 失败不强制回退，但记录 reason
      if (!event.success) {
        return {
          nextStage: input.currentStage,
          nextIteration: input.iteration + 1,
          action: {
            kind: 'next',
            tool: event.tool,
            action: event.action,
            reason: event.reason ?? `${key} failed; retry`,
          },
          hardGate: event.blocked ? 'stage_write_guard' : undefined,
        };
      }
      return {
        nextStage,
        nextIteration: input.iteration + 1,
        action: {
          kind: 'next',
          tool: 'aza_loop',
          action: 'next',
          reason: `${key} succeeded; advance to ${nextStage}`,
        },
      };
    }

    case 'tick': {
      // Tick 不改变 stage，只递增 iteration
      return {
        nextStage: input.currentStage,
        nextIteration: event.iteration,
        action: { kind: 'noop', reason: 'tick' },
      };
    }

    case 'user_input': {
      // 用户输入：留在当前 stage 但建议重新评估 plan
      return {
        nextStage: input.currentStage,
        nextIteration: input.iteration + 1,
        action: {
          kind: 'next',
          tool: 'aza_auto',
          action: 'plan',
          reason: `user input: ${event.text.slice(0, 60)}`,
        },
      };
    }

    case 'awaiting_action_resolved': {
      // awaiting action 已解决：停留在原 stage 等待下一次 step
      return {
        nextStage: input.currentStage,
        nextIteration: event.iteration,
        action: { kind: 'noop', reason: 'awaiting action resolved' },
      };
    }
  }
}

/**
 * 推进到下一个未完成的 stage。
 * 如果当前 stage 在已完成集合中，跳过；否则当前 stage 标记为完成。
 */
function advanceStage(
  current: Stage,
  completed: ReadonlySet<Stage>,
  terminal: Stage,
): Stage {
  const idx = DEFAULT_STAGE_ORDER.indexOf(current);
  if (idx < 0) return current;
  for (let i = idx + 1; i < DEFAULT_STAGE_ORDER.length; i++) {
    const s = DEFAULT_STAGE_ORDER[i];
    if (s === undefined) continue;
    if (s === terminal) return terminal;
    if (!completed.has(s)) return s;
  }
  return terminal;
}

/**
 * 默认 TransitionInput 工厂 — 让 runtime 只需提供增量信息。
 */
export function makeDefaultInput(opts: Partial<TransitionInput> = {}): TransitionInput {
  return {
    currentStage: 'open',
    iteration: 0,
    failures: 0,
    circuitOpen: false,
    completedStages: new Set(),
    maxIterations: 100,
    terminalStage: 'archive',
    ...opts,
  };
}
