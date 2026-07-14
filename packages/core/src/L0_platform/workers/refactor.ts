/**
 * refactor worker (T28)
 *
 * Triggered on stage advance. Emits a small set of refactor hints
 * based on the files modified in the current iteration. This is a
 * placeholder — Phase 4 will replace with AST-based heuristics.
 */
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runRefactor(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  // Heuristic: if the loop has many iterations, suggest a refactor.
  const iters = ctx.state.loop?.iteration ?? 0;
  if (iters > 10) {
    findings.push({
      severity: 'warn',
      message: `Loop iteration ${iters} is high — consider a refactor before proceeding.`,
      refs: ['STATE.yaml:loop.iteration'],
    });
  } else {
    findings.push({ severity: 'info', message: 'No refactor hints at this iteration.', refs: [] });
  }

  return {
    name: 'refactor',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
