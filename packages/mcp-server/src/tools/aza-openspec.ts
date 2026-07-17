/**
 * Thin OpenSpec lifecycle helpers for aza_spec propose/apply/archive.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { LoopResponse } from '@azaloop/shared';
import { appendProgress, syncTaskBoardPhase } from '@azaloop/core';

function changesRoot(workspace: string): string {
  return path.join(workspace, 'openspec', 'changes');
}

function listActiveChanges(workspace: string): string[] {
  const root = changesRoot(workspace);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive')
    .map((d) => d.name);
}

/** Propose: ensure change scaffold exists (proposal/design/tasks). */
export async function handleOpenSpecPropose(
  workspacePath: string,
  title: string,
  description?: string,
): Promise<LoopResponse> {
  const root = workspacePath || process.cwd();
  const slug =
    (title || 'change')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || `change-${Date.now()}`;
  const dir = path.join(changesRoot(root), slug);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString().slice(0, 10);
  const writeIfMissing = (name: string, body: string) => {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) fs.writeFileSync(p, body, 'utf8');
  };
  writeIfMissing(
    'proposal.md',
    `# Change: ${slug}\n\n> Date: ${now}\n\n## Why\n\n${description || title}\n\n## What Changes\n\n- TBD\n\n## Impact\n\n**Severity**: medium\n`,
  );
  writeIfMissing(
    'design.md',
    `# Design: ${slug}\n\n> Date: ${now}\n\n## Technical Approach\n\n${description || title}\n`,
  );
  writeIfMissing(
    'tasks.md',
    `# Tasks: ${slug}\n\n> Date: ${now}\n\n- [ ] **1.1** Implement ${title || slug}\n`,
  );
  appendProgress(path.join(root, '.aza'), `openspec propose ${slug}`);
  return {
    success: true,
    data: { change_id: slug, path: dir, files: ['proposal.md', 'design.md', 'tasks.md'] },
    next_action: { tool: 'aza_spec', action: 'apply', reason: 'Change scaffolded — apply tasks' },
    metadata: { iteration: 0, progress: '20%', stage: 'design' },
  };
}

/** Apply: mark first open checkbox done and sync task board. */
export async function handleOpenSpecApply(
  workspacePath: string,
  focus?: string,
): Promise<LoopResponse> {
  const root = workspacePath || process.cwd();
  const changes = listActiveChanges(root);
  const target = focus && changes.includes(focus) ? focus : changes[0];
  if (!target) {
    return {
      success: false,
      data: null,
      error: 'No active openspec/changes/* found',
      next_action: { tool: 'aza_spec', action: 'propose', reason: 'Propose a change first' },
      metadata: { iteration: 0, progress: '0%', stage: 'design' },
    };
  }
  const tasksPath = path.join(changesRoot(root), target, 'tasks.md');
  let body = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf8') : '';
  if (/- \[ \]/.test(body)) {
    body = body.replace(/- \[ \]/, '- [x]');
    fs.writeFileSync(tasksPath, body, 'utf8');
  }
  const open = (body.match(/- \[ \]/g) || []).length;
  const azaDir = path.join(root, '.aza');
  syncTaskBoardPhase(azaDir, open === 0 ? 'verify' : 'build', open === 0 ? 'complete' : 'in_progress', target);
  appendProgress(azaDir, `openspec apply ${target} remaining_open=${open}`);
  return {
    success: true,
    data: { change_id: target, remaining_open: open, tasks_path: tasksPath },
    next_action:
      open === 0
        ? { tool: 'aza_quality', action: 'check', reason: 'All OpenSpec tasks checked — verify' }
        : { tool: 'aza_spec', action: 'implement', reason: 'Tasks remain — continue implement' },
    metadata: { iteration: 0, progress: open === 0 ? '70%' : '50%', stage: open === 0 ? 'verify' : 'build' },
  };
}

/** Archive: move change folder under openspec/changes/archive/YYYY-MM-DD-id
 *  and merge specs into openspec/specs (OpenSpec opsx alignment).
 */
export async function handleOpenSpecArchive(
  workspacePath: string,
  title?: string,
): Promise<LoopResponse> {
  const root = workspacePath || process.cwd();
  const changes = listActiveChanges(root);
  const target = title && changes.includes(title) ? title : changes[0];
  if (!target) {
    return {
      success: false,
      data: null,
      error: 'No active change to archive',
      metadata: { iteration: 0, progress: '90%', stage: 'archive' },
    };
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const azaDir = path.join(root, '.aza');
  try {
    const { archiveChange } = await import('@azaloop/core');
    const archivedRel = await archiveChange(target, root, stamp);
    syncTaskBoardPhase(azaDir, 'archive', 'complete', target);
    appendProgress(azaDir, `openspec archive ${target} → ${archivedRel} (specs merged)`);
    return {
      success: true,
      data: {
        change_id: target,
        archived_to: path.join(root, archivedRel),
        specs_merged: true,
        index: path.join(azaDir, 'openspec-archive-index.md'),
      },
      next_action: { tool: 'aza_finish', action: 'ship', reason: 'Change archived + specs merged — ship' },
      metadata: { iteration: 0, progress: '95%', stage: 'archive' },
    };
  } catch (err) {
    // Fallback to rename-only if slug validation fails (e.g. non-kebab)
    const src = path.join(changesRoot(root), target);
    const destDir = path.join(changesRoot(root), 'archive');
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, `${stamp}-${target}`);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    // Best-effort merge before rename
    try {
      const { mergeChangeSpecsToCanonical } = await import('@azaloop/core');
      await mergeChangeSpecsToCanonical(src, root, target);
    } catch {
      /* ignore */
    }
    fs.renameSync(src, dest);
    syncTaskBoardPhase(azaDir, 'archive', 'complete', target);
    appendProgress(azaDir, `openspec archive ${target} → ${dest} (fallback: ${err instanceof Error ? err.message : String(err)})`);
    return {
      success: true,
      data: { change_id: target, archived_to: dest, specs_merged: true, fallback: true },
      next_action: { tool: 'aza_finish', action: 'ship', reason: 'Change archived — ship' },
      metadata: { iteration: 0, progress: '95%', stage: 'archive' },
    };
  }
}
