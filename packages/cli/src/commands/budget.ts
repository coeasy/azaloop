import { LoopCost, RunLedger } from '@azaloop/core';
import * as path from 'path';

export async function budgetCommand(dir?: string): Promise<void> {
  const azaDir = dir || path.join(process.cwd(), '.aza');

  const ledger = new RunLedger(azaDir);
  const entries = await ledger.load();
  const consumedTokens = entries.reduce((sum: number, e: any) => sum + (e.tokens ?? 0), 0);

  const estimator = new LoopCost({
    budget: 100000,
    maxPhaseIterations: 5,
    storyCount: Math.max(1, entries.filter((e: any) => e.stage === 'open').length),
    gateFailureRate: 0.3,
    enableOuterLoop: false,
  });

  const report = estimator.estimate();
  const remaining = estimator.remainingBudget(consumedTokens);

  console.log('');
  console.log('  📊 AzaLoop Budget Report');
  console.log('  ─────────────────────────────────────');
  console.log(`  Token Budget:     ${report.budget.toLocaleString()}`);
  console.log(`  Estimated Total:  ${report.total_estimate.toLocaleString()}`);
  console.log(`  Consumed:         ${consumedTokens.toLocaleString()}`);
  console.log(`  Within Budget:    ${report.within_budget ? '✅ Yes' : '❌ No'}`);
  console.log(`  Utilization:      ${report.utilization_pct}%`);
  console.log(`  Remaining:        ${remaining.remaining.toLocaleString()}`);
  console.log(`  Cycles Remaining: ${remaining.cycles_remaining}`);
  console.log('');

  console.log('  Per-Stage Breakdown:');
  console.log('  ─────────────────────────────────────');
  for (const s of report.stages) {
    console.log(`  ${s.stage.padEnd(10)} maker=${s.maker_tokens} checker=${s.checker_tokens} iters=${s.expected_iterations} total=${s.total_tokens}`);
  }
  console.log('');

  if (report.recommendations.length > 0) {
    console.log('  Recommendations:');
    for (const r of report.recommendations) {
      console.log(`  • ${r}`);
    }
    console.log('');
  }
}
