import { describe, it, expect } from 'vitest';
import { runShellwardGuard, SHELLWARD_LAYERS } from '../../packages/core/src/L6_security/shellward-guard';
import { createNSWIndex } from '../../packages/core/src/L2_memory/hnsw-index';
import {
  ensureStores,
  putStoreDoc,
  openVectorStore,
  reindexStores,
} from '../../packages/core/src/L2_memory/stores';
import { SwarmCoordinator } from '../../packages/core/src/L8_orchestrator/swarm/coordinator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('shellward 8-layer DLP', () => {
  it('runs all 8 layers', () => {
    const r = runShellwardGuard('hello world', 't', { blockOnFail: false });
    expect(r.layers_run).toEqual([...SHELLWARD_LAYERS]);
    expect(r.passed).toBe(true);
  });

  it('blocks secrets', () => {
    const r = runShellwardGuard('api_key = "sk-abcdefghijklmnopqrstuvwxyz"', 't');
    expect(r.blocked).toBe(true);
  });

  it('blocks destructive rm', () => {
    const r = runShellwardGuard('rm -rf /', 't');
    expect(r.blocked).toBe(true);
  });
});

describe('NSW index', () => {
  it('graph search returns nearest', () => {
    const idx = createNSWIndex({ dimensions: 4, M: 4, efSearch: 8, normalize: true });
    idx.insert('a', [1, 0, 0, 0]);
    idx.insert('b', [0, 1, 0, 0]);
    idx.insert('c', [0.9, 0.1, 0, 0]);
    const out = idx.search([1, 0, 0, 0], 2);
    expect(out[0].key).toBe('a');
    expect(out.map((x) => x.key)).toContain('c');
  });
});

describe('stores + vectors', () => {
  it('put/list/reindex/search', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-stores-'));
    const aza = path.join(dir, '.aza');
    ensureStores(aza);
    putStoreDoc(aza, 'specs', { id: 's1', title: 'Add numbers', body: 'implement add(a,b) utility' });
    putStoreDoc(aza, 'changes', { id: 'c1', title: 'tests', body: 'add unit tests for add' });
    const { indexed } = reindexStores(aza);
    expect(indexed).toBe(2);
    const vs = openVectorStore(aza);
    const hits = vs.search('add utility function', 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(aza, 'stores', 'vectors', 'index.json'))).toBe(true);
  });
});

describe('SwarmCoordinator', () => {
  it('respects depends_on and report unlocks', () => {
    const swarm = new SwarmCoordinator({
      enabled: true,
      max_parallel: 2,
      agents: ['a', 'b'],
    });
    const d1 = swarm.dispatch(
      { id: 't1', type: 'sequential', agent: 'a', payload: { goal: 'one' }, depends_on: [] },
      'hierarchical',
    );
    expect(d1.dispatched).toBe(true);
    expect(d1.host?.instruction).toContain('t1');

    const blocked = swarm.dispatch(
      { id: 't2', type: 'sequential', agent: 'b', payload: { goal: 'two' }, depends_on: ['t1'] },
      'hierarchical',
    );
    expect(blocked.dispatched).toBe(false);
    expect(blocked.reason).toMatch(/dependencies/);

    const unlocked = swarm.reportResult('t1', { ok: true });
    expect(unlocked.unlocked.some((u) => u.taskId === 't2' && u.dispatched)).toBe(true);
  });
});
