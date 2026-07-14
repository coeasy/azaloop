import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  autoAppendJournalEntry,
  WorkspaceJournal,
} from '../../packages/core/src/L2_memory/workspace-journal';

describe('v14-P9.1 Workspace journal auto-update', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-journal-'));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1) autoAppendJournalEntry writes a single record to the journal', async () => {
    const azaDir = path.join(tmpDir, '.aza');
    const record = await autoAppendJournalEntry(azaDir, {
      stage: 'design',
      summary: 'Initial design pass',
      decisions: ['Use composition over inheritance'],
      openQuestions: ['How to handle migrations?'],
      iteration: 1,
    });
    expect(record).not.toBeNull();
    expect(record!.stage).toBe('design');
    expect(record!.work_summary).toBe('Initial design pass');

    const journal = new WorkspaceJournal(azaDir);
    const all = await journal.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.work_summary).toBe('Initial design pass');
  });

  it('2) multiple stage transitions accumulate entries', async () => {
    const azaDir = path.join(tmpDir, '.aza');
    await autoAppendJournalEntry(azaDir, { stage: 'open', summary: 'started', iteration: 0 });
    await autoAppendJournalEntry(azaDir, { stage: 'design', summary: 'designed', iteration: 1 });
    await autoAppendJournalEntry(azaDir, { stage: 'build', summary: 'built', iteration: 2 });
    await autoAppendJournalEntry(azaDir, { stage: 'verify', summary: 'verified', iteration: 3 });

    const journal = new WorkspaceJournal(azaDir);
    const all = await journal.loadAll();
    expect(all).toHaveLength(4);
    expect(all.map((r) => r.stage)).toEqual(['open', 'design', 'build', 'verify']);
  });

  it('3) autoAppendJournalEntry returns null and does not throw on bad azaDir', async () => {
    // Pass a path that cannot be created: a regular file with the same name.
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, 'x');
    const badAzaDir = path.join(blocker, '.aza');
    const r = await autoAppendJournalEntry(badAzaDir, {
      stage: 'open',
      summary: 'should fail',
    });
    expect(r).toBeNull();
  });
});
