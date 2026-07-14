/**
 * SPARC 5-Phase Gate Criteria (T26)
 *
 * Implements the ruflo/SPARC methodology (Specification / Pseudocode /
 * Architecture / Refinement / Completion) as a multi-stage gate evaluator
 * with explicit criteria and minimum-score thresholds.
 *
 * Reference: ruvnet/ruflo SPARC pattern
 *   - https://github.com/ruvnet/ruflo (loop/sparc)
 *
 * SPARC ↔ azaloop state-machine mapping:
 *   specification  ← open stage
 *   pseudocode     ← design stage (front 30%, by `designProgress`)
 *   architecture   ← design stage (back 70%, by `designProgress`)
 *   refinement     ← build stage
 *   completion     ← verify + archive stages
 *
 * The 5 phases have progressively stricter minScore thresholds (0.6 → 0.6 →
 * 0.7 → 0.8 → 0.9), reflecting the increasing cost of late-stage rework.
 */

import type { Stage } from './state-machine';

// ── Public types ─────────────────────────────────────────────

export type SPARCPhase =
  | 'specification'
  | 'pseudocode'
  | 'architecture'
  | 'refinement'
  | 'completion';

export interface SPARCPhaseConfig {
  criteria: string[];
  minScore: number;
  description: string;
}

export interface Evidence {
  name: string;
  passed: boolean;
  /** Optional weight in [0, 1]. Defaults to 1.0. */
  weight?: number;
}

export interface SPARCGateEvaluation {
  phase: SPARCPhase;
  passed: boolean;
  score: number;
  minScore: number;
  missingCriteria: string[];
  passedCriteria: string[];
  evidence: Array<{ name: string; passed: boolean; weight: number }>;
}

// ── Constants ───────────────────────────────────────────────

/**
 * ruflo SPARC 5-phase criteria table. The `minScore` is a fraction in [0, 1]
 * that the weighted-evidence sum must reach for the phase to pass.
 *
 * Thresholds follow the ruflo reference implementation; the escalating
 * values reflect the cost curve of late-stage rework.
 */
export const SPARC_GATE_CRITERIA: Record<SPARCPhase, SPARCPhaseConfig> = {
  specification: {
    description: 'Capture intent, acceptance criteria, constraints, and edges.',
    criteria: [
      'Acceptance criteria ≥ 3',
      'Constraints documented',
      'Edge cases listed',
      'Out-of-scope items called out',
    ],
    minScore: 0.6,
  },
  pseudocode: {
    description: 'Sketch the algorithm and error paths in language-agnostic pseudocode.',
    criteria: [
      'Covers all acceptance criteria',
      'Error paths explicit',
      'Complexity annotated (Big-O)',
    ],
    minScore: 0.6,
  },
  architecture: {
    description: 'Decide on structure, typed interfaces, and module boundaries.',
    criteria: [
      'All constraints addressed',
      'Typed API contracts',
      'No circular dependencies',
      'ADR created for non-trivial decisions',
    ],
    minScore: 0.7,
  },
  refinement: {
    description: 'TDD-driven implementation with reviewer sign-off.',
    criteria: [
      'All ACs have passing tests (TDD Iron Law)',
      'Code review approved',
      'Coverage ≥ 80%',
    ],
    minScore: 0.8,
  },
  completion: {
    description: 'Verify, document, and certify the change for ship.',
    criteria: [
      'All tests green',
      'Documentation complete',
      'Deployment checklist verified',
      'ADR-0001 (namespace) updated',
    ],
    minScore: 0.9,
  },
};

/**
 * Strict ordering of the 5 phases. Used by `nextSPARCPhase` and to
 * serialize `evaluateSparcGate` calls.
 */
export const SPARC_PHASE_ORDER: readonly SPARCPhase[] = [
  'specification',
  'pseudocode',
  'architecture',
  'refinement',
  'completion',
] as const;

// ── Mapping helpers ─────────────────────────────────────────

/**
 * Map an azaloop `Stage` to a SPARC phase. The `design` stage is split:
 *   - first 30% of design progress → `pseudocode`
 *   - remaining 70%                → `architecture`
 * Other stages map 1:1 (open→specification, build→refinement,
 * verify/archive both → completion).
 *
 * If `designProgress` is omitted, `pseudocode` is returned for `design`
 * to err on the side of the more permissive gate.
 */
export function sparcPhaseForStage(
  stage: Stage,
  designProgress?: number,
): SPARCPhase {
  switch (stage) {
    case 'open':
      return 'specification';
    case 'design':
      if (designProgress !== undefined && designProgress >= 0.3) {
        return 'architecture';
      }
      return 'pseudocode';
    case 'build':
      return 'refinement';
    case 'verify':
    case 'archive':
      return 'completion';
  }
}

/**
 * Return the next SPARC phase in the strict ordering. Returns `null` at
 * the end so callers can detect "all phases complete".
 */
export function nextSPARCPhase(phase: SPARCPhase): SPARCPhase | null {
  const idx = SPARC_PHASE_ORDER.indexOf(phase);
  if (idx < 0 || idx >= SPARC_PHASE_ORDER.length - 1) return null;
  return SPARC_PHASE_ORDER[idx + 1] ?? null;
}

// ── Evaluation ──────────────────────────────────────────────

/**
 * Evaluate a SPARC gate given a set of evidence items.
 *
 * Algorithm:
 *   1. Compute the weighted sum of `passed === true` evidence.
 *   2. Divide by the total weight to get a score in [0, 1].
 *   3. Pass if `score >= config.minScore` AND at least one criterion
 *      was supplied.
 *   4. `missingCriteria` lists criteria whose corresponding evidence
 *      was not found (by name prefix match).
 *
 * Edge cases:
 *   - Empty evidence → score = 0, passed = false (caller can override
 *     by passing at least one piece of evidence).
 *   - All weight=0 → score = 0 (treated as no evidence).
 */
export function evaluateSparcGate(
  phase: SPARCPhase,
  evidence: Evidence[],
): SPARCGateEvaluation {
  const config = SPARC_GATE_CRITERIA[phase];

  if (evidence.length === 0) {
    return {
      phase,
      passed: false,
      score: 0,
      minScore: config.minScore,
      missingCriteria: [...config.criteria],
      passedCriteria: [],
      evidence: [],
    };
  }

  let passedWeight = 0;
  let totalWeight = 0;
  const evidencePassedNames: string[] = [];

  for (const ev of evidence) {
    const w = ev.weight ?? 1;
    totalWeight += w;
    if (ev.passed) {
      passedWeight += w;
      evidencePassedNames.push(ev.name);
    }
  }

  const score = totalWeight > 0 ? passedWeight / totalWeight : 0;
  const passed = score >= config.minScore && totalWeight > 0;

  // Map evidence name → criterion coverage.
  // An evidence "covers" a criterion if its name is a substring of
  // the criterion (case-insensitive) or vice versa. This is a
  // simple heuristic — callers may pass more specific names.
  const passedCriteria: string[] = [];
  const missingCriteria: string[] = [];
  for (const criterion of config.criteria) {
    const lower = criterion.toLowerCase();
    const matched = evidencePassedNames.some(
      (n) => lower.includes(n.toLowerCase()) || n.toLowerCase().includes(lower.split(' ')[0] ?? ''),
    );
    if (matched) {
      passedCriteria.push(criterion);
    } else {
      missingCriteria.push(criterion);
    }
  }

  return {
    phase,
    passed,
    score: Math.round(score * 1000) / 1000,
    minScore: config.minScore,
    missingCriteria,
    passedCriteria,
    evidence: evidence.map((e) => ({ name: e.name, passed: e.passed, weight: e.weight ?? 1 })),
  };
}

// ── Convenience constructors ────────────────────────────────

/**
 * Build an evidence list from a `Record<name, passed>`. Useful for
 * terse callers that don't need to specify weights.
 */
export function evidenceFromMap(record: Record<string, boolean>): Evidence[] {
  return Object.entries(record).map(([name, passed]) => ({ name, passed }));
}

/**
 * Validate that all required phases are configured. Throws if any
 * phase is missing or has no criteria. Useful as a startup check.
 */
export function validateSparcConfig(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const phase of SPARC_PHASE_ORDER) {
    const config = SPARC_GATE_CRITERIA[phase];
    if (!config) {
      errors.push(`SPARC phase "${phase}" is missing`);
      continue;
    }
    if (config.criteria.length === 0) {
      errors.push(`SPARC phase "${phase}" has no criteria`);
    }
    if (config.minScore < 0 || config.minScore > 1) {
      errors.push(`SPARC phase "${phase}" minScore out of range: ${config.minScore}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
