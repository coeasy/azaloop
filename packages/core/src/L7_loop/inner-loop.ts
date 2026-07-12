import { StateMachine, type Stage } from './state-machine';
import { PhaseLoop, type PhaseResult, type MakerFn, type CheckerFn, type OptimizerFn } from './phase-loop';
import type { CircuitBreaker } from './circuit-breaker';
import { DAGBuilder, type Task as DAGTask } from './dag-builder';
import { DecisionPointRegistry } from './decision-points';

/**
 * A record of a single stage's execution within the inner loop.
 */
export interface StageRecord {
  /** The stage that was executed. */
  stage: Stage;
  /** The phase result from running the stage. */
  result: PhaseResult;
  /** Timestamp the stage started. */
  started_at: string;
  /** Timestamp the stage completed (or was abandoned). */
  completed_at?: string;
  /** Whether the stage was auto-transitioned to the next. */
  auto_transitioned: boolean;
}

/**
 * Result returned by {@link InnerLoop.run}.
 */
export interface InnerLoopResult {
  /** Whether the full 5-stage pipeline completed successfully. */
  success: boolean;
  /** The Story ID this inner loop was processing. */
  story_id: string;
  /** The current stage when the loop ended. */
  current_stage: Stage;
  /** Whether all stages completed. */
  completed: boolean;
  /** Total iterations across all stages. */
  total_iterations: number;
  /** Per-stage execution records. */
  stage_history: StageRecord[];
  /** Whether the inner loop escalated to the outer loop. */
  escalated: boolean;
  /** Escalation reason, if escalated. */
  escalation_reason?: string;
  /** Accumulated work summary across all stages. */
  work_summary: string;
  /** Aggregate suggestions from all phases. */
  suggestions: string[];
}

/**
 * Options accepted by {@link InnerLoop}.
 */
export interface InnerLoopOptions {
  /** Maximum consecutive stage failures before escalating (default 3). */
  maxStageFailures?: number;
  /** Whether to automatically transition to the next stage (default true). */
  autoTransition?: boolean;
  /** Max iterations per phase (default 5). */
  maxPhaseIterations?: number;
  /** Decision point registry for recording DP transitions (DP-0 to DP-7). */
  dpRegistry?: DecisionPointRegistry;
}

/**
 * Maker/checker/optimizer provider for a given stage.
 *
 * The inner loop calls this to obtain the three functions needed to run
 * the phase loop for each stage.
 */
export interface StageHandlers {
  maker: MakerFn;
  checker: CheckerFn;
  optimizer: OptimizerFn;
}

/**
 * A function that provides handlers for a given stage.
 */
export type StageHandlerProvider = (stage: Stage) => StageHandlers;

/**
 * Inner loop controller.
 *
 * Manages the 5-stage pipeline progression (open → design → build → verify → archive)
 * for a single Story. Each stage runs a {@link PhaseLoop} instance.
 *
 * If a stage fails more than {@link InnerLoopOptions.maxStageFailures} times,
 * the inner loop escalates to the outer loop.
 */
export class InnerLoop {
  private stateMachine: StateMachine;
  private phaseLoop: PhaseLoop;
  private circuitBreaker?: CircuitBreaker;
  private options: InnerLoopOptions;
  private stageHistory: StageRecord[] = [];
  private stageFailures: number = 0;
  private totalIterations: number = 0;

  constructor(
    circuitBreaker?: CircuitBreaker,
    options: InnerLoopOptions = {},
    stateMachine?: StateMachine,
  ) {
    this.circuitBreaker = circuitBreaker;
    this.options = {
      maxStageFailures: options.maxStageFailures ?? 3,
      autoTransition: options.autoTransition ?? true,
      maxPhaseIterations: options.maxPhaseIterations ?? 5,
      dpRegistry: options.dpRegistry,
    };
    this.stateMachine = stateMachine ?? new StateMachine();
    this.phaseLoop = new PhaseLoop(circuitBreaker, {
      maxIterations: this.options.maxPhaseIterations ?? 5,
      dpRegistry: this.options.dpRegistry,
    });
  }

  /**
   * Run the inner loop for a single Story through all 5 stages.
   *
   * @param storyId  The ID of the Story being processed.
   * @param provider A function that returns maker/checker/optimizer for each stage.
   */
  async run(storyId: string, provider: StageHandlerProvider): Promise<InnerLoopResult> {
    this.stageHistory = [];
    this.stageFailures = 0;
    this.totalIterations = 0;
    // Use the injected/shared StateMachine — do NOT create a new one.
    // LoopController manages the state lifecycle.

    const suggestions: string[] = [];
    const workParts: string[] = [];

    const STAGES: Stage[] = ['open', 'design', 'build', 'verify', 'archive'];

    for (const stage of STAGES) {
      const stageStart = new Date().toISOString();
      this.stateMachine.setStageStatus(stage, 'in_progress');

      // V12: DAG Builder integration — build task dependency graph in design stage
      if (stage === 'design') {
        try {
          const dag = new DAGBuilder();
          // Build a task list from the story and any subtasks defined in STATE
          const tasks: DAGTask[] = [
            { id: storyId, title: `Story: ${storyId}`, dependencies: [], status: 'pending' },
          ];
          // If there are other stories in the stage history, add them as potential dependencies
          for (const record of this.stageHistory) {
            if (record.stage !== stage) {
              tasks.push({
                id: `STORY-${record.stage.toUpperCase()}`,
                title: `Stage: ${record.stage}`,
                dependencies: [],
                status: record.result.success ? 'done' : 'pending',
              });
            }
          }
          const buildResult = dag.build(tasks);
          if (buildResult.is_acyclic) {
            const parallelTasks = dag.getParallelTasks();
            if (parallelTasks.length > 1) {
              workParts.push(`[design] DAG: ${parallelTasks.length} parallel tasks detected (topological order: ${buildResult.topological_order.join(' → ')})`);
            }
          } else if (buildResult.cycle) {
            workParts.push(`[design] DAG: Cycle detected: ${buildResult.cycle.join(' → ')} — blocking`);
          }
        } catch { /* best-effort: DAG is non-fatal */ }
      }

      // Obtain handlers for this stage
      const handlers = provider(stage);

      // Run the phase loop for this stage
      const phaseResult = await this.phaseLoop.run(
        stage,
        handlers.maker,
        handlers.checker,
        handlers.optimizer,
      );

      this.totalIterations += phaseResult.iterations;

      const record: StageRecord = {
        stage,
        result: phaseResult,
        started_at: stageStart,
        completed_at: new Date().toISOString(),
        auto_transitioned: false,
      };

      if (phaseResult.success) {
        // Stage succeeded
        this.stateMachine.setStageStatus(stage, 'completed');
        workParts.push(`[${stage}] ${phaseResult.work}`);
        suggestions.push(...phaseResult.suggestions);
        this.stageHistory.push(record);

        // Circuit breaker: record progress
        this.circuitBreaker?.recordProgress('inner');
        this.stageFailures = 0;

        // Auto-transition to next stage
        if ((this.options.autoTransition ?? true) && stage !== 'archive') {
          const idx = STAGES.indexOf(stage);
          const nextStage = STAGES[idx + 1];
          if (nextStage) {
            record.auto_transitioned = true;
            this.stateMachine.setStageStatus(nextStage, 'in_progress');
          }
        }
      } else {
        // Stage failed
        this.stateMachine.setStageStatus(stage, 'blocked', phaseResult.escalation_reason);
        this.stageFailures++;
        suggestions.push(...phaseResult.suggestions);
        this.stageHistory.push(record);

        // Circuit breaker: record failure
        this.circuitBreaker?.recordFailure(
          'inner',
          phaseResult.escalation_reason || `Stage "${stage}" failed`,
        );

        // Check if we should escalate
        if (this.stageFailures >= (this.options.maxStageFailures ?? 3)) {
          return this.escalate(
            storyId,
            `${this.stageFailures} consecutive stage failures`,
            workParts,
            suggestions,
          );
        }

        // Check circuit breaker
        if (this.circuitBreaker) {
          const breakerResult = this.circuitBreaker.check('inner');
          if (breakerResult.tripped) {
            return this.escalate(
              storyId,
              `Circuit breaker tripped: ${breakerResult.reason}`,
              workParts,
              suggestions,
            );
          }
        }

        // If the phase escalated but we haven't hit max failures,
        // the loop escalates to outer
        if (phaseResult.escalated) {
          return this.escalate(
            storyId,
            phaseResult.escalation_reason || `Stage "${stage}" escalated`,
            workParts,
            suggestions,
          );
        }
      }
    }

    // All stages completed
    const completed = this.stateMachine.isCompleted();
    return {
      success: completed,
      story_id: storyId,
      current_stage: this.stateMachine.getCurrentStage(),
      completed,
      total_iterations: this.totalIterations,
      stage_history: this.stageHistory,
      escalated: false,
      work_summary: workParts.join('\n'),
      suggestions,
    };
  }

  /**
   * Get the current state of the state machine.
   */
  getState() {
    return this.stateMachine.getState();
  }

  /**
   * Get the current stage.
   */
  getCurrentStage(): Stage {
    return this.stateMachine.getCurrentStage();
  }

  /**
   * Get the per-stage execution history.
   */
  getStageHistory(): StageRecord[] {
    return [...this.stageHistory];
  }

  // ── private helpers ──

  private escalate(
    storyId: string,
    reason: string,
    workParts: string[],
    suggestions: string[],
  ): InnerLoopResult {
    return {
      success: false,
      story_id: storyId,
      current_stage: this.stateMachine.getCurrentStage(),
      completed: false,
      total_iterations: this.totalIterations,
      stage_history: this.stageHistory,
      escalated: true,
      escalation_reason: reason,
      work_summary: workParts.join('\n'),
      suggestions,
    };
  }
}
