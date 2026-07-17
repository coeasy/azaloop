/**
 * End-to-end: aza_auto → design → report_tool → continue until pause/done.
 * Proves full-auto spine without relying on Cursor MCP process.
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve('d:/workspace/aza_0716/azaloop-main');
process.env.AZA_AUTO_APPROVE_PRD = 'true';
process.env.AZA_AUTO_MAX_STEPS = '8';
process.env.AZA_WORKSPACE = root;

async function main() {
  const { handleAzaAuto, handleAzaLoop, handleAzaSpec } = await import(
    '../packages/mcp-server/src/unified-handlers.ts'
  );
  const { StateManager } = await import('../packages/core/src/state/state-manager.ts');
  const { ResumeGenerator } = await import('../packages/core/src/continuity/resume-generator.ts');
  const { clearControllerCache } = await import('../packages/mcp-server/src/tools/aza-loop.ts');

  clearControllerCache(root);
  const sm = new StateManager(path.join(root, '.aza'));
  const rg = new ResumeGenerator(path.join(root, '.aza'));

  const log: any[] = [];
  let r: any = await handleAzaAuto(
    {
      user_input: `E2E full-auto verify ${Date.now()}: keep design lean, then build-complete.marker`,
      workspace_path: root,
      max_iterations: 15,
    },
    sm,
    rg,
  );
  log.push({ step: 'aza_auto', stage: r?.data?.stage, status: r?.data?.status, next: r?.next_action });

  // Follow awaitingAction chain up to 6 hops
  for (let i = 0; i < 6; i++) {
    const na = r?.next_action;
    if (!na?.tool) break;
    if (na.action === 'stop' || na.action === 'escalate') {
      log.push({ step: `halt:${na.action}`, reason: na.reason });
      break;
    }
    if (na.tool === 'aza_spec' && na.action === 'design') {
      r = await handleAzaSpec({
        action: 'design',
        story_id: 'STORY-E2E',
        title: 'E2E lean design',
        description: 'Technical Approach: write design.md and marker',
        workspace_path: root,
      });
      log.push({ step: 'aza_spec.design', ok: r?.success, next: r?.next_action });
      // Simulate host completing design artifact
      const design = path.join(root, '.aza', 'design.md');
      fs.writeFileSync(
        design,
        '# Design\n\n## Intent\nE2E\n\n## Technical Approach\n1. Lean design\n2. Marker\n\n## Acceptance\n- loop advances\n',
      );
      fs.writeFileSync(path.join(root, '.aza', 'build-complete.marker'), 'e2e');
      r = await handleAzaLoop({
        action: 'report_tool',
        tool_name: 'aza_spec',
        tool_action: 'design',
        success: true,
        workspace_path: root,
      });
      log.push({ step: 'report_tool.design', stage: r?.data?.stage, next: r?.next_action });
      continue;
    }
    if (na.tool === 'aza_loop') {
      r = await handleAzaLoop({
        action: na.action || 'full',
        workspace_path: root,
      });
      log.push({
        step: `aza_loop.${na.action}`,
        stage: r?.data?.stage || r?.metadata?.stage,
        status: r?.data?.status,
        next: r?.next_action,
        reason: r?.next_action?.reason || r?.data?.reason,
      });
      continue;
    }
    if (na.tool === 'aza_quality' || na.tool === 'aza_finish') {
      log.push({ step: 'reached', next: na });
      break;
    }
    // Unknown — stop
    log.push({ step: 'unhandled', next: na });
    break;
  }

  const stagnated = log.some((x) => /content_stagnation/i.test(String(x.reason || '')));
  const reachedDesign = log.some(
    (x) => x.step === 'aza_spec.design' || x?.next?.action === 'design' || x.stage === 'design',
  );
  const advancedPastArchiveTrap = !log.some(
    (x) => /DP gate blocked.*archive/i.test(String(x.reason || '')),
  );

  console.log(JSON.stringify({ stagnated, reachedDesign, advancedPastArchiveTrap, log }, null, 2));
  if (stagnated || !advancedPastArchiveTrap) process.exit(1);
  if (!reachedDesign && !log.some((x) => x.step === 'reached')) {
    // Still OK if first pause was design awaiting
    const first = log[0];
    if (first?.next?.action !== 'design' && first?.stage !== 'design') process.exit(1);
  }
  console.log('PASS: full-auto chain progressed without archive DP trap / stagnation');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
