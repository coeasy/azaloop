import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseAdrRules,
  scanAdrCompliance,
  scanFile,
} from '../../packages/core/src/L6_security/scanners/adr-compliance';
import {
  adrComplianceGate,
  GATE7_NAME,
} from '../../packages/core/src/quality/gates/gate7-adr-compliance';
import { createAdr, type Adr } from '../../packages/core/src/L1_spec/adr';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ADR Compliance Scanner (v14-P7.2)', () => {
  it('1) parseAdrRules extracts forbidden_import/module/construct', () => {
    const adr: Adr = {
      id: '0001',
      path: '/tmp/0001.md',
      title: 'Test',
      status: 'accepted',
      date: '2026-07-13',
      deciders: [],
      tags: [],
      supersedes: [],
      supersededBy: [],
      body: `## Rules\n\n- forbidden_import: lodash\n- forbidden_module: moment\n- forbidden_construct: eval\n`,
    };
    const rules = parseAdrRules(adr);
    expect(rules).toHaveLength(3);
    expect(rules[0]).toEqual({ kind: 'forbidden_import', token: 'lodash' });
    expect(rules[1]).toEqual({ kind: 'forbidden_module', token: 'moment' });
    expect(rules[2]).toEqual({ kind: 'forbidden_construct', token: 'eval' });
  });

  it('2) parseAdrRules returns [] when no Rules section', () => {
    const adr: Adr = {
      id: '0001',
      path: '/tmp/0001.md',
      title: 'Test',
      status: 'accepted',
      date: '2026-07-13',
      deciders: [],
      tags: [],
      supersedes: [],
      supersededBy: [],
      body: '## Context\n\nNo rules.',
    };
    expect(parseAdrRules(adr)).toEqual([]);
  });

  it('3) scanFile detects forbidden_import', () => {
    const rules = [{ kind: 'forbidden_import' as const, token: 'lodash' }];
    const violations = scanFile(
      { path: 'a.ts', content: "import { get } from 'lodash';" },
      rules,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('forbidden_import:lodash');
  });

  it('4) scanFile detects forbidden_module via require/from', () => {
    const rules = [{ kind: 'forbidden_module' as const, token: 'moment' }];
    const v1 = scanFile({ path: 'a.ts', content: "const m = require('moment');" }, rules);
    const v2 = scanFile({ path: 'b.ts', content: "import m from 'moment';" }, rules);
    expect(v1).toHaveLength(1);
    expect(v2).toHaveLength(1);
  });

  it('5) scanFile detects forbidden_construct (eval)', () => {
    const rules = [{ kind: 'forbidden_construct' as const, token: 'eval' }];
    const v = scanFile({ path: 'a.ts', content: 'const x = eval("1+1");' }, rules);
    expect(v).toHaveLength(1);
  });

  it('6) scanAdrCompliance ignores proposed/deprecated/superseded ADRs', () => {
    createAdr(tmpDir, {
      title: 'no-lodash',
      body: '## Rules\n\n- forbidden_import: lodash\n',
      status: 'proposed',
    });
    const result = scanAdrCompliance(tmpDir, [
      { path: 'a.ts', content: "import x from 'lodash';" },
    ]);
    expect(result.scannedAdrs).toBe(0);
    expect(result.hasViolations).toBe(false);
  });

  it('7) scanAdrCompliance flags accepted ADR violations', () => {
    createAdr(tmpDir, {
      title: 'no-lodash',
      body: '## Rules\n\n- forbidden_import: lodash\n',
      status: 'accepted',
    });
    const result = scanAdrCompliance(tmpDir, [
      { path: 'a.ts', content: "import x from 'lodash';" },
    ]);
    expect(result.hasViolations).toBe(true);
    expect(result.violations[0].rule).toBe('forbidden_import:lodash');
  });

  it('8) scanAdrCompliance handles empty file list', () => {
    const result = scanAdrCompliance(tmpDir, []);
    expect(result.hasViolations).toBe(false);
    expect(result.scannedFiles).toBe(0);
  });

  it('9) adrComplianceGate returns passed=true when no ADR has rules', async () => {
    const result = await adrComplianceGate({ azaDir: tmpDir, filePaths: [] });
    expect(result.gate).toBe(GATE7_NAME);
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('10) adrComplianceGate fails on accepted ADR violation', async () => {
    createAdr(tmpDir, {
      title: 'no-eval',
      body: '## Rules\n\n- forbidden_construct: eval\n',
      status: 'accepted',
    });
    // Create a workspace file that violates the rule
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-'));
    const src = path.join(workDir, 'evil.ts');
    fs.writeFileSync(src, 'const x = eval("1");\n', 'utf8');
    const result = await adrComplianceGate({
      azaDir: tmpDir,
      filePaths: [src],
      workspaceRoot: workDir,
    });
    fs.rmSync(workDir, { recursive: true, force: true });
    expect(result.passed).toBe(false);
    expect(result.issues[0]).toMatch(/ADR 0001.*eval/);
  });
});
