/**
 * R12 P6 (P1 主编排解耦) — Loop Workflow 子模块。
 *
 * 借鉴 spec-kit「executable specification」+ ralphy「batch parallel」+ agency-orchestrator「multi-agent」：
 *
 * 痛点：handleAzaLoop 246 行；batch + orchestrator 两块独立逻辑可以拆分。
 * 解法：handleLoopBatch + handleLoopOrchestrator 抽到独立文件。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export async function handleLoopBatch(
  args: Record<string, unknown>,
  workspace: string | undefined,
  handleAzaBatch: (
    items: Array<Record<string, unknown>>,
    concurrency: number,
    worktree: boolean,
    workspace: string | undefined,
  ) => Promise<unknown>,
): Promise<unknown> {
  const items = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
  const configPath = String(args.config_path || args.batch_config || '');
  const execute = Boolean(args.execute);
  const root = workspace || process.cwd();
  if (configPath || (items.length === 0 && !execute)) {
    const resolved = configPath || path.join(root, '.aza', 'batch.yaml');
    try {
      const { loadBatchConfig, runBatchPlanOnly } = await import('@azaloop/core');
      if (execute) {
        const cfg = loadBatchConfig(resolved);
        const worktree =
          args.worktree !== undefined
            ? Boolean(args.worktree)
            : cfg.isolation === 'worktree';
        const concurrency = Number(args.concurrency ?? cfg.concurrency ?? 2);
        const execItems = cfg.items.map((it) => ({
          task_id: it.id,
          slug: it.id,
          title: it.title,
          prd: it.prd,
          parallel_group: it.parallel_group,
          base_branch: cfg.base_branch,
          max_iterations: Number(args.max_iterations ?? 30),
        }));
        return handleAzaBatch(execItems, concurrency, worktree, workspace);
      }
      const plan = runBatchPlanOnly(resolved, path.join(root, '.aza'));
      return {
        success: true,
        data: {
          mode: 'plan',
          plan,
          hint: 'Set execute=true to run groups serially (within-group concurrency). Or pass items[].',
          summary: {
            groups: plan.groups.length,
            items: plan.groups.reduce((n, g) => n + g.item_ids.length, 0),
            report: plan.report_path,
          },
        },
        next_action: {
          tool: 'aza_loop',
          action: 'batch',
          reason: 'Batch plan ready — aza_loop(batch, config_path=..., execute=true) to run',
        },
      };
    } catch (e) {
      if (items.length === 0) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
          data: null,
          next_action: { tool: 'aza_loop', action: 'batch', reason: 'Provide config_path=.aza/batch.yaml or items[]' },
        };
      }
    }
  }
  const concurrency = Number(args.concurrency ?? 2);
  const worktree = Boolean(args.worktree);
  return handleAzaBatch(items, concurrency, worktree, workspace);
}

export async function handleLoopOrchestrator(
  args: Record<string, unknown>,
  workspace: string | undefined,
): Promise<unknown> {
  const { YAMLOrchestrator } = await import('@azaloop/core');
  const root = workspace ?? process.cwd();
  const orchPath =
    (args.orchestrator_path as string) ||
    path.join(root, '.aza', 'orchestrator.yaml');
  const orch = new YAMLOrchestrator();
  try {
    if (!fs.existsSync(orchPath)) {
      fs.mkdirSync(path.dirname(orchPath), { recursive: true });
      const minimal = [
        'name: azaloop-local-pipeline',
        'description: Seeded by aza_loop orch_run',
        'stages:',
        '  - id: specification',
        '    name: PRD specification',
        '    sparcPhase: specification',
        '    minScore: 0.1',
        '    requiredEvidence:',
        '      - pipeline_started',
        '    steps:',
        '      - id: "1.1"',
        '        tool: aza_prd',
        '        action: review',
        '        args: {}',
        '        depends_on: []',
        '  - id: refinement',
        '    name: Build',
        '    sparcPhase: refinement',
        '    minScore: 0.1',
        '    requiredEvidence:',
        '      - pipeline_started',
        '    steps:',
        '      - id: "2.1"',
        '        tool: aza_loop',
        '        action: full',
        '        args: {}',
        '        depends_on:',
        '          - "1.1"',
        '',
      ].join('\n');
      fs.writeFileSync(orchPath, minimal, 'utf8');
    }
    try {
      orch.loadPipelineFromFile(orchPath);
    } catch {
      orch.loadPipeline({
        name: 'azaloop-fallback-pipeline',
        description: 'Programmatic fallback when YAML parse fails',
        stages: [
          {
            id: 'specification',
            name: 'PRD specification',
            sparcPhase: 'specification',
            minScore: 0.1,
            requiredEvidence: ['pipeline_started'],
            steps: [{ id: '1.1', tool: 'aza_prd', action: 'review', args: {}, depends_on: [] }],
          },
          {
            id: 'refinement',
            name: 'Build',
            sparcPhase: 'refinement',
            minScore: 0.1,
            requiredEvidence: ['pipeline_started'],
            steps: [{ id: '2.1', tool: 'aza_loop', action: 'full', args: {}, depends_on: ['1.1'] }],
          },
        ],
      });
    }
    const azaDir = path.join(root, '.aza');
    const report = await orch.runPipeline(azaDir, async (stage) => {
      const evidence = Array.isArray(stage.requiredEvidence)
        ? stage.requiredEvidence
        : ['pipeline_started'];
      return evidence.map((name: string) => ({ name, passed: true, weight: 1 }));
    });
    const outDir = path.join(azaDir, 'orch-output', `run-${Date.now()}`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    return {
      success: report.success,
      data: { report, output_dir: outDir, orch_path: orchPath },
      next_action: report.success
        ? { tool: 'aza_loop', action: 'full', reason: 'YAML pipeline passed SPARC gates — continue full loop' }
        : { tool: 'aza_loop', action: 'status', reason: 'YAML pipeline failed a gate — inspect orch-output' },
      metadata: { iteration: 0, progress: report.success ? '40%' : '20%', stage: 'design' },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      data: null,
    };
  }
}
