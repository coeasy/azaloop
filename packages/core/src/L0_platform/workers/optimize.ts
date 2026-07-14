/**
 * optimize worker (T28)
 *
 * Monitors token / time budget usage and emits a warning when the
 * current loop is approaching or exceeding its configured budget.
 */
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runOptimize(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  const outer = ctx.state.loops?.outer;
  const budget = outer?.budget;
  if (budget) {
    const ratio = budget.tokens_budget > 0 ? budget.tokens_used / budget.tokens_budget : 0;
    if (ratio >= 0.9) {
      findings.push({
        severity: 'error',
        message: `Token budget at ${(ratio * 100).toFixed(1)}% — consider hard-stop.`,
        refs: ['STATE.yaml:loops.outer.budget'],
      });
    } else if (ratio >= 0.7) {
      findings.push({
        severity: 'warn',
        message: `Token budget at ${(ratio * 100).toFixed(1)}% — pace carefully.`,
        refs: ['STATE.yaml:loops.outer.budget'],
      });
    } else {
      findings.push({
        severity: 'info',
        message: `Token budget healthy at ${(ratio * 100).toFixed(1)}%.`,
        refs: [],
      });
    }
  } else {
    findings.push({ severity: 'info', message: 'No budget configured.', refs: [] });
  }

  return {
    name: 'optimize',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
