#!/usr/bin/env node
/**
 * Setup Cursor for AzaLoop (third-party project or local monorepo).
 *
 * Usage:
 *   node scripts/setup-cursor.mjs --target D:\tmp\aza-demo-add --mode local
 *   node scripts/setup-cursor.mjs --target . --mode local --fresh
 *   node scripts/setup-cursor.mjs --target D:\my-app --mode npx
 *
 * Modes:
 *   local — node <azaloop>/packages/mcp-server/dist/server.js  (dev / this PC)
 *   npx   — npx -y @azaloop/mcp-server                          (published package)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const TEMPLATES = path.join(REPO, 'templates', 'clients', 'cursor');

function parseArgs(argv) {
  const out = { target: process.cwd(), mode: 'local', fresh: false, autoApprove: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') out.target = path.resolve(argv[++i]);
    else if (a === '--mode') out.mode = argv[++i];
    else if (a === '--fresh') out.fresh = true;
    else if (a === '--no-auto-approve') out.autoApprove = false;
  }
  return out;
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirFiles(srcDir, destDir, filter) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(srcDir)) {
    if (filter && !filter(f)) continue;
    const s = path.join(srcDir, f);
    if (!fs.statSync(s).isFile()) continue;
    copyFile(s, path.join(destDir, f));
    n++;
  }
  return n;
}

function mcpConfig(mode, autoApprove) {
  const env = {};
  if (autoApprove) env.AZA_AUTO_APPROVE_PRD = 'true';

  if (mode === 'local') {
    const serverJs = path.join(REPO, 'packages', 'mcp-server', 'dist', 'server.js');
    if (!fs.existsSync(serverJs)) {
      throw new Error(`Missing ${serverJs} — run: pnpm --filter @azaloop/mcp-server build`);
    }
    return {
      mcpServers: {
        azaloop: {
          command: 'node',
          args: [serverJs.replace(/\\/g, '/')],
          env,
        },
      },
    };
  }

  return {
    mcpServers: {
      azaloop: {
        command: 'npx',
        args: ['-y', '@azaloop/mcp-server'],
        env,
      },
    },
  };
}

function ensureAza(root, client = 'cursor') {
  const aza = path.join(root, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  const state = `pipeline:
  current_stage: open
  stages:
    open: { status: pending }
    design: { status: pending }
    build: { status: pending }
    verify: { status: pending }
    archive: { status: pending }
loop:
  iteration: 0
  progress: '0%'
  client: ${client}
  model: unknown
  max_iterations: 50
memory: { semantic_keys: [] }
security_findings: []
strikes: 0
updated_at: ${new Date().toISOString()}
`;
  fs.writeFileSync(path.join(aza, 'STATE.yaml'), state, 'utf8');
  fs.writeFileSync(
    path.join(aza, 'RESUME.md'),
    `# AzaLoop Resume\n\nInitialized for Cursor.\n\n## Next\n1. aza_session(action=calibrate)\n2. aza_prd(action=review, …)\n3. aza_loop(action=full)\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(aza, 'run-state.json'), '{}', 'utf8');
}

function writePrompt(root) {
  const p = path.join(root, 'AZA-CURSOR-PROMPT.md');
  fs.writeFileSync(
    p,
    `# 在 Cursor Agent 中粘贴此提示

按 AzaLoop 全自动协议执行，**不要**问我 Continue / 是否继续。

工作区：当前项目根目录。

## 需求
实现 \`add(a: number, b: number): number\`，并用 vitest 写单元测试。

## 强制步骤
1. \`aza_session\` → \`action: calibrate\`
2. \`aza_prd\` → \`action: review\`, title=\`Add utility\`, description=上面需求, \`auto_approve: true\`
3. 跟随返回的 \`next_action\`：\`aza_loop\` → \`action: full\`
4. 若有 \`awaitingAction\`：先执行该工具，再 \`aza_loop\` → \`action: report_tool\`, \`tool_name\`=刚才工具名
5. 循环直到 \`aza_finish\` → \`action: ship\`

只用这 8 个工具：aza_session / aza_prd / aza_loop / aza_spec / aza_quality / aza_finish / aza_memory / aza_meta
`,
    'utf8',
  );
  return p;
}

function main() {
  const opts = parseArgs(process.argv);
  const target = opts.target;
  fs.mkdirSync(target, { recursive: true });

  if (opts.fresh && fs.existsSync(path.join(target, '.aza'))) {
    fs.rmSync(path.join(target, '.aza'), { recursive: true, force: true });
  }

  const cursorDir = path.join(target, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });

  const mcpPath = path.join(cursorDir, 'mcp.json');
  fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig(opts.mode, opts.autoApprove), null, 2) + '\n', 'utf8');

  const rulesN = copyDirFiles(
    path.join(TEMPLATES, 'rules'),
    path.join(cursorDir, 'rules'),
    (f) => f.endsWith('.mdc') || f.endsWith('.md'),
  );
  // continue.md also as reference
  if (fs.existsSync(path.join(TEMPLATES, 'continue.md'))) {
    copyFile(path.join(TEMPLATES, 'continue.md'), path.join(cursorDir, 'continue.md'));
  }
  const cmdN = copyDirFiles(path.join(TEMPLATES, 'commands'), path.join(cursorDir, 'commands'));
  const hookN = copyDirFiles(path.join(TEMPLATES, 'hooks'), path.join(cursorDir, 'hooks'));

  ensureAza(target);
  const prompt = writePrompt(target);

  // minimal package if missing
  const pkg = path.join(target, 'package.json');
  if (!fs.existsSync(pkg)) {
    fs.writeFileSync(
      pkg,
      JSON.stringify(
        {
          name: path.basename(target),
          private: true,
          type: 'module',
          scripts: { test: 'vitest run' },
          devDependencies: { vitest: '^3.0.0', typescript: '^5.0.0' },
        },
        null,
        2,
      ) + '\n',
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        target,
        mode: opts.mode,
        mcp: mcpPath,
        rules: rulesN,
        commands: cmdN,
        hooks: hookN,
        prompt,
        next: [
          'Open this folder in Cursor',
          'Settings → MCP → enable azaloop (should list 8 tools)',
          'New Agent chat → paste AZA-CURSOR-PROMPT.md',
        ],
      },
      null,
      2,
    ),
  );
}

main();
