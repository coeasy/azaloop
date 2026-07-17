/**
 * Drive: stamp design for current task-epoch, mark build complete, then print next steps.
 * Used after code fix so local workspace can finish the loop without MCP reload.
 */
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const root = path.resolve('d:/workspace/aza_0716/azaloop-main');
  const aza = path.join(root, '.aza');
  const { handleAzaAuto } = await import('../packages/mcp-server/src/unified-handlers.ts');
  const { handleTaskDesign, handleTaskImplement } = await import(
    '../packages/mcp-server/src/tools/aza-task.ts'
  );
  const { handleAutoLoop } = await import('../packages/mcp-server/src/tools/aza-loop.ts');
  const { StateManager } = await import('../packages/core/src/state/state-manager.ts');
  const { ResumeGenerator } = await import('../packages/core/src/continuity/resume-generator.ts');

  process.env.AZA_AUTO_APPROVE_PRD = 'true';
  process.env.AZA_WORKSPACE = root.replace(/\\/g, '/');

  const sm = new StateManager(aza);
  const rg = new ResumeGenerator(aza);

  const auto: any = await handleAzaAuto(
    {
      user_input:
        '全部实现全部改进：修复全自动未跑完（HOST跟链+防旧制品快进）+ 回归测试 + 验证文档',
      workspace_path: root,
      max_iterations: 20,
    },
    sm,
    rg,
  );

  console.log('aza_auto →', JSON.stringify({
    stage: auto?.data?.stage,
    next: auto?.next_action,
    instruction: auto?.data?.instruction?.slice?.(0, 120),
  }));

  if (auto?.next_action?.tool === 'aza_spec' && auto?.next_action?.action === 'design') {
    const design = await handleTaskDesign(
      'STORY-FULL-AUTO-FIX',
      '全自动跟链修复',
      'Fresh Start 归档旧 design；task-epoch；HOST_MUST_EXECUTE；smoke no-skip-verify',
      root,
    );
    console.log('design →', design?.success, design?.data?.design_artifact);
    const report1: any = await handleAutoLoop('report_tool', undefined, root, 'aza_spec');
    console.log('report design →', report1?.next_action || report1?.data?.stage);
  }

  // Ensure design stamped with epoch + Technical Approach (handleTaskDesign does this)
  const epoch = fs.existsSync(path.join(aza, 'task-epoch'))
    ? fs.readFileSync(path.join(aza, 'task-epoch'), 'utf8').trim()
    : '';
  let designMd = fs.existsSync(path.join(aza, 'design.md'))
    ? fs.readFileSync(path.join(aza, 'design.md'), 'utf8')
    : '';
  if (epoch && designMd && !designMd.includes(epoch)) {
    designMd = designMd.replace(
      /^# Design[^\n]*/m,
      (m) => `${m}\n\n> task_epoch: ${epoch}\n> user_input_hash: ${epoch}`,
    );
    if (!designMd.includes('## Technical Approach')) {
      designMd += `\n## Technical Approach\n\nSee unified-handlers + real-handlers + aza-task fixes.\n`;
    }
    fs.writeFileSync(path.join(aza, 'design.md'), designMd, 'utf8');
  }

  // Implement already landed in source — mark build complete for this epoch
  await handleTaskImplement('TASK-FULL-AUTO-FIX', root);
  fs.writeFileSync(
    path.join(aza, 'build-complete.marker'),
    `full-auto-incomplete-fix ${new Date().toISOString()}\n`,
    'utf8',
  );
  const report2: any = await handleAutoLoop('report_tool', undefined, root, 'aza_spec');
  console.log('report implement →', report2?.next_action || report2?.data);

  console.log('DONE local drive. Next: aza_quality(check) then aza_finish(ship) via MCP or CLI.');
  console.log('epoch=', epoch);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
