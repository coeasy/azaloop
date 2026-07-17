/**
 * Smoke: aza_auto auto-picks best plan and writes chosen-plan.json
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  const { autoSelectBestPlan, pickBestOption } = await import('../packages/mcp-server/src/auto-plan.ts');
  const { exploreWorkspace } = await import('../packages/mcp-server/src/tools/aza-explore.ts');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-autopick-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', private: true }));
  fs.writeFileSync(
    path.join(tmp, 'azaloop.yaml'),
    'version: "0.1.0"\nproject:\n  name: x\n  root: .\nautonomy:\n  level: L3\n  auto_approve_prd: true\n',
  );
  fs.mkdirSync(path.join(tmp, '.aza'), { recursive: true });

  const user_input = '做全自动硬续，自动帮用户选择最佳方案执行，全自动执行优化';
  const { plan, plan_path } = autoSelectBestPlan(tmp, user_input);

  if (!fs.existsSync(plan_path) || !fs.existsSync(path.join(tmp, '.aza', 'chosen-plan.json'))) {
    console.error('FAIL: plan files missing');
    process.exit(1);
  }
  if (!plan.selected?.name || plan.selected.score < 1) {
    console.error('FAIL: no selected plan', plan.selected);
    process.exit(1);
  }

  // Unattended intent should prefer incremental over rewrite
  const explore = exploreWorkspace(tmp, user_input);
  const best = pickBestOption(explore, user_input);
  const rewrite = explore.options.find((o) => /rewrite|greenfield/i.test(o.name));
  if (rewrite && best.name === rewrite.name && rewrite.score > 50) {
    // only fail if rewrite clearly won despite auto bias — unlikely
  }
  if (/rewrite|greenfield/i.test(best.name) && /全自动|硬续/.test(user_input)) {
    console.error('FAIL: should not pick rewrite for unattended intent', best);
    process.exit(1);
  }

  console.log('PASS: auto-picked', best.name, best.score, '→', plan_path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
