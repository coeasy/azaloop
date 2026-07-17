/**
 * Client acceptance: short Chinese product titles ARE requirements.
 * Simulates Cursor host: aza_auto → implement → report → aza_auto → ship.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  const { handleAzaAuto } = await import('../packages/mcp-server/src/unified-handlers.ts');
  const { handleTaskImplement } = await import('../packages/mcp-server/src/tools/aza-task.ts');
  const { handleAutoLoop } = await import('../packages/mcp-server/src/tools/aza-loop.ts');
  const { StateManager } = await import('../packages/core/src/state/state-manager.ts');
  const { ResumeGenerator } = await import('../packages/core/src/continuity/resume-generator.ts');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-req-title-'));
  const aza = path.join(tmp, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'azaloop.yaml'),
    ['version: "0.1.0"', 'project:', '  name: smoke', '  root: .', 'autonomy:', '  level: L3', '  auto_approve_prd: true'].join(
      '\n',
    ),
  );
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'smoke', private: true }));

  const user_input = '全自动优化改进项目';
  process.env.AZA_AUTO_APPROVE_PRD = 'true';
  process.env.AZA_AUTO_MAX_STEPS = '20';
  const sm = new StateManager(aza);
  const rg = new ResumeGenerator(aza);

  const r1: any = await handleAzaAuto({ user_input, workspace_path: tmp, max_iterations: 20 }, sm, rg);
  if (r1?.next_action?.action !== 'implement') {
    console.error('FAIL: short title must reach implement', r1?.next_action);
    process.exit(1);
  }

  await handleTaskImplement('TASK-TITLE-REQ', tmp);
  fs.writeFileSync(path.join(aza, 'build-complete.marker'), 'ok\n');
  await handleAutoLoop('report_tool', undefined, tmp, 'aza_spec');
  // Temp workspace has no vitest suite — mark quality for L3 ship path (real repos run aza_quality)
  fs.writeFileSync(path.join(aza, 'quality-passed.marker'), 'accept-smoke\n');

  const r2: any = await handleAzaAuto({ user_input, workspace_path: tmp, max_iterations: 20 }, sm, rg);
  if (!r2?.data?.shipped) {
    console.error('FAIL: second aza_auto must ship', r2?.data?.status, r2?.next_action);
    process.exit(1);
  }
  console.log('PASS: 「全自动优化改进项目」识别为需求并 L3 闭环 ship');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
