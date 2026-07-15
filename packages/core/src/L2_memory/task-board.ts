/**
 * planning-with-files style human-readable task board under `.aza/`.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface TaskBoardSnapshot {
  title?: string;
  phase?: string;
  status?: 'pending' | 'in_progress' | 'complete' | 'blocked';
  notes?: string;
}

export interface TaskBoardSummary {
  plan_excerpt: string;
  findings_excerpt: string;
  progress_excerpt: string;
  phases_complete: boolean;
  plan_sha256: string;
  paths: {
    task_plan: string;
    findings: string;
    progress: string;
  };
}

const PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;

function clip(text: string, max = 1200): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated)`;
}

function ensureFiles(azaDir: string): void {
  if (!fs.existsSync(azaDir)) fs.mkdirSync(azaDir, { recursive: true });
  const now = new Date().toISOString();
  const planPath = path.join(azaDir, 'task_plan.md');
  const findingsPath = path.join(azaDir, 'findings.md');
  const progressPath = path.join(azaDir, 'progress.md');
  if (!fs.existsSync(planPath)) {
    fs.writeFileSync(
      planPath,
      `# Task Plan\n\nUpdated: ${now}\n\n## Current\n\n- Phase: open\n- Status: pending\n- Title: (none)\n\n## Phases\n\n- [ ] open\n- [ ] design\n- [ ] build\n- [ ] verify\n- [ ] archive\n`,
      'utf8',
    );
  }
  if (!fs.existsSync(findingsPath)) {
    fs.writeFileSync(findingsPath, `# Findings\n\nUpdated: ${now}\n\n## Research\n\n## Technical Decisions\n`, 'utf8');
  }
  if (!fs.existsSync(progressPath)) {
    fs.writeFileSync(progressPath, `# Progress\n\nUpdated: ${now}\n\n## Session Log\n\n`, 'utf8');
  }
}

export function appendProgress(azaDir: string, line: string): void {
  ensureFiles(azaDir);
  const progressPath = path.join(azaDir, 'progress.md');
  const now = new Date().toISOString();
  try {
    fs.appendFileSync(progressPath, `- [${now}] ${line}\n`, 'utf8');
  } catch {
    /* best-effort */
  }
}

export function appendFinding(azaDir: string, note: string): void {
  ensureFiles(azaDir);
  const findingsPath = path.join(azaDir, 'findings.md');
  const now = new Date().toISOString();
  try {
    fs.appendFileSync(findingsPath, `\n### ${now}\n\n${note.trim()}\n`, 'utf8');
  } catch {
    /* best-effort */
  }
}

export function syncTaskBoardPhase(
  azaDir: string,
  phase: string,
  status: NonNullable<TaskBoardSnapshot['status']>,
  title?: string,
): void {
  ensureFiles(azaDir);
  const planPath = path.join(azaDir, 'task_plan.md');
  try {
    let text = fs.readFileSync(planPath, 'utf8');
    text = text.replace(/^- Phase: .*/m, `- Phase: ${phase}`);
    text = text.replace(/^- Status: .*/m, `- Status: ${status}`);
    if (title) text = text.replace(/^- Title: .*/m, `- Title: ${title}`);
    text = text.replace(/^Updated: .*/m, `Updated: ${new Date().toISOString()}`);
    const idx = PHASES.indexOf(phase as (typeof PHASES)[number]);
    for (const p of PHASES) {
      const pIdx = PHASES.indexOf(p);
      const done = pIdx < idx || (p === phase && status === 'complete');
      const mark = done ? 'x' : ' ';
      text = text.replace(new RegExp(`- \\[[ x]\\] ${p}`), `- [${mark}] ${p}`);
    }
    fs.writeFileSync(planPath, text, 'utf8');
    appendProgress(azaDir, `synced phase=${phase} status=${status}`);
  } catch {
    /* best-effort */
  }
}

export function ensureTaskBoard(azaDir: string, snapshot?: TaskBoardSnapshot): void {
  ensureFiles(azaDir);
  if (snapshot?.phase && snapshot.status) {
    syncTaskBoardPhase(azaDir, snapshot.phase, snapshot.status, snapshot.title);
  }
  if (snapshot?.notes) appendProgress(azaDir, snapshot.notes);
}

/** True when every pipeline phase checkbox is `[x]`. */
export function isTaskPlanComplete(azaDir: string): boolean {
  ensureFiles(azaDir);
  try {
    const text = fs.readFileSync(path.join(azaDir, 'task_plan.md'), 'utf8');
    return PHASES.every((p) => new RegExp(`- \\[x\\] ${p}`).test(text));
  } catch {
    return false;
  }
}

export function computePlanSha(azaDir: string): string {
  ensureFiles(azaDir);
  try {
    const raw = fs.readFileSync(path.join(azaDir, 'task_plan.md'), 'utf8');
    return crypto.createHash('sha256').update(raw).digest('hex');
  } catch {
    return '';
  }
}

/**
 * Compact planning summary for session continue / calibrate (Manus three-file pattern).
 */
export function readTaskBoardSummary(azaDir: string): TaskBoardSummary {
  ensureFiles(azaDir);
  const paths = {
    task_plan: path.join(azaDir, 'task_plan.md'),
    findings: path.join(azaDir, 'findings.md'),
    progress: path.join(azaDir, 'progress.md'),
  };
  const read = (p: string) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return '';
    }
  };
  return {
    plan_excerpt: clip(read(paths.task_plan)),
    findings_excerpt: clip(read(paths.findings), 800),
    progress_excerpt: clip(read(paths.progress), 800),
    phases_complete: isTaskPlanComplete(azaDir),
    plan_sha256: computePlanSha(azaDir),
    paths,
  };
}
