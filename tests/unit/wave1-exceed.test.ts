import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  archiveChange,
  mergeChangeSpecsToCanonical,
} from '../../packages/core/src/L1_spec/change-folder.ts';
import {
  recordCheckerFailure,
  recordCheckerPass,
  isStoryBlockedByReviewCap,
} from '../../packages/core/src/L7_loop/maker-checker-cap.ts';
import { writeBatchReport, planBatch } from '../../packages/core/src/L7_loop/batch-runner.ts';

describe('OpenSpec archive → specs merge', () => {
  it('merges change specs into openspec/specs on archive', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-arch-'));
    const slug = 'add-feature-x';
    const changeDir = path.join(root, 'openspec', 'changes', slug);
    const specDir = path.join(changeDir, 'specs', 'feature-x');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Why\n\nDo X\n');
    fs.writeFileSync(path.join(specDir, 'spec.md'), '# Spec feature-x\n\nMUST work.\n');

    const rel = await archiveChange(slug, root, '2026-07-16');
    expect(rel.replace(/\\/g, '/')).toContain('archive/2026-07-16-add-feature-x');
    expect(fs.existsSync(path.join(root, 'openspec', 'specs', 'feature-x', 'spec.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.aza', 'openspec-archive-index.md'))).toBe(true);
    expect(fs.existsSync(changeDir)).toBe(false);
  });

  it('synthesizes stub when no specs folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-arch2-'));
    const changeDir = path.join(root, 'openspec', 'changes', 'stub-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Why\nstub\n');
    const r = await mergeChangeSpecsToCanonical(changeDir, root, 'stub-change');
    expect(r.merged.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(root, 'openspec', 'specs', 'stub-change', 'spec.md'))).toBe(true);
  });
});

describe('Maker/Checker review cap', () => {
  it('blocks after 3 consecutive failures', () => {
    const aza = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-cap-'));
    expect(recordCheckerFailure(aza, 'STORY-1').blocked).toBe(false);
    expect(recordCheckerFailure(aza, 'STORY-1').blocked).toBe(false);
    expect(recordCheckerFailure(aza, 'STORY-1').blocked).toBe(true);
    expect(isStoryBlockedByReviewCap(aza, 'STORY-1')).toBe(true);
    recordCheckerPass(aza, 'STORY-1');
    expect(isStoryBlockedByReviewCap(aza, 'STORY-1')).toBe(false);
  });
});

describe('batch-report acceptance', () => {
  it('includes Acceptance section', () => {
    const aza = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-br-'));
    const plan = planBatch(
      {
        concurrency: 2,
        isolation: 'worktree',
        items: [
          { id: 'a', parallel_group: 1 },
          { id: 'b', parallel_group: 1 },
        ],
      },
      aza,
    );
    writeBatchReport(plan, 'extra note', [
      { id: 'a', status: 'pass', detail: 'ok' },
      { id: 'b', status: 'fail', detail: 'timeout' },
    ]);
    const body = fs.readFileSync(plan.report_path, 'utf8');
    expect(body).toContain('## Acceptance');
    expect(body).toContain('| a | pass |');
    expect(body).toContain('| b | fail |');
  });
});
