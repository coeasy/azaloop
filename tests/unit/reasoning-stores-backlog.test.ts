import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ReasoningBank,
  episodeToReasoningInput,
} from '../../packages/core/src/L2_memory/reasoning-bank.ts';
import {
  distillChangeToStore,
  distillConventionsToStore,
} from '../../packages/core/src/L9_knowledge/spec-distill.ts';
import { openVectorStore, ensureStores } from '../../packages/core/src/L2_memory/stores.ts';
import { writeChangeFolder, archiveChange } from '../../packages/core/src/L1_spec/change-folder.ts';

describe('ReasoningBank', () => {
  it('persists and recalls traces across loadAll', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-rb-'));
    const aza = path.join(dir, '.aza');
    fs.mkdirSync(aza, { recursive: true });
    const bank = new ReasoningBank(aza);
    await bank.init();
    await bank.upsert(
      episodeToReasoningInput(
        'fix flaky quality gate',
        '- add marker\n- re-run gates\n- ship',
        ['reasoning', 'success'],
        'success',
      ),
    );
    const bank2 = new ReasoningBank(aza);
    await bank2.init();
    const hits = await bank2.search('quality gate');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.problem).toContain('quality');
    expect(fs.existsSync(path.join(aza, 'memory', 'reasoning'))).toBe(true);
  });
});

describe('Stores distill', () => {
  it('archive distills into stores and search hits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-distill-'));
    await writeChangeFolder(
      {
        intent: 'Add distill pipeline',
        capability: 'knowledge',
        slug: 'add-distill',
        whatChanges: ['wire archive to stores'],
      },
      dir,
    );
    const stamp = new Date().toISOString().slice(0, 10);
    await archiveChange('add-distill', dir, stamp);
    const aza = path.join(dir, '.aza');
    ensureStores(aza);
    const listed = fs.readdirSync(path.join(aza, 'stores', 'changes'));
    expect(listed.some((f) => f.includes('add-distill'))).toBe(true);
    const vs = openVectorStore(aza);
    const hits = vs.search('distill pipeline', 3);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('distillConventionsToStore indexes jsonl', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-conv-'));
    const aza = path.join(dir, '.aza');
    fs.mkdirSync(path.join(aza, 'spec-conventions'), { recursive: true });
    fs.writeFileSync(
      path.join(aza, 'spec-conventions', 'conventions.jsonl'),
      JSON.stringify({ id: 'c1', title: 'prefer kebab', rule: 'use kebab-case for slugs' }) + '\n',
    );
    const r = distillConventionsToStore(aza);
    expect(r.docs.length).toBe(1);
    expect(r.indexed).toBeGreaterThan(0);
  });

  it('distillChangeToStore writes change doc', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-dc-'));
    const aza = path.join(dir, '.aza');
    const change = path.join(dir, 'openspec', 'changes', 'foo');
    fs.mkdirSync(change, { recursive: true });
    fs.writeFileSync(path.join(change, 'proposal.md'), '# Foo\n\nBar distill me');
    const r = distillChangeToStore(aza, change, 'foo');
    expect(r.docs.some((d) => d.id === 'change:foo')).toBe(true);
  });
});
