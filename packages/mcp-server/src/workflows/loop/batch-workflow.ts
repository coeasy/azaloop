/**
 * R12 P6 (P1 主编排解耦) — Batch Workflow 子模块。
 *
 * 借鉴 ralphy「--parallel 多任务」+ agency-orchestrator「max_iterations+concurrency」：
 *
 * 痛点：handleAzaBatch 220 行；多 task 隔离、worktree 创建、并发执行、报告生成混在一起。
 * 解法：抽到独立文件；handleAzaBatch 退化为 thin shell。
 */
import * as fsPromises from 'node:fs/promises';
import {
  WorktreeManager,
  groupBatchItems,
  planBatch,
  writeBatchReport,
} from '@azaloop/core';
import { buildDriver } from '../../tools/aza-loop';

interface BatchItemResult {
  task_id?: string;
  slug?: string;
  success: boolean;
  iterations: number;
  final_stage?: string;
  reason?: string;
  duration_ms: number;
  isolation?: string;
  worktree_path?: string;
  runs_path?: string;
  parallel_group?: number;
}

export async function handleAzaBatchImpl(
  items: Array<Record<string, unknown>>,
  concurrency: number,
  worktree: boolean,
  workspace: string | undefined,
): Promise<unknown> {
  if (items.length === 0) {
    return {
      success: false,
      error: 'batch: items must be a non-empty array',
      data: null,
    };
  }
  const root = workspace || process.cwd();
  const results: BatchItemResult[] = [];
  const wtMgr = worktree
    ? new WorktreeManager({
        enabled: true,
        base_branch: 'main',
        worktree_prefix: 'aza-batch/',
        repo_root: root,
      })
    : null;

  const start = Date.now();
  const groups = groupBatchItems(
    items.map((it, i) => ({
      ...it,
      parallel_group: Number(it.parallel_group ?? 1),
      _idx: i,
    })),
  );

  const runOne = async (item: Record<string, unknown>, groupNum: number): Promise<void> => {
    const itemStart = Date.now();
    const slug =
      (item.slug as string) ||
      `batch-${String(item.task_id || 'item').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)}-${Date.now().toString(36)}`;

    let isolation = 'runs-dir';
    let itemWs = `${root}/.aza/runs/${slug}`;
    let worktreePath: string | undefined;
    const runsPath = `${root}/.aza/runs/${slug}`;

    if (wtMgr) {
      const created = wtMgr.create(slug, { base: String(item.base_branch || 'main') });
      if (created.ok && created.path) {
        itemWs = created.path;
        worktreePath = created.path;
        isolation = 'git-worktree';
      } else {
        await fsPromises.mkdir(itemWs, { recursive: true });
        isolation = `fallback-runs (${created.error || 'worktree failed'})`;
      }
    } else {
      await fsPromises.mkdir(itemWs, { recursive: true });
    }

    try {
      const driver = buildDriver(itemWs);
      const maxIter = Number(item.max_iterations ?? 30);
      let iter = 0;
      let lastStage: string | undefined;
      let done = false;
      for (let i = 0; i < maxIter; i++) {
        const r = await driver.step();
        iter = r.iteration;
        lastStage = r.stage;
        if (r.done) {
          done = true;
          break;
        }
      }
      results.push({
        task_id: item.task_id as string,
        slug,
        success: done,
        iterations: iter,
        final_stage: lastStage,
        reason: done ? 'completed' : `max_iterations(${maxIter}) reached`,
        duration_ms: Date.now() - itemStart,
        isolation,
        worktree_path: worktreePath,
        runs_path: runsPath,
        parallel_group: groupNum,
      });
    } catch (e) {
      results.push({
        task_id: item.task_id as string,
        slug,
        success: false,
        iterations: 0,
        reason: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - itemStart,
        isolation,
        worktree_path: worktreePath,
        runs_path: runsPath,
        parallel_group: groupNum,
      });
    }
  };

  // Groups serial; within each group up to concurrency parallel
  for (const g of groups) {
    const queue = [...g.items];
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.max(1, concurrency); w++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;
            await runOne(item, g.group);
          }
        })(),
      );
    }
    await Promise.all(workers);
  }

  const success = results.every((r) => r.success);
  const duration_ms = Date.now() - start;
  const azaDir = `${root}/.aza`;
  const plan = planBatch(
    {
      concurrency: Math.max(1, concurrency),
      isolation: worktree ? 'worktree' : 'none',
      items: items.map((it, i) => ({
        id: String(it.task_id || it.slug || `item-${i + 1}`),
        parallel_group: Number(it.parallel_group ?? 1),
      })),
    },
    azaDir,
  );
  for (const g of plan.groups) {
    const groupResults = results.filter(
      (r) =>
        g.item_ids.includes(String(r.task_id || r.slug)) ||
        Number(r.parallel_group) === g.group,
    );
    const allOk = groupResults.length > 0 && groupResults.every((r) => r.success);
    const anyFail = groupResults.some((r) => !r.success);
    g.status = allOk ? 'done' : anyFail ? 'failed' : 'planned';
    if (anyFail) {
      g.error = groupResults
        .filter((r) => !r.success)
        .map((r) => r.reason)
        .join('; ');
    }
  }
  try {
    writeBatchReport(
      plan,
      `_Executed ${results.length} items in ${duration_ms}ms (groups serial, concurrency=${concurrency})_`,
      results.map((r) => ({
        id: String(r.task_id || r.slug || 'item'),
        group: r.parallel_group,
        status: (r.success ? 'pass' : 'fail') as 'pass' | 'fail',
        detail: `${r.isolation || ''} ${r.reason || ''}`.trim(),
        duration_ms: r.duration_ms,
        isolation: r.isolation,
        worktree_path: r.worktree_path,
        runs_path: r.runs_path,
      })),
      {
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        pending: 0,
        duration_ms,
      },
    );
  } catch { /* best-effort report */ }

  return {
    success,
    data: {
      total: items.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      duration_ms,
      groups: plan.groups.length,
      concurrency,
      worktree,
      results,
      report: `${root}/.aza/batch-report.md`,
    },
    next_action: success
      ? { tool: 'aza_finish', action: 'ship', reason: 'All batch items completed' }
      : { tool: 'aza_loop', action: 'status', reason: 'Some batch items failed — inspect results / batch-report.md' },
    metadata: { loop_level: 'outer', batch: true, count: items.length },
  };
}
