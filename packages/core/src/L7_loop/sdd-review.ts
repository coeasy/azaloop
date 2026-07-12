import type { PhaseGateInput, PhaseGateEvaluation, GateCheckResult } from '../L7_loop/phase-gates';
import type { PhaseGate } from '../L7_loop/phase-gates';
import type { Stage } from '../L7_loop/state-machine';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * SDD (Subagent-Driven Development) dual review.
 *
 * Implements implementer → reviewer → dual verdict pattern:
 * - Implementer verdict: code correctness + functionality
 * - Reviewer verdict: spec compliance + security + maintainability
 *
 * Both must pass for the stage to advance.
 */
export interface VerdictResult {
  /** Verdict type: implementer or reviewer */
  type: 'implementer' | 'reviewer';
  /** Whether this verdict passed */
  passed: boolean;
  /** Score: 0-100 */
  score: number;
  /** Detailed findings */
  findings: string[];
  /** Specific issues found */
  issues: string[];
  /** Recommendations */
  recommendations: string[];
}

export interface DualVerdict {
  implementer: VerdictResult;
  reviewer: VerdictResult;
  /** Both verdicts must pass for the stage to advance */
  both_passed: boolean;
  /** Combined score (average of both) */
  combined_score: number;
  /** Overall verdict detail */
  detail: string;
}

/**
 * Implementer verdict — focuses on code correctness and functionality.
 */
export function evaluateImplementerVerdict(
  input: PhaseGateInput,
  output: string = '',
): VerdictResult {
  const findings: string[] = [];
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  // TDD enforcement
  if (input.tdd_enforced === false) {
    score -= 30;
    issues.push('TDD discipline not enforced');
    findings.push('No TDD evidence found');
  }

  // Unit test pass rate
  const testPassPct = input.unit_test_pass_pct ?? 0;
  if (testPassPct < 100) {
    score -= Math.round((100 - testPassPct) * 0.3);
    issues.push(`Unit test pass rate: ${testPassPct}%`);
    findings.push(`Tests failing: ${100 - testPassPct}%`);
    if (testPassPct >= 80) {
      recommendations.push('Fix failing tests before proceeding');
    }
  }

  // Build stage completeness
  if (input.gates_passed !== undefined) {
    const gatesPassed = input.gates_passed;
    if (gatesPassed < 3) {
      score -= 20;
      issues.push('Few quality gates passed during build');
    }
  }

  // Output quality check
  if (output && output.length > 0) {
    const hasCode = /\bcode|function|class|module|export|import\b/i.test(output);
    if (!hasCode) {
      score -= 10;
      issues.push('No code detected in implementation output');
    }
  }

  return {
    type: 'implementer',
    passed: score >= 60,
    score,
    findings,
    issues,
    recommendations,
  };
}

/**
 * Reviewer verdict — focuses on spec compliance, security, and maintainability.
 */
export function evaluateReviewerVerdict(
  input: PhaseGateInput,
  output: string = '',
): VerdictResult {
  const findings: string[] = [];
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  // Security scan results
  if (input.security_optional_downgrade === true) {
    score -= 15;
    issues.push('Security scan had findings (optional downgrade applied)');
    findings.push('Security concerns detected during verification');
    recommendations.push('Review security findings before production deployment');
  }

  // PRD quality issues
  const p0Issues = input.p0_issues ?? 0;
  if (p0Issues > 0) {
    score -= 25;
    issues.push(`P0 issues in PRD: ${p0Issues}`);
    findings.push('Critical PRD quality issues remain');
    recommendations.push('Resolve P0 issues before verification');
  }

  const p1Issues = input.p1_issues ?? 0;
  if (p1Issues > 2) {
    score -= 10;
    issues.push(`P1 issues in PRD: ${p1Issues}`);
    findings.push('Multiple high-priority PRD issues');
  }

  // Quality gates passed
  const gatesPassed = input.gates_passed ?? 0;
  if (gatesPassed < 4) {
    score -= 15;
    issues.push(`Only ${gatesPassed} quality gates passed (need 4+ for reviewer pass)`);
    findings.push('Quality verification incomplete');
    recommendations.push('Complete all quality gates before reviewer sign-off');
  }

  // Spec compliance
  if (input.spec_sync_done === false) {
    score -= 10;
    issues.push('Spec sync not completed');
    findings.push('PRD specification not synced with implementation');
  }

  // Security findings in output
  if (output) {
    const securityKeywords = /\bsecret|password|token|api[_-]?key|credential|private[_-]?key\b/i;
    if (securityKeywords.test(output)) {
      score -= 10;
      issues.push('Potential security concern detected in output');
      recommendations.push('Review output for credential exposure');
    }
  }

  // Maintainability
  if (input.documents_complete !== undefined) {
    const docsComplete = input.documents_complete;
    if (docsComplete < 3) {
      score -= 10;
      issues.push('Insufficient documentation');
      findings.push('Documentation incomplete');
      recommendations.push('Complete documentation before final review');
    }
  }

  return {
    type: 'reviewer',
    passed: score >= 60,
    score,
    findings,
    issues,
    recommendations,
  };
}

/**
 * Dual verdict — combines implementer and reviewer verdicts.
 */
export function evaluateDualVerdict(
  input: PhaseGateInput,
  output: string = '',
): DualVerdict {
  const implementer = evaluateImplementerVerdict(input, output);
  const reviewer = evaluateReviewerVerdict(input, output);

  return {
    implementer,
    reviewer,
    both_passed: implementer.passed && reviewer.passed,
    combined_score: Math.round((implementer.score + reviewer.score) / 2),
    detail: `Implementer: ${implementer.passed ? 'PASS' : 'FAIL'} (${implementer.score}/100), Reviewer: ${reviewer.passed ? 'PASS' : 'FAIL'} (${reviewer.score}/100)`,
  };
}

/**
 * SDD review gate — evaluates dual verdict for a stage.
 */
export function evaluateSDDReviewGate(
  stage: Stage,
  input: PhaseGateInput,
  output: string = '',
): PhaseGateEvaluation {
  const dual = evaluateDualVerdict(input, output);

  const results = [
    {
      id: 'implementer_verdict',
      label: 'Implementer verdict (code correctness + functionality)',
      result: {
        passed: dual.implementer.passed,
        detail: `Implementer: ${dual.implementer.passed ? 'PASS' : 'FAIL'} (${dual.implementer.score}/100)`,
        metrics: { score: dual.implementer.score },
      } as GateCheckResult,
    },
    {
      id: 'reviewer_verdict',
      label: 'Reviewer verdict (spec compliance + security + maintainability)',
      result: {
        passed: dual.reviewer.passed,
        detail: `Reviewer: ${dual.reviewer.passed ? 'PASS' : 'FAIL'} (${dual.reviewer.score}/100)`,
        metrics: { score: dual.reviewer.score },
      } as GateCheckResult,
    },
  ];

  const firstFailure = results.find(r => !r.result.passed);

  return {
    stage,
    passed: firstFailure === undefined,
    results,
    blocking_reason: firstFailure?.result.detail,
  };
}

/**
 * Save SDD review record to .aza/sdd-reviews.jsonl
 */
export async function saveSDDReview(azaDir: string, stage: Stage, dual: DualVerdict): Promise<void> {
  const reviewPath = path.join(azaDir, 'sdd-reviews.jsonl');
  await fs.mkdir(azaDir, { recursive: true });
  const record = {
    stage,
    dual,
    timestamp: new Date().toISOString(),
  };
  await fs.appendFile(reviewPath, JSON.stringify(record) + '\n', 'utf8');
}
