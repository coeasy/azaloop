import type { Stage } from './state-machine';
import {
  evaluateStageGate,
  type PhaseGateInput,
  type PhaseGateEvaluation,
} from './phase-gates';
import type { CircuitBreaker } from './circuit-breaker';
import { DynamicBinder } from '../L3_roles/dynamic-binder';
import type { NextAction } from '@azaloop/shared';
import {
  DecisionPointRegistry,
  DecisionPointId,
  STAGE_TO_DP,
} from './decision-points';
// v13 — P1.3: completion-sentinel detection in the phase loop. When the
// maker's `work` contains a sentinel (e.g. <promise>TASK_COMPLETE</promise>)
// we exit the phase immediately instead of looping until max iterations.
import { detectSentinel, type SentinelMatch } from './completion-sentinel';

/**
 * The role of the active agent within a single iteration.
 */
export type AgentRole = 'maker' | 'checker';

/**
 * A single iteration record produced by the phase loop.
 */
export interface IterationRecord {
  /** 1-based iteration number within this phase. */
  iteration: number;
  /** Which agent role was active. */
  role: AgentRole;
  /** Timestamp the iteration started. */
  started_at: string;
  /** Timestamp the iteration completed. */
  completed_at?: string;
  /** Tokens consumed during this iteration. */
  tokens_used: number;
  /** Whether this iteration passed the quality gate. */
  gate_passed: boolean;
  /** The gate evaluation details, if the checker ran. */
  gate_evaluation?: PhaseGateEvaluation;
  /** Suggestion or action produced by the iteration. */
  suggestion?: string;
  /** Error encountered, if any. */
  error?: string;
}

/**
 * Result returned by {@link PhaseLoop.run}.
 */
export interface PhaseResult {
  /** Whether the phase ultimately succeeded (gate passed within maxIterations). */
  success: boolean;
  /** The stage that was executed. */
  stage: Stage;
  /** A summary of the work produced (accumulated across iterations). */
  work: string;
  /** Number of iterations consumed. */
  iterations: number;
  /** Suggestions for the next loop level (e.g. inner loop) if escalation is needed. */
  suggestions: string[];
  /** Full iteration history for circuit-breaker analysis. */
  history: IterationRecord[];
  /** Whether the phase escalated to the inner loop. */
  escalated: boolean;
  /** Escalation reason, if escalated. */
  escalation_reason?: string;
}

/**
 * Options accepted by {@link PhaseLoop}.
 */
export interface PhaseLoopOptions {
  /** Maximum iterations before escalating (default 5). */
  maxIterations?: number;
  /** Decision point registry for recording DP transitions (DP-0 to DP-7). */
  dpRegistry?: DecisionPointRegistry;
}

/**
 * V16: Extended maker return type — supports awaiting_agent signal.
 *
 * When `status` is `"awaiting_agent"`, the phase loop pauses and returns
 * `awaitingAction` so the LLM can execute the specified tool before
 * continuing with checker → gate evaluation.
 */
export interface MakerResult {
  work: string;
  tokensUsed: number;
  /** V16: Signal to pause phase loop — LLM must execute the specified tool. */
  status?: 'awaiting_agent';
  /** V16: The tool the LLM should call next (e.g. "aza_task_implement"). */
  action?: string;
  /** V16: The stage context for the awaited action. */
  stage?: Stage;
}

/**
 * V16: Result returned by {@link PhaseLoop.runOne}.
 */
export interface PhaseOneResult {
  /** Whether this iteration completed the phase (gate passed or sentinel). */
  done: boolean;
  /** The iteration number (1-based). */
  iteration: number;
  /** The work produced by the maker. */
  work: string;
  /** Whether the iteration succeeded (gate passed). */
  success: boolean;
  /** Whether the iteration escalated. */
  escalated: boolean;
  /** Escalation reason, if escalated. */
  escalation_reason?: string;
  /** V16: If the maker returned `awaiting_agent`, the action the LLM should take. */
  awaitingAction?: NextAction;
  /** Suggestions for the next loop level. */
  suggestions: string[];
}

/**
 * A Maker function — produces work for the given stage.
 *
 * Returns the work summary and tokens consumed.
 * The optional `rolePrompt` parameter carries the DynamicBinder role prompt
 * for context injection (non-breaking for existing makers).
 * V16: Supports `status: "awaiting_agent"` to signal the phase loop to pause
 * and wait for the LLM to execute a tool before continuing.
 */
export type MakerFn = (stage: Stage, iteration: number, rolePrompt?: string) => Promise<MakerResult>;

/**
 * A Checker function — verifies the work and returns the gate input metrics.
 */
/**
 * A Checker function — verifies the work and returns the gate input metrics.
 * The optional `rolePrompt` parameter carries the DynamicBinder checker role.
 */
export type CheckerFn = (stage: Stage, work: string, rolePrompt?: string) => Promise<{
  input: PhaseGateInput;
  tokensUsed: number;
}>;

/**
 * An Optimizer function — adjusts work based on failed gate evaluation.
 *
 * Returns updated work and tokens consumed.
 */
export type OptimizerFn = (stage: Stage, work: string, evaluation: PhaseGateEvaluation) => Promise<{
  work: string;
  tokensUsed: number;
}>;

/**
 * Phase-level loop controller.
 *
 * Executes a single stage with quality-gated iteration:
 *
 *   Maker execute → Checker verify → quality gate → pass? next stage / fail? optimize → repeat
 *
 * If the gate does not pass within {@link PhaseLoopOptions.maxIterations},
 * the loop escalates to the inner loop level.
 */
export class PhaseLoop {
  private maxIterations: number;
  private circuitBreaker?: CircuitBreaker;
  private history: IterationRecord[] = [];
  private dynamicBinder: DynamicBinder;
  private dpRegistry?: DecisionPointRegistry;

  constructor(
    circuitBreaker?: CircuitBreaker,
    options: PhaseLoopOptions = {},
  ) {
    this.maxIterations = options.maxIterations ?? 5;
    this.circuitBreaker = circuitBreaker;
    this.dynamicBinder = new DynamicBinder();
    this.dpRegistry = options.dpRegistry;
  }

  /**
   * V16: Run a single iteration of the phase loop.
   *
   * Unlike `run()`, this executes ONE iteration of maker→checker→gate
   * and returns immediately. If the maker returns `{ status: "awaiting_agent" }`,
   * the phase loop pauses and returns the `awaitingAction` so the LLM can
   * execute the specified tool before continuing.
   *
   * @param stage     The stage to execute.
   * @param maker     Function that produces work.
   * @param checker   Function that verifies work and returns gate input.
   * @param optimizer Function that optimizes work when the gate fails.
   * @param iteration The 1-based iteration number for this call.
   * @param currentWork The current accumulated work (optional, for retries).
   */
  async runOne(
    stage: Stage,
    maker: MakerFn,
    checker: CheckerFn,
    optimizer: OptimizerFn,
    iteration: number = 1,
    currentWork: string = '',
  ): Promise<PhaseOneResult> {
    const iterationStart = new Date().toISOString();
    const suggestions: string[] = [];

    // V12: Inject role prompts from DynamicBinder — real context injection
    const roles = this.dynamicBinder.getRoleForStage(stage);
    const makerRole = roles.find(r => r.name === 'build' || r.name === 'plan' || r.name === 'think');
    const checkerRole = roles.find(r => r.name === 'review' || r.name === 'test' || r.name === 'observe');
    const makerRolePrompt = makerRole?.prompt ?? '';
    const checkerRolePrompt = checkerRole?.prompt ?? '';

    // ── Step 1: Maker executes ──
    let makerResult: MakerResult;
    try {
      makerResult = await maker(stage, iteration, makerRolePrompt);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordIteration({
        iteration,
        role: 'maker',
        started_at: iterationStart,
        completed_at: new Date().toISOString(),
        tokens_used: 0,
        gate_passed: false,
        error: `Maker error: ${errorMsg}`,
      });
      this.circuitBreaker?.recordFailure('phase', `Maker error: ${errorMsg}`);
      return {
        done: true,
        iteration,
        work: currentWork,
        success: false,
        escalated: true,
        escalation_reason: `Maker failed: ${errorMsg}`,
        suggestions: [`Maker error: ${errorMsg}`],
      };
    }

    const work = makerResult.work;

    // V16: await_agent signal — maker needs LLM to execute a tool before continuing
    if (makerResult.status === 'awaiting_agent' && makerResult.action) {
      this.recordIteration({
        iteration,
        role: 'maker',
        started_at: iterationStart,
        completed_at: new Date().toISOString(),
        tokens_used: makerResult.tokensUsed,
        gate_passed: false,
        suggestion: `Awaiting agent to execute ${makerResult.action} for stage "${makerResult.stage || stage}"`,
      });
      return {
        done: false,
        iteration,
        work,
        success: false,
        escalated: false,
        awaitingAction: {
          tool: makerResult.action as any,
          action: 'implement',
          reason: `Maker waiting for LLM to execute ${makerResult.action} for stage "${makerResult.stage || stage}"`,
        },
        suggestions: [`Awaiting ${makerResult.action} execution`],
      };
    }

    // v13 — P1.3: completion-sentinel detection
    const sentinel: SentinelMatch = detectSentinel(work);
    if (sentinel.matched) {
      if (sentinel.matched === 'taskFailed') {
        this.recordIteration({
          iteration,
          role: 'maker',
          started_at: iterationStart,
          completed_at: new Date().toISOString(),
          tokens_used: makerResult.tokensUsed,
          gate_passed: false,
          error: `Sentinel: TASK_FAILED detected in maker output`,
        });
        this.circuitBreaker?.recordFailure('phase', 'sentinel: TASK_FAILED');
        return {
          done: true,
          iteration,
          work,
          success: false,
          escalated: true,
          escalation_reason: `Sentinel TASK_FAILED — exiting phase`,
          suggestions: [`Sentinel TASK_FAILED`],
        };
      }
      if (sentinel.matched === 'taskBlocked') {
        this.recordIteration({
          iteration,
          role: 'maker',
          started_at: iterationStart,
          completed_at: new Date().toISOString(),
          tokens_used: makerResult.tokensUsed,
          gate_passed: false,
          error: `Sentinel: TASK_BLOCKED detected — escalating`,
        });
        return {
          done: true,
          iteration,
          work,
          success: false,
          escalated: true,
          escalation_reason: `Sentinel TASK_BLOCKED — user input required`,
          suggestions: [`Sentinel TASK_BLOCKED`],
        };
      }
      // Sentinel TASK_COMPLETE → success
      this.recordIteration({
        iteration,
        role: 'maker',
        started_at: iterationStart,
        completed_at: new Date().toISOString(),
        tokens_used: makerResult.tokensUsed,
        gate_passed: true,
        suggestion: `Sentinel: ${sentinel.matched} — phase complete`,
      });
      this.circuitBreaker?.recordProgress('phase', makerResult.tokensUsed);
      // Write phase-summary.md best-effort
      try {
        const fs = await import('fs');
        const path = await import('path');
        const candidates = [
          path.join(process.cwd(), '.aza'),
          path.join(process.cwd(), '..', '.aza'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            const summaryPath = path.join(candidate, 'phase-summary.md');
            fs.writeFileSync(
              summaryPath,
              [
                `# Phase Summary — ${stage}`,
                ``,
                `> Generated by phase-loop sentinel detection at ${new Date().toISOString()}`,
                `> Sentinel: \`${sentinel.matched}\``,
                `> Iteration: ${iteration}`,
                ``,
                `## Maker Work (excerpt)`,
                ``,
                work.length > 4000
                  ? work.slice(0, 4000) + '\n…(truncated)…'
                  : work,
              ].join('\n'),
              'utf8',
            );
            break;
          }
        }
      } catch {
        // best-effort — sentinel still applies
      }
      return {
        done: true,
        iteration,
        work,
        success: true,
        escalated: false,
        suggestions: [`Sentinel: ${sentinel.matched} — phase complete`],
      };
    }

    // ── Step 2: Checker verifies ──
    let checkerResult;
    try {
      checkerResult = await checker(stage, work, checkerRolePrompt);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordIteration({
        iteration,
        role: 'checker',
        started_at: iterationStart,
        completed_at: new Date().toISOString(),
        tokens_used: makerResult.tokensUsed,
        gate_passed: false,
        error: `Checker error: ${errorMsg}`,
      });
      this.circuitBreaker?.recordFailure('phase', `Checker error: ${errorMsg}`);
      return {
        done: true,
        iteration,
        work,
        success: false,
        escalated: true,
        escalation_reason: `Checker failed: ${errorMsg}`,
        suggestions: [`Checker error: ${errorMsg}`],
      };
    }

    // ── Step 3: Quality gate evaluation ──
    const evaluation = evaluateStageGate(stage, checkerResult.input);

    const totalTokens = makerResult.tokensUsed + checkerResult.tokensUsed;

    if (evaluation.passed) {
      // Gate passed — phase succeeded
      this.recordIteration({
        iteration,
        role: 'checker',
        started_at: iterationStart,
        completed_at: new Date().toISOString(),
        tokens_used: totalTokens,
        gate_passed: true,
        gate_evaluation: evaluation,
        suggestion: `Stage "${stage}" passed all quality gates`,
      });
      this.circuitBreaker?.recordProgress('phase', totalTokens);

      // Record DP transition (passed)
      this.recordDP(stage, 'passed', {
        gateResults: evaluation.results.map(r => ({
          id: r.id,
          label: r.label,
          passed: r.result.passed,
          detail: r.result.detail,
        })),
        iteration,
        tokenEstimate: totalTokens,
      });

      return {
        done: true,
        iteration,
        work,
        success: true,
        escalated: false,
        suggestions: [`Stage "${stage}" passed all quality gates`],
      };
    }

    // ── Step 4: Gate failed → record and optimize ──
    const suggestion = evaluation.blocking_reason || `Stage "${stage}" gate check failed`;
    suggestions.push(`Iteration ${iteration}: ${suggestion}`);

    this.recordIteration({
      iteration,
      role: 'checker',
      started_at: iterationStart,
      completed_at: new Date().toISOString(),
      tokens_used: totalTokens,
      gate_passed: false,
      gate_evaluation: evaluation,
      suggestion,
    });

    // Check circuit breaker before continuing
    if (this.circuitBreaker) {
      this.circuitBreaker.recordFailure('phase', suggestion, totalTokens);
      const breakerResult = this.circuitBreaker.check('phase');
      if (breakerResult.tripped) {
        return {
          done: true,
          iteration,
          work,
          success: false,
          escalated: true,
          escalation_reason: `Circuit breaker tripped: ${breakerResult.reason}`,
          suggestions: [`Circuit breaker tripped: ${breakerResult.reason}`],
        };
      }
    }

    // ── Step 5: Optimize for retry (only if within max iterations) ──
    if (iteration < this.maxIterations) {
      try {
        const optimized = await optimizer(stage, work, evaluation);
        suggestions.push(`Iteration ${iteration}: optimized — ${optimized.work.slice(0, 100)}`);
        return {
          done: false,
          iteration,
          work: optimized.work,
          success: false,
          escalated: false,
          suggestions,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          done: true,
          iteration,
          work,
          success: false,
          escalated: true,
          escalation_reason: `Optimizer failed: ${errorMsg}`,
          suggestions: [`Optimizer failed: ${errorMsg}`],
        };
      }
    }

    // Exceeded max iterations → escalate
    return {
      done: true,
      iteration,
      work,
      success: false,
      escalated: true,
      escalation_reason: `Exceeded max iterations (${this.maxIterations}) for stage "${stage}"`,
      suggestions: [`Exceeded max iterations (${this.maxIterations})`],
    };
  }

  /**
   * Run the phase loop for a single stage.
   *
   * Aggregates multiple `runOne()` calls until completion or escalation.
   *
   * @param stage     The stage to execute.
   * @param maker     Function that produces work.
   * @param checker   Function that verifies work and returns gate input.
   * @param optimizer Function that optimizes work when the gate fails.
   */
  async run(
    stage: Stage,
    maker: MakerFn,
    checker: CheckerFn,
    optimizer: OptimizerFn,
  ): Promise<PhaseResult> {
    this.history = [];
    let currentWork = '';
    const suggestions: string[] = [];

    for (let i = 1; i <= this.maxIterations; i++) {
      const oneResult = await this.runOne(stage, maker, checker, optimizer, i, currentWork);

      // V16: If awaiting agent action, the run() method cannot continue
      // (this is a synchronous multi-iteration loop). In V16, callers
      // should use runOne() directly for awaiting_agent support.
      if (oneResult.awaitingAction) {
        return {
          success: false,
          stage,
          work: currentWork,
          iterations: i,
          suggestions: [...suggestions, ...oneResult.suggestions],
          history: this.history,
          escalated: false,
          escalation_reason: `Awaiting agent action: ${oneResult.awaitingAction.tool}`,
        };
      }

      currentWork = oneResult.work;
      suggestions.push(...oneResult.suggestions);

      if (oneResult.done) {
        if (oneResult.success) {
          return {
            success: true,
            stage,
            work: currentWork,
            iterations: i,
            suggestions,
            history: this.history,
            escalated: false,
          };
        }
        if (oneResult.escalated) {
          // Record DP transition (escalated)
          this.recordDP(stage, 'escalated', {
            iteration: i,
            reason: oneResult.escalation_reason,
            tokenEstimate: this.history.reduce((s, h) => s + h.tokens_used, 0),
          });
          return {
            success: false,
            stage,
            work: currentWork,
            iterations: i,
            suggestions,
            history: this.history,
            escalated: true,
            escalation_reason: oneResult.escalation_reason,
          };
        }
      }

      // Not done, not escalated, not awaiting → continue to next iteration
      // (optimizer ran in runOne, currentWork is updated)
    }

    // Exceeded max iterations → escalate
    this.recordDP(stage, 'escalated', {
      iteration: this.maxIterations,
      reason: `Exceeded max iterations (${this.maxIterations}) for stage "${stage}"`,
      tokenEstimate: this.history.reduce((s, h) => s + h.tokens_used, 0),
    });
    return {
      success: false,
      stage,
      work: currentWork,
      iterations: this.maxIterations,
      suggestions,
      history: this.history,
      escalated: true,
      escalation_reason: `Exceeded max iterations (${this.maxIterations}) for stage "${stage}"`,
    };
  }

  /**
   * Get the iteration history from the last run.
   */
  getHistory(): IterationRecord[] {
    return [...this.history];
  }

  // ── private helpers ──

  private recordIteration(record: IterationRecord): void {
    this.history.push(record);
  }

  private recordDP(
    stage: Stage,
    status: 'passed' | 'blocked' | 'escalated',
    options: {
      gateResults?: Array<{ id: string; label: string; passed: boolean; detail: string }>;
      iteration: number;
      tokenEstimate?: number;
      reason?: string;
      artifacts?: string[];
      circuitBreaker?: { dimension: string; tripped: boolean };
    },
  ): void {
    if (!this.dpRegistry) return;
    const dpInfo = STAGE_TO_DP[stage];
    if (!dpInfo) return;
    const nextStage = STAGE_TO_DP[stage]?.from === stage
      ? Object.entries(STAGE_TO_DP).find(([k]) => STAGE_TO_DP[k as Stage]?.from === stage)?.[0]
      : (Object.entries(STAGE_TO_DP).find(([k]) => STAGE_TO_DP[k as Stage]?.from === stage)?.[0] as Stage | 'done') || 'done';
    this.dpRegistry.record(
      dpInfo.dp,
      dpInfo.from,
      stage === 'archive' ? 'done' : stage,
      status,
      {
        gateResults: options.gateResults,
        iteration: options.iteration,
        tokenEstimate: options.tokenEstimate,
        reason: options.reason,
        artifacts: options.artifacts,
        circuitBreaker: options.circuitBreaker,
      },
    );
  }

  private escalate(
    stage: Stage,
    work: string,
    suggestions: string[],
    reason: string,
  ): PhaseResult {
    // Record DP transition (escalated)
    this.recordDP(stage, 'escalated', {
      iteration: this.history.length,
      reason,
      tokenEstimate: this.history.reduce((s, h) => s + h.tokens_used, 0),
    });
    return {
      success: false,
      stage,
      work,
      iterations: this.history.length,
      suggestions,
      history: this.history,
      escalated: true,
      escalation_reason: reason,
    };
  }
}
