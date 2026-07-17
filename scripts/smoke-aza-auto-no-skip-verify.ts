/**
 * Smoke: new aza_auto user_input must NOT skip to verify via stale design/OpenSpec.
 * Expect pause at design with awaitingAction aza_spec(design).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  const repo = path.resolve('d:/workspace/aza_0716/azaloop-main');
  const { handleAzaAuto } = await import('../packages/mcp-server/src/unified-handlers.ts');
  const { StateManager } = await import('../packages/core/src/state/state-manager.ts');
  const { ResumeGenerator } = await import('../packages/core/src/continuity/resume-generator.ts');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-auto-noskip-'));
  const aza = path.join(tmp, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  // Stale completed artifacts that previously caused skip-to-verify
  fs.writeFileSync(
    path.join(aza, 'RESUME.md'),
    `---\nschema_version: "1.0"\nstage: "archive"\niteration: 9\nprogress: "100%"\n---\n# stale shipped\n`,
  );
  fs.writeFileSync(path.join(aza, 'quality-passed.marker'), 'ok');
  fs.writeFileSync(path.join(aza, 'build-complete.marker'), 'ok');
  fs.writeFileSync(
    path.join(aza, 'design.md'),
    `# Design — OLD\n\n## Technical Approach\n\nOld approach that must not satisfy a new task.\n`,
  );
  fs.mkdirSync(path.join(tmp, 'openspec', 'changes', 'old-done'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'openspec', 'changes', 'old-done', 'proposal.md'), '# p\n');
  fs.writeFileSync(
    path.join(tmp, 'openspec', 'changes', 'old-done', 'design.md'),
    '# Design\n\n## Technical Approach\n\nEnough text for lean openspec ready gate to pass.\n',
  );
  fs.writeFileSync(
    path.join(tmp, 'openspec', 'changes', 'old-done', 'tasks.md'),
    '# Tasks\n\n- [x] done one\n- [x] done two\n',
  );
  fs.writeFileSync(
    path.join(tmp, 'azaloop.yaml'),
    ['version: "0.1.0"', 'project:', '  name: smoke', '  root: .', 'autonomy:', '  level: L3', '  auto_approve_prd: true'].join(
      '\n',
    ),
  );
  // Minimal package.json so workspace looks real
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'smoke', private: true }, null, 2));

  const sm = new StateManager(aza);
  const rg = new ResumeGenerator(aza);
  process.env.AZA_AUTO_APPROVE_PRD = 'true';
  process.env.AZA_AUTO_MAX_STEPS = '8';

  const result: any = await handleAzaAuto(
    {
      user_input: `No-skip verify smoke ${Date.now()}: implement host-chain fix`,
      workspace_path: tmp,
      max_iterations: 8,
    },
    sm,
    rg,
  );

  const stage = String(result?.data?.stage || result?.metadata?.stage || '');
  const nextTool = String(result?.next_action?.tool || '');
  const nextAction = String(result?.next_action?.action || '');
  const instruction = String(result?.data?.instruction || '');

  console.log(
    JSON.stringify(
      {
        success: result?.success,
        status: result?.data?.status,
        stage,
        next: result?.next_action,
        instruction_has_host_must: /HOST_MUST_EXECUTE/i.test(instruction),
        design_prev: fs.existsSync(path.join(aza, 'design.prev.md')),
        design_gone_or_new: !fs.existsSync(path.join(aza, 'design.md')),
        task_epoch: fs.existsSync(path.join(aza, 'task-epoch')),
      },
      null,
      2,
    ),
  );

  if (stage === 'verify' || nextTool === 'aza_quality') {
    console.error('FAIL: skipped to verify/quality via stale artifacts');
    process.exit(1);
  }
  // L3 inline auto-completes design → expect pause at implement (or design if inline off)
  const okPause =
    (stage === 'design' && nextTool === 'aza_spec' && nextAction === 'design') ||
    (stage === 'build' && nextTool === 'aza_spec' && nextAction === 'implement');
  if (!okPause) {
    console.error(`FAIL: expected design or implement pause, got stage=${stage} next=${nextTool}(${nextAction})`);
    process.exit(1);
  }
  if (!/HOST_MUST_EXECUTE/i.test(instruction) && nextAction === 'implement') {
    // implement pause should still instruct host
    if (!instruction && !result?.data?.l3_inline) {
      console.error('FAIL: missing HOST_MUST_EXECUTE instruction');
      process.exit(1);
    }
  }
  if (nextAction === 'design' && !/HOST_MUST_EXECUTE/i.test(instruction)) {
    console.error('FAIL: missing HOST_MUST_EXECUTE instruction');
    process.exit(1);
  }
  console.log(`PASS: aza_auto paused at ${stage}/${nextAction} — did not skip to verify`);
  void repo;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
