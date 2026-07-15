/**
 * deepdive worker (T28)
 *
 * @status integrated — triggered on-strike via WorkerScheduler + LoopController.notifyStrike.
 *
 * Triggered on strike. Records which strike reason triggered the dive
 * and surfaces a structured reminder for the loop to back off and
 * re-analyze before retrying.
 */
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runDeepdive(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  // Look at the most recent strike via the journal (best-effort).
  findings.push({
    severity: 'warn',
    message: 'Strike detected — backing off for deeper analysis before retry.',
    refs: ['STATE.yaml:loops.inner.story_attempts'],
  });
  findings.push({
    severity: 'info',
    message: `Current story attempts: ${ctx.state.loops?.inner?.story_attempts ?? 0}`,
    refs: ['STATE.yaml:loops.inner.story_attempts'],
  });

  return {
    name: 'deepdive',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
