/**
 * R12 P6 Plus2 (P2 退出标准) — Outer Loop Runner 拆分
 *
 * 借鉴 ralphy「batch orchestrator」+ comet「multi-story sequencing」：
 *
 * 痛点：loop-controller.ts advanceOuterBoardIfNeeded (~70 行) + runOuterLoop (~50 行)
 *       + buildOuterLoopResponse (~25 行) = ~145 行，OuterLoop 调度逻辑密集。
 *
 * 解法：抽出 OuterLoopRunner 工具类，封装 multi-story 顺序推进 + OuterLoop 执行 + 响应构造。
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 */

import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { Stage } from '../state-machine';
import type { StateMachine } from '../state-machine';
import type { StateManager } from '../../state/state-manager';
import type { OuterLoop, OuterLoopResult, StoryProvider, HumanGateFn, CommitFn } from '../outer-loop';
import type { StageHandlerProvider } from '../inner-loop';
import type { TokenBudget } from '../token-budget';
import {
  createDefaultStoryProvider,
  createDefaultHumanGate,
  createDefaultCommit,
} from '../outer-loop';

// ── OuterLoopRunner 依赖（从 LoopController 注入）──

export interface OuterLoopRunnerDeps {
  stateMachine: StateMachine;
  stateManager: StateManager | null;
  outerLoop: OuterLoop | null;
  handlerProvider: StageHandlerProvider;
  tokenBudget: TokenBudget;
  /** External callbacks for story provider / human gate / commit (optional) */
  outerLoopCallbacks: {
    storyProvider: StoryProvider;
    humanGate: HumanGateFn;
    commit: CommitFn;
  } | null;
  /** Build a standard LoopResponse */
  buildResponse: (
    stage: string,
    nextAction: NextAction,
    isHardStop?: boolean,
    loopLevel?: 'outer' | 'inner' | 'phase',
  ) => LoopResponse<any>;
  /** Sync state from memory to file */
  syncStateToFile: () => Promise<void>;
}

/**
 * OuterLoop 运行器：负责 multi-story 顺序调度。
 */
export class OuterLoopRunner {
  constructor(private readonly deps: OuterLoopRunnerDeps) {}

  /**
   * 故事完成后，把下一个 pending story 推到 board，重置 pipeline 到 design。
   * 行为等价于原 LoopController.advanceOuterBoardIfNeeded() 方法。
   */
  async advanceBoardIfNeeded(
    result: LoopResponse<{ stage: string; progress: string; next_action: NextAction; awaitingAction?: NextAction }>,
  ): Promise<void> {
    const { stateManager, stateMachine, tokenBudget } = this.deps;
    if (!stateManager) return;

    const stage = result.metadata?.stage || result.data?.stage;
    const action = result.next_action?.action;
    if (stage !== 'archive' || (action !== 'done' && action !== 'ship')) return;

    const state = stateManager.getState();
    const board = state.loops?.outer?.board || { pending: [], in_progress: [], done: [], blocked: [] };
    const doneStory = state.loop.current_story;
    const pending = [...(board.pending || [])];
    const nextStory = pending.shift();
    const done = [...(board.done || [])];
    if (doneStory) done.push(doneStory);

    if (!nextStory) {
      await stateManager.update({
        loops: {
          ...state.loops,
          outer: {
            ...state.loops.outer,
            board: { ...board, pending: [], in_progress: [], done, blocked: board.blocked || [] },
          },
        },
      });
      return;
    }

    // Reset pipeline for next story (keep PRD approved — start at design)
    stateMachine.loadState({
      current_stage: 'design',
      stages: {
        open: { status: 'completed' },
        design: { status: 'pending' },
        build: { status: 'pending' },
        verify: { status: 'pending' },
        archive: { status: 'pending' },
      } as any,
      iteration: stateMachine.getState().iteration,
    });
    // R10 第5轮 (D5): 切换到新 story 时重置 per-task 预算
    tokenBudget.resetPerTask();
    stateMachine.setInnerLoopState({ current_story: nextStory } as any);
    await stateManager.update({
      pipeline: {
        current_stage: 'design',
        stages: stateMachine.getState().stages as any,
      },
      loop: {
        ...state.loop,
        current_story: nextStory,
        progress: '20%',
      },
      loops: {
        ...state.loops,
        outer: {
          ...state.loops.outer,
          board: {
            pending,
            in_progress: [nextStory],
            done,
            blocked: board.blocked || [],
          },
        },
        inner: {
          ...state.loops.inner,
          current_story: nextStory,
        },
      },
    });
  }

  /**
   * 运行 OuterLoop（Story-level 调度）。
   * 行为等价于原 LoopController.runOuterLoop() 方法。
   */
  async run(): Promise<OuterLoopResult> {
    const { stateManager, stateMachine, outerLoop, handlerProvider, outerLoopCallbacks } = this.deps;

    const storyProvider = outerLoopCallbacks?.storyProvider ||
      (stateManager ? createDefaultStoryProvider(stateManager) : null);
    const humanGate = outerLoopCallbacks?.humanGate ||
      (stateManager ? createDefaultHumanGate(stateManager) : null);
    const commit = outerLoopCallbacks?.commit ||
      (stateManager ? createDefaultCommit(stateManager) : null);

    if (!storyProvider || !humanGate || !commit) {
      throw new Error('OuterLoop requires storyProvider, humanGate, and commit callbacks or StateManager');
    }

    const stateReader = async () => {
      const state = stateMachine.getState();
      const innerState = stateMachine.getInnerLoopState();
      return {
        current_stage: state.current_stage,
        has_in_progress: innerState.current_story !== null,
        iteration: state.iteration,
      };
    };

    // DAG parallel for independent stories when explicitly enabled
    if (process.env.AZA_OUTER_PARALLEL === 'true') {
      return await outerLoop!.runParallel(
        storyProvider,
        stateReader,
        handlerProvider,
        humanGate,
        commit,
      );
    }

    const result = await outerLoop!.run(
      storyProvider,
      stateReader,
      handlerProvider,
      humanGate,
      commit,
    );

    // Sync state after OuterLoop completes
    await this.deps.syncStateToFile();
    return result;
  }

  /**
   * 从 OuterLoop 结果构造 LoopResponse。
   * 行为等价于原 LoopController.buildOuterLoopResponse() 方法。
   */
  buildResponse(outerResult: OuterLoopResult): LoopResponse<{ stage: string; progress: string; next_action: NextAction }> {
    const { stateMachine, buildResponse } = this.deps;
    const stage = stateMachine.getCurrentStage();

    if (outerResult.done) {
      return buildResponse('archive', {
        tool: 'aza_loop', action: 'done',
        reason: 'All stories processed — project complete',
      });
    }

    if (outerResult.escalated) {
      return buildResponse(stage, {
        tool: 'aza_loop', action: 'escalate',
        reason: outerResult.escalation_reason || 'OuterLoop escalated to human',
      }, true);
    }

    // Continue with next story
    return buildResponse(stage, {
      tool: 'aza_loop', action: 'next',
      reason: `OuterLoop cycle ${outerResult.total_cycles} completed — continue to next story`,
    });
  }
}
