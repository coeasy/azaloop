/**
 * Presets / constitution / multi-role / UI QA scaffold unit tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  listPresets,
  applyPreset,
  getPreset,
  ensureConstitution,
  readConstitution,
  writePlanMd,
  readPlanMd,
  runMultiRolePrdReview,
  runUiQa,
  loadFederation,
  registerFederationPeer,
  syncFederationDigest,
} from '../src/index';
import type { PRD } from '@azaloop/shared';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aza-fix-'));
}

describe('presets (P2-6)', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists 3 builtin presets', () => {
    const presets = listPresets(root);
    expect(presets.map((p) => p.id)).toEqual(
      expect.arrayContaining(['full-auto', 'oneshot', 'strict-verify']),
    );
  });

  it('applyPreset writes active-preset and seeds yaml', () => {
    const p = applyPreset(root, 'oneshot');
    expect(p.mode).toBe('oneshot');
    expect(fs.existsSync(path.join(root, '.aza', 'active-preset.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.aza', 'presets', 'oneshot.yaml'))).toBe(true);
    expect(process.env.PLANNING_DISABLED).toBe('true');
    delete process.env.PLANNING_DISABLED;
    delete process.env.AZALOOP_MODE;
  });

  it('getPreset returns null for unknown', () => {
    expect(getPreset(root, 'nope')).toBeNull();
  });
});

describe('constitution + plan.md', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('ensureConstitution creates default file', () => {
    ensureConstitution(root);
    expect(readConstitution(root)).toMatch(/CONST-001/);
  });

  it('writePlanMd persists and reads back', () => {
    writePlanMd(root, { title: 'T', stage: 'open', next: 'aza_loop(full)', bullets: ['a'] });
    expect(readPlanMd(root)).toMatch(/Plan: T/);
  });
});

describe('multi-role PRD review (P3-2)', () => {
  it('fails hollow ACs as P0', () => {
    const prd = {
      id: 'p1',
      title: 'X',
      overview: 'Pain peers OpenSpec MCP Host-LLM',
      goals: ['G1 competitive', 'G2'],
      stories: [
        {
          id: 's1',
          title: 'S',
          description: 'd',
          priority: 'P0',
          acceptance_criteria: [{ id: 'ac1', description: 'works as expected', testable: true }],
        },
      ],
      architecture: [{ name: 'a', mermaid: 'graph TD\n  A-->B' }],
      functional_requirements: [{ id: 'fr1', description: 'must do x' }],
      risks: [{ description: 'r', mitigation: 'm' }],
    } as unknown as PRD;
    const r = runMultiRolePrdReview(prd);
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.role === 'qa' && !f.passed)).toBe(true);
  });

  it('passes well-formed PRD', () => {
    const prd = {
      id: 'p1',
      title: 'X',
      overview: 'Pain: stall. Peers: OpenSpec. Differentiator: Host-LLM MCP.',
      goals: ['competitive differentiation via MCP', 'ship MVP'],
      stories: [
        {
          id: 's1',
          title: 'S',
          description: 'd',
          priority: 'P0',
          acceptance_criteria: [
            { id: 'ac1', description: 'CLI exits 0 and prints status within 2s', testable: true },
          ],
        },
      ],
      architecture: [{ name: 'a', mermaid: 'graph TD\n  A-->B-->C' }],
      functional_requirements: [{ id: 'fr1', description: 'must expose aza_session' }],
      risks: [{ description: 'token blowup', mitigation: 'slim context' }],
    } as unknown as PRD;
    const r = runMultiRolePrdReview(prd);
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThan(70);
  });
});

describe('UI QA scaffold (P3-1)', () => {
  it('skips when not enabled', async () => {
    const root = tmpRoot();
    delete process.env.AZA_UI_QA;
    delete process.env.AZA_UI_QA_URL;
    const r = await runUiQa({ projectRoot: root });
    expect(r.skipped).toBe(true);
    expect(r.passed).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('federation stub', () => {
  it('register + sync digest', () => {
    const root = tmpRoot();
    const shared = path.join(root, 'shared');
    registerFederationPeer(root, { id: 'peer1', label: 'p1', shared_aza: shared });
    const m = loadFederation(root);
    expect(m.peers).toHaveLength(1);
    writePlanMd(root, { title: 'F', stage: 'open', next: 'x' });
    const dig = syncFederationDigest(root, 'peer1');
    expect(dig.ok).toBe(true);
    expect(fs.existsSync(path.join(shared, 'plan.md'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
