/**
 * testgaps worker (T28)
 *
 * Periodic (every 270s). Surfaces a placeholder reminder to check
 * test coverage. The real implementation would parse coverage
 * reports; here we just emit an info-level nudge.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runTestGaps(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  // Heuristic: look for a coverage report in common locations.
  const candidates = [
    'coverage/coverage-summary.json',
    'coverage/lcov.info',
    '.nyc_output/coverage.json',
  ];
  let found: string | null = null;
  for (const c of candidates) {
    const p = path.join(ctx.azaDir, c);
    if (fs.existsSync(p)) {
      found = p;
      break;
    }
  }

  if (found) {
    findings.push({ severity: 'info', message: `Coverage report detected at ${found}.`, refs: [found] });
  } else {
    findings.push({
      severity: 'warn',
      message: 'No coverage report found — consider running tests with coverage.',
      refs: [],
    });
  }

  return {
    name: 'testgaps',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
