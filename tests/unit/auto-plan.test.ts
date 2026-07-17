import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autoSelectBestPlan,
  loadChosenPlan,
  pickBestOption,
  type ChosenPlan,
} from '../../packages/mcp-server/src/auto-plan';
import type { ExploreResult } from '../../packages/mcp-server/src/tools/aza-explore';
import { StateManager } from '../../packages/core/src/state/state-manager';
import { ResumeGenerator } from '../../packages/core/src/continuity/resume-generator';
import { handleAzaAuto } from '../../packages/mcp-server/src/unified-handlers';
import { decideRecovery } from '../../packages/mcp-server/src/workflows/auto/recovery-policy';
import { createTaskIdentity } from '../../packages/mcp-server/src/workflows/auto/task-identity';

const tempDirs: string[] = [];

function fingerprint(input: string): string {
  return createHash('sha256')
    .update(input.normalize('NFKC').trim().replace(/\s+/g, ' '))
    .digest('hex')
    .slice(0, 32);
}

afterEach(() => {
  delete process.env.AZA_AUTO_PICK;
  delete process.env.AZA_AUTO_MAX_STEPS;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function exploreFixture(): ExploreResult {
  return {
    target: 'fixture',
    current_state: 'Node.js/TypeScript project with 500 files, tests and CI.',
    files_analyzed: ['package.json', 'README.md'],
    options: [
      {
        name: 'Incremental Improvement',
        description: 'Targeted changes.',
        pros: ['Low risk'],
        cons: ['Limited scope'],
        score: 75,
      },
      {
        name: 'Architecture Refactor',
        description: 'Cross-cutting restructuring.',
        pros: ['Maintainability'],
        cons: ['Higher risk'],
        score: 85,
      },
      {
        name: 'Greenfield Rewrite',
        description: 'Replace the project.',
        pros: ['Clean slate'],
        cons: ['Highest risk'],
        score: 80,
      },
    ],
    recommendation: 'Architecture Refactor',
    risks: ['Large codebase'],
    effort: 'high',
  };
}

describe('automatic plan selection', () => {
  it('uses a 128-bit task fingerprint', () => {
    expect(createTaskIdentity('实现账单模块').fingerprint).toMatch(/^[a-f0-9]{32}$/);
  });

  it('prefers incremental work for a localized bug fix', () => {
    const selected = pickBestOption(
      exploreFixture(),
      '修复登录按钮偶发重复提交，并补充对应回归测试',
    );

    expect(selected.name).toBe('Incremental Improvement');
  });

  it('prefers architecture refactoring for cross-cutting autonomous reliability work', () => {
    const selected = pickBestOption(
      exploreFixture(),
      '全面改进架构、可靠性、可维护性和全自动执行链路，不需要用户额外输入',
    );

    expect(selected.name).toBe('Architecture Refactor');
  });

  it('selects a rewrite only when the requirement explicitly asks to replace the project', () => {
    const explicit = pickBestOption(
      exploreFixture(),
      '废弃现有实现，从零彻底重写整个项目并迁移全部能力',
    );
    const ambiguous = pickBestOption(exploreFixture(), '全面优化项目');

    expect(explicit.name).toBe('Greenfield Rewrite');
    expect(ambiguous.name).not.toBe('Greenfield Rewrite');
  });

  it('never selects a rewrite without explicit intent even when its base score is highest', () => {
    const explore = exploreFixture();
    explore.options[0]!.score = 10;
    explore.options[1]!.score = 20;
    explore.options[2]!.score = 100;

    expect(pickBestOption(explore, '全面优化项目质量').name).not.toBe(
      'Greenfield Rewrite',
    );
  });

  it('rejects an empty requirement before persisting a plan', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-plan-empty-'));
    tempDirs.push(root);

    expect(() => autoSelectBestPlan(root, '   ')).toThrow(/requirement/i);
    expect(fs.existsSync(path.join(root, '.aza', 'chosen-plan.json'))).toBe(false);
  });

  it('rejects whitespace-only requirements at the public aza_auto boundary', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-handler-empty-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    const result = (await handleAzaAuto(
      { user_input: '   ', workspace_path: root },
      new StateManager(azaDir),
      new ResumeGenerator(azaDir),
    )) as { success?: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/user_input is required/i);
    expect(fs.existsSync(path.join(azaDir, 'chosen-plan.json'))).toBe(false);
  });

  it('does not hydrate a chosen plan before resume identity is accepted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-plan-isolation-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    const first = '重构认证模块';
    const second = '实现全新的账单模块';
    autoSelectBestPlan(root, first);

    const resume = new ResumeGenerator(azaDir);
    resume.read = async () => ({
      current_stage: 'build',
      iteration: 3,
      progress: '60%',
      client: 'test',
      model: 'test',
      next_action: 'implement',
      next_tool: 'aza_spec',
      errors_to_avoid: [],
      last_milestone: new Date().toISOString(),
      task_id: `aza-${fingerprint(first)}`,
      user_input_hash: fingerprint(first),
    });
    process.env.AZA_AUTO_PICK = '0';
    process.env.AZA_AUTO_MAX_STEPS = '0';

    const result = (await handleAzaAuto(
      { user_input: second, workspace_path: root },
      new StateManager(azaDir),
      resume,
    )) as {
      data?: {
        task_fingerprint?: string;
        auto_plan_selected?: boolean;
        auto_plan_path?: string;
      };
    };

    expect(result.data?.task_fingerprint).toBe(fingerprint(second));
    expect(result.data?.auto_plan_selected).toBe(false);
    expect(result.data?.auto_plan_path).toBeUndefined();
  });

  it('round-trips task identity through RESUME before accepting recovery and its plan', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-resume-roundtrip-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    const input = '重构真实恢复链路';
    const identity = createTaskIdentity(input);
    const state = new StateManager(azaDir);
    const current = state.getState();
    await state.update({
      pipeline: {
        ...current.pipeline,
        current_stage: 'build',
        stages: {
          ...current.pipeline.stages,
          build: { status: 'in_progress' },
        },
      },
    });
    autoSelectBestPlan(root, input);

    await new ResumeGenerator(azaDir).generate(state, {
      task_id: identity.task_id,
      user_input_hash: identity.fingerprint,
    });
    const recovered = await new ResumeGenerator(azaDir).read();
    const decision = decideRecovery(identity, recovered);

    expect(recovered?.task_id).toBe(identity.task_id);
    expect(recovered?.user_input_hash).toBe(identity.fingerprint);
    expect(decision.kind).toBe('same_task');
    expect(loadChosenPlan(root, identity.fingerprint)?.task_fingerprint).toBe(
      identity.fingerprint,
    );
  });

  it('round-trips an explicit task id containing quotes and backslashes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-resume-escaped-id-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    const state = new StateManager(azaDir);
    const taskId = 'task-"quoted"\\nested\\path';

    await new ResumeGenerator(azaDir).generate(state, {
      task_id: taskId,
      user_input_hash: fingerprint('特殊任务标识'),
    });

    expect((await new ResumeGenerator(azaDir).read())?.task_id).toBe(taskId);
  });

  it('deletes an orphan plan on fresh start before a second same-input call can recover it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-fresh-orphan-plan-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    const input = '执行无恢复文件的新任务';
    const state = new StateManager(azaDir);
    autoSelectBestPlan(root, input);
    process.env.AZA_AUTO_PICK = '0';
    process.env.AZA_AUTO_MAX_STEPS = '0';

    const first = (await handleAzaAuto(
      { user_input: input, workspace_path: root },
      state,
      new ResumeGenerator(azaDir),
    )) as { data?: { auto_plan_selected?: boolean; auto_plan_path?: string } };
    const second = (await handleAzaAuto(
      { user_input: input, workspace_path: root },
      state,
      new ResumeGenerator(azaDir),
    )) as { data?: { auto_plan_selected?: boolean; auto_plan_path?: string } };

    expect(fs.existsSync(path.join(azaDir, 'chosen-plan.json'))).toBe(false);
    expect(fs.existsSync(path.join(azaDir, 'chosen-plan.md'))).toBe(false);
    expect(first.data?.auto_plan_selected).toBe(false);
    expect(first.data?.auto_plan_path).toBeUndefined();
    expect(second.data?.auto_plan_selected).toBe(false);
    expect(second.data?.auto_plan_path).toBeUndefined();
  });

  it('deletes a terminal task plan before a same-input vNext run can recover', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-terminal-plan-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    const input = '重新执行已完成的账单任务';
    const identity = createTaskIdentity(input);
    const state = new StateManager(azaDir);
    const current = state.getState();
    await state.update({
      pipeline: {
        ...current.pipeline,
        current_stage: 'archive',
        stages: {
          ...current.pipeline.stages,
          archive: { status: 'completed' },
        },
      },
      loops: {
        ...current.loops,
        phase: { ...current.loops.phase, current: 'archive' },
      },
      loop: { ...current.loop, progress: '100%' },
    });
    autoSelectBestPlan(root, input);
    await new ResumeGenerator(azaDir).generate(state, {
      task_id: identity.task_id,
      user_input_hash: identity.fingerprint,
    });
    process.env.AZA_AUTO_PICK = '0';
    process.env.AZA_AUTO_MAX_STEPS = '0';

    const first = (await handleAzaAuto(
      { user_input: input, workspace_path: root },
      state,
      new ResumeGenerator(azaDir),
    )) as { data?: { auto_plan_selected?: boolean; auto_plan_path?: string } };
    const second = (await handleAzaAuto(
      { user_input: input, workspace_path: root },
      state,
      new ResumeGenerator(azaDir),
    )) as { data?: { auto_plan_selected?: boolean; auto_plan_path?: string } };

    expect(fs.existsSync(path.join(azaDir, 'chosen-plan.json'))).toBe(false);
    expect(fs.existsSync(path.join(azaDir, 'chosen-plan.md'))).toBe(false);
    expect(first.data?.auto_plan_selected).toBe(false);
    expect(first.data?.auto_plan_path).toBeUndefined();
    expect(second.data?.auto_plan_selected).toBe(false);
    expect(second.data?.auto_plan_path).toBeUndefined();
  });

  it('rejects a structurally invalid chosen plan even when its fingerprint matches', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-plan-invalid-'));
    tempDirs.push(root);
    const identity = createTaskIdentity('验证方案结构');
    fs.mkdirSync(path.join(root, '.aza'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.aza', 'chosen-plan.json'),
      JSON.stringify({
        task_fingerprint: identity.fingerprint,
        selected: { name: 'Incomplete' },
      }),
      'utf8',
    );

    expect(loadChosenPlan(root, identity.fingerprint)).toBeNull();
  });

  it('rejects chosen plans with out-of-range confidence, scores, or effort', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-plan-boundaries-'));
    tempDirs.push(root);
    const input = '验证方案边界';
    const identity = createTaskIdentity(input);
    autoSelectBestPlan(root, input);
    const planPath = path.join(root, '.aza', 'chosen-plan.json');
    const baseline = JSON.parse(fs.readFileSync(planPath, 'utf8')) as Record<string, any>;
    const invalidPlans = [
      { ...baseline, confidence: -1 },
      { ...baseline, confidence: 101 },
      { ...baseline, selected: { ...baseline.selected, score: -1 } },
      { ...baseline, selected: { ...baseline.selected, score: 101 } },
      { ...baseline, explore: { ...baseline.explore, effort: 'extreme' } },
    ];

    for (const invalid of invalidPlans) {
      fs.writeFileSync(planPath, JSON.stringify(invalid), 'utf8');
      expect(loadChosenPlan(root, identity.fingerprint)).toBeNull();
    }
  });

  it('persists the same adjusted scores used to make the decision', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-plan-ranked-'));
    tempDirs.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { test: 'vitest' } }),
      'utf8',
    );
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'one.test.ts'), 'export {};', 'utf8');

    const result = autoSelectBestPlan(
      root,
      '修复一个局部配置解析错误并补充测试',
    );
    const persisted = JSON.parse(
      fs.readFileSync(path.join(root, '.aza', 'chosen-plan.json'), 'utf8'),
    ) as ChosenPlan & { ranked_options?: Array<{ name: string; score: number }> };

    expect(persisted.ranked_options?.[0]?.name).toBe(result.plan.selected.name);
    expect(persisted.ranked_options?.[0]?.score).toBe(result.plan.selected.score);
    expect(persisted.ranked_options?.length).toBe(3);
  });

  it('reports the no-user-ask host contract truthfully when auto-pick is disabled', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-no-pick-'));
    tempDirs.push(root);
    fs.writeFileSync(
      path.join(root, 'azaloop.yaml'),
      [
        'version: "0.1.0"',
        'project:',
        '  name: no-pick',
        '  root: .',
        'autonomy:',
        '  level: L3',
        '  auto_approve_prd: true',
      ].join('\n'),
      'utf8',
    );
    process.env.AZA_AUTO_PICK = '0';
    const azaDir = path.join(root, '.aza');

    const result = (await handleAzaAuto(
      { user_input: `实现一个无需选案的局部功能 ${Date.now()}`, workspace_path: root },
      new StateManager(azaDir),
      new ResumeGenerator(azaDir),
    )) as {
      data?: { auto_plan_selected?: boolean; instruction?: string };
      next_action?: { forbid_user_ask?: boolean; instruction?: string };
    };

    expect(result.data?.auto_plan_selected).toBe(false);
    expect(result.data?.instruction).not.toContain('.aza/chosen-plan.md');
    expect(result.next_action?.forbid_user_ask).toBe(true);
    expect(result.next_action?.instruction).toMatch(/禁止.*用户/);
  });

  it('keeps the no-user-ask protocol when continuing after the step budget', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-step-budget-'));
    tempDirs.push(root);
    process.env.AZA_AUTO_MAX_STEPS = '0';
    const azaDir = path.join(root, '.aza');

    const result = (await handleAzaAuto(
      { user_input: `继续执行预算烟雾测试 ${Date.now()}`, workspace_path: root },
      new StateManager(azaDir),
      new ResumeGenerator(azaDir),
    )) as {
      data?: { status?: string };
      next_action?: { forbid_user_ask?: boolean; host_protocol?: string };
    };

    expect(result.data?.status).toBe('max_steps_reached');
    expect(result.next_action?.forbid_user_ask).toBe(true);
    expect(result.next_action?.host_protocol).toBe('hard_continue_to_ship_no_user_ask');
  });
});
