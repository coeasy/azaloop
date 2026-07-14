/**
 * break-loop.ts
 *
 * Trellis-style break-loop knowledge sedimentation. When the StrikeSystem
 * records the 2nd strike, this module performs a structured 5-dimension
 * root-cause analysis of the failure and writes a `ConventionsEntry` into
 * `.aza/spec-conventions/break-loop.jsonl` so future iterations can avoid
 * the same mistake.
 *
 * 5 dimensions (Bayesian-inspired):
 *   1. Missing Spec        — was the PRD/contract missing a requirement?
 *   2. Cross-Layer Contract — did an interface/protocol drift between layers?
 *   3. Change Propagation  — was an upstream change not propagated to all consumers?
 *   4. Test Gap            — was there a missing test or fixture?
 *   5. Implicit Assumption — was something the agent took for granted wrong?
 *
 * The rule-based classifier in this module is intentionally simple — the
 * goal is to *capture* the failure context with stable IDs so that future
 * LLM-assisted analysis can enrich the entry without losing the lineage.
 *
 * Reference: https://github.com/mindfold-ai/Trellis (break-loop pattern)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Stage } from '../L7_loop/state-machine';
import type { NextAction } from '@azaloop/shared';
import type { ConventionsEntry } from '../L7_loop/learn-from-task';

export type BreakLoopDimension =
  | 'missing_spec'
  | 'cross_layer_contract'
  | 'change_propagation'
  | 'test_gap'
  | 'implicit_assumption';

export interface RootCause {
  dimension: BreakLoopDimension;
  confidence: number; // 0..1
  rationale: string;
  evidence: string[];
}

export interface BreakLoopContext {
  stage: Stage;
  iteration: number;
  error: string;
  lastAction: NextAction;
  strikeCount: number;
  /** Optional: free-form context the controller wants captured. */
  extra?: Record<string, unknown>;
}

export interface BreakLoopResult {
  rootCauses: RootCause[];
  recommendations: string[];
  convention: ConventionsEntry;
  /** Path the entry was written to. */
  writtenTo: string;
}

// ── Rule-based classifier ──

const KEYWORD_RULES: Array<{
  dimension: BreakLoopDimension;
  patterns: RegExp[];
  rationale: string;
}> = [
  {
    dimension: 'missing_spec',
    patterns: [
      /\b(spec|requirement|prd|unclear|ambiguous|undefined|not specified)\b/i,
      /缺少(需求|规格|定义)/,
    ],
    rationale: 'Failure references a missing or ambiguous spec/requirement.',
  },
  {
    dimension: 'cross_layer_contract',
    patterns: [
      /\b(interface|protocol|api|contract|signature|schema)\b.*\b(mismatch|drift|broken|invalid)\b/i,
      /接口(不匹配|不一致|失败)/,
    ],
    rationale: 'Failure indicates an interface/protocol drift between layers.',
  },
  {
    dimension: 'change_propagation',
    patterns: [
      /\b(propagat|cascad|downstream|consumer|not updated|stale)\b/i,
      /未(同步|更新|传播)/,
    ],
    rationale: 'Failure suggests an upstream change was not propagated to all consumers.',
  },
  {
    dimension: 'test_gap',
    patterns: [
      /\b(test|fixture|mock|coverage|assertion|expectation).{0,30}\b(missing|absent|skipped|fail)\b/i,
      /(测试|用例).{0,15}(缺失|失败|跳过)/,
    ],
    rationale: 'Failure points to a missing or failing test/fixture.',
  },
  {
    dimension: 'implicit_assumption',
    patterns: [
      /\b(assum|presuppos|expect|take for granted|thought it was)\b/i,
      /假设.{0,15}(错误|不成立|失败)/,
    ],
    rationale: 'Failure reveals an implicit assumption that turned out to be wrong.',
  },
];

function classifyError(ctx: BreakLoopContext): RootCause[] {
  const blob = `${ctx.error}\n${ctx.lastAction?.reason ?? ''}\n${ctx.lastAction?.tool ?? ''}`;
  const causes: RootCause[] = [];
  for (const rule of KEYWORD_RULES) {
    const evidence: string[] = [];
    for (const pat of rule.patterns) {
      const m = blob.match(pat);
      if (m) evidence.push(m[0]);
    }
    if (evidence.length === 0) continue;
    // Confidence: 0.5 baseline + 0.15 per evidence snippet, capped at 0.95.
    const confidence = Math.min(0.5 + evidence.length * 0.15, 0.95);
    causes.push({
      dimension: rule.dimension,
      confidence,
      rationale: rule.rationale,
      evidence,
    });
  }
  // Stable ordering: highest confidence first.
  causes.sort((a, b) => b.confidence - a.confidence);
  return causes;
}

function recommendationsFor(causes: RootCause[]): string[] {
  const out: string[] = [];
  for (const c of causes) {
    switch (c.dimension) {
      case 'missing_spec':
        out.push('Re-run aza_explore → aza_prd_review and clarify the missing requirement before continuing.');
        break;
      case 'cross_layer_contract':
        out.push('Add a contract test or aza_contract_diff between the two layers and re-run.');
        break;
      case 'change_propagation':
        out.push('Trace the upstream change with aza_dependency_graph and re-sync downstream consumers.');
        break;
      case 'test_gap':
        out.push('Add a focused regression test in tests/ that reproduces this failure, then re-run aza_task_implement.');
        break;
      case 'implicit_assumption':
        out.push('Document the assumption explicitly in .aza/RESUME.md so it can be re-checked next iteration.');
        break;
    }
  }
  if (out.length === 0) {
    out.push('No rule matched; consider escalating to aza_audit and let a human review the failure log.');
  }
  return out;
}

function dimensionToTag(d: BreakLoopDimension): string {
  switch (d) {
    case 'missing_spec': return 'spec-gap';
    case 'cross_layer_contract': return 'contract-drift';
    case 'change_propagation': return 'propagation';
    case 'test_gap': return 'test-gap';
    case 'implicit_assumption': return 'assumption';
  }
}

function buildConvention(ctx: BreakLoopContext, rootCauses: RootCause[]): ConventionsEntry {
  const tags = rootCauses.map(c => dimensionToTag(c.dimension));
  const primary = rootCauses[0]?.dimension ?? 'implicit_assumption';
  return {
    tag: `break-loop:${primary}`,
    description: [
      `Strike #${ctx.strikeCount} on stage ${ctx.stage} (iter ${ctx.iteration}).`,
      `Last action: ${ctx.lastAction?.tool ?? '(none)'}.`,
      `Top root cause: ${primary}.`,
      `Error: ${truncate(ctx.error, 240)}`,
    ].join(' '),
    source: `break-loop:${ctx.stage}`,
    recorded_at: new Date().toISOString(),
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

/**
 * Run the break-loop analysis and append a ConventionsEntry to
 * `<azaDir>/spec-conventions/break-loop.jsonl`.
 *
 * Returns a structured result that LoopController can attach to its
 * `nextV12` response as `data.break_loop`.
 */
export async function breakLoop(ctx: BreakLoopContext, azaDir: string = '.aza'): Promise<BreakLoopResult> {
  const rootCauses = classifyError(ctx);
  const recommendations = recommendationsFor(rootCauses);
  const convention = buildConvention(ctx, rootCauses);

  // Build a fuller human-readable body to write alongside the ConventionsEntry.
  const fullBody = [
    `**Error**: ${ctx.error}`,
    `**Last action**: ${ctx.lastAction?.tool ?? '(none)'} (${ctx.lastAction?.action ?? ''})`,
    `**Iteration**: ${ctx.iteration}`,
    ``,
    `## Root causes`,
    ...rootCauses.map(c => `- **${c.dimension}** (confidence ${c.confidence.toFixed(2)}): ${c.rationale}`),
    ``,
    `## Recommendations`,
    ...recommendations.map(r => `- ${r}`),
  ].join('\n');

  const target = path.join(azaDir, 'spec-conventions', 'break-loop.jsonl');
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Write a richer JSONL payload that wraps the ConventionsEntry with the
  // full body so downstream tooling (and a future LLM-assisted re-analyzer)
  // can recover everything from this file.
  const record = {
    convention,
    body: fullBody,
    stage: ctx.stage,
    iteration: ctx.iteration,
    strikeCount: ctx.strikeCount,
    timestamp: new Date().toISOString(),
    rootCauses,
    recommendations,
    extra: ctx.extra ?? {},
  };
  await fs.appendFile(target, JSON.stringify(record) + '\n', 'utf8');

  return {
    rootCauses,
    recommendations,
    convention,
    writtenTo: target,
  };
}
