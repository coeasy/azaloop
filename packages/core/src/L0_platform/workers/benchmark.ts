/**
 * benchmark worker — records stage timings from STATE into `.aza/benchmark.json`.
 * Explicitly heuristic (wall-clock from timestamps only).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runBenchmark(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  const stages = ctx.state.pipeline?.stages ?? {};
  const stageTimings: Record<string, number> = {};
  let totalMs = 0;
  for (const [name, info] of Object.entries(stages)) {
    const stage = info as { started_at?: string; completed_at?: string };
    if (stage.started_at && stage.completed_at) {
      const ms = new Date(stage.completed_at).getTime() - new Date(stage.started_at).getTime();
      if (Number.isFinite(ms) && ms >= 0) {
        stageTimings[name] = ms;
        totalMs += ms;
        findings.push({
          severity: 'info',
          message: `Stage "${name}" took ${ms}ms (from STATE timestamps)`,
          refs: [`STATE.yaml:pipeline.stages.${name}`],
        });
      }
    }
  }

  findings.push({
    severity: 'info',
    message: `Total measured stage time: ${totalMs}ms. Worker is wall-clock heuristic only (not a microbenchmark harness).`,
    refs: ['worker:benchmark:heuristic'],
  });

  try {
    fs.mkdirSync(ctx.azaDir, { recursive: true });
    fs.writeFileSync(
      path.join(ctx.azaDir, 'benchmark.json'),
      JSON.stringify(
        {
          recorded_at: startedAt,
          total_ms: totalMs,
          stages: stageTimings,
          note: 'heuristic wall-clock from STATE.yaml stage timestamps',
        },
        null,
        2,
      ),
      'utf8',
    );
    findings.push({
      severity: 'info',
      message: 'Wrote .aza/benchmark.json',
      refs: [path.join(ctx.azaDir, 'benchmark.json')],
    });
  } catch (err) {
    findings.push({
      severity: 'warn',
      message: `Failed to write benchmark.json: ${err instanceof Error ? err.message : String(err)}`,
      refs: [],
    });
  }

  return {
    name: 'benchmark',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
