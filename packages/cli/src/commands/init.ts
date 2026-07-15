import { detectClient, getClient, getAllClients } from '@azaloop/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as fsSync from 'fs';
import { normalizeCliPath } from '../util/path';

export interface InitOptions {
  client?: string;
  root?: string;
  yes?: boolean;
}

const CLIENT_CONFIGS: Record<string, {
  configDir: string;
  mcpFile?: string;
  rulesFile?: string;
  hooksDir?: string;
  instructionsFile?: string;
  agentFile?: string;
}> = {
  opencode:     { configDir: '.opencode',   mcpFile: 'mcp.json', rulesFile: 'rules.md' },
  cursor:       { configDir: '.cursor',      mcpFile: 'mcp.json', rulesFile: 'rules/azaloop.mdc', hooksDir: 'hooks' },
  'claude-code':{ configDir: '.claude',      mcpFile: 'mcp.json', rulesFile: 'CLAUDE.md', agentFile: 'agents/azaloop.json' },
  'claude-desktop': { configDir: '.',        mcpFile: 'claude_desktop_config.json' },
  trae:         { configDir: '.trae',        mcpFile: 'mcp.json', rulesFile: 'rules.md' },
  windsurf:     { configDir: '.windsurf',    mcpFile: 'mcp.json', rulesFile: 'rules/azaloop.md' },
  vscode:       { configDir: '.vscode',      mcpFile: 'mcp.json', rulesFile: 'settings.json' },
  'github-copilot': { configDir: '.github',  mcpFile: 'mcp.json', instructionsFile: 'copilot-instructions.md' },
  cline:        { configDir: '.',            mcpFile: 'cline_mcp_settings.json', rulesFile: '.clinerules' },
  'roo-code':   { configDir: '.roo',         mcpFile: 'mcp.json', rulesFile: 'azaloop.md' },
  continue:     { configDir: '.continue',     mcpFile: 'config.json', rulesFile: '.continuerules' },
  zed:          { configDir: '.zed',          mcpFile: 'mcp.json' },
  aider:        { configDir: '.',             rulesFile: 'CONVENTIONS.md' },
  goose:        { configDir: '.',             mcpFile: 'mcp.json' },
  'gemini-cli': { configDir: '.gemini',      mcpFile: 'mcp.json', rulesFile: 'rules.md' },
  'codex-cli':  { configDir: '.',            mcpFile: 'mcp.json', rulesFile: 'AGENTS.md' },
  comate:       { configDir: '.comate',      mcpFile: 'mcp.json', rulesFile: 'rules.md' },
  workbuddy:    { configDir: '.workbuddy',   mcpFile: 'mcp.json', rulesFile: 'rules.md' },
  kiro:         { configDir: '.kiro',         mcpFile: 'mcp.json', rulesFile: 'azaloop.md' },
  'qwen-code':  { configDir: '.qwen',        mcpFile: 'mcp.json', rulesFile: 'rules.md' },
  droid:        { configDir: '.droid',        mcpFile: 'mcp.json' },
  codeium:      { configDir: '.codeium',      mcpFile: 'mcp.json' },
  openhands:    { configDir: '.openhands',    mcpFile: 'mcp.json', rulesFile: 'instructions.md' },
  hermes:       { configDir: '.hermes',       mcpFile: 'mcp.json', rulesFile: 'skills/aza-loop.md' },
  openclaw:     { configDir: '.',             mcpFile: 'mcp.json', rulesFile: 'clawhub.json' },
};

function mcpConfigJson(): object {
  return {
    mcpServers: {
      azaloop: {
        command: 'npx',
        args: ['-y', '@azaloop/mcp-server'],
        env: {
          AZA_AUTO_APPROVE_PRD: 'true',
        },
      },
    },
  };
}

function vscodeSettingsJson(): object {
  return {
    'mcp.enabled': true,
    'mcp.servers': {
      azaloop: {
        command: 'npx',
        args: ['@azaloop/mcp-server'],
      },
    },
    'chat.mcpTools': true,
  };
}

function claudeDesktopConfigJson(): object {
  return {
    mcpServers: {
      azaloop: {
        command: 'npx',
        args: ['@azaloop/mcp-server'],
        env: {},
      },
    },
  };
}

function clineSettingsJson(): object {
  return {
    mcpServers: {
      azaloop: {
        command: 'npx',
        args: ['@azaloop/mcp-server'],
        disabled: false,
        autoApprove: [
          'aza_prd_generate',
          'aza_loop_next',
          'aza_loop_status',
          'aza_quality_check',
        ],
      },
    },
  };
}

function continueConfigJson(): object {
  return {
    mcpServers: [
      {
        name: 'azaloop',
        command: 'npx',
        args: ['@azaloop/mcp-server'],
        env: {},
      },
    ],
  };
}

function rulesContent(clientName: string): string {
  const eng = clientName !== 'opencode' && clientName !== 'trae' && clientName !== 'comate' && clientName !== 'qwen-code' && clientName !== 'workbuddy';
  if (eng) {
    return `# AzaLoop Development Rules

You are running AzaLoop in **${clientName}**.

## Session Start (MANDATORY)
1. Call \`aza_session(action=calibrate)\` (or continue if RESUME.md exists)
2. Follow \`next_action\` from every MCP response — do not ask the user to click Continue

## Unified tools (exactly 8)
\`aza_session\` · \`aza_prd\` · \`aza_loop\` · \`aza_spec\` · \`aza_quality\` · \`aza_finish\` · \`aza_memory\` · \`aza_meta\`

## Auto-Loop (MANDATORY)
\`aza_prd(review)\` → approve → \`aza_loop(full)\` → execute awaitingAction (\`aza_spec\`/\`aza_quality\`) → \`aza_loop(report_tool)\` → \`aza_finish(ship)\`

## 5-Stage Pipeline
1. **open** — aza_prd review/approve
2. **design** — aza_spec design
3. **build** — TDD → aza_spec implement
4. **verify** — aza_quality check (gates)
5. **archive** — aza_finish ship/archive

## Quality Gates
- TypeScript compilation must pass
- All tests must pass
- No critical security findings
- Acceptance criteria documented & met

## Memory
Record significant decisions via aza_memory(record).
`;
  }
  return `# AzaLoop — ${clientName} 开发规则

你在 ${clientName} 中运行 AzaLoop（PRD 驱动的自主开发循环引擎）。

## 会话启动（MANDATORY）
1. 调用 aza_session(action=calibrate)（若有 RESUME.md 则 continue）
2. 严格跟随 next_action，不要停下来问「是否继续」

## 统一工具面（恰好 8 个）
aza_session · aza_prd · aza_loop · aza_spec · aza_quality · aza_finish · aza_memory · aza_meta

## 全自动循环（MANDATORY）
aza_prd(review) → approve → aza_loop(full) → 执行 awaitingAction → aza_loop(report_tool) → aza_finish(ship)

## 五阶段流水线
- open: aza_prd review/approve
- design: aza_spec design
- build: TDD → aza_spec implement
- verify: aza_quality check
- archive: aza_finish ship

## 禁止
- 不得跳过 next_action 链
- 不得在测试通过前宣称完成
- 不得引入模拟流程
`;
}

function continueContent(clientName: string): string {
  const eng = clientName !== 'opencode' && clientName !== 'trae' && clientName !== 'comate' && clientName !== 'qwen-code' && clientName !== 'workbuddy';
  if (eng) {
    return `# AzaLoop Auto-Continue Rules

## Session Start (MANDATORY)
1. aza_session(calibrate|continue) — restore session
2. Check RESUME.md → aza_loop(full) to resume, or aza_prd(review) for new work

## Auto-Loop
aza_loop(full) → awaitingAction → host tool → aza_loop(report_tool) → … → aza_finish(ship)
`;
  }
  return `# AzaLoop 自动续跑规则（会话启动时首先执行）

## 会话启动（MANDATORY）
1. aza_session(calibrate|continue) — 恢复会话
2. 检查 RESUME.md → aza_loop(full) 续跑 或 aza_prd(review) 开新需求

## 全自动循环
aza_loop(full) → awaitingAction → 宿主工具 → aza_loop(report_tool) → … → aza_finish(ship)
`;
}

async function writeFileSafe(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function welcome(clientName: string): string {
  return [
    '',
    '  ╔══════════════════════════════════════════╗',
    '  ║           AzaLoop  v0.2.0                ║',
    '  ║  PRD-Driven Autonomous Development Loop  ║',
    '  ╚══════════════════════════════════════════╝',
    '',
    '  Detected client: ' + clientName,
    '',
  ].join('\n');
}

function usageHint(clientName: string): string {
  return [
    '',
    '  ── Next Steps ──',
    '',
    '  1. Open this project in ' + clientName,
    '  2. Enable MCP server "azaloop" (expect 8 tools)',
    '  3. Paste AZA-CURSOR-PROMPT.md or describe a feature',
    '  4. Follow next_action: session → prd → loop(full) → finish(ship)',
    '',
    '  📖 Cursor third-party guide: docs/CURSOR-THIRD-PARTY.md',
    '  📖 Full install docs:       docs/CLIENT-INSTALLATION.md',
    '',
  ].join('\n');
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const root = normalizeCliPath(options.root) || process.cwd();

  // ── Multi-client support: --client cursor,trae → init for each ──
  if (options.client && options.client.includes(',')) {
    const clients = options.client.split(',').map(c => c.trim()).filter(Boolean);
    console.log(`  Initializing for ${clients.length} clients: ${clients.join(', ')}\n`);
    for (const clientName of clients) {
      await initCommand({ ...options, client: clientName });
      console.log('');
    }
    return;
  }

  // ── Step 1: Detect or select client ──
  let client = options.client ? getClient(options.client) : detectClient();
  if (client.name === 'unknown' && !options.client) {
    console.log('  ⚠️  No known AI coding assistant detected.\n');
    const clients = getAllClients();
    for (const c of clients) {
      console.log(`     ${c.name.padEnd(16)} ${c.tier}`);
    }
    console.log('');
    console.log('  💡 Specify your client:');
    console.log('     aza init --client cursor');
    console.log('     aza init --client opencode');
    console.log('     aza init --client claude-code\n');
    return;
  }

  console.log(welcome(client.name));
  console.log(`  Initializing AzaLoop for ${client.name}...\n`);

  // ── Step 2: Create .aza directory ──
  const azaDir = path.join(root, '.aza');
  await fs.mkdir(azaDir, { recursive: true });
  // Use StateManager (not a hand-written template) so timestamps are
  // correctly quoted and the file always satisfies StateSchema — otherwise
  // js-yaml parses unquoted ISO timestamps into Date objects and
  // StateManager.load() throws on first `aza status`/`aza continue`.
  const { StateManager } = await import('@azaloop/core');
  const stateManager = new StateManager(azaDir);
  await stateManager.update({ loop: { client: client.name, model: 'unknown' } } as any);
  console.log('  ✓ .aza/STATE.yaml');

  await fs.writeFile(path.join(azaDir, 'RESUME.md'), '# AzaLoop Resume\n\nProject initialized.\n', 'utf8');
  console.log('  ✓ .aza/RESUME.md');

  await fs.writeFile(path.join(azaDir, 'run-state.json'), '{}', 'utf8');
  console.log('  ✓ .aza/run-state.json');

  // ── Step 3: Generate client config files ──
  const cfg = CLIENT_CONFIGS[client.name];
  if (!cfg) {
    console.log(`  ⚠️  ${client.name} 的配置模板未定义，跳过客户端配置文件生成`);
  } else {
    // MCP config
    if (cfg.mcpFile) {
      let content: string;
      if (client.name === 'vscode') {
        content = JSON.stringify(vscodeSettingsJson(), null, 2);
      } else if (client.name === 'claude-desktop') {
        content = JSON.stringify(claudeDesktopConfigJson(), null, 2);
      } else if (client.name === 'cline') {
        content = JSON.stringify(clineSettingsJson(), null, 2);
      } else if (client.name === 'continue') {
        content = JSON.stringify(continueConfigJson(), null, 2);
      } else {
        content = JSON.stringify(mcpConfigJson(), null, 2);
      }
      const mcpPath = path.join(root, cfg.configDir, cfg.mcpFile);
      const ok = await writeFileSafe(mcpPath, content + '\n');
      if (ok) {
        const rel = path.relative(root, mcpPath);
        console.log(`  ✓ ${rel}`);
      }
    }

    // Rules file — Cursor: prefer V17 template from packages templates
    if (cfg.rulesFile) {
      const rulesPath = path.join(root, cfg.configDir, cfg.rulesFile);
      let body = rulesContent(client.name);
      if (client.name === 'cursor') {
        const tmpl = path.join(__dirname, '..', '..', '..', '..', 'templates', 'clients', 'cursor', 'rules', 'azaloop.mdc');
        try {
          if (fsSync.existsSync(tmpl)) {
            body = await fs.readFile(tmpl, 'utf8');
          }
        } catch {
          /* keep generated body */
        }
      }
      const ok = await writeFileSafe(rulesPath, body);
      if (ok) {
        const rel = path.relative(root, rulesPath);
        console.log(`  ✓ ${rel}`);
      }
    }

    // Continue file (separate from rules, for session start flow)
    const continueFileName = client.name === 'opencode' ? 'continue.md'
      : client.name === 'cursor' ? 'rules/continue.mdc'
      : client.name === 'trae' ? 'rules/continue.md'
      : client.name === 'windsurf' ? 'rules/continue.md'
      : client.name === 'cline' ? '.clinerules'
      : 'continue.md';
    const continuePath = cfg.configDir === '.' || client.name === 'cline'
      ? (client.name === 'cline' ? path.join(root, '.clinerules') : path.join(root, continueFileName))
      : path.join(root, cfg.configDir, continueFileName);
    if (client.name === 'cline') {
      // .clinerules already written as rules, skip duplicate
    } else {
      const ok = await writeFileSafe(continuePath, continueContent(client.name));
      if (ok) {
        const rel = path.relative(root, continuePath);
        if (!rel.includes('.clinerules')) {
          console.log(`  ✓ ${rel}`);
        }
      }
    }
  }

  // ── Step 4: Verify MCP server ──
  console.log('\n  ── 验证 MCP 服务器 ──');
  try {
    const mcpPath = path.join(root, 'node_modules', '@azaloop', 'mcp-server', 'dist', 'server.js');
    const localMcpPath = path.join(__dirname, '..', '..', '..', 'mcp-server', 'dist', 'server.js');
    const serverPath = fsSync.existsSync(mcpPath) ? mcpPath
      : fsSync.existsSync(localMcpPath) ? localMcpPath
      : null;
    if (serverPath) {
      console.log('  ✓ MCP 服务器文件可用');
    } else {
      console.log('  ⚠️  未找到本地 MCP 服务器（全局安装后自动可用）');
    }
  } catch {
    console.log('  ⚠️  跳过验证（全局安装后 npx 会自动解析）');
  }

  // ── Done ──
  console.log(usageHint(client.name));
}
