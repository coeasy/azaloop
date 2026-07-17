import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkProcessSkillsGate } from '../../packages/core/src/L5_skill/process-skills-gate.ts';
import { checkAutonomyGate } from '../../packages/core/src/L7_loop/autonomy.ts';

describe('process-skills-gate', () => {
  it('blocks implement without design', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-skill-'));
    fs.mkdirSync(path.join(dir, '.aza'));
    const r = checkProcessSkillsGate(dir, 'aza_spec', 'implement');
    expect(r.allowed).toBe(false);
    expect(r.skill).toBe('brainstorming');
  });

  it('allows implement with lean design.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-skill-'));
    const aza = path.join(dir, '.aza');
    fs.mkdirSync(aza);
    fs.writeFileSync(
      path.join(aza, 'design.md'),
      '# Design\n\n## Intent\nX\n\n## Technical Approach\n1. Do thing\n\n## Acceptance\n- ok\n',
    );
    fs.writeFileSync(
      path.join(aza, 'task_plan.md'),
      '# Plan\n\n- [ ] implement the change\n',
    );
    const r = checkProcessSkillsGate(dir, 'aza_spec', 'implement');
    expect(r.allowed).toBe(true);
  });

  it('blocks ship without quality-passed.marker', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-skill-'));
    fs.mkdirSync(path.join(dir, '.aza'));
    const r = checkProcessSkillsGate(dir, 'aza_finish', 'ship');
    expect(r.allowed).toBe(false);
    expect(r.skill).toBe('verification-before-completion');
  });
});

describe('autonomy gate', () => {
  it('L1 blocks implement', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-'));
    fs.writeFileSync(
      path.join(dir, 'azaloop.yaml'),
      ['version: "0.1.0"', 'project:', '  name: t', '  root: .', 'autonomy:', '  level: L1'].join('\n'),
    );
    const r = checkAutonomyGate(dir, 'aza_spec', 'implement');
    expect(r.allowed).toBe(false);
    expect(r.level).toBe('L1');
  });

  it('L3 allows implement', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-'));
    fs.writeFileSync(
      path.join(dir, 'azaloop.yaml'),
      [
        'version: "0.1.0"',
        'project:',
        '  name: t',
        '  root: .',
        'autonomy:',
        '  level: L3',
        '  auto_approve_prd: true',
      ].join('\n'),
    );
    const r = checkAutonomyGate(dir, 'aza_spec', 'implement');
    expect(r.allowed).toBe(true);
    expect(r.level).toBe('L3');
  });
});
