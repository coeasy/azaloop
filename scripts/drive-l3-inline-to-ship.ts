/** Complete L3 chain: aza_auto → implement → report → aza_auto resumes → inline quality+ship */
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const root = path.resolve('d:/workspace/aza_0716/azaloop-main');
  const aza = path.join(root, '.aza');
  const { handleAzaAuto, handleAzaFinish } = await import('../packages/mcp-server/src/unified-handlers.ts');
  const { handleTaskImplement } = await import('../packages/mcp-server/src/tools/aza-task.ts');
  const { handleAutoLoop } = await import('../packages/mcp-server/src/tools/aza-loop.ts');
  const { StateManager } = await import('../packages/core/src/state/state-manager.ts');
  const { ResumeGenerator } = await import('../packages/core/src/continuity/resume-generator.ts');

  process.env.AZA_AUTO_APPROVE_PRD = 'true';
  process.env.AZA_AUTO_MAX_STEPS = '30';
  const user_input = 'L3内联全自动：design/quality/ship自动；仅implement需宿主；README已更新';
  const sm = new StateManager(aza);
  const rg = new ResumeGenerator(aza);

  let r: any = await handleAzaAuto({ user_input, workspace_path: root, max_iterations: 30 }, sm, rg);
  console.log('1) aza_auto →', r?.data?.stage, r?.next_action);

  if (r?.next_action?.action === 'implement') {
    await handleTaskImplement('TASK-L3-INLINE', root);
    fs.writeFileSync(path.join(aza, 'build-complete.marker'), `l3-inline ${new Date().toISOString()}\n`);
    const rep: any = await handleAutoLoop('report_tool', undefined, root, 'aza_spec');
    console.log('2) report implement →', rep?.next_action || rep?.data?.stage);

    // Resume aza_auto — L3 should inline quality + ship
    r = await handleAzaAuto({ user_input, workspace_path: root, max_iterations: 30 }, sm, rg);
    console.log('3) aza_auto resume →', r?.data?.status, r?.data?.stage, r?.next_action, 'shipped=', r?.data?.shipped);

    if (!r?.data?.shipped && r?.next_action?.tool === 'aza_quality') {
      // fallback if resume didn't inline
      const { handleQualityCheck } = await import('../packages/mcp-server/src/tools/aza-quality.ts');
      await handleQualityCheck(root);
      await handleAutoLoop('report_tool', undefined, root, 'aza_quality');
      r = await handleAzaFinish(
        { action: 'ship', workspace_path: root, stop_loop: true, work_summary: 'L3 inline fallback ship' },
        sm,
        rg,
      );
      console.log('3b) fallback ship →', (r as any)?.data?.shipped ?? (r as any)?.success);
    }
  }

  console.log('FINAL', JSON.stringify({ status: r?.data?.status, shipped: r?.data?.shipped, stage: r?.data?.stage || r?.metadata?.stage }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
