/**
 * Smoke-test MCP as Cursor would see it (tools/list + one calibrate).
 * Run: npx tsx scripts/smoke-cursor-mcp.ts [workspace]
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO = path.resolve(__dirname, '..');
const SERVER = path.join(REPO, 'packages', 'mcp-server', 'dist', 'server.js');
const WORK = path.resolve(process.argv[2] || path.join('D:', 'tmp', 'aza-demo-add'));

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

async function rpc(
  proc: ReturnType<typeof spawn>,
  lines: object[],
): Promise<any[]> {
  const payload = lines.map((o) => JSON.stringify(o)).join('\n') + '\n';
  return new Promise((resolve, reject) => {
    let buf = '';
    const outs: any[] = [];
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const parts = buf.split('\n');
      buf = parts.pop() || '';
      for (const line of parts) {
        if (!line.trim()) continue;
        try {
          outs.push(JSON.parse(line));
        } catch {
          /* ignore non-json */
        }
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', (c) => process.stderr.write(c));
    proc.stdin?.write(payload);
    setTimeout(() => {
      proc.stdout?.off('data', onData);
      resolve(outs);
    }, 2500);
  });
}

async function main() {
  assert(fs.existsSync(SERVER), `build mcp-server first: ${SERVER}`);
  assert(fs.existsSync(WORK), `workspace missing: ${WORK}`);

  const proc = spawn('node', [SERVER], {
    cwd: WORK,
    env: { ...process.env, AZA_AUTO_APPROVE_PRD: 'true' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const responses = await rpc(proc, [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke-cursor', version: '0.1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'aza_session',
        arguments: { action: 'calibrate', workspace_path: WORK },
      },
    },
  ]);

  proc.kill();

  const list = responses.find((r) => r.id === 2);
  const tools = list?.result?.tools || [];
  const names = tools.map((t: any) => t.name);
  assert(names.length === 8, `expected 8 tools, got ${names.length}: ${names.join(',')}`);

  const call = responses.find((r) => r.id === 3);
  const text = call?.result?.content?.[0]?.text || JSON.stringify(call?.result);
  let parsed: any = null;
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : call?.result;
  } catch {
    parsed = { raw: text };
  }

  const mcpJson = path.join(WORK, '.cursor', 'mcp.json');
  assert(fs.existsSync(mcpJson), 'missing .cursor/mcp.json — run setup-cursor.mjs');
  assert(fs.existsSync(path.join(WORK, '.cursor', 'rules', 'azaloop.mdc')), 'missing rules');

  console.log(
    JSON.stringify(
      {
        ok: true,
        workspace: WORK,
        tools: names,
        calibrate_ok: parsed?.success !== false,
        next_action: parsed?.next_action || parsed?.data?.next_action,
        cursor_mcp: mcpJson,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
