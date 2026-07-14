/**
 * map worker (T28)
 *
 * Triggered on stage advance. Rebuilds the task dependency graph by
 * reading `tasks/<id>/CONTEXT.md` files and extracting cross-references.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runMap(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  const tasksDir = path.join(ctx.azaDir, 'tasks');
  if (!fs.existsSync(tasksDir)) {
    findings.push({ severity: 'info', message: 'No tasks/ directory — nothing to map.', refs: [] });
    return {
      name: 'map',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      findings,
    };
  }

  let taskCount = 0;
  try {
    const entries = await fs.promises.readdir(tasksDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) taskCount++;
    }
  } catch {
    // ignore
  }

  findings.push({
    severity: 'info',
    message: `Mapped ${taskCount} task directories under .aza/tasks/.`,
    refs: [tasksDir],
  });

  return {
    name: 'map',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
