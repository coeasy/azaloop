/**
 * Drive current workspace hard-continue ship for STORY-HC.
 */
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const root = path.resolve('d:/workspace/aza_0716/azaloop-main');
  const aza = path.join(root, '.aza');
  fs.writeFileSync(path.join(aza, 'build-complete.marker'), `hard-continue-v1 ${new Date().toISOString()}\n`);

  const { handleAzaSpec, handleAzaLoop } = await import('../packages/mcp-server/src/unified-handlers.ts');

  const impl: any = await handleAzaSpec({
    action: 'implement',
    task_id: 'TASK-HC',
    title: '全自动硬续',
    workspace_path: root,
  });
  console.log('1) implement →', impl?.success, impl?.next_action);

  const rep: any = await handleAzaLoop({
    action: 'report_tool',
    tool_name: 'aza_spec',
    workspace_path: root,
  });
  console.log(
    '2) report_tool hard-continue →',
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
    console.error('FAIL: expected ship via hard-continue');
    process.exit(1);
  }
  console.log('PASS: hard-continue shipped');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
