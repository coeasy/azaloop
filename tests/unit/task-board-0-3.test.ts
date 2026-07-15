import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ensureTaskBoard,
  syncTaskBoardPhase,
  appendFinding,
  isTaskPlanComplete,
  computePlanSha,
  readTaskBoardSummary,
} from '../../packages/core/src/L2_memory/task-board';
import { evaluateStageGate } from '../../packages/core/src/L7_loop/phase-gates';

describe('task-board 0.3.x APIs', () => {
  let azaDir: string;

  beforeEach(() => {
    azaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-board-'));
  });

  afterEach(() => {
    fs.rmSync(azaDir, { recursive: true, force: true });
  });

  it('ensureTaskBoard creates three files', () => {
    ensureTaskBoard(azaDir);
    expect(fs.existsSync(path.join(azaDir, 'task_plan.md'))).toBe(true);
    expect(fs.existsSync(path.join(azaDir, 'findings.md'))).toBe(true);
    expect(fs.existsSync(path.join(azaDir, 'progress.md'))).toBe(true);
  });

  it('syncs phases and reports complete only when all checked', () => {
    ensureTaskBoard(azaDir);
    expect(isTaskPlanComplete(azaDir)).toBe(false);
    for (const p of ['open', 'design', 'build', 'verify', 'archive']) {
      syncTaskBoardPhase(azaDir, p, 'complete');
    }
    expect(isTaskPlanComplete(azaDir)).toBe(true);
    expect(computePlanSha(azaDir)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('readTaskBoardSummary includes plan sha and excerpts', () => {
    ensureTaskBoard(azaDir, { phase: 'design', status: 'in_progress', title: 'demo' });
    appendFinding(azaDir, 'OpenSpec design gate prefers fluid artifacts');
    const summary = readTaskBoardSummary(azaDir);
    expect(summary.plan_excerpt).toContain('Phase: design');
    expect(summary.findings_excerpt).toContain('OpenSpec');
    expect(summary.plan_sha256).toHaveLength(64);
  });
});

describe('design phase gate openspec path', () => {
  it('passes with openspec_design_ready without 7 diagrams', () => {
    const result = evaluateStageGate('design', {
      diagrams_complete: 0,
      openspec_design_ready: true,
      design_review_passed: true,
    });
    expect(result.passed).toBe(true);
  });

  it('fails without diagrams and without openspec', () => {
    const result = evaluateStageGate('design', {
      diagrams_complete: 2,
      openspec_design_ready: false,
      design_review_passed: true,
    });
    expect(result.passed).toBe(false);
  });
});
