import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { planBatch, writeBatchReport, loadBatchConfig, runBatchPlanOnly } from '../../packages/core/src/L7_loop/batch-runner.ts';

describe('BatchRunner parallel_group ordering', () => {
  it('orders groups ascending and lists item ids', () => {
    const plan = planBatch(
      {
        concurrency: 2,
        isolation: 'worktree',
        items: [
          { id: 'b', parallel_group: 2 },
          { id: 'a1', parallel_group: 1 },
          { id: 'a2', parallel_group: 1 },
        ],
      },
      path.join(os.tmpdir(), 'aza-batch-test'),
    );
    expect(plan.groups.map((g) => g.group)).toEqual([1, 2]);
    expect(plan.groups[0]!.item_ids).toEqual(['a1', 'a2']);
    expect(plan.groups[1]!.item_ids).toEqual(['b']);
  });

  it('loads yaml and writes report with Summary', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-batch-'));
    const cfg = path.join(dir, 'batch.yaml');
    fs.writeFileSync(
      cfg,
      ['concurrency: 3', 'isolation: worktree', 'items:', '  - id: x', '    parallel_group: 1'].join('\n'),
    );
    const aza = path.join(dir, '.aza');
    fs.mkdirSync(aza);
    const plan = runBatchPlanOnly(cfg, aza);
    expect(loadBatchConfig(cfg).items[0]!.id).toBe('x');
    expect(fs.existsSync(plan.report_path)).toBe(true);
    writeBatchReport(
      plan,
      undefined,
      [{ id: 'x', group: 1, status: 'pass', duration_ms: 12, isolation: 'worktree', worktree_path: '/tmp/wt' }],
      { total: 1, succeeded: 1, failed: 0, pending: 0, duration_ms: 12 },
    );
    const md = fs.readFileSync(plan.report_path, 'utf8');
    expect(md).toContain('Batch Report');
    expect(md).toContain('## Summary');
    expect(md).toContain('## Results');
    expect(md).toContain('/tmp/wt');
  });

  it('groupBatchItems orders groups ascending', async () => {
    const { groupBatchItems } = await import('../../packages/core/src/L7_loop/batch-runner.ts');
    const groups = groupBatchItems([
      { id: 'b', parallel_group: 2 },
      { id: 'a', parallel_group: 1 },
    ]);
    expect(groups.map((g) => g.group)).toEqual([1, 2]);
  });
});
