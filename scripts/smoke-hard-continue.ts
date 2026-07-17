/**
 * Smoke: L3 hard-continue — report_tool(implement) ships without second aza_auto.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  const { handleAzaAuto, handleAzaLoop } = await import('../packages/mcp-server/src/unified-handlers.ts');
  const { handleTaskImplement } = await import('../packages/mcp-server/src/tools/aza-task.ts');
  const { StateManager } = await import('../packages/core/src/state/state-manager.ts');
  const { ResumeGenerator } = await import('../packages/core/src/continuity/resume-generator.ts');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-hard-cont-'));
  const aza = path.join(tmp, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'azaloop.yaml'),
    [
      'version: "0.1.0"',
      'project:',
      '  name: hard-continue-smoke',
      '  root: .',
      'autonomy:',
      '  level: L3',
      '  auto_approve_prd: true',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'hc-smoke', private: true }, null, 2));

  process.env.AZA_AUTO_APPROVE_PRD = 'true';
  process.env.AZA_AUTO_MAX_STEPS = '12';
  process.env.AZA_HARD_CONTINUE = '1';

  const sm = new StateManager(aza);
  const rg = new ResumeGenerator(aza);
  const user_input = `hard-continue smoke ${Date.now()}`;

  const first: any = await handleAzaAuto(
    { user_input, workspace_path: tmp, max_iterations: 12 },
    sm,
    rg,
  );
  if (first?.next_action?.action !== 'implement') {
    console.error('FAIL: expected implement pause', first?.next_action);
    process.exit(1);
  }

  await handleTaskImplement('TASK-HC', tmp);
  fs.writeFileSync(path.join(aza, 'build-complete.marker'), `hc ${new Date().toISOString()}\n`);
  fs.writeFileSync(path.join(aza, 'quality-passed.marker'), 'smoke\n');

  // Critical: report via handleAzaLoop so hard-continue wrapper runs
  const rep: any = await handleAzaLoop({
    action: 'report_tool',
    tool_name: 'aza_spec',
    workspace_path: tmp,
  });

  console.log(
    JSON.stringify(
      {
        shipped: rep?.data?.shipped,
        mode: rep?.data?.mode,
        hard_continue: rep?.data?.hard_continue,
        steps: rep?.data?.hard_continue_steps,
        status: rep?.data?.status,
        next: rep?.next_action,
      },
      null,
      2,
    ),
  );

  if (!rep?.data?.shipped) {
    console.error('FAIL: expected hard_continue ship without second aza_auto');
    process.exit(1);
  }
  if (rep?.data?.mode !== 'l3_hard_continue' && !rep?.data?.hard_continue) {
    console.error('FAIL: missing hard_continue markers');
    process.exit(1);
  }
  console.log('PASS: report_tool(implement) hard-continued to ship');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
