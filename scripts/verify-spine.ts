/**
 * Local spine verification — exercises converged MCP tools without Cursor UI.
 * Run: npx tsx scripts/verify-spine.ts
 *
 * Important: chdir into the temp workspace BEFORE importing the MCP server,
 * because StateManager binds `.aza` at module init from process.cwd().
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-spine-'));
const AZA = path.join(WORK, '.aza');
fs.mkdirSync(AZA, { recursive: true });

const repoRoot = path.resolve(__dirname, '..');
const tmpl = path.join(repoRoot, 'templates', 'orchestrator.example.yaml');
if (fs.existsSync(tmpl)) {
  fs.mkdirSync(path.join(WORK, 'templates'), { recursive: true });
  fs.copyFileSync(tmpl, path.join(WORK, 'templates', 'orchestrator.example.yaml'));
}

fs.writeFileSync(
  path.join(WORK, 'package.json'),
  JSON.stringify({ name: 'aza-spine', private: true, type: 'module' }, null, 2),
);
fs.writeFileSync(
  path.join(WORK, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      module: 'ESNext',
      moduleResolution: 'Bundler',
      target: 'ES2020',
      skipLibCheck: true,
      noEmit: true,
      strict: false,
      types: [],
    },
    include: ['src/**/*'],
  }),
);
fs.mkdirSync(path.join(WORK, 'src'), { recursive: true });
fs.writeFileSync(path.join(WORK, 'src', 'add.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
fs.writeFileSync(
  path.join(WORK, 'src', 'add.test.ts'),
  "// @ts-nocheck\nimport { add } from './add';\nimport { test, expect } from 'vitest';\ntest('adds', () => { expect(add(1,2)).toBe(3); });\n",
);
fs.writeFileSync(
  path.join(WORK, 'vitest.config.ts'),
  "export default { test: { include: ['src/**/*.test.ts'], environment: 'node', passWithNoTests: true } };\n",
);
fs.writeFileSync(
  path.join(AZA, 'contract.md'),
  '# Contract\n\n- MUST add numbers correctly\n- SHOULD have unit tests\n',
);

process.chdir(WORK);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function main() {
  const { handleToolCall, listTools } = await import('../packages/mcp-server/src/index');
  const { DynamicBinder } = await import('../packages/core/src/L3_roles/dynamic-binder');

  async function step(name: string, tool: string, args: Record<string, unknown>) {
    process.stderr.write(`\n→ ${name}: ${tool}\n`);
    const result: any = await handleToolCall(tool, args);
    process.stderr.write(
      `  success=${result?.success} err=${result?.error ?? '-'} next=${JSON.stringify(result?.next_action)}\n`,
    );
    return result;
  }

  const tools = listTools();
  assert(tools.length === 8, `expected 8 tools, got ${tools.length}`);
  process.stderr.write(`[ok] tools/list = ${tools.map((t) => t.name).join(', ')}\n`);

  const binder = new DynamicBinder();
  const slash = binder.getSlashCatalog();
  assert(slash.some((s) => s.slash === '/aza-ceo'), 'missing /aza-ceo');
  process.stderr.write(`[ok] slash roles: ${[...new Set(slash.map((s) => s.slash))].join(', ')}\n`);

  await step('legacy alias', 'aza_session_start', { workspace_path: WORK });
  await step('calibrate', 'aza_session', { action: 'calibrate', workspace_path: WORK });

  const review = await step('prd review+auto', 'aza_prd', {
    action: 'review',
    title: 'Spine Verify Demo',
    description:
      'Build a tiny add(a,b) utility with unit tests to prove the AzaLoop MCP spine end-to-end.',
    auto_approve: true,
    workspace_path: WORK,
  });
  assert(review?.success, 'auto approve failed');
  assert(review?.next_action?.tool === 'aza_loop', 'next after approve should be aza_loop');
  assert(fs.existsSync(path.join(AZA, 'task_plan.md')), 'task_plan.md missing after approve');
  process.stderr.write('[ok] task board after approve\n');

  const hasOpenspec =
    fs.existsSync(path.join(WORK, 'openspec')) || fs.existsSync(path.join(AZA, 'openspec'));
  process.stderr.write(`[info] openspec present=${hasOpenspec}\n`);

  let loopResult = await step('loop full #1', 'aza_loop', {
    action: 'full',
    workspace_path: WORK,
  });

  for (let i = 0; i < 4; i++) {
    const awaitAction = loopResult?.data?.awaitingAction || loopResult?.next_action;
    const awaitTool = awaitAction?.tool;
    if (!awaitTool || awaitTool === 'aza_loop' || loopResult?.data?.done) break;
    await step(`host ${awaitTool}`, awaitTool, {
      action: awaitAction.action || 'design',
      story_id: 'STORY-1',
      task_id: 'TASK-1',
      title: 'Demo',
      description: 'demo',
      workspace_path: WORK,
      project_root: WORK,
    });
    loopResult = await step(`report #${i}`, 'aza_loop', {
      action: 'report_tool',
      tool_name: awaitTool,
      workspace_path: WORK,
    });
    loopResult = await step(`loop #${i + 2}`, 'aza_loop', { action: 'full', workspace_path: WORK });
  }

  const quality = await step('quality', 'aza_quality', {
    action: 'check',
    project_root: WORK,
    workspace_path: WORK,
  });
  process.stderr.write(`  quality.success=${quality?.success} summary=${quality?.data?.summary}\n`);
  assert(quality !== null && quality !== undefined, 'quality returned nothing');

  const finishWork = await step('finish work', 'aza_finish', {
    action: 'work',
    work_summary: 'Spine verify demo',
    workspace_path: WORK,
  });
  assert(finishWork?.success !== false || finishWork?.data?.task_id, 'finish work broken');

  const orch = await step('yaml orch', 'aza_loop', {
    action: 'orch_run',
    workspace_path: WORK,
  });
  assert(orch?.data?.orch_path || orch?.error, 'orch_run must attempt pipeline');
  process.stderr.write(`  orch success=${orch?.success} path=${orch?.data?.orch_path}\n`);

  await step('pre-skill args', 'aza_meta', {
    action: 'skills_search',
    query: 'prd',
    skill_id: 'tdd-process',
    when_to_use: 'implementing any production code with failing tests first',
    intent: 'draw a logo for marketing',
    workspace_path: WORK,
  });

  const storesPut = await step('stores put', 'aza_meta', {
    action: 'stores',
    sub_action: 'put',
    kind: 'specs',
    id: 'spine-demo',
    title: 'Add',
    body: 'add(a,b) returns sum',
    workspace_path: WORK,
  });
  assert(storesPut?.success, 'stores put failed');

  const storesSearch = await step('stores search', 'aza_meta', {
    action: 'stores',
    sub_action: 'search',
    query: 'sum add',
    workspace_path: WORK,
  });
  assert(storesSearch?.success, 'stores search failed');

  const swarm = await step('swarm dispatch', 'aza_meta', {
    action: 'swarm',
    sub_action: 'dispatch',
    task_id: 'spine-swarm-1',
    agent: 'host',
    goal: 'verify add',
    tool: 'aza_quality',
    task_action: 'check',
    workspace_path: WORK,
  });
  assert(swarm?.success || swarm?.data?.host, 'swarm dispatch failed');

  const dlp = await step('dlp scan clean', 'aza_meta', {
    action: 'dlp_scan',
    content: 'implement add with unit tests',
    workspace_path: WORK,
  });
  assert(dlp?.success !== false || dlp?.data?.passed === true, 'dlp clean should pass');

  process.stderr.write(`\n✅ spine verification finished in ${WORK}\n`);
  process.stdout.write(
    JSON.stringify({
      ok: true,
      work: WORK,
      tools: 8,
      quality_success: quality?.success ?? null,
      orch_success: orch?.success ?? null,
      task_board: true,
      openspec: hasOpenspec,
      stores: true,
      swarm: Boolean(swarm?.success || swarm?.data?.host),
      dlp_passed: dlp?.data?.passed ?? dlp?.success,
    }) + '\n',
  );
}

main().catch((err) => {
  console.error('\n❌', err);
  process.exit(1);
});
