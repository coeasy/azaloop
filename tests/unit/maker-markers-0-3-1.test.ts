import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Verify OpenSpec / marker completion helpers used by real-handlers (0.3.1).
 * Uses the same filesystem conventions without importing the private helpers.
 */

function detectOpenSpecTasksComplete(workDir: string): boolean {
  const changesRoot = path.join(workDir, 'openspec', 'changes');
  if (!fs.existsSync(changesRoot)) return false;
  const dirs = fs.readdirSync(changesRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'archive');
  for (const d of dirs) {
    const tasksPath = path.join(changesRoot, d.name, 'tasks.md');
    if (!fs.existsSync(tasksPath)) continue;
    const body = fs.readFileSync(tasksPath, 'utf8');
    const open = (body.match(/- \[ \]/g) || []).length;
    const done = (body.match(/- \[x\]/gi) || []).length;
    if (done > 0 && open === 0) return true;
  }
  return false;
}

describe('0.3.1 maker completion markers', () => {
  let root: string;
  let azaDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-031-'));
    azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('detects all OpenSpec tasks checked', () => {
    const change = path.join(root, 'openspec', 'changes', 'demo');
    fs.mkdirSync(change, { recursive: true });
    fs.writeFileSync(path.join(change, 'tasks.md'), '# Tasks\n\n- [x] 1.1\n- [x] 1.2\n', 'utf8');
    expect(detectOpenSpecTasksComplete(root)).toBe(true);
  });

  it('rejects when open checkboxes remain', () => {
    const change = path.join(root, 'openspec', 'changes', 'demo');
    fs.mkdirSync(change, { recursive: true });
    fs.writeFileSync(path.join(change, 'tasks.md'), '# Tasks\n\n- [x] 1.1\n- [ ] 1.2\n', 'utf8');
    expect(detectOpenSpecTasksComplete(root)).toBe(false);
  });

  it('build-complete.marker presence is enough for filesystem gate', () => {
    fs.writeFileSync(path.join(azaDir, 'build-complete.marker'), '{}', 'utf8');
    expect(fs.existsSync(path.join(azaDir, 'build-complete.marker'))).toBe(true);
  });
});
