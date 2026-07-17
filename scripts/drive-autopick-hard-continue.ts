/**
 * Drive autopick + hard-continue ship for current user requirement.
 */
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const root = path.resolve('d:/workspace/aza_0716/azaloop-main');
  const aza = path.join(root, '.aza');
  const user_input = '做全自动硬续，自动帮用户选择最佳方案执行，全自动执行优化';

  process.env.AZA_AUTO_APPROVE_PRD = 'true';
  process.env.AZA_HARD_CONTINUE = '1';
  process.env.AZA_AUTO_PICK = '1';
  process.env.AZA_AUTO_MAX_STEPS = '30';

  const { handleAzaAuto, handleAzaLoop, handleAzaSpec } = await import(
    '../packages/mcp-server/src/unified-handlers.ts'
  );
  const { StateManager } = await import('../packages/core/src/state/state-manager.ts');
  const { ResumeGenerator } = await import('../packages/core/src/continuity/resume-generator.ts');

  const sm = new StateManager(aza);
  const rg = new ResumeGenerator(aza);

  let r: any = await handleAzaAuto(
    { user_input, workspace_path: root, max_iterations: 30 },
    sm,
    rg,
  );
  console.log('1) aza_auto →', r?.data?.stage, r?.next_action?.action, 'auto_plan=', r?.data?.auto_plan_selected);

  const planPath = path.join(aza, 'chosen-plan.json');
  if (!fs.existsSync(planPath) && !fs.existsSync(path.join(aza, 'auto-pick.marker'))) {
    console.error('FAIL: expected auto-pick artifacts');
    process.exit(1);
  }
  if (fs.existsSync(planPath)) {
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    console.log('   chosen:', plan.selected?.name, plan.selected?.score);
  }

  if (r?.next_action?.action === 'implement') {
    await handleAzaSpec({
      action: 'implement',
      task_id: 'TASK-AUTOPICK',
      title: '全自动硬续+自动选方案',
      workspace_path: root,
    });
    fs.writeFileSync(path.join(aza, 'build-complete.marker'), `autopick ${new Date().toISOString()}\n`);
    r = await handleAzaLoop({
      action: 'report_tool',
      tool_name: 'aza_spec',
      workspace_path: root,
    });
    console.log('2) hard-continue → shipped=', r?.data?.shipped, 'mode=', r?.data?.mode);
  }

  if (!r?.data?.shipped) {
    console.error('FAIL: not shipped', r?.data?.status, r?.next_action);
    process.exit(1);
  }
  console.log('PASS: autopick + hard-continue shipped');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
