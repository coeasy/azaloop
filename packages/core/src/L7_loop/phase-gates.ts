import type { Stage } from './state-machine';

/**
 * Quality gate check result for a single criterion within a phase.
 */
export interface GateCheckResult {
  /** Whether this individual check passed. */
  passed: boolean;
  /** Human-readable description of the check result. */
  detail: string;
  /** Metrics or values produced by the check (e.g. issue counts). */
  metrics?: Record<string, number>;
}

/**
 * A phase-level quality gate definition.
 *
 * Each stage (open / design / build / verify / archive) has a PhaseGate
 * that aggregates one or more {@link GateCheckResult} entries and
 * determines whether the stage may advance.
 */
export interface PhaseGate {
  /** The stage this gate belongs to. */
  stage: Stage;
  /** Human-readable name of the gate. */
  name: string;
  /** Individual checks that must all pass for the gate to be satisfied. */
  checks: PhaseGateCheck[];
}

/**
 * A single checkable criterion inside a phase gate.
 *
 * The `check` function is called at evaluation time — typically after the
 * Maker has produced work and the Checker has verified it.
 */
export interface PhaseGateCheck {
  /** Short identifier for the check (e.g. `p0_issues_zero`). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Evaluates the check against the provided input. */
  check: (input: PhaseGateInput) => GateCheckResult;
}

/**
 * Input passed to every phase-gate check.
 *
 * This is intentionally a flexible bag of metrics so that each stage can
 * carry the data it needs without forcing unrelated fields on others.
 */
export interface PhaseGateInput {
  // ── open stage metrics ──
  /** Number of P0 (critical) issues in the PRD. */
  p0_issues?: number;
  /** Number of P1 (high) issues in the PRD. */
  p1_issues?: number;

  // ── design stage metrics ──
  /** Number of architecture diagrams completed. */
  diagrams_complete?: number;
  /** Whether the design review has passed. */
  design_review_passed?: boolean;

  // ── build stage metrics ──
  /** Whether TDD discipline is enforced (tests written before code). */
  tdd_enforced?: boolean;
  /** Percentage (0–100) of unit tests passing. */
  unit_test_pass_pct?: number;

  // ── verify stage metrics ──
  /** Number of quality gates passed (out of 5). */
  gates_passed?: number;
  /** Whether security gate is allowed to be downgraded to optional. */
  security_optional_downgrade?: boolean;
  /** Text output from verify stage for TDD Iron Law phrase detection. */
  verify_output?: string;

  // ── archive stage metrics ──
  /** Number of required documents completed. */
  documents_complete?: number;
  /** Whether spec sync has been completed. */
  spec_sync_done?: boolean;
  /** Whether learn-from-task conventions were written. */
  conventions_written?: boolean;
}

/**
 * Aggregate result of evaluating all checks in a phase gate.
 */
export interface PhaseGateEvaluation {
  /** The stage that was evaluated. */
  stage: Stage;
  /** Whether the overall gate passed (all checks passed). */
  passed: boolean;
  /** Individual check results. */
  results: Array<{ id: string; label: string; result: GateCheckResult }>;
  /** First failing reason, if any (used for concise error reporting). */
  blocking_reason?: string;
}

// ---------------------------------------------------------------------------
// Phase gate definitions
// ---------------------------------------------------------------------------

/**
 * Quality gate for the **open** stage (PRD generation).
 *
 * Requirement: P0 issues = 0 AND P1 issues <= 3.
 */
const openGate: PhaseGate = {
  stage: 'open',
  name: 'PRD Quality Gate — P0 issues must be 0 and P1 <= 3',
  checks: [
    {
      id: 'p0_issues_zero',
      label: 'P0 issues = 0',
      check: (input) => {
        const p0 = input.p0_issues ?? -1;
        return {
          passed: p0 === 0,
          detail: p0 < 0 ? 'P0 issue count not provided' : `P0 issues = ${p0}`,
          metrics: { p0_issues: p0 },
        };
      },
    },
    {
      id: 'p1_issues_within_limit',
      label: 'P1 issues <= 3',
      check: (input) => {
        const p1 = input.p1_issues ?? -1;
        return {
          passed: p1 >= 0 && p1 <= 3,
          detail: p1 < 0 ? 'P1 issue count not provided' : `P1 issues = ${p1}`,
          metrics: { p1_issues: p1 },
        };
      },
    },
  ],
};

/**
 * Quality gate for the **design** stage (architecture).
 *
 * Requirement: 7 architecture diagrams complete + design review passed.
 */
const designGate: PhaseGate = {
  stage: 'design',
  name: 'Architecture Gate — 7 diagrams complete + design review passed',
  checks: [
    {
      id: 'diagrams_complete',
      label: '7 architecture diagrams complete',
      check: (input) => {
        const diagrams = input.diagrams_complete ?? 0;
        return {
          passed: diagrams >= 7,
          detail: `${diagrams}/7 architecture diagrams complete`,
          metrics: { diagrams_complete: diagrams, required: 7 },
        };
      },
    },
    {
      id: 'design_review_passed',
      label: 'Design review passed',
      check: (input) => ({
        passed: input.design_review_passed === true,
        detail: input.design_review_passed ? 'Design review passed' : 'Design review not yet passed',
      }),
    },
  ],
};

/**
 * Quality gate for the **build** stage (coding).
 *
 * Requirement: TDD enforced + unit tests 100% passing.
 */
const buildGate: PhaseGate = {
  stage: 'build',
  name: 'Build Gate — TDD enforced + unit tests 100% passing',
  checks: [
    {
      id: 'tdd_enforced',
      label: 'TDD enforced (tests before code)',
      check: (input) => ({
        passed: input.tdd_enforced === true,
        detail: input.tdd_enforced ? 'TDD discipline enforced' : 'TDD discipline not enforced',
      }),
    },
    {
      id: 'unit_tests_passing',
      label: 'Unit tests 100% passing',
      check: (input) => {
        const pct = input.unit_test_pass_pct ?? 0;
        return {
          passed: pct >= 100,
          detail: `Unit test pass rate: ${pct}%`,
          metrics: { unit_test_pass_pct: pct, required: 100 },
        };
      },
    },
  ],
};

/**
 * Anti-pattern phrases that trigger TDD Iron Law STOP.
 * Inspired by spec-superflow's phrase-based stop triggers.
 * These phrases indicate the agent is trying to bypass test discipline.
 */
const TDD_IRON_LAW_STOP_PHRASES: RegExp[] = [
  /skip\s+the\s*test/i,
  /verify\s+manually/i,
  /test\s+is\s+not\s+necessary/i,
  /not\s+worothy\s+of\s+test/i,
  /test\s+overhead/i,
  /tests?\s+can\s+be\s+written\s+later/i,
  /trust\s+me\s+it\s+works/i,
  /works\s+for\s+me/i,
  /probably\s+works/i,
  /assume\s+it\s+is\s+correct/i,
  /test\s+it\s+myself/i,
  /manual\s+verification\s+is\s+enough/i,
];

/**
 * Quality gate for the **verify** stage (validation).
 *
 * Requirement: 5 gates all passed (security optional downgrade) +
 * TDD Iron Law: verify output must not contain anti-pattern phrases.
 */
const verifyGate: PhaseGate = {
  stage: 'verify',
  name: 'Verification Gate — all 5 quality gates passed + TDD Iron Law',
  checks: [
    {
      id: 'gates_passed',
      label: 'All 5 quality gates passed',
      check: (input) => {
        const passed = input.gates_passed ?? 0;
        const required = input.security_optional_downgrade ? 4 : 5;
        return {
          passed: passed >= required,
          detail: `${passed}/${required} required gates passed${input.security_optional_downgrade ? ' (security optional)' : ''}`,
          metrics: { gates_passed: passed, required },
        };
      },
    },
    {
      id: 'tdd_iron_law',
      label: 'TDD Iron Law — no anti-pattern phrases',
      check: (input) => {
        const output = input.verify_output ?? '';
        if (!output) {
          return { passed: true, detail: 'No verify output to scan (non-blocking)', metrics: { phrase_count: 0 } };
        }
        let found = false;
        for (const pattern of TDD_IRON_LAW_STOP_PHRASES) {
          if (pattern.test(output)) {
            found = true;
            break;
          }
        }
        if (found) {
          return {
            passed: false,
            detail: `TDD Iron Law STOP: anti-pattern phrase detected`,
            metrics: { phrase_count: 1 },
          };
        }
        return { passed: true, detail: 'TDD Iron Law passed — no anti-pattern phrases', metrics: { phrase_count: 0 } };
      },
    },
  ],
};

/**
 * Quality gate for the **archive** stage (archival).
 *
 * Requirement: 6 documents complete + spec sync done + learn-from-task conventions written.
 */
const archiveGate: PhaseGate = {
  stage: 'archive',
  name: 'Archive Gate — 6 documents + spec sync + conventions written',
  checks: [
    {
      id: 'documents_complete',
      label: '6 documents complete',
      check: (input) => {
        const docs = input.documents_complete ?? 0;
        return {
          passed: docs >= 6,
          detail: `${docs}/6 documents complete`,
          metrics: { documents_complete: docs, required: 6 },
        };
      },
    },
    {
      id: 'spec_sync_done',
      label: 'Spec sync completed',
      check: (input) => ({
        passed: input.spec_sync_done === true,
        detail: input.spec_sync_done ? 'Spec sync completed' : 'Spec sync not yet completed',
      }),
    },
    {
      id: 'conventions_written',
      label: 'Learn-from-task conventions written',
      check: (input) => ({
        passed: input.conventions_written === true,
        detail: input.conventions_written ? 'Conventions written to spec-conventions/' : 'Conventions not yet written',
      }),
    },
  ],
};

/**
 * The full set of phase gates keyed by stage.
 *
 * Usage:
 * ```ts
 * const gate = PHASE_GATES['build'];
 * const evaluation = evaluatePhaseGate(gate, input);
 * if (!evaluation.passed) { /* optimize & retry *\/ }
 * ```
 */
export const PHASE_GATES: Record<Stage, PhaseGate> = {
  open: openGate,
  design: designGate,
  build: buildGate,
  verify: verifyGate,
  archive: archiveGate,
};

/**
 * Evaluate a single phase gate against the given input.
 *
 * All checks must pass for the gate to be considered passed.
 */
export function evaluatePhaseGate(
  gate: PhaseGate,
  input: PhaseGateInput,
): PhaseGateEvaluation {
  const results = gate.checks.map((c) => ({
    id: c.id,
    label: c.label,
    result: c.check(input),
  }));

  const firstFailure = results.find((r) => !r.result.passed);

  return {
    stage: gate.stage,
    passed: firstFailure === undefined,
    results,
    blocking_reason: firstFailure?.result.detail,
  };
}

/**
 * Evaluate the phase gate for a specific stage using the global {@link PHASE_GATES}.
 */
export function evaluateStageGate(
  stage: Stage,
  input: PhaseGateInput,
): PhaseGateEvaluation {
  const gate = PHASE_GATES[stage];
  return evaluatePhaseGate(gate, input);
}
