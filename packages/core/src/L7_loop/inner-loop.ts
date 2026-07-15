import { StateMachine, type Stage } from './state-machine';
import { PhaseLoop, type PhaseResult, type PhaseOneResult, type MakerFn, type CheckerFn, type OptimizerFn } from './phase-loop';
import type { NextAction } from '@azaloop/shared';
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
 * V16: Result returned by {@link InnerLoop.runStage}.
 *
 * Unlike InnerLoopResult (which aggregates all 5 stages), this represents
 * a single stage execution. When `awaitingAction` is set, the LLM must
 * execute the specified tool before the next call to `runStage()`.
 */
export interface InnerStageResult {
  /** Whether this stage execution completed. */
  done: boolean;
  /** The stage that was executed. */
  stage: Stage;
  /** The story ID. */
  story_id: string;
  /** Whether the stage succeeded (gate passed). */
  success: boolean;
  /** Whether the stage escalated. */
  escalated: boolean;
  /** Escalation reason, if escalated. */
  escalation_reason?: string;
  /** V16: If the maker returned `awaiting_agent`, the action the LLM should take. */
  awaitingAction?: NextAction;
  /** Work summary from this stage. */
  work: string;
  /** Suggestions for the next loop level. */
  suggestions: string[];
  /** Phase iteration count for this stage. */
  iteration: number;
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
  /**
   * v13 — P6.1: aza directory used to record subagent review results
   * under `<azaDir>/tasks/<taskId>/NOTES.md`. Defaults to '.aza'.
   */
  azaDir?: string;
  /**
   * G6: optional stage handler provider — when set, the 5 phase
   * handlers (planner / maker / checker / optimizer / finalize) inside
   * {@link InnerLoop.runPhase} dispatch through the same real handler
   * chain that the outer LoopController uses. When absent, the
   * handlers fall back to lightweight stubs (with a `console.warn`).
   */
  handlerProvider?: StageHandlerProvider;
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
  /** v13 — P6.1: aza dir for subagent review notes. */
  private azaDir: string;
  /**
   * G6: optional stage handler provider. When set, the 5 phase
   * handlers (planner/maker/checker/optimizer/finalize) inside
   * {@link runPhase} dispatch through this provider instead of
   * falling back to the lightweight stubs.
   */
  private handlerProvider: StageHandlerProvider | null = null;

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
      azaDir: options.azaDir,
      handlerProvider: options.handlerProvider,
    };
    this.azaDir = options.azaDir ?? '.aza';
    this.handlerProvider = options.handlerProvider ?? null;
    this.stateMachine = stateMachine ?? new StateMachine();
    this.phaseLoop = new PhaseLoop(circuitBreaker, {
      maxIterations: this.options.maxPhaseIterations ?? 5,
      dpRegistry: this.options.dpRegistry,
    });
  }

  /**
   * G6: install / replace the stage handler provider. Lets the
   * outer LoopController share its real handler chain with the
   * inner loop so the 5 phase handlers stay in lock-step.
   */
  setHandlerProvider(provider: StageHandlerProvider | null): void {
    this.handlerProvider = provider ?? null;
  }

  /**
   * G6: read-only accessor for the current handler provider (used
   * by tests and for diagnostics). Returns `null` when no provider
   * has been installed.
   */
  getHandlerProvider(): StageHandlerProvider | null {
    return this.handlerProvider;
  }

  /**
   * V16: Run a single stage of the inner loop.
   *
   * Unlike `run()`, this executes ONE stage and returns immediately.
   * If the maker returns `{ status: "awaiting_agent" }`, the result
   * contains `awaitingAction` so the LoopController can tell the LLM
   * to execute the specified tool before calling `runStage()` again.
   *
   * @param stage    The stage to execute.
   * @param storyId  The ID of the Story being processed.
   * @param provider A function that returns maker/checker/optimizer for this stage.
   */
  async runStage(stage: Stage, storyId: string, provider: StageHandlerProvider): Promise<InnerStageResult> {
    const stageStart = new Date().toISOString();
    this.stateMachine.setStageStatus(stage, 'in_progress');

    // V12: DAG Builder — persist for OuterLoop / parallel scheduling
    if (stage === 'design' && this.stageHistory.length === 0) {
      try {
        const dag = new DAGBuilder();
        const tasks: DAGTask[] = [
          { id: storyId, title: `Story: ${storyId}`, dependencies: [], status: 'pending' },
        ];
        const buildResult = dag.build(tasks);
        if (buildResult.is_acyclic) {
          const fs = await import('fs');
          const path = await import('path');
          const azaDir = (this as any).azaDir || path.join(process.cwd(), '.aza');
          try {
            if (!fs.existsSync(azaDir)) fs.mkdirSync(azaDir, { recursive: true });
            const payload = {
              story_id: storyId,
              built_at: new Date().toISOString(),
              parallel: dag.getParallelTasks(),
              serialized: typeof (dag as any).serialize === 'function' ? (dag as any).serialize() : buildResult,
            };
            fs.writeFileSync(path.join(azaDir, 'dag.json'), JSON.stringify(payload, null, 2), 'utf8');
          } catch {
            /* non-fatal */
          }
        }
      } catch { /* best-effort: DAG is non-fatal */ }
    }

    // Obtain handlers for this stage
    const handlers = provider(stage);

    // Run one phase iteration for this stage
    const phaseOneResult = await this.phaseLoop.runOne(
      stage,
      handlers.maker,
      handlers.checker,
      handlers.optimizer,
      this.totalIterations + 1,
    );

    this.totalIterations++;

    // V16: If awaiting agent action, return immediately
    if (phaseOneResult.awaitingAction) {
      return {
        done: false,
        stage,
        story_id: storyId,
        success: false,
        escalated: false,
        awaitingAction: phaseOneResult.awaitingAction,
        work: phaseOneResult.work,
        suggestions: phaseOneResult.suggestions,
        iteration: this.totalIterations,
      };
    }

    if (phaseOneResult.done && phaseOneResult.success) {
      // Stage succeeded
      this.stateMachine.setStageStatus(stage, 'completed');
      this.circuitBreaker?.recordProgress('inner');
      this.stageFailures = 0;

      // Record stage history
      this.stageHistory.push({
        stage,
        result: {
          success: true,
          stage,
          work: phaseOneResult.work,
          iterations: phaseOneResult.iteration,
          suggestions: phaseOneResult.suggestions,
          history: [],
          escalated: false,
        },
        started_at: stageStart,
        completed_at: new Date().toISOString(),
        auto_transitioned: true,
      });

      return {
        done: true,
        stage,
        story_id: storyId,
        success: true,
        escalated: false,
        work: phaseOneResult.work,
        suggestions: phaseOneResult.suggestions,
        iteration: this.totalIterations,
      };
    }

    // Stage failed or escalated
    this.stageFailures++;
    this.stateMachine.setStageStatus(stage, 'blocked', phaseOneResult.escalation_reason);
    this.circuitBreaker?.recordFailure(
      'inner',
      phaseOneResult.escalation_reason || `Stage "${stage}" failed`,
    );

    // Check if we should escalate
    if (this.stageFailures >= (this.options.maxStageFailures ?? 3)) {
      return {
        done: true,
        stage,
        story_id: storyId,
        success: false,
        escalated: true,
        escalation_reason: `${this.stageFailures} consecutive stage failures`,
        work: phaseOneResult.work,
        suggestions: phaseOneResult.suggestions,
        iteration: this.totalIterations,
      };
    }

    // Check circuit breaker
    if (this.circuitBreaker) {
      const breakerResult = this.circuitBreaker.check('inner');
      if (breakerResult.tripped) {
        return {
          done: true,
          stage,
          story_id: storyId,
          success: false,
          escalated: true,
          escalation_reason: `Circuit breaker tripped: ${breakerResult.reason}`,
          work: phaseOneResult.work,
          suggestions: phaseOneResult.suggestions,
          iteration: this.totalIterations,
        };
      }
    }

    // Not done — needs retry
    return {
      done: false,
      stage,
      story_id: storyId,
      success: false,
      escalated: phaseOneResult.escalated,
      escalation_reason: phaseOneResult.escalation_reason,
      work: phaseOneResult.work,
      suggestions: phaseOneResult.suggestions,
      iteration: this.totalIterations,
    };
  }

  /**
   * Run the inner loop for a single Story through all 5 stages.
   *
   * For V16 single-stage scheduling, use {@link runStage} instead.
   * This method is kept for backward compatibility.
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

        // v13 — P6.1: when the verify stage succeeds, dispatch the
        // 2-stage subagent review (spec-compliance → code-quality). If
        // either stage fails, append a strike reason to the suggestions
        // and record the result in `<azaDir>/tasks/<taskId>/NOTES.md`.
        // Best-effort: never throws.
        if (stage === 'verify') {
          try {
            const { runTwoStageReview, recordReviewInNotes } = await import('../L3_roles/subagent-roles');
            const reviewInput = {
              taskId: storyId,
              content: phaseResult.work,
              context: { stage },
            };
            const review = runTwoStageReview(reviewInput);
            recordReviewInNotes(this.azaDir, review);
            if (!review.passed) {
              suggestions.push(
                `Subagent 2-stage review: ${review.strike ? 'STRIKE' : 'WARN'} — ${review.allFindings.join('; ') || 'no findings'}`,
              );
            }
          } catch {
            // best-effort
          }
        }

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

  /**
   * Phase state-transition entry point. Routes `payload` to the appropriate
   * phase handler based on `phase`. Unknown phases are routed through
   * {@link InnerLoop.softRecover} so the caller always gets a structured
   * response instead of an uncaught throw.
   */
  async runPhase(phase: string, payload: any): Promise<any> {
    const validPhases = ['planner', 'maker', 'checker', 'optimizer', 'finalize'];
    if (!validPhases.includes(phase)) {
      return this.softRecover(payload, `unknown_phase: ${phase}`);
    }
    const phaseHandlers: Record<string, (p: any) => Promise<any>> = {
      planner: (p) => this.handlePlanner(p),
      maker: (p) => this.handleMaker(p),
      checker: (p) => this.handleChecker(p),
      optimizer: (p) => this.handleOptimizer(p),
      finalize: (p) => this.handleFinalize(p),
    };
    try {
      return await phaseHandlers[phase]!(payload);
    } catch (err) {
      return this.softRecover(payload, `${phase}_error: ${(err as Error).message}`);
    }
  }

  // ── G6: phase handlers — prefer the shared handlerProvider when present ──

  /**
   * G6: dispatch a phase call to the appropriate real handler from
   * the installed {@link handlerProvider}. Falls back to `null` when
   * no provider is set so callers can keep using the stub path.
   *
   * The phase names are the SPARC 5-phase split used by
   * {@link runPhase}, which do not 1:1 match the 5 pipeline stages
   * (`open`/`design`/`build`/`verify`/`archive`). We map each phase
   * to the closest pipeline stage so the underlying
   * {@link StageHandlerProvider} (which expects a `Stage`) receives
   * a well-typed argument.
   */
  private async runHandlerForStage(phase: string, payload: any): Promise<any | null> {
    if (!this.handlerProvider) return null;
    try {
      const stageForProvider = this.phaseToStage(phase);
      const handlers = this.handlerProvider(stageForProvider);
      const iteration = this.totalIterations + 1;
      const work = (payload && typeof payload === 'object' && 'work' in payload)
        ? String((payload as { work: unknown }).work ?? '')
        : '';
      const rolePrompt = (payload && typeof payload === 'object' && 'rolePrompt' in payload)
        ? String((payload as { rolePrompt: unknown }).rolePrompt ?? '')
        : undefined;
      const evaluation = (payload && typeof payload === 'object' && 'evaluation' in payload)
        ? (payload as { evaluation: unknown }).evaluation
        : undefined;

      switch (phase) {
        case 'planner': {
          const result = await handlers.maker(stageForProvider, iteration, rolePrompt);
          return { phase: 'planner', status: result?.status ?? 'completed', work: result?.work, payload };
        }
        case 'maker': {
          const result = await handlers.maker(stageForProvider, iteration, rolePrompt);
          return { phase: 'maker', status: result?.status ?? 'completed', work: result?.work, payload };
        }
        case 'checker': {
          const result = await handlers.checker(stageForProvider, work, rolePrompt);
          return { phase: 'checker', status: 'completed', work, payload, evaluation: result?.input, tokensUsed: result?.tokensUsed };
        }
        case 'optimizer': {
          const result = await handlers.optimizer(stageForProvider, work, evaluation as any);
          return { phase: 'optimizer', status: 'completed', work: result?.work, payload, tokensUsed: result?.tokensUsed };
        }
        case 'finalize': {
          // finalize has no direct counterpart in StageHandlers; reuse
          // checker to produce the final attestation payload.
          const result = await handlers.checker(stageForProvider, work, rolePrompt);
          return { phase: 'finalize', status: 'completed', work, payload, evaluation: result?.input, tokensUsed: result?.tokensUsed };
        }
        default:
          return null;
      }
    } catch {
      // best-effort: handler dispatch is non-fatal, callers can retry
      // or fall back to the stub.
      return null;
    }
  }

  /**
   * G6: map a {@link runPhase} phase name to the closest pipeline
   * `Stage` so we can dispatch through {@link StageHandlerProvider}.
   * Unknown phases fall back to the current stage (or `design` when
   * the state machine is empty).
   */
  private phaseToStage(phase: string): Stage {
    switch (phase) {
      case 'planner':
        return 'design';
      case 'maker':
        return 'build';
      case 'checker':
        return 'verify';
      case 'optimizer':
        return 'build';
      case 'finalize':
        return 'archive';
      default: {
        const current = this.stateMachine.getCurrentStage();
        return current ?? 'design';
      }
    }
  }

  // TODO: wire the planner phase to the planning LLM / tool call.
  private async handlePlanner(payload: any): Promise<any> {
    const handled = await this.runHandlerForStage('planner', payload);
    if (handled) return handled;
    console.warn('[InnerLoop] handlePlanner: no handlerProvider installed, using stub');
    return { phase: 'planner', status: 'completed', payload };
  }

  // TODO: wire the maker phase to the maker LLM / tool call.
  private async handleMaker(payload: any): Promise<any> {
    const handled = await this.runHandlerForStage('maker', payload);
    if (handled) return handled;
    console.warn('[InnerLoop] handleMaker: no handlerProvider installed, using stub');
    return { phase: 'maker', status: 'completed', payload };
  }

  // TODO: wire the checker phase to the gate evaluation pipeline.
  private async handleChecker(payload: any): Promise<any> {
    const handled = await this.runHandlerForStage('checker', payload);
    if (handled) return handled;
    console.warn('[InnerLoop] handleChecker: no handlerProvider installed, using stub');
    return { phase: 'checker', status: 'completed', payload };
  }

  // TODO: wire the optimizer phase to the optimizer LLM / tool call.
  private async handleOptimizer(payload: any): Promise<any> {
    const handled = await this.runHandlerForStage('optimizer', payload);
    if (handled) return handled;
    console.warn('[InnerLoop] handleOptimizer: no handlerProvider installed, using stub');
    return { phase: 'optimizer', status: 'completed', payload };
  }

  // TODO: wire the finalize phase to the completion / handoff step.
  private async handleFinalize(payload: any): Promise<any> {
    const handled = await this.runHandlerForStage('finalize', payload);
    if (handled) return handled;
    console.warn('[InnerLoop] handleFinalize: no handlerProvider installed, using stub');
    return { phase: 'finalize', status: 'completed', payload };
  }

  /**
   * Soft-recover from an unknown phase or phase-level error by returning
   * a structured result instead of throwing. Keeps the inner loop moving.
   */
  private async softRecover(payload: any, reason: string): Promise<any> {
    return { phase: 'soft-recover', status: 'recovered', reason, payload };
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
