/**
 * T27 — Completion Sentinel + Task Source Adapter tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_SENTINELS,
  detectSentinel,
  detectAllSentinels,
  isTaskComplete,
  TaskSourceAdapter,
  parseMdTasks,
  parseYamlTasks,
  parseJsonTasks,
  parseFolderTasks,
  parseGitHubTasks,
  parseOpenSpecChangeTasks,
} from '@azaloop/core';

describe('Completion Sentinel (T27)', () => {
  describe('detectSentinel', () => {
    it('detects TASK_COMPLETE in the tail', () => {
      const text = `Working on the feature.\nDone. <promise>TASK_COMPLETE</promise>`;
      const m = detectSentinel(text);
      expect(m.matched).toBe('taskComplete');
      expect(m.inTail).toBe(true);
      expect(m.offset).toBeGreaterThan(0);
    });

    it('detects TASK_FAILED', () => {
      const m = detectSentinel('error happened <promise>TASK_FAILED</promise>');
      expect(m.matched).toBe('taskFailed');
    });

    it('detects TASK_BLOCKED', () => {
      const m = detectSentinel('need user input <promise>TASK_BLOCKED</promise>');
      expect(m.matched).toBe('taskBlocked');
    });

    it('returns null for empty / non-string input', () => {
      expect(detectSentinel('').matched).toBeNull();
      // @ts-expect-error testing bad input
      expect(detectSentinel(null).matched).toBeNull();
    });

    it('returns null when no sentinel is present', () => {
      expect(detectSentinel('hello world').matched).toBeNull();
    });

    it('does not match a sentinel mentioned earlier in prose (tailWindow=200)', () => {
      // Place the sentinel far enough from the end that it falls outside the
      // 200-char tail window, then have no sentinel in the tail at all.
      const longPrefix = 'x'.repeat(500);
      const longSuffix = 'y'.repeat(1000);
      const text = `${longPrefix}\nDiscussion of <promise>TASK_COMPLETE</promise>\n${longSuffix}`;
      const m = detectSentinel(text);
      // The sentinel is well before the tail window AND not in the tail —
      // with our strict policy, we should NOT match it (return null).
      expect(m.matched).toBeNull();
    });

    it('prefers the tail sentinel over an earlier one', () => {
      const longPrefix = 'x'.repeat(500);
      const text = `${longPrefix}<promise>TASK_FAILED</promise>\n... actually <promise>TASK_COMPLETE</promise>`;
      const m = detectSentinel(text);
      expect(m.matched).toBe('taskComplete');
      expect(m.inTail).toBe(true);
    });
  });

  describe('detectAllSentinels', () => {
    it('returns all matches in document order', () => {
      const text = `a <promise>TASK_FAILED</promise> b <promise>TASK_COMPLETE</promise> c <promise>TASK_BLOCKED</promise>`;
      const all = detectAllSentinels(text);
      expect(all.map((m) => m.key)).toEqual(['taskFailed', 'taskComplete', 'taskBlocked']);
    });
  });

  describe('isTaskComplete convenience', () => {
    it('returns true when the tail contains TASK_COMPLETE', () => {
      expect(isTaskComplete('done <promise>TASK_COMPLETE</promise>')).toBe(true);
    });
    it('returns false otherwise', () => {
      expect(isTaskComplete('still working')).toBe(false);
    });
  });
});

describe('Task Source Adapters (T27)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azaloop-tasksrc-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseMdTasks', () => {
    it('parses checked / unchecked lines with line numbers and parallel_group', async () => {
      const md = `# Plan
- [ ] **1.1** First task
- [x] **1.2** Done task _(verification: ok)_
- [ ] **2.1** Second group
`;
      const file = path.join(tmpDir, 'tasks.md');
      await fs.promises.writeFile(file, md);
      const items = await parseMdTasks(file);
      expect(items).toHaveLength(3);
      expect(items[0]).toMatchObject({ title: 'First task', completed: false, line: 2, parallel_group: 1 });
      expect(items[1]).toMatchObject({ title: 'Done task', completed: true, line: 3 });
      expect(items[2]).toMatchObject({ title: 'Second group', completed: false, parallel_group: 2 });
    });

    it('returns [] for missing file', async () => {
      const items = await parseMdTasks(path.join(tmpDir, 'ghost.md'));
      expect(items).toEqual([]);
    });
  });

  describe('parseYamlTasks', () => {
    it('parses a top-level list of - title: ... entries', async () => {
      const yaml = `- title: First
  completed: false
  parallel_group: 1
- title: Second
  completed: true
`;
      const file = path.join(tmpDir, 'tasks.yaml');
      await fs.promises.writeFile(file, yaml);
      const items = await parseYamlTasks(file);
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ title: 'First', completed: false, parallel_group: 1 });
      expect(items[1]).toMatchObject({ title: 'Second', completed: true });
    });
  });

  describe('parseJsonTasks', () => {
    it('parses a JSON array of task objects', async () => {
      const json = `[
        {"title": "T1", "completed": false, "parallel_group": 1},
        {"title": "T2", "completed": true}
      ]`;
      const file = path.join(tmpDir, 'tasks.json');
      await fs.promises.writeFile(file, json);
      const items = await parseJsonTasks(file);
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ title: 'T1', completed: false, parallel_group: 1 });
    });

    it('throws on invalid JSON', async () => {
      const file = path.join(tmpDir, 'bad.json');
      await fs.promises.writeFile(file, 'not json');
      await expect(parseJsonTasks(file)).rejects.toThrow(/invalid JSON/);
    });
  });

  describe('parseFolderTasks', () => {
    it('aggregates *.md files in a directory, keyed by path', async () => {
      await fs.promises.writeFile(path.join(tmpDir, 'a.md'), '- [ ] task A\n');
      await fs.promises.writeFile(path.join(tmpDir, 'b.md'), '- [x] task B\n');
      await fs.promises.writeFile(path.join(tmpDir, 'c.txt'), 'ignored');
      const map = await parseFolderTasks(tmpDir);
      expect(map.size).toBe(2);
      const all = Array.from(map.values()).flat();
      expect(all.map((t) => t.title).sort()).toEqual(['task A', 'task B']);
    });
  });

  describe('parseGitHubTasks (mock)', () => {
    it('filters by label and maps state to completed', async () => {
      const items = await parseGitHubTasks('foo', 'bar', 'bug', {
        mockIssues: [
          { number: 1, title: 'bug 1', state: 'open', labels: [{ name: 'bug' }] },
          { number: 2, title: 'bug 2', state: 'closed', labels: [{ name: 'bug' }] },
          { number: 3, title: 'feature 1', state: 'open', labels: [{ name: 'enhancement' }] },
        ],
      });
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ title: 'bug 1', completed: false });
      expect(items[1]).toMatchObject({ title: 'bug 2', completed: true });
    });

    it('returns [] when no token and no mock', async () => {
      const items = await parseGitHubTasks('foo', 'bar', 'bug');
      expect(items).toEqual([]);
    });
  });

  describe('parseOpenSpecChangeTasks', () => {
    it('delegates to md parser when given a tasks.md file', async () => {
      const folder = path.join(tmpDir, 'openspec', 'changes', 'add-foo');
      await fs.promises.mkdir(folder, { recursive: true });
      await fs.promises.writeFile(path.join(folder, 'tasks.md'), '- [ ] openspec task\n');
      const items = await parseOpenSpecChangeTasks(folder);
      expect(items).toHaveLength(1);
      expect(items[0]?.title).toBe('openspec task');
      expect(items[0]?.source).toBe('openspec-change');
    });
  });

  describe('TaskSourceAdapter facade', () => {
    it('routes to the correct parser by method name', async () => {
      const file = path.join(tmpDir, 'tasks.md');
      await fs.promises.writeFile(file, '- [ ] adapter task\n');
      const items = await TaskSourceAdapter.md(file);
      expect(items[0]?.title).toBe('adapter task');
    });
  });
});
