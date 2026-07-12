import type { GateResult } from '../pipeline';
import { LoopAudit } from '../../L7_loop/loop-audit';
import type {
  AuditLevel,
  LoopAuditResult,
  SignalInput,
} from '../../L7_loop/loop-audit';

/**
 * The minimum score required to pass the gate (default: 40, the L1
 * "Report-only" threshold).
 */
export const DEFAULT_LOOP_AUDIT_MIN_SCORE = 40;

/**
 * Context for the loop-audit quality gate.
 */
export interface LoopAuditGateContext {
  /** Signal pass/fail map evaluated by {@link LoopAudit}. */
  signals: SignalInput;
  /** Minimum score required to pass. Defaults to 40 (L1 minimum). */
  minScore?: number;
}

/**
 * Extended gate result with loop-audit-specific details.
 *
 * Extends {@link GateResult} so it is structurally compatible with the
 * quality pipeline, while also carrying the audit score, level,
 * recommendations, and full audit result.
 */
export interface LoopAuditGateResult extends GateResult {
  /** Numeric audit score (0–100). */
  score: number;
  /** The assigned audit level (L0–L3). */
  level: AuditLevel;
  /** Recommendations for improving the score. */
  recommendations: string[];
  /** The full loop-audit result (signals, etc.). */
  details: LoopAuditResult;
}

/**
 * Quality Gate 6 — Loop Audit Scoring.
 *
 * Runs the L7 {@link LoopAudit} engine and requires the resulting score
 * to meet or exceed a configurable minimum (default: 40, the L1
 * "Report-only" threshold).
 *
 * @example
 * ```ts
 * const gate = new LoopAuditGate(40);
 * const result = await gate.run({ signals: { state_file_exists: true, ... } });
 * if (!result.passed) {
 *   console.warn(`Score ${result.score}/100 — below minimum`);
 * }
 * ```
 */
export class LoopAuditGate {
  private readonly audit: LoopAudit;
  private readonly minScore: number;

  /**
   * @param minScore - Minimum score required to pass (default: 40).
   */
  constructor(minScore: number = DEFAULT_LOOP_AUDIT_MIN_SCORE) {
    this.audit = new LoopAudit();
    this.minScore = minScore;
  }

  /**
   * Run the loop-audit gate.
   *
   * @param context - Signals and optional override for the minimum score.
   * @returns A {@link LoopAuditGateResult} with score, level, and recommendations.
   */
  async run(context: LoopAuditGateContext): Promise<LoopAuditGateResult> {
    const start = Date.now();
    const effectiveMinScore = context.minScore ?? this.minScore;

    const auditResult = this.audit.evaluate(context.signals);
    const passed = auditResult.score >= effectiveMinScore;

    const issues: string[] = [];
    if (!passed) {
      issues.push(
        `Loop audit score ${auditResult.score}/100 (${auditResult.level}) — below minimum ${effectiveMinScore}`,
      );
    }

    return {
      gate: 'Gate 6: Loop Audit Scoring',
      passed,
      issues,
      duration_ms: Date.now() - start,
      score: auditResult.score,
      level: auditResult.level,
      recommendations: auditResult.recommendations,
      details: auditResult,
    };
  }
}

/**
 * Convenience function — run the loop-audit gate without instantiating.
 *
 * @param context - Signals and optional minimum-score override.
 * @param minScore - Minimum score (default: 40).
 * @returns A {@link LoopAuditGateResult}.
 */
export async function loopAuditGate(
  context: LoopAuditGateContext,
  minScore: number = DEFAULT_LOOP_AUDIT_MIN_SCORE,
): Promise<LoopAuditGateResult> {
  const gate = new LoopAuditGate(minScore);
  return gate.run(context);
}
