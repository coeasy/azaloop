/**
 * v13 — P6.1: Subagent 2-stage dispatch
 *
 * Implements superpowers-style 2-stage review: every task is first
 * reviewed for spec compliance, then for code quality. If either stage
 * fails, a strike is recorded.
 *
 * Four roles are available:
 *   - spec-compliance-reviewer
 *   - code-quality-reviewer
 *   - security-reviewer
 *   - docs-reviewer
 *
 * The 2-stage flow is `spec-compliance` → `code-quality`. The security
 * and docs reviewers can be added as additional stages via `dispatchReview`.
 *
 * Reference: obra/superpowers subagent-driven development pattern.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import * as path from 'path';

export type SubagentRole =
  | 'spec-compliance-reviewer'
  | 'code-quality-reviewer'
  | 'security-reviewer'
  | 'docs-reviewer';

export interface ReviewInput {
  taskId: string;
  /** The diff / patch / file contents to review. */
  content: string;
  /** Optional context (e.g. related specs, ADRs). */
  context?: Record<string, string>;
}

export interface ReviewResult {
  role: SubagentRole;
  taskId: string;
  /** Whether the review passed. */
  passed: boolean;
  /** Score 0..1. */
  score: number;
  /** Findings from the reviewer. */
  findings: string[];
  /** Optional suggestion for the next stage. */
  suggestion?: string;
  /** ISO timestamp. */
  reviewedAt: string;
}

export interface TwoStageReviewResult {
  taskId: string;
  stage1: ReviewResult;
  stage2: ReviewResult;
  /** Overall pass = stage1.passed && stage2.passed. */
  passed: boolean;
  /** Whether either stage recorded a strike. */
  strike: boolean;
  /** Combined findings. */
  allFindings: string[];
}

// ── Per-role heuristics (best-effort) ────────────────────

function reviewSpecCompliance(input: ReviewInput): ReviewResult {
  const findings: string[] = [];
  let score = 1.0;
  // Heuristic 1: must reference the taskId somewhere
  if (!input.content.includes(input.taskId)) {
    findings.push(`Content does not reference taskId ${input.taskId}`);
    score -= 0.2;
  }
  // Heuristic 2: must contain at least one of: `MUST`, `SHALL`, `acceptance`
  if (!/\b(MUST|SHALL|acceptance|test)/i.test(input.content)) {
    findings.push('Content does not reference acceptance criteria or MUST/SHALL language');
    score -= 0.3;
  }
  return {
    role: 'spec-compliance-reviewer',
    taskId: input.taskId,
    passed: score >= 0.6,
    score: Math.max(0, score),
    findings,
    reviewedAt: new Date().toISOString(),
  };
}

function reviewCodeQuality(input: ReviewInput): ReviewResult {
  const findings: string[] = [];
  let score = 1.0;
  // Heuristic 1: avoid `console.log` in production code
  if (/console\.log\(/.test(input.content)) {
    findings.push('Avoid console.log in production code');
    score -= 0.5;
  }
  // Heuristic 2: avoid `any` in TypeScript
  if (/:\s*any\b/.test(input.content)) {
    findings.push('Avoid `any` type in TypeScript code');
    score -= 0.2;
  }
  // Heuristic 3: avoid `TODO` (incomplete work)
  if (/\bTODO\b/.test(input.content)) {
    findings.push('Content contains TODO markers — incomplete work');
    score -= 0.15;
  }
  return {
    role: 'code-quality-reviewer',
    taskId: input.taskId,
    passed: score >= 0.6,
    score: Math.max(0, score),
    findings,
    reviewedAt: new Date().toISOString(),
  };
}

function reviewSecurity(input: ReviewInput): ReviewResult {
  const findings: string[] = [];
  let score = 1.0;
  if (/eval\(/.test(input.content)) {
    findings.push('Use of eval() is a security risk');
    score -= 0.5;
  }
  if (/innerHTML\s*=/.test(input.content)) {
    findings.push('Direct innerHTML assignment is a XSS risk');
    score -= 0.3;
  }
  if (/password\s*=\s*['"]/i.test(input.content)) {
    findings.push('Hardcoded password detected');
    score -= 0.5;
  }
  return {
    role: 'security-reviewer',
    taskId: input.taskId,
    passed: score >= 0.7,
    score: Math.max(0, score),
    findings,
    reviewedAt: new Date().toISOString(),
  };
}

function reviewDocs(input: ReviewInput): ReviewResult {
  const findings: string[] = [];
  let score = 1.0;
  if (!/\bREADME|##\s/.test(input.content)) {
    findings.push('No README or section header found');
    score -= 0.3;
  }
  return {
    role: 'docs-reviewer',
    taskId: input.taskId,
    passed: score >= 0.6,
    score: Math.max(0, score),
    findings,
    reviewedAt: new Date().toISOString(),
  };
}

const REVIEWERS: Record<SubagentRole, (input: ReviewInput) => ReviewResult> = {
  'spec-compliance-reviewer': reviewSpecCompliance,
  'code-quality-reviewer': reviewCodeQuality,
  'security-reviewer': reviewSecurity,
  'docs-reviewer': reviewDocs,
};

// ── Public API ────────────────────────────────────────────

/**
 * Dispatch a single review.
 */
export function dispatchReview(role: SubagentRole, input: ReviewInput): ReviewResult {
  const fn = REVIEWERS[role];
  if (!fn) {
    throw new Error(`dispatchReview: unknown role ${role}`);
  }
  return fn(input);
}

/**
 * v13 — P6.1: run the 2-stage review (spec-compliance → code-quality).
 * If either stage fails, `strike: true` is set. Both stage results are
 * returned for traceability.
 */
export function runTwoStageReview(input: ReviewInput): TwoStageReviewResult {
  const stage1 = dispatchReview('spec-compliance-reviewer', input);
  const stage2 = dispatchReview('code-quality-reviewer', input);
  const passed = stage1.passed && stage2.passed;
  return {
    taskId: input.taskId,
    stage1,
    stage2,
    passed,
    strike: !passed,
    allFindings: [...stage1.findings, ...stage2.findings],
  };
}

/**
 * Write a review result to `<azaDir>/tasks/<taskId>/NOTES.md`. Best-effort.
 */
export function recordReviewInNotes(azaDir: string, result: TwoStageReviewResult): void {
  try {
    const dir = path.join(azaDir, 'tasks', result.taskId);
    mkdirSync(dir, { recursive: true });
    const notesPath = path.join(dir, 'NOTES.md');
    const ts = new Date().toISOString();
    const block = [
      '',
      `## ${ts} — 2-stage review`,
      '',
      `- spec-compliance: ${result.stage1.passed ? 'PASS' : 'FAIL'} (score=${result.stage1.score})`,
      `- code-quality: ${result.stage2.passed ? 'PASS' : 'FAIL'} (score=${result.stage2.score})`,
      `- overall: ${result.passed ? 'PASS' : 'FAIL'}${result.strike ? ' (STRIKE)' : ''}`,
      '',
      result.allFindings.length > 0
        ? '### Findings\n\n' + result.allFindings.map((f) => `- ${f}`).join('\n')
        : '_no findings_',
      '',
    ].join('\n');
    if (!existsSync(notesPath)) {
      writeFileSync(notesPath, `# NOTES — ${result.taskId}\n\n`, 'utf8');
    }
    const existing = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : '';
    writeFileSync(notesPath, existing + block, 'utf8');
  } catch {
    // best-effort
  }
}
