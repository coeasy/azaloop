/**
 * audit worker (T28)
 *
 * Triggered on completion. Summarizes the entire loop run: total
 * iterations, stages completed, strikes recorded, attestation status.
 */
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runAudit(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  const stages = ctx.state.pipeline?.stages ?? {};
  const completed: string[] = [];
  const pending: string[] = [];
  for (const [name, info] of Object.entries(stages)) {
    if ((info as { status?: string }).status === 'completed') completed.push(name);
    else if ((info as { status?: string }).status === 'pending') pending.push(name);
  }

  findings.push({
    severity: 'info',
    message: `Stages completed: ${completed.join(', ') || '(none)'} | pending: ${pending.join(', ') || '(none)'}`,
    refs: ['STATE.yaml:stages'],
  });

  const att = ctx.state.attestation;
  if (att && !att.verified) {
    findings.push({
      severity: 'error',
      message: 'Attestation unverified at completion — review PRD/plan hashes.',
      refs: ['STATE.yaml:attestation'],
    });
  }

  return {
    name: 'audit',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
