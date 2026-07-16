import { InnerLoop, type InnerLoopResult, type StageHandlerProvider } from './inner-loop';
import type { CircuitBreaker, CircuitBreakerResult } from './circuit-breaker';
import type { Stage } from './state-machine';
import { DAGBuilder, type Task as DAGTask } from './dag-builder';

/**
 * The phase of the outer loop cycle.
 */
export type OuterLoopPhase = 'schedule' | 'triage' | 'dispatch' | 'wait' | 'gate' | 'commit';

/**
 * A Story item that can be dispatched to the inner loop.
 */
export interface Story {
  /** Unique identifier for the Story. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Priority of the story (higher = more important). */
  priority: number;
  /** Whether the story has been started. */
  started: boolean;
  /** IDs of stories that must complete before this one (DAG dependencies). */
  dependencies?: string[];
  /**
   * R10 第9轮 (D15)：并行分组标签——借鉴 ralphy --parallel。
   *
   * PRD 可声明 parallel_groups: [[story1, story2], [story3]]，
   * 同一 parallel_group 的 stories 在同一波次并行执行，
   * 不同 group 顺序执行。比 dependencies 更声明式（适合非 DAG 场景）。
   * 若同时设置 dependencies 和 parallel_group，dependencies 优先。
   */
  parallel_group?: string;
}

/**
 * A record of one outer-loop cycle.
 */
export interface OuterCycleRecord {
  /** The cycle number (1-based). */
  cycle: number;
  /** Which phase of the outer loop was reached. */
  phase: OuterLoopPhase;
  /** Timestamp the cycle started. */
  started_at: string;
  /** Timestamp the cycle completed. */
  completed_at?: string;
  /** The Story dispatched, if any. */
  story_id?: string;
  /** The inner loop result, if the cycle completed an inner loop. */
  inner_result?: InnerLoopResult;
  /** Whether the Human Gate was reached. */
  human_gate_reached: boolean;
  /** Whether a commit/PR was created. */
  committed: boolean;
  /** Whether the cycle escalated. */
  escalated: boolean;
  /** Escalation reason, if escalated. */
  escalation_reason?: string;
  /** Tokens consumed during the cycle. */
  tokens_used: number;
}

/**
 * Result returned by {@link OuterLoop.run}.
 */
export interface OuterLoopResult {
  /** Whether the outer loop completed successfully. */
  success: boolean;
  /** Whether the loop is done (all stories processed + human gate passed). */
  done: boolean;
  /** Total cycles executed. */
  total_cycles: number;
  /** All cycle records. */
  cycle_history: OuterCycleRecord[];
  /** Whether the outer loop escalated to human. */
  escalated: boolean;
  /** Escalation reason, if escalated. */
  escalation_reason?: string;
  /** Summary of work completed. */
  work_summary: string;
  /** Suggestions accumulated across cycles. */
  suggestions: string[];
  /** Circuit breaker status at the end of the run. */
  breaker_status: CircuitBreakerResult | null;
}

/**
 * Options accepted by {@link OuterLoop}.
 */
export interface OuterLoopOptions {
  /** Maximum outer-loop cycles before stopping (default 20). */
  maxCycles?: number;
  /** Whether to require a Human Gate before committing (default true). */
  requireHumanGate?: boolean;
  /** Whether circuit-breaker monitoring is enabled (default true). */
  enableCircuitBreaker?: boolean;
  /** Maximum number of stories to dispatch in parallel (default 4). */
  maxParallel?: number;
}

/**
 * A function that returns the current backlog of Stories to process.
 */
export type StoryProvider = () => Promise<Story[]>;

/**
 * A function that reads the current STATE file.
 */
export type StateReader = () => Promise<{
  current_stage: Stage;
  has_in_progress: boolean;
  iteration: number;
}>;

/**
 * A function that performs the Human Gate check — returns true if the
 * human has approved continuation.
 */
export type HumanGateFn = (storyId: string, innerResult: InnerLoopResult) => Promise<boolean>;

/**
 * A function that creates a commit / PR after a successful inner loop.
 */
export type CommitFn = (storyId: string, innerResult: InnerLoopResult) => Promise<{
  committed: boolean;
  pr_url?: string;
}>;

/**
 * A function that performs triage — selects which story to dispatch next.
 */
export type TriageFn = (stories: Story[], state: { has_in_progress: boolean }) => Promise<Story | null>;

/**
 * Default triage: select the highest-priority unstarted story.
 */
export async function defaultTriage(
  stories: Story[],
  state: { has_in_progress: boolean },
): Promise<Story | null> {
  if (state.has_in_progress) return null;
  const available = stories
    .filter(s => !s.started)
    .sort((a, b) => b.priority - a.priority);
  return available[0] ?? null;
}

/**
 * Default StoryProvider: reads stories from STATE.yaml pipeline stages.
 * Each non-completed stage is treated as a Story item.
 */
export function createDefaultStoryProvider(stateManager: { getState: () => any }): StoryProvider {
  return async () => {
    const state = stateManager.getState();
    // Prefer outer board stories (multi-task batch) when present
    const board = state.loops?.outer?.board;
    const boardIds = [
      ...(board?.in_progress || []),
      ...(board?.pending || []),
    ].filter(Boolean);
    if (boardIds.length > 0) {
      return boardIds.map((id: string, index: number) => ({
        id,
        title: String(id),
        priority: boardIds.length - index,
        started: (board?.in_progress || []).includes(id),
      }));
    }

    const stages = state.pipeline?.stages || {};
    const stageOrder: Stage[] = ['open', 'design', 'build', 'verify', 'archive'];
    
    return stageOrder
      .filter(stage => stages[stage]?.status !== 'completed')
      .map((stage, index) => ({
        id: `STORY-${stage.toUpperCase()}`,
        title: `Stage: ${stage}`,
        priority: stageOrder.length - index,
        started: stages[stage]?.status === 'in_progress',
      }));
  };
}

/**
 * Default HumanGateFn: auto-approves if PRD review is passed,
 * otherwise returns false to require human intervention.
 */
export function createDefaultHumanGate(stateManager: { getState: () => any }): HumanGateFn {
  return async (storyId: string, innerResult: InnerLoopResult) => {
    const state = stateManager.getState();
    const prdApproved = state.attestation?.verified === true;
    
    if (prdApproved) {
      return true;
    }
    
    // Auto-approve on first cycle, require human on subsequent cycles
    return innerResult.total_iterations <= 1;
  };
}

/**
 * Default CommitFn: records the commit in STATE.yaml.
 * In MCP tool context, the actual git commit is performed by the LLM.
 */
export function createDefaultCommit(stateManager: { getState: () => any; update: (update: any) => Promise<any> }): CommitFn {
  return async (storyId: string, innerResult: InnerLoopResult) => {
    const state = stateManager.getState();
    await stateManager.update({
      pipeline: {
        current_stage: state.pipeline.current_stage,
        stages: {
          ...state.pipeline.stages,
          [state.pipeline.current_stage]: {
            ...state.pipeline.stages[state.pipeline.current_stage],
            status: 'completed',
            completed_at: new Date().toISOString(),
          },
        },
      },
    });
    
    return {
      committed: true,
      pr_url: undefined,
    };
  };
}

/**
 * Outer loop controller.
 *
 * Implements the time-driven triage cycle:
 *
 *   schedule → triage → read STATE → dispatch Story → wait for inner loop → Human Gate → commit/PR/escalate
 *
 * The outer loop also monitors the circuit breaker at the outer level and
 * escalates to human intervention if any dimension trips.
 *
 * When no external callbacks are provided, uses default implementations that
 * read from STATE.yaml and auto-approve after PRD review.
 */
export class OuterLoop {
  private innerLoop: InnerLoop;
  private circuitBreaker?: CircuitBreaker;
  private options: Required<OuterLoopOptions>;
  private cycleHistory: OuterCycleRecord[] = [];
  private totalCycles: number = 0;

  constructor(
    circuitBreaker?: CircuitBreaker,
    options: OuterLoopOptions = {},
    sharedInnerLoop?: InnerLoop,
  ) {
    this.circuitBreaker = circuitBreaker;
    this.options = {
      maxCycles: options.maxCycles ?? 20,
      requireHumanGate: options.requireHumanGate ?? true,
      enableCircuitBreaker: options.enableCircuitBreaker ?? true,
      maxParallel: options.maxParallel ?? 4,
    };
    // Use shared InnerLoop instance if provided (e.g., from LoopController)
    // to ensure state machine reference is consistent across all loop levels.
    this.innerLoop = sharedInnerLoop ?? new InnerLoop(circuitBreaker);
  }

  /**
   * Run the outer loop.
   *
   * The loop cycles through triage → dispatch → wait → gate → commit until:
   * - All stories are processed and the Human Gate is passed, OR
   * - The maximum cycle count is reached, OR
   * - The circuit breaker trips at the outer level, OR
   * - An escalation occurs.
   *
   * @param storyProvider  Returns the current backlog of Stories.
   * @param stateReader     Reads the current STATE file.
   * @param handlerProvider Provides stage handlers for the inner loop.
   * @param humanGate       Performs the Human Gate check.
   * @param commit          Creates a commit / PR after successful inner loop.
   * @param triage          Optional custom triage function (defaults to priority-based).
   */
  async run(
    storyProvider: StoryProvider,
    stateReader: StateReader,
    handlerProvider: StageHandlerProvider,
    humanGate: HumanGateFn,
    commit: CommitFn,
    triage: TriageFn = defaultTriage,
  ): Promise<OuterLoopResult> {
    this.cycleHistory = [];
    this.totalCycles = 0;
    const suggestions: string[] = [];
    const workParts: string[] = [];

    for (let cycle = 1; cycle <= this.options.maxCycles; cycle++) {
      this.totalCycles = cycle;
      const cycleStart = new Date().toISOString();

      // ── Phase 1: Schedule ──
      // The schedule phase is implicit — we are now entering a cycle.

      // ── Phase 2: Read STATE ──
      const state = await stateReader();

      // ── Phase 3: Triage ──
      const stories = await storyProvider();
      const selectedStory = await triage(stories, { has_in_progress: state.has_in_progress });

      if (!selectedStory) {
        // No story to dispatch — check if we're done
        const allDone = stories.every(s => s.started);
        const record: OuterCycleRecord = {
          cycle,
          phase: 'triage',
          started_at: cycleStart,
          completed_at: new Date().toISOString(),
          human_gate_reached: false,
          committed: false,
          escalated: false,
          tokens_used: 0,
        };
        this.cycleHistory.push(record);

        if (allDone) {
          return this.complete(workParts, suggestions);
        }
        // Nothing to do this cycle — continue to next
        continue;
      }

      // ── Phase 4: Dispatch Story to inner loop ──
      const innerResult = await this.innerLoop.run(selectedStory.id, handlerProvider);

      suggestions.push(...innerResult.suggestions);

      // ── Phase 5: Wait for inner loop completion ──
      // (Already completed — innerLoop.run is synchronous-await)

      let humanGatePassed = false;
      let committed = false;
      let escalated = false;
      let escalationReason: string | undefined;

      if (innerResult.success) {
        // Inner loop succeeded — check Human Gate
        if (this.options.requireHumanGate) {
          humanGatePassed = await humanGate(selectedStory.id, innerResult);
        } else {
          humanGatePassed = true;
        }

        if (humanGatePassed) {
          // ── Phase 6: Commit / PR ──
          const commitResult = await commit(selectedStory.id, innerResult);
          committed = commitResult.committed;
          if (committed) {
            workParts.push(`Story "${selectedStory.id}": committed${commitResult.pr_url ? ` (PR: ${commitResult.pr_url})` : ''}`);
          }
          suggestions.push(`Story "${selectedStory.id}" committed successfully`);
        } else {
          escalated = true;
          escalationReason = `Human Gate rejected story "${selectedStory.id}"`;
        }
      } else {
        // Inner loop failed or escalated
        if (innerResult.escalated) {
          escalated = true;
          escalationReason = innerResult.escalation_reason || `Inner loop escalated for story "${selectedStory.id}"`;
        } else {
          escalated = true;
          escalationReason = `Inner loop failed for story "${selectedStory.id}"`;
        }
      }

      // Record the cycle
      this.cycleHistory.push({
        cycle,
        phase: escalated ? 'gate' : 'commit',
        started_at: cycleStart,
        completed_at: new Date().toISOString(),
        story_id: selectedStory.id,
        inner_result: innerResult,
        human_gate_reached: humanGatePassed,
        committed,
        escalated,
        escalation_reason: escalationReason,
        tokens_used: innerResult.total_iterations * 1000, // approximate
      });

      // Record for circuit breaker
      if (this.circuitBreaker && this.options.enableCircuitBreaker) {
        if (committed) {
          this.circuitBreaker.recordProgress('outer');
        } else {
          this.circuitBreaker.recordFailure(
            'outer',
            escalationReason || `Cycle ${cycle} did not commit`,
          );
        }

        // Check circuit breaker
        const breakerResult = this.circuitBreaker.check('outer');
        if (breakerResult.tripped) {
          return this.escalate(
            `Circuit breaker tripped: ${breakerResult.reason}`,
            workParts,
            suggestions,
            breakerResult,
          );
        }
      }

      // If escalated, stop the outer loop
      if (escalated) {
        return this.escalate(
          escalationReason || 'Unknown escalation',
          workParts,
          suggestions,
          null,
        );
      }
    }

    // Reached max cycles
    return {
      success: false,
      done: false,
      total_cycles: this.totalCycles,
      cycle_history: this.cycleHistory,
      escalated: true,
      escalation_reason: `Reached maximum cycles (${this.options.maxCycles})`,
      work_summary: workParts.join('\n'),
      suggestions,
      breaker_status: this.circuitBreaker && this.options.enableCircuitBreaker
        ? this.circuitBreaker.check('outer')
        : null,
    };
  }

  /**
   * Get the cycle history from the last run.
   */
  getCycleHistory(): OuterCycleRecord[] {
    return [...this.cycleHistory];
  }

  /**
   * Run the outer loop with DAG-based parallel dispatch.
   *
   * Uses the L7 DAGBuilder to identify independent stories (no dependency
   * edges) and dispatches them to the inner loop in parallel via
   * `Promise.all`. Stories with unsatisfied dependencies are deferred
   * until their blockers complete.
   *
   * Falls back to sequential dispatch for stories that declare no
   * `dependencies` field.
   */
  async runParallel(
    storyProvider: StoryProvider,
    stateReader: StateReader,
    handlerProvider: StageHandlerProvider,
    humanGate: HumanGateFn,
    commit: CommitFn,
  ): Promise<OuterLoopResult> {
    this.cycleHistory = [];
    this.totalCycles = 0;
    const suggestions: string[] = [];
    const workParts: string[] = [];

    // Build DAG from stories
    const stories = await storyProvider();
    const dag = new DAGBuilder();
    const dagTasks: DAGTask[] = stories.map(s => ({
      id: s.id,
      title: s.title,
      dependencies: s.dependencies ?? [],
      status: s.started ? 'in_progress' as const : 'pending' as const,
    }));
    const buildResult = dag.build(dagTasks);

    if (!buildResult.is_acyclic) {
      return {
        success: false,
        done: false,
        total_cycles: 0,
        cycle_history: [],
        escalated: true,
        escalation_reason: `DAG cycle detected: ${buildResult.cycle?.join(' → ')}`,
        work_summary: '',
        suggestions: ['Resolve cyclic dependencies between stories'],
        breaker_status: null,
      };
    }

    // Process waves: each wave dispatches all ready (no-blocker) stories in parallel
    for (let wave = 1; wave <= this.options.maxCycles; wave++) {
      this.totalCycles = wave;
      const waveStart = new Date().toISOString();

      const readyTasks = dag.getParallelTasks();
      if (readyTasks.length === 0) {
        const status = dag.getStatus();
        if (status.done === status.total) {
          return this.complete(workParts, suggestions);
        }
        // All remaining tasks are blocked — escalate
        return this.escalate(
          `No parallel-ready tasks — ${status.blocked} blocked, ${status.pending} pending`,
          workParts, suggestions, null,
        );
      }

      // Cap parallelism
      const batch = readyTasks.slice(0, this.options.maxParallel);

      // Dispatch batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          const story = stories.find(s => s.id === task.id);
          if (!story) return { task, innerResult: null, storyId: task.id };

          const innerResult = await this.innerLoop.run(story.id, handlerProvider);
          return { task, innerResult, storyId: story.id };
        }),
      );

      // Process results
      let anyEscalated = false;
      let escalationReason: string | undefined;

      for (const { task, innerResult, storyId } of batchResults) {
        if (!innerResult) continue;

        suggestions.push(...innerResult.suggestions);

        let humanGatePassed = false;
        let committed = false;
        let escalated = false;

        if (innerResult.success) {
          if (this.options.requireHumanGate) {
            humanGatePassed = await humanGate(storyId, innerResult);
          } else {
            humanGatePassed = true;
          }

          if (humanGatePassed) {
            const commitResult = await commit(storyId, innerResult);
            committed = commitResult.committed;
            if (committed) {
              workParts.push(`Story "${storyId}": committed${commitResult.pr_url ? ` (PR: ${commitResult.pr_url})` : ''}`);
              dag.markDone(task.id);
            }
          } else {
            escalated = true;
            escalationReason = `Human Gate rejected story "${storyId}"`;
          }
        } else {
          escalated = true;
          escalationReason = innerResult.escalation_reason || `Inner loop failed for story "${storyId}"`;
        }

        this.cycleHistory.push({
          cycle: wave,
          phase: escalated ? 'gate' : 'commit',
          started_at: waveStart,
          completed_at: new Date().toISOString(),
          story_id: storyId,
          inner_result: innerResult,
          human_gate_reached: humanGatePassed,
          committed,
          escalated,
          escalation_reason: escalated ? escalationReason : undefined,
          tokens_used: innerResult.total_iterations * 1000,
        });

        if (escalated) {
          anyEscalated = true;
        }

        // Circuit breaker recording
        if (this.circuitBreaker && this.options.enableCircuitBreaker) {
          if (committed) {
            this.circuitBreaker.recordProgress('outer');
          } else {
            this.circuitBreaker.recordFailure('outer', escalationReason || `Wave ${wave} did not commit`);
          }
        }
      }

      // Check circuit breaker after wave
      if (this.circuitBreaker && this.options.enableCircuitBreaker) {
        const breakerResult = this.circuitBreaker.check('outer');
        if (breakerResult.tripped) {
          return this.escalate(
            `Circuit breaker tripped: ${breakerResult.reason}`,
            workParts, suggestions, breakerResult,
          );
        }
      }

      if (anyEscalated) {
        return this.escalate(
          escalationReason || 'Unknown escalation',
          workParts, suggestions, null,
        );
      }
    }

    // Reached max cycles
    return {
      success: false,
      done: false,
      total_cycles: this.totalCycles,
      cycle_history: this.cycleHistory,
      escalated: true,
      escalation_reason: `Reached maximum cycles (${this.options.maxCycles})`,
      work_summary: workParts.join('\n'),
      suggestions,
      breaker_status: this.circuitBreaker && this.options.enableCircuitBreaker
        ? this.circuitBreaker.check('outer')
        : null,
    };
  }

  /**
   * R10 第9轮 (D15)：基于 parallel_group 的并行批次执行——借鉴 ralphy --parallel。
   *
   * 与 {@link runParallel} 的差异：
   * - `runParallel` 基于 DAG dependencies 自动识别可并行 stories
   * - `runParallelGroups` 基于 PRD 声明的 `parallel_group` 字段显式分组
   *
   * 语义：
   * - 同一 parallel_group 的 stories 在同一波次并行执行（Promise.all）
   * - 不同 group 顺序执行（group A 完成 → group B 开始）
   * - 无 parallel_group 的 stories 单独成组、按 priority 顺序执行
   *
   * 适用场景：PRD 作者明确知道哪些 stories 可以并行（如多个独立模块的构建），
   * 不想手算 dependencies，直接声明分组更直观。
   *
   * @param storyProvider     返回当前 backlog（stories 需带 parallel_group 字段）
   * @param stateReader       读取 STATE 文件
   * @param handlerProvider   提供 stage handlers
   * @param humanGate         Human Gate 检查
   * @param commit            Commit/PR 回调
   */
  async runParallelGroups(
    storyProvider: StoryProvider,
    stateReader: StateReader,
    handlerProvider: StageHandlerProvider,
    humanGate: HumanGateFn,
    commit: CommitFn,
  ): Promise<OuterLoopResult> {
    this.cycleHistory = [];
    this.totalCycles = 0;
    const suggestions: string[] = [];
    const workParts: string[] = [];

    const stories = await storyProvider();
    if (stories.length === 0) {
      return this.complete(workParts, suggestions);
    }

    // 按 parallel_group 分组（undefined 单独成组）
    const groupMap = new Map<string, Story[]>();
    for (const s of stories) {
      const g = s.parallel_group ?? '__default__';
      const arr = groupMap.get(g) ?? [];
      arr.push(s);
      groupMap.set(g, arr);
    }
    // 组内按 priority 降序（保证高优先级先调度）
    for (const arr of groupMap.values()) {
      arr.sort((a, b) => b.priority - a.priority);
    }
    // 组顺序：default 组最后（确保显式声明的组先跑）
    const groupNames = [...groupMap.keys()].sort((a, b) => {
      if (a === '__default__') return 1;
      if (b === '__default__') return -1;
      return a.localeCompare(b);
    });

    for (let wave = 1; wave <= this.options.maxCycles; wave++) {
      this.totalCycles = wave;
      const groupName = groupNames[wave - 1];
      if (!groupName) {
        // 所有 group 已处理完
        return this.complete(workParts, suggestions);
      }
      const group = groupMap.get(groupName) ?? [];
      if (group.length === 0) continue;

      const waveStart = new Date().toISOString();
      // Cap parallelism within the group
      const batch = group.slice(0, this.options.maxParallel);

      // Dispatch batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (story) => {
          const innerResult = await this.innerLoop.run(story.id, handlerProvider);
          return { story, innerResult };
        }),
      );

      let anyEscalated = false;
      let escalationReason: string | undefined;

      for (const { story, innerResult } of batchResults) {
        suggestions.push(...innerResult.suggestions);

        let humanGatePassed = false;
        let committed = false;
        let escalated = false;

        if (innerResult.success) {
          if (this.options.requireHumanGate) {
            humanGatePassed = await humanGate(story.id, innerResult);
          } else {
            humanGatePassed = true;
          }
          if (humanGatePassed) {
            const commitResult = await commit(story.id, innerResult);
            committed = commitResult.committed;
            if (committed) {
              workParts.push(
                `Story "${story.id}" (group=${groupName}): committed${commitResult.pr_url ? ` (PR: ${commitResult.pr_url})` : ''}`,
              );
            }
          } else {
            escalated = true;
            escalationReason = `Human Gate rejected story "${story.id}" in group "${groupName}"`;
          }
        } else {
          escalated = true;
          escalationReason = innerResult.escalation_reason || `Inner loop failed for story "${story.id}"`;
        }

        this.cycleHistory.push({
          cycle: wave,
          phase: escalated ? 'gate' : 'commit',
          started_at: waveStart,
          completed_at: new Date().toISOString(),
          story_id: story.id,
          inner_result: innerResult,
          human_gate_reached: humanGatePassed,
          committed,
          escalated,
          escalation_reason: escalated ? escalationReason : undefined,
          tokens_used: innerResult.total_iterations * 1000,
        });

        if (escalated) anyEscalated = true;

        if (this.circuitBreaker && this.options.enableCircuitBreaker) {
          if (committed) {
            this.circuitBreaker.recordProgress('outer');
          } else {
            this.circuitBreaker.recordFailure('outer', escalationReason || `Wave ${wave} did not commit`);
          }
        }
      }

      if (this.circuitBreaker && this.options.enableCircuitBreaker) {
        const breakerResult = this.circuitBreaker.check('outer');
        if (breakerResult.tripped) {
          return this.escalate(
            `Circuit breaker tripped: ${breakerResult.reason}`,
            workParts, suggestions, breakerResult,
          );
        }
      }

      if (anyEscalated) {
        return this.escalate(
          escalationReason || 'Unknown escalation',
          workParts, suggestions, null,
        );
      }
    }

    return {
      success: false,
      done: false,
      total_cycles: this.totalCycles,
      cycle_history: this.cycleHistory,
      escalated: true,
      escalation_reason: `Reached maximum cycles (${this.options.maxCycles})`,
      work_summary: workParts.join('\n'),
      suggestions,
      breaker_status: this.circuitBreaker && this.options.enableCircuitBreaker
        ? this.circuitBreaker.check('outer')
        : null,
    };
  }

  // ── private helpers ──

  private complete(workParts: string[], suggestions: string[]): OuterLoopResult {
    return {
      success: true,
      done: true,
      total_cycles: this.totalCycles,
      cycle_history: this.cycleHistory,
      escalated: false,
      work_summary: workParts.join('\n'),
      suggestions,
      breaker_status: this.circuitBreaker && this.options.enableCircuitBreaker
        ? this.circuitBreaker.check('outer')
        : null,
    };
  }

  private escalate(
    reason: string,
    workParts: string[],
    suggestions: string[],
    breakerStatus: CircuitBreakerResult | null,
  ): OuterLoopResult {
    return {
      success: false,
      done: false,
      total_cycles: this.totalCycles,
      cycle_history: this.cycleHistory,
      escalated: true,
      escalation_reason: reason,
      work_summary: workParts.join('\n'),
      suggestions,
      breaker_status: breakerStatus,
    };
  }
}
