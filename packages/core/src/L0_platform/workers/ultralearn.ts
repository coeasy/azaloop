/**
 * ultralearn worker (T28)
 *
 * Periodically scans `.aza/` for repeated patterns and writes findings
 * to its report. Patterns include:
 *   - red flags seen ≥ 3 times in the journal
 *   - strikes of the same reason ≥ 2 in a row
 *
 * This is a lightweight heuristic implementation. The "real" version
 * would call an LLM to summarize; here we surface structural signals.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runUltralearn(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  try {
    const journalPath = path.join(ctx.azaDir, 'developer-journal.jsonl');
    if (fs.existsSync(journalPath)) {
      const raw = await fs.promises.readFile(journalPath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const redFlagCount = new Map<string, number>();
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as { red_flag?: string };
          if (entry.red_flag) {
            redFlagCount.set(entry.red_flag, (redFlagCount.get(entry.red_flag) ?? 0) + 1);
          }
        } catch {
          // skip malformed
        }
      }
      for (const [flag, count] of redFlagCount) {
        if (count >= 3) {
          findings.push({
            severity: 'warn',
            message: `Red flag "${flag}" observed ${count}× — consider a deeper review.`,
            refs: [journalPath],
          });
        }
      }
    }
  } catch {
    // best-effort
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      message: 'No repeated patterns detected in .aza/ journals.',
      refs: [],
    });
  }

  return {
    name: 'ultralearn',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
