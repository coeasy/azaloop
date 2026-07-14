/**
 * v14 — v13-P7.5: Task Source Quality Scoring
 *
 * Scores the "completeness" of a parsed task source so the inner loop
 * can refuse to start when the source is too damaged to be useful.
 *
 * ## Algorithm
 *   1. **Coverage** — fraction of items that are `completed: true`.
 *      If the source is brand new this should be `0` — that's a pass.
 *   2. **Missing fields** — per-item penalty when required fields
 *      (title, description) are absent. Penalty: 5 points per field.
 *   3. **Damaged lines** — penalty when a task line can't be parsed
 *      (e.g. malformed markdown). Penalty: 2 points per line.
 *   4. **Final score** = `100 - missing - damaged` (clamped to 0).
 *
 * ## Quality gate
 *   - `score >= 80` → `allowed: true` (loop may proceed)
 *   - `score >= 50` → `allowed: true` (with warning)
 *   - `score < 50` → `allowed: false` (loop must reject the source)
 *
 * Reference: michaelshimeles/ralphy task-sources + Trellis task
 * "completeness" heuristic.
 */

import type { TaskItem } from '../L7_loop/task-sources';

// ── Public types ─────────────────────────────────────────────

export interface QualityScore {
  /** Final score in [0, 100]. */
  total: number;
  /** 0–100: how many items are already completed. */
  coverage: number;
  /** Number of items missing required fields. */
  missingFields: number;
  /** Number of items that were damaged during parsing. */
  damagedLines: number;
  /** Total items in the source. */
  itemCount: number;
  /** Penalty applied for missing fields. */
  missingPenalty: number;
  /** Penalty applied for damaged lines. */
  damagedPenalty: number;
}

export interface QualityGateResult {
  allowed: boolean;
  score: QualityScore;
  reason: string;
  level: 'pass' | 'warn' | 'fail';
}

export interface QualityGateOptions {
  /** Coverage threshold for `pass`. Default 80. */
  passThreshold?: number;
  /** Coverage threshold for `warn`. Default 50. */
  warnThreshold?: number;
  /** Penalty per missing required field. Default 5. */
  missingFieldPenalty?: number;
  /** Penalty per damaged line. Default 2. */
  damagedLinePenalty?: number;
}

const REQUIRED_FIELDS: ReadonlyArray<keyof TaskItem> = ['title'];

// ── Public API ───────────────────────────────────────────────

/**
 * Score a parsed task source.
 */
export function scoreTaskSource(
  items: TaskItem[],
  options: QualityGateOptions = {},
): QualityScore {
  const missingPenalty = options.missingFieldPenalty ?? 5;
  const damagedPenalty = options.damagedLinePenalty ?? 2;

  const itemCount = items.length;
  if (itemCount === 0) {
    return {
      total: 0,
      coverage: 0,
      missingFields: 0,
      damagedLines: 0,
      itemCount: 0,
      missingPenalty: 0,
      damagedPenalty: 0,
    };
  }

  const completed = items.filter((i) => i.completed).length;
  const coverage = Math.round((completed / itemCount) * 100);

  let missingFields = 0;
  for (const item of items) {
    for (const field of REQUIRED_FIELDS) {
      const v = item[field];
      if (typeof v !== 'string' || v.trim().length === 0) {
        missingFields++;
      }
    }
  }

  const damagedLines = items.filter((i) => i.line === undefined && i.source !== 'github').length;

  const totalPenalty = missingFields * missingPenalty + damagedLines * damagedPenalty;
  const total = Math.max(0, 100 - totalPenalty);

  return {
    total,
    coverage,
    missingFields,
    damagedLines,
    itemCount,
    missingPenalty: missingFields * missingPenalty,
    damagedPenalty: damagedLines * damagedPenalty,
  };
}

/**
 * Run the quality gate. Returns a result with `allowed`, `level`, and
 * a human-readable reason. The gate is permissive: empty sources get
 * `allowed: false, level: 'fail'` because there's nothing to run.
 */
export function qualityGate(
  items: TaskItem[],
  options: QualityGateOptions = {},
): QualityGateResult {
  const passThreshold = options.passThreshold ?? 80;
  const warnThreshold = options.warnThreshold ?? 50;
  const score = scoreTaskSource(items, options);

  if (score.itemCount === 0) {
    return {
      allowed: false,
      score,
      reason: 'No tasks in source — refusing to start loop',
      level: 'fail',
    };
  }

  if (score.total >= passThreshold) {
    return {
      allowed: true,
      score,
      reason: `Score ${score.total}/100 (>= ${passThreshold}) — pass`,
      level: 'pass',
    };
  }

  if (score.total >= warnThreshold) {
    return {
      allowed: true,
      score,
      reason: `Score ${score.total}/100 (in [${warnThreshold}, ${passThreshold})) — proceed with warning`,
      level: 'warn',
    };
  }

  return {
    allowed: false,
    score,
    reason: `Score ${score.total}/100 (< ${warnThreshold}) — loop refused`,
    level: 'fail',
  };
}
