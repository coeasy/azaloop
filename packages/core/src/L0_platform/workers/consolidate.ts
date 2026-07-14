/**
 * consolidate worker (T28)
 *
 * Triggered on stage advance. Looks at the story board and surfaces
 * duplicate or near-duplicate pending stories. The real implementation
 * would compute embeddings; here we use a simple normalized title.
 */
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

export async function runConsolidate(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];

  const board = ctx.state.loops?.outer?.board;
  if (!board) {
    findings.push({ severity: 'info', message: 'No story board found.', refs: [] });
    return {
      name: 'consolidate',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      findings,
    };
  }

  const seen = new Map<string, string>();
  for (const story of board.pending) {
    const key = story.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) {
      findings.push({
        severity: 'warn',
        message: `Possible duplicate pending story: "${story}" ≈ "${seen.get(key)}"`,
        refs: ['STATE.yaml:loops.outer.board.pending'],
      });
    } else {
      seen.set(key, story);
    }
  }

  if (findings.length === 0) {
    findings.push({ severity: 'info', message: 'No duplicate stories detected.', refs: [] });
  }

  return {
    name: 'consolidate',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
