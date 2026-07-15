/**
 * Run short spine against a Cursor demo workspace.
 * Usage: npx tsx scripts/demo-spine-in-workspace.ts D:\tmp\aza-demo-add
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(__dirname, '..');
const WORK = path.resolve(process.argv[2] || path.join('D:', 'tmp', 'aza-demo-add'));

async function main() {
  if (!fs.existsSync(WORK)) throw new Error(`missing workspace ${WORK}`);
  process.chdir(WORK);

  const mod = await import(
    pathToFileURL(path.join(REPO, 'packages', 'mcp-server', 'src', 'index.ts')).href
  );
  const { handleToolCall, listTools } = mod;

  const tools = listTools();
  if (tools.length !== 8) throw new Error(`expected 8 tools, got ${tools.length}`);

  let r: any = await handleToolCall('aza_session', {
    action: 'calibrate',
    workspace_path: WORK,
  });
  process.stderr.write(`calibrate success=${r?.success}\n`);

  r = await handleToolCall('aza_prd', {
    action: 'review',
    title: 'Add utility',
    description: 'Implement add(a,b) with vitest unit tests',
    auto_approve: true,
    workspace_path: WORK,
  });
  process.stderr.write(`prd success=${r?.success} next=${JSON.stringify(r?.next_action)}\n`);

  r = await handleToolCall('aza_loop', { action: 'full', workspace_path: WORK });
  const awaitAction = r?.data?.awaitingAction || r?.next_action;
  process.stderr.write(`loop next=${JSON.stringify(awaitAction)}\n`);

  if (awaitAction?.tool && !String(awaitAction.tool).startsWith('aza_loop')) {
    await handleToolCall(awaitAction.tool, {
      action: awaitAction.action || 'design',
      story_id: 'STORY-1',
      task_id: 'TASK-1',
      title: 'Add',
      description: 'add',
      workspace_path: WORK,
      project_root: WORK,
    });
    await handleToolCall('aza_loop', {
      action: 'report_tool',
      tool_name: awaitAction.tool,
      workspace_path: WORK,
    });
  }

  console.log(
    JSON.stringify({
      ok: true,
      demo: WORK,
      tools: 8,
      task_board: fs.existsSync(path.join(WORK, '.aza', 'task_plan.md')),
      mcp: fs.existsSync(path.join(WORK, '.cursor', 'mcp.json')),
      rules: fs.existsSync(path.join(WORK, '.cursor', 'rules', 'azaloop.mdc')),
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
