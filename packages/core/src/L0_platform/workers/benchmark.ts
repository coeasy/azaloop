/**
 * benchmark worker (T28)
 *
 * Triggered on completion. Records how long the loop took in total and
 * writes a small benchmark summary. This is a placeholder for Phase 4
 * performance-baseline work.
 */
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runBenchmark(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  const stages = ctx.state.pipeline?.stages ?? {};
  let totalMs = 0;
  for (const [name, info] of Object.entries(stages)) {
    const stage = info as { started_at?: string; completed_at?: string };
    if (stage.started_at && stage.completed_at) {
      const ms = new Date(stage.completed_at).getTime() - new Date(stage.started_at).getTime();
      totalMs += ms;
      findings.push({
        severity: 'info',
        message: `Stage "${name}" took ${ms}ms`,
        refs: [`STATE.yaml:pipeline.stages.${name}`],
      });
    }
  }

  findings.push({ severity: 'info', message: `Total stage time: ${totalMs}ms`, refs: [] });

  return {
    name: 'benchmark',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
