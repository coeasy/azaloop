import { LoopCost, RunLedger, type BudgetReport } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

/**
 * aza_budget — Token budget estimator and reporter.
 *
 * Borrows from loop-engineering's loop-cost pattern:
 * provides real-time token consumption tracking and budget forecasting.
 */

/**
 * MCP tool handler: Generate a budget report.
 */
export async function handleBudget(workspacePath?: string): Promise<LoopResponse> {
  const root = workspacePath || process.cwd();
  const azaDir = path.join(root, '.aza');

  // Load run ledger for actual consumption data
  const ledger = new RunLedger(azaDir);
  const entries = await ledger.load();
  const consumedTokens = entries.reduce((sum, e) => sum + (e.tokens ?? 0), 0);

  // Create cost estimator with real data
  const estimator = new LoopCost({
    budget: 100000, // default; would come from azaloop.yaml
    maxPhaseIterations: 5,
    storyCount: Math.max(1, entries.filter(e => e.stage === 'open').length),
    gateFailureRate: 0.3,
    enableOuterLoop: false,
  });

  const report = estimator.estimate();
  const remaining = estimator.remainingBudget(consumedTokens);

  // Generate human-readable budget report
  const summary = [
    '# Budget Report',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Token Budget | ${report.budget.toLocaleString()} |`,
    `| Estimated Total | ${report.total_estimate.toLocaleString()} |`,
    `| Actually Consumed | ${consumedTokens.toLocaleString()} |`,
    `| Within Budget | ${report.within_budget ? '✅ Yes' : '❌ No'} |`,
    `| Utilization | ${report.utilization_pct}% |`,
    `| Remaining | ${remaining.remaining.toLocaleString()} |`,
    `| Cycles Remaining | ${remaining.cycles_remaining} |`,
    '',
    '## Per-Stage Breakdown',
    '',
    '| Stage | Maker | Checker | Optimizer | Iterations | Total |',
    '|-------|-------|---------|-----------|------------|-------|',
    ...report.stages.map(s =>
      `| ${s.stage} | ${s.maker_tokens} | ${s.checker_tokens} | ${s.optimizer_tokens} | ${s.expected_iterations} | ${s.total_tokens} |`
    ),
    '',
    '## Per-Level Breakdown',
    '',
    '| Level | Tokens/Cycle | Cycles | Total |',
    '|-------|-------------|--------|-------|',
    ...report.levels.map(l =>
      `| ${l.level} | ${l.tokens_per_cycle} | ${l.expected_cycles} | ${l.total_tokens} |`
    ),
    '',
    '## Recommendations',
    '',
    ...report.recommendations.map(r => `- ${r}`),
    '',
  ].join('\n');

  // Also generate BUDGET.md file
  try {
    await ledger.writeBudgetMd(report.budget);
  } catch { /* best-effort */ }

  return {
    success: true,
    data: {
      report,
      consumed: consumedTokens,
      remaining,
      summary,
    },
    metadata: {
      iteration: 0,
      progress: `${consumedTokens}/${report.budget} tokens consumed`,
      stage: 'open',
    },
  };
}
