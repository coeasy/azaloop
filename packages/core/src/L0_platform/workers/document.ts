/**
 * document worker (T28)
 *
 * Triggered on completion. Emits a documentation summary: which
 * artifacts (PRD, ADRs, OpenSpec) exist and which are missing.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runDocument(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  const checks: Array<{ label: string; rel: string; required: boolean }> = [
    { label: 'PRD', rel: 'PRD.md', required: true },
    { label: 'STATE', rel: 'STATE.yaml', required: true },
    { label: 'RESUME', rel: 'RESUME.md', required: false },
    { label: 'EXAMPLES', rel: 'EXAMPLES.md', required: false },
    { label: 'openspec dir', rel: 'openspec', required: false },
    { label: 'adrs dir', rel: 'docs/adrs', required: false },
  ];

  const present: string[] = [];
  const missing: string[] = [];
  for (const c of checks) {
    const p = path.join(ctx.azaDir, c.rel);
    if (fs.existsSync(p)) present.push(c.label);
    else if (c.required) missing.push(c.label);
  }

  if (present.length > 0) {
    findings.push({ severity: 'info', message: `Present: ${present.join(', ')}`, refs: [] });
  }
  if (missing.length > 0) {
    findings.push({
      severity: 'error',
      message: `Required artifacts missing: ${missing.join(', ')}`,
      refs: missing.map((m) => `.aza/${m}`),
    });
  }
  if (present.length === 0 && missing.length === 0) {
    findings.push({ severity: 'info', message: 'No documentation artifacts inspected.', refs: [] });
  }

  return {
    name: 'document',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
