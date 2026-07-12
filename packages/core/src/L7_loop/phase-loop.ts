import type { Stage } from './state-machine';
import {
  evaluateStageGate,
  type PhaseGateInput,
  type PhaseGateEvaluation,
} from './phase-gates';
import type { CircuitBreaker } from './circuit-breaker';
import { DynamicBinder } from '../L3_roles/dynamic-binder';
import {
  DecisionPointRegistry,
  DecisionPointId,
  STAGE_TO_DP,
} from './decision-points';

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
 * A Maker function — produces work for the given stage.
 *
 * Returns the work summary and tokens consumed.
 */
/**
 * A Maker function — produces work for the given stage.
 *
 * Returns the work summary and tokens consumed.
 * The optional `rolePrompt` parameter carries the DynamicBinder role prompt
 * for context injection (non-breaking for existing makers).
 */
export type MakerFn = (stage: Stage, iteration: number, rolePrompt?: string) => Promise<{
  work: string;
  tokensUsed: number;
}>;

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
   * Run the phase loop for a single stage.
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
      const iterationStart = new Date().toISOString();

      // V12: Inject role prompts from DynamicBinder — real context injection
      const roles = this.dynamicBinder.getRoleForStage(stage);
      const makerRole = roles.find(r => r.name === 'build' || r.name === 'plan' || r.name === 'think');
      const checkerRole = roles.find(r => r.name === 'review' || r.name === 'test' || r.name === 'observe');
      const makerRolePrompt = makerRole?.prompt ?? '';
      const checkerRolePrompt = checkerRole?.prompt ?? '';

      // ── Step 1: Maker executes ──
      let makerResult;
      try {
        makerResult = await maker(stage, i, makerRolePrompt);
        currentWork = makerResult.work;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.recordIteration({
          iteration: i,
          role: 'maker',
          started_at: iterationStart,
          completed_at: new Date().toISOString(),
          tokens_used: 0,
          gate_passed: false,
          error: `Maker error: ${errorMsg}`,
        });
        this.circuitBreaker?.recordFailure('phase', `Maker error: ${errorMsg}`);
        return this.escalate(stage, currentWork, suggestions, `Maker failed: ${errorMsg}`);
      }

      // ── Step 2: Checker verifies ──
      let checkerResult;
      try {
        checkerResult = await checker(stage, currentWork, checkerRolePrompt);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.recordIteration({
          iteration: i,
          role: 'checker',
          started_at: iterationStart,
          completed_at: new Date().toISOString(),
          tokens_used: makerResult.tokensUsed,
          gate_passed: false,
          error: `Checker error: ${errorMsg}`,
        });
        this.circuitBreaker?.recordFailure('phase', `Checker error: ${errorMsg}`);
        return this.escalate(stage, currentWork, suggestions, `Checker failed: ${errorMsg}`);
      }

      // ── Step 3: Quality gate evaluation ──
      const evaluation = evaluateStageGate(stage, checkerResult.input);

      const totalTokens = makerResult.tokensUsed + checkerResult.tokensUsed;

      if (evaluation.passed) {
        // Gate passed — phase succeeded
        this.recordIteration({
          iteration: i,
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
          iteration: i,
          tokenEstimate: totalTokens,
        });

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

      // ── Step 4: Gate failed → record and optimize ──
      const suggestion = evaluation.blocking_reason || `Stage "${stage}" gate check failed`;
      suggestions.push(`Iteration ${i}: ${suggestion}`);

      this.recordIteration({
        iteration: i,
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
          return this.escalate(
            stage,
            currentWork,
            suggestions,
            `Circuit breaker tripped: ${breakerResult.reason}`,
          );
        }
      }

      // ── Step 5: Optimize and retry ──
      if (i < this.maxIterations) {
        try {
          const optimized = await optimizer(stage, currentWork, evaluation);
          currentWork = optimized.work;
          suggestions.push(`Iteration ${i}: optimized — ${optimized.work.slice(0, 100)}`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          return this.escalate(stage, currentWork, suggestions, `Optimizer failed: ${errorMsg}`);
        }
      }
    }

    // Exceeded max iterations → escalate to inner loop
    return this.escalate(
      stage,
      currentWork,
      suggestions,
      `Exceeded max iterations (${this.maxIterations}) for stage "${stage}"`,
    );
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
