/**
 * predict worker (T28)
 *
 * Predicts risk for the next stage by inspecting strike count and
 * iteration depth. If strikes ≥ 2 OR iteration ≥ 80% of max, warn.
 */
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runPredict(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  const phase = ctx.state.loops?.phase;
  if (phase) {
    const iterRatio = phase.max_iterations > 0 ? phase.iteration / phase.max_iterations : 0;
    if (iterRatio >= 0.8) {
      findings.push({
        severity: 'warn',
        message: `Phase iteration at ${(iterRatio * 100).toFixed(1)}% of max — risk of loop exhaustion.`,
        refs: ['STATE.yaml:loops.phase'],
      });
    } else {
      findings.push({
        severity: 'info',
        message: `Phase iteration healthy at ${(iterRatio * 100).toFixed(1)}%.`,
        refs: [],
      });
    }
  } else {
    findings.push({ severity: 'info', message: 'No phase loop state found.', refs: [] });
  }

  return {
    name: 'predict',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
