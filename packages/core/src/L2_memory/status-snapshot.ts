/**
 * v13 — P4.1: STATUS.md live snapshot
 *
 * Generates a `.aza/STATUS.md` file that summarizes the current loop
 * state. Inspired by Trellis (mindfold-ai/Trellis) which uses a similar
 * `STATUS.md` for the agent's "where are we now" report.
 *
 * The snapshot is IDEMPOTENT: each call overwrites the previous file
 * with the latest state. Callers should invoke this once per loop tick
 * (not per internal phase) to keep the IO cost low.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface StatusSnapshotInput {
  /** Current pipeline stage. */
  currentStage: string;
  /** Current loop iteration number. */
  iteration: number;
  /** Progress percentage (0-100). */
  progress: string;
  /** Last completed milestone (e.g. 'PRD approved', 'TDD enforced'). */
  lastMilestone: string;
  /** Next action to take. */
  nextAction: string;
  /** Number of active strikes. */
  strikes: number;
  /** List of open changes (slugs from openspec/ or docs/adr/). */
  openChanges: string[];
  /** Optional human-readable story ID. */
  storyId?: string;
  /** Optional client name (cursor, trae, claude-code, etc.). */
  client?: string;
  /** Optional model name. */
  model?: string;
  /** ISO timestamp; defaults to now. */
  updatedAt?: string;
}

/**
 * Write the STATUS.md snapshot to `<azaDir>/STATUS.md`. Best-effort:
 * any failure (e.g. read-only filesystem) throws — callers should wrap
 * in try/catch.
 */
export function writeStatusSnapshot(azaDir: string, input: StatusSnapshotInput): void {
  const content = buildStatusMarkdown(input);
  const filePath = path.join(azaDir, 'STATUS.md');
  fs.mkdirSync(azaDir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Read the current STATUS.md (if any). Returns null when no snapshot exists.
 */
export function readStatusSnapshot(azaDir: string): string | null {
  const filePath = path.join(azaDir, 'STATUS.md');
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Pure: build the STATUS.md markdown from the input. Exposed for tests.
 */
export function buildStatusMarkdown(input: StatusSnapshotInput): string {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const lines: string[] = [
    '# STATUS',
    '',
    `> Live snapshot of the current azaloop loop. Updated at ${updatedAt}.`,
    '',
    '## Current State',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Stage | \`${input.currentStage}\` |`,
    `| Iteration | \`${input.iteration}\` |`,
    `| Progress | \`${input.progress}\` |`,
    `| Strikes | \`${input.strikes}\` |`,
  ];
  if (input.storyId) lines.push(`| Story | \`${input.storyId}\` |`);
  if (input.client) lines.push(`| Client | \`${input.client}\` |`);
  if (input.model) lines.push(`| Model | \`${input.model}\` |`);

  lines.push('', '## Last Milestone', '', input.lastMilestone || '_none yet_');
  lines.push('', '## Next Action', '', input.nextAction || '_idle_');

  lines.push('', '## Open Changes', '');
  if (input.openChanges.length === 0) {
    lines.push('_none_');
  } else {
    for (const c of input.openChanges) {
      lines.push(`- \`${c}\``);
    }
  }

  lines.push('', '---', '', `<!-- updated ${updatedAt} -->`);
  return lines.join('\n') + '\n';
}
