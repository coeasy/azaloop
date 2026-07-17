/**
 * Smoke: aza_auto fresh-start when RESUME is stale archive@100%.
 * Runs against local packages (does not require Cursor MCP reload).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  const root = path.resolve('d:/workspace/aza_0716/azaloop-main');
  // Dynamic import after build
  const { handleAzaAuto } = await import('../packages/mcp-server/src/unified-handlers.ts');
  const { StateManager } = await import('../packages/core/src/state/state-manager.ts');
  const { ResumeGenerator } = await import('../packages/core/src/continuity/resume-generator.ts');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-smoke-'));
  const aza = path.join(tmp, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  fs.writeFileSync(
    path.join(aza, 'RESUME.md'),
    `---\nschema_version: "1.0"\nstage: "archive"\nstory: "STORY-OLD"\niteration: 10\nprogress: "100%"\n---\n# stale\n`,
  );
  fs.writeFileSync(path.join(aza, 'quality-passed.marker'), 'ok');
  fs.writeFileSync(
    path.join(tmp, 'azaloop.yaml'),
    ['version: "0.1.0"', 'project:', '  name: smoke', '  root: .', 'autonomy:', '  level: L3', '  auto_approve_prd: true'].join('\n'),
  );

  const sm = new StateManager(aza);
  const rg = new ResumeGenerator(aza);
  process.env.AZA_AUTO_APPROVE_PRD = 'true';
  process.env.AZA_AUTO_MAX_STEPS = '8';

  const result: any = await handleAzaAuto(
    {
      user_input: 'Smoke test: create a tiny hello module and stop',
      workspace_path: tmp,
      max_iterations: 3,
    },
    sm,
    rg,
  );

  const resumeExists = fs.existsSync(path.join(aza, 'RESUME.md'));
  console.log(JSON.stringify({
    success: result?.success,
    status: result?.data?.status,
    stage: result?.data?.stage,
    reason: result?.data?.reason || result?.next_action?.reason,
    next: result?.next_action,
    resume_after: resumeExists,
  }, null, 2));

  // Fresh start must not stay stuck claiming content_stagnation from old archive
  const reason = String(result?.data?.reason || result?.next_action?.reason || '');
  if (/content_stagnation/i.test(reason)) {
    console.error('FAIL: still content_stagnation on fresh user_input');
    process.exit(1);
  }
  console.log('PASS: aza_auto did not stagnate on stale archive RESUME');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
