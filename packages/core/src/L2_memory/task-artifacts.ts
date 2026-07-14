/**
 * v13 — P4.1: Task Artifacts (3-piece set)
 *
 * For every task the loop processes, we write a 3-piece set under
 * `<azaDir>/tasks/<taskId>/`:
 *
 *   CONTEXT.md  — what the task is, why, dependencies, acceptance
 *   REPAIR.md   — repair attempts (e.g. when strikes cause a retry)
 *   NOTES.md    — free-form notes from the agent (review results, decisions)
 *
 * The set is generated lazily: `ensureTaskArtifacts` creates the files
 * on first call. `appendNote` and `recordRepairAttempt` append to the
 * respective files (best-effort: never throws).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TaskContextInput {
  taskId: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  dependencies?: string[];
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
}

/**
 * Ensure the 3-piece task artifacts exist under
 * `<azaDir>/tasks/<taskId>/`. Creates CONTEXT.md from `input` if it does
 * not exist. REPAIR.md and NOTES.md are created empty if missing.
 */
export function ensureTaskArtifacts(azaDir: string, input: TaskContextInput): void {
  const taskDir = path.join(azaDir, 'tasks', input.taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const contextPath = path.join(taskDir, 'CONTEXT.md');
  if (!fs.existsSync(contextPath)) {
    fs.writeFileSync(contextPath, buildContextMarkdown(input), 'utf8');
  }

  const repairPath = path.join(taskDir, 'REPAIR.md');
  if (!fs.existsSync(repairPath)) {
    fs.writeFileSync(repairPath, buildRepairHeader(input.taskId), 'utf8');
  }

  const notesPath = path.join(taskDir, 'NOTES.md');
  if (!fs.existsSync(notesPath)) {
    fs.writeFileSync(notesPath, buildNotesHeader(input.taskId), 'utf8');
  }
}

/**
 * Append a timestamped note to `<azaDir>/tasks/<taskId>/NOTES.md`.
 * Best-effort: never throws.
 */
export function appendNote(azaDir: string, taskId: string, note: string): void {
  try {
    const notesPath = path.join(azaDir, 'tasks', taskId, 'NOTES.md');
    fs.mkdirSync(path.dirname(notesPath), { recursive: true });
    const ts = new Date().toISOString();
    const line = `\n## ${ts}\n\n${note}\n`;
    fs.appendFileSync(notesPath, line, 'utf8');
  } catch {
    // best-effort
  }
}

/**
 * Record a repair attempt to `<azaDir>/tasks/<taskId>/REPAIR.md`.
 * Best-effort: never throws.
 */
export function recordRepairAttempt(
  azaDir: string,
  taskId: string,
  attempt: number,
  result: 'success' | 'failed' | 'in_progress',
  reason?: string,
): void {
  try {
    const repairPath = path.join(azaDir, 'tasks', taskId, 'REPAIR.md');
    fs.mkdirSync(path.dirname(repairPath), { recursive: true });
    const ts = new Date().toISOString();
    const line = `\n## Attempt ${attempt} (${ts}) — ${result}\n\n${reason ?? '_no reason given_'}\n`;
    fs.appendFileSync(repairPath, line, 'utf8');
  } catch {
    // best-effort
  }
}

/**
 * Read the contents of NOTES.md for a task. Returns null if missing.
 */
export function readNotes(azaDir: string, taskId: string): string | null {
  const notesPath = path.join(azaDir, 'tasks', taskId, 'NOTES.md');
  if (!fs.existsSync(notesPath)) return null;
  return fs.readFileSync(notesPath, 'utf8');
}

/**
 * Read the contents of REPAIR.md for a task. Returns null if missing.
 */
export function readRepairLog(azaDir: string, taskId: string): string | null {
  const repairPath = path.join(azaDir, 'tasks', taskId, 'REPAIR.md');
  if (!fs.existsSync(repairPath)) return null;
  return fs.readFileSync(repairPath, 'utf8');
}

// ── Internal builders ──────────────────────────────────────

function buildContextMarkdown(input: TaskContextInput): string {
  const lines: string[] = [
    `# CONTEXT — ${input.taskId}`,
    '',
    `> **${input.title}**`,
    '',
  ];
  if (input.priority) {
    lines.push(`**Priority**: ${input.priority}`);
    lines.push('');
  }
  if (input.description) {
    lines.push('## Description', '', input.description, '');
  }
  if (input.acceptanceCriteria && input.acceptanceCriteria.length > 0) {
    lines.push('## Acceptance Criteria', '');
    for (const ac of input.acceptanceCriteria) {
      lines.push(`- [ ] ${ac}`);
    }
    lines.push('');
  }
  if (input.dependencies && input.dependencies.length > 0) {
    lines.push('## Dependencies', '');
    for (const d of input.dependencies) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildRepairHeader(taskId: string): string {
  return [
    `# REPAIR — ${taskId}`,
    '',
    '> Repair attempts are appended below in reverse chronological order.',
    '',
  ].join('\n');
}

function buildNotesHeader(taskId: string): string {
  return [
    `# NOTES — ${taskId}`,
    '',
    '> Free-form notes from the agent. Most recent entry is at the bottom.',
    '',
  ].join('\n');
}
