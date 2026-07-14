/**
 * preload worker (T28)
 *
 * Triggered on stage advance. Identifies what the next stage will need
 * and emits a "preload" reminder. Simple heuristic: if the next stage
 * is `build` and the `design` stage has no architecture entry, warn.
 */
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runPreload(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  const order = ['open', 'design', 'build', 'verify', 'archive'] as const;
  const current = ctx.state.pipeline?.current_stage;
  const idx = current ? order.indexOf(current as typeof order[number]) : -1;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;

  if (next) {
    findings.push({
      severity: 'info',
      message: `Preload reminder: next stage is "${next}".`,
      refs: ['STATE.yaml:pipeline.current_stage'],
    });
    if (next === 'build') {
      const designStage = ctx.state.pipeline?.stages?.design;
      if (designStage?.status !== 'completed') {
        findings.push({
          severity: 'warn',
          message: 'Design stage not completed before build — consider reviewing.',
          refs: ['STATE.yaml:pipeline.stages.design'],
        });
      }
    }
  } else {
    findings.push({ severity: 'info', message: 'No next stage.', refs: [] });
  }

  return {
    name: 'preload',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
