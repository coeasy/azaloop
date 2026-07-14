/**
 * v13 — P6.1: Subagent 2-stage review integration test
 *
 * Verifies:
 *   1) dispatchReview returns a result with the expected shape
 *   2) spec-compliance-reviewer flags missing taskId
 *   3) code-quality-reviewer flags console.log
 *   4) security-reviewer flags eval()
 *   5) runTwoStageReview fails when content has console.log (code quality)
 *   6) runTwoStageReview passes when content is clean
 *   7) recordReviewInNotes writes to <azaDir>/tasks/<taskId>/NOTES.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  dispatchReview,
  runTwoStageReview,
  recordReviewInNotes,
} from '@azaloop/core';

describe('v13 P6.1 — Subagent single-review dispatch', () => {
  it('1) spec-compliance-reviewer passes clean content', () => {
    const r = dispatchReview('spec-compliance-reviewer', {
      taskId: 'T-1',
      content: 'T-1: This is a MUST-implement task with acceptance criteria and tests.',
    });
    expect(r.role).toBe('spec-compliance-reviewer');
    expect(r.passed).toBe(true);
  });

  it('2) spec-compliance-reviewer fails when taskId not referenced', () => {
    const r = dispatchReview('spec-compliance-reviewer', {
      taskId: 'T-1',
      content: 'Some random text with no task reference.',
    });
    expect(r.passed).toBe(false);
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it('3) code-quality-reviewer flags console.log', () => {
    const r = dispatchReview('code-quality-reviewer', {
      taskId: 'T-1',
      content: 'function foo() { console.log("hi"); return 42; }',
    });
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.includes('console.log'))).toBe(true);
  });

  it('4) code-quality-reviewer flags any type', () => {
    const r = dispatchReview('code-quality-reviewer', {
      taskId: 'T-1',
      content: 'const x: any = 5;',
    });
    expect(r.findings.some((f) => f.includes('any'))).toBe(true);
  });

  it('5) security-reviewer flags eval()', () => {
    const r = dispatchReview('security-reviewer', {
      taskId: 'T-1',
      content: 'const x = eval("1+1");',
    });
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.includes('eval'))).toBe(true);
  });

  it('6) security-reviewer flags hardcoded password', () => {
    const r = dispatchReview('security-reviewer', {
      taskId: 'T-1',
      content: 'const password = "secret123";',
    });
    expect(r.passed).toBe(false);
  });

  it('7) docs-reviewer flags missing README', () => {
    const r = dispatchReview('docs-reviewer', {
      taskId: 'T-1',
      content: 'no headers here just text',
    });
    expect(r.findings.some((f) => f.includes('README'))).toBe(true);
  });
});

describe('v13 P6.1 — 2-stage review', () => {
  it('1) clean content passes both stages', () => {
    const r = runTwoStageReview({
      taskId: 'T-1',
      content: 'T-1: This MUST be implemented. Acceptance criteria and tests are defined. ## Implementation',
    });
    expect(r.stage1.passed).toBe(true);
    expect(r.stage2.passed).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.strike).toBe(false);
  });

  it('2) code with console.log fails code-quality stage', () => {
    const r = runTwoStageReview({
      taskId: 'T-1',
      content: 'T-1: MUST be implemented. ## Section\nconsole.log("debug");',
    });
    expect(r.stage1.passed).toBe(true);
    expect(r.stage2.passed).toBe(false);
    expect(r.passed).toBe(false);
    expect(r.strike).toBe(true);
    expect(r.allFindings.length).toBeGreaterThan(0);
  });

  it('3) combined result has both stage reports', () => {
    const r = runTwoStageReview({
      taskId: 'T-1',
      content: 'T-1: MUST be implemented. ## Section',
    });
    expect(r.stage1).toBeDefined();
    expect(r.stage2).toBeDefined();
    expect(r.stage1.role).toBe('spec-compliance-reviewer');
    expect(r.stage2.role).toBe('code-quality-reviewer');
  });
});

describe('v13 P6.1 — recordReviewInNotes', () => {
  let azaDir: string;

  beforeEach(() => {
    azaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-sub-'));
  });

  afterEach(() => {
    fs.rmSync(azaDir, { recursive: true, force: true });
  });

  it('1) writes NOTES.md with review result', () => {
    const r = runTwoStageReview({
      taskId: 'T-1',
      content: 'T-1: MUST. ## Section',
    });
    recordReviewInNotes(azaDir, r);
    const notesPath = path.join(azaDir, 'tasks', 'T-1', 'NOTES.md');
    expect(fs.existsSync(notesPath)).toBe(true);
    const content = fs.readFileSync(notesPath, 'utf8');
    expect(content).toContain('2-stage review');
    expect(content).toContain('spec-compliance');
    expect(content).toContain('code-quality');
  });

  it('2) appends to existing NOTES.md', () => {
    const r1 = runTwoStageReview({
      taskId: 'T-1',
      content: 'T-1: MUST. ## Section',
    });
    recordReviewInNotes(azaDir, r1);
    const r2 = runTwoStageReview({
      taskId: 'T-1',
      content: 'T-1: MUST. ## Section',
    });
    recordReviewInNotes(azaDir, r2);
    const content = fs.readFileSync(path.join(azaDir, 'tasks', 'T-1', 'NOTES.md'), 'utf8');
    // Two review entries
    expect((content.match(/2-stage review/g) ?? []).length).toBe(2);
  });
});
