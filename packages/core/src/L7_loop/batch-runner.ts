/**
 * BatchRunner — multi-PRD / multi-story parallel execution with parallel_group.
 * Inspired by ralphy `--parallel` + agency-orchestrator concurrency.
 *
 * Does not expand MCP tool count: exposed as `aza_loop action=batch`.
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { WorktreeManager } from '../L8_orchestrator/worktree/manager';

export interface BatchItem {
  id: string;
  prd?: string;
  title?: string;
  parallel_group: number;
  isolation?: 'worktree' | 'sandbox' | 'none';
}

export interface BatchConfig {
  concurrency: number;
  isolation: 'worktree' | 'sandbox' | 'none';
  base_branch?: string;
  items: BatchItem[];
}

export interface BatchGroupResult {
  group: number;
  item_ids: string[];
  status: 'planned' | 'running' | 'done' | 'failed';
  error?: string;
}

export interface BatchPlan {
  concurrency: number;
  isolation: BatchConfig['isolation'];
  groups: BatchGroupResult[];
  report_path: string;
}

export interface BatchItemResult {
  id: string;
  group?: number;
  status: 'pass' | 'fail' | 'pending';
  detail?: string;
  duration_ms?: number;
  isolation?: string;
  worktree_path?: string;
  runs_path?: string;
}

export interface BatchReportSummary {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  duration_ms?: number;
}

export function loadBatchConfig(filePath: string): BatchConfig {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(raw) as BatchConfig;
  if (!parsed?.items?.length) {
    throw new Error(`Batch config ${filePath} has no items`);
  }
  return {
    concurrency: Math.max(1, Number(parsed.concurrency ?? 3)),
    isolation: parsed.isolation ?? 'worktree',
    base_branch: parsed.base_branch,
    items: parsed.items.map((it, i) => ({
      id: String(it.id || `item-${i + 1}`),
      prd: it.prd,
      title: it.title,
      parallel_group: Number(it.parallel_group ?? 1),
      isolation: it.isolation,
    })),
  };
}

/** Order items into serial groups; within a group, up to concurrency run in parallel. */
export function planBatch(config: BatchConfig, azaDir: string): BatchPlan {
  const byGroup = new Map<number, BatchItem[]>();
  for (const item of config.items) {
    const g = item.parallel_group || 1;
    const list = byGroup.get(g) ?? [];
    list.push(item);
    byGroup.set(g, list);
  }
  const groupNums = [...byGroup.keys()].sort((a, b) => a - b);
  const groups: BatchGroupResult[] = groupNums.map((g) => ({
    group: g,
    item_ids: (byGroup.get(g) ?? []).map((i) => i.id),
    status: 'planned' as const,
  }));

  const report_path = path.join(azaDir, 'batch-report.md');
  return {
    concurrency: config.concurrency,
    isolation: config.isolation,
    groups,
    report_path,
  };
}

export function writeBatchReport(
  plan: BatchPlan,
  extra?: string,
  acceptance?: BatchItemResult[],
  summary?: BatchReportSummary,
): void {
  const derived: BatchReportSummary = summary ?? {
    total: acceptance?.length ?? plan.groups.reduce((n, g) => n + g.item_ids.length, 0),
    succeeded: acceptance?.filter((a) => a.status === 'pass').length ?? 0,
    failed: acceptance?.filter((a) => a.status === 'fail').length ?? 0,
    pending: acceptance?.filter((a) => a.status === 'pending').length ?? 0,
  };
  const lines = [
    '# AzaLoop Batch Report',
    '',
    `> concurrency=${plan.concurrency} isolation=${plan.isolation}`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| total | ${derived.total} |`,
    `| succeeded | ${derived.succeeded} |`,
    `| failed | ${derived.failed} |`,
    `| pending | ${derived.pending} |`,
    ...(derived.duration_ms != null ? [`| duration_ms | ${derived.duration_ms} |`] : []),
    '',
    '| Group | Items | Status |',
    '|-------|-------|--------|',
    ...plan.groups.map(
      (g) => `| ${g.group} | ${g.item_ids.join(', ')} | ${g.status}${g.error ? ` (${g.error})` : ''} |`,
    ),
    '',
  ];
  if (acceptance && acceptance.length > 0) {
    lines.push('## Results', '');
    lines.push(
      '| ID | Group | Status | ms | Isolation | Worktree / Runs | Detail |',
      '|----|-------|--------|----|-----------|-----------------|--------|',
    );
    for (const a of acceptance) {
      const loc = a.worktree_path || a.runs_path || '';
      lines.push(
        `| ${a.id} | ${a.group ?? ''} | ${a.status} | ${a.duration_ms ?? ''} | ${a.isolation || ''} | ${loc} | ${a.detail || ''} |`,
      );
    }
    lines.push('');
    lines.push('## Acceptance', '');
    lines.push('| ID | Status | Detail |', '|----|--------|--------|');
    for (const a of acceptance) {
      lines.push(`| ${a.id} | ${a.status} | ${a.detail || ''} |`);
    }
    lines.push('');
  }
  if (extra) lines.push(extra, '');
  fs.mkdirSync(path.dirname(plan.report_path), { recursive: true });
  fs.writeFileSync(plan.report_path, lines.join('\n'), 'utf8');
}

/**
 * Group items by parallel_group ascending; callers run groups serially,
 * and within each group up to `concurrency` in parallel.
 */
export function groupBatchItems<T extends { parallel_group?: number }>(
  items: T[],
): Array<{ group: number; items: T[] }> {
  const byGroup = new Map<number, T[]>();
  for (const item of items) {
    const g = Number(item.parallel_group ?? 1);
    const list = byGroup.get(g) ?? [];
    list.push(item);
    byGroup.set(g, list);
  }
  return [...byGroup.keys()]
    .sort((a, b) => a - b)
    .map((group) => ({ group, items: byGroup.get(group)! }));
}

/**
 * Dry-run / plan-only execution: materializes group order and report.
 * Full worktree spawn is left to the host loop (aza_loop full per item).
 */
export function runBatchPlanOnly(configPath: string, azaDir: string): BatchPlan {
  const config = loadBatchConfig(configPath);
  const plan = planBatch(config, azaDir);
  writeBatchReport(plan, '_Plan only — host should run each item via aza_loop(full) per worktree._');
  return plan;
}

/**
 * P0 竞品超越 (ralphy / agency-orchestrator 对齐)：
 * 真 worktree 模式下的 batch item 创建。
 *
 * 借鉴 ralphy `--parallel` + ralphy-openspec：每个 batch item 创建独立
 * git worktree，路径写入 batch-item result 的 worktree_path 字段，
 * 后续 host 在各自 worktree 内执行 aza_loop(full) 时无写集冲突。
 *
 * 设计原则：
 * - worktree 创建失败不阻塞 batch 报告；error 写入 detail
 * - 非 worktree 模式（sandbox/none）走 best-effort，回退到 azaDir/.aza/runs/<id>
 * - 借鉴 ralphy-openspec：每个 task 独立 artifact namespace (runs/<id>)
 */

export interface BatchWorktreeSpawnOptions {
  /** 是否启用 worktree（默认按 BatchConfig.isolation 决定） */
  enabled?: boolean;
  /** git 仓库根目录（WorktreeManager 必需） */
  repoRoot: string;
  /** worktree 分支前缀，默认 'aza/batch/' */
  branchPrefix?: string;
  /** worktree 基分支，默认 'main' */
  baseBranch?: string;
}

/**
 * 真 worktree spawn — 为每个 batch item 创建独立 worktree。
 *
 * @param config  解析后的 batch 配置
 * @param azaDir  .aza 目录（用于写 runs/<id> 兜底路径）
 * @param opts    spawn 选项
 * @returns 每个 item 的 spawn 结果（含 worktree_path 或回退路径）
 */
export function spawnBatchWorktrees(
  config: BatchConfig,
  azaDir: string,
  opts: BatchWorktreeSpawnOptions,
): BatchItemResult[] {
  const isolation = opts.enabled === true || config.isolation === 'worktree' ? 'worktree' : config.isolation;
  const useWorktree = isolation === 'worktree';

  // 仅在真 worktree 模式下初始化 WorktreeManager
  const wm = useWorktree
    ? new WorktreeManager({
        enabled: true,
        base_branch: opts.baseBranch ?? config.base_branch ?? 'main',
        worktree_prefix: opts.branchPrefix ?? 'aza/batch/',
        repo_root: opts.repoRoot,
      })
    : null;

  return config.items.map((item): BatchItemResult => {
    const start = Date.now();
    if (useWorktree && wm) {
      const r = wm.create(item.id, { branch: `${opts.branchPrefix ?? 'aza/batch/'}${item.id}` });
      if (r.ok && r.path) {
        return {
          id: item.id,
          group: item.parallel_group,
          status: 'pass',
          detail: 'worktree created',
          duration_ms: Date.now() - start,
          isolation: 'worktree',
          worktree_path: r.path,
        };
      }
      return {
        id: item.id,
        group: item.parallel_group,
        status: 'fail',
        detail: `worktree create failed: ${r.error ?? 'unknown'}`,
        duration_ms: Date.now() - start,
        isolation: 'worktree',
      };
    }

    // sandbox / none 模式：回退到 azaDir/.aza/runs/<id>
    const runsPath = path.join(azaDir, 'runs', item.id);
    try {
      fs.mkdirSync(runsPath, { recursive: true });
      return {
        id: item.id,
        group: item.parallel_group,
        status: 'pass',
        detail: `${isolation} namespace created`,
        duration_ms: Date.now() - start,
        isolation,
        runs_path: runsPath,
      };
    } catch (err) {
      return {
        id: item.id,
        group: item.parallel_group,
        status: 'fail',
        detail: `${isolation} namespace failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - start,
        isolation,
      };
    }
  });
}
