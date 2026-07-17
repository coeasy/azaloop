/**
 * Smoke: L3 aza_auto inlines design and pauses only at implement.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  const { handleAzaAuto } = await import('../packages/mcp-server/src/unified-handlers.ts');
  const { StateManager } = await import('../packages/core/src/state/state-manager.ts');
  const { ResumeGenerator } = await import('../packages/core/src/continuity/resume-generator.ts');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-l3-'));
  const aza = path.join(tmp, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'azaloop.yaml'),
    ['version: "0.1.0"', 'project:', '  name: smoke', '  root: .', 'autonomy:', '  level: L3', '  auto_approve_prd: true'].join(
      '\n',
    ),
  );
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'smoke', private: true }, null, 2));

  const sm = new StateManager(aza);
  const rg = new ResumeGenerator(aza);
  process.env.AZA_AUTO_APPROVE_PRD = 'true';
  process.env.AZA_AUTO_MAX_STEPS = '12';

  const result: any = await handleAzaAuto(
    {
      user_input: `L3 inline smoke ${Date.now()}`,
      workspace_path: tmp,
      max_iterations: 12,
    },
    sm,
    rg,
  );

  const stage = String(result?.data?.stage || '');
  const next = result?.next_action || {};
  console.log(JSON.stringify({ stage, next, l3: result?.data?.l3_inline, status: result?.data?.status }, null, 2));

  if (stage === 'verify' || next.tool === 'aza_quality') {
    console.error('FAIL: must not reach verify without host implement');
    process.exit(1);
  }
  if (next.tool !== 'aza_spec' || next.action !== 'implement') {
    console.error(`FAIL: expected aza_spec(implement), got ${next.tool}(${next.action}) stage=${stage}`);
    process.exit(1);
  }
  console.log('PASS: L3 aza_auto inlined design and paused at implement');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
