import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { execSync } from 'child_process';

const BANNER = `
  ╔══════════════════════════════════════════╗
  ║        AzaLoop Setup Wizard              ║
  ║  One-click guided installation & config  ║
  ╚══════════════════════════════════════════╝
`;

const CLIENTS = [
  { name: 'cursor',         tier: 'T1', desc: 'Cursor AI Editor' },
  { name: 'claude-code',    tier: 'T1', desc: 'Claude Code (CLI)' },
  { name: 'opencode',       tier: 'T1', desc: 'OpenCode (CLI)' },
  { name: 'trae',           tier: 'T1', desc: 'Trae (字节跳动)' },
  { name: 'vscode',         tier: 'T2', desc: 'VS Code + Copilot Chat' },
  { name: 'windsurf',       tier: 'T2', desc: 'Windsurf Editor' },
  { name: 'cline',          tier: 'T2', desc: 'Cline (VS Code ext)' },
  { name: 'roo-code',       tier: 'T2', desc: 'Roo Code (VS Code ext)' },
  { name: 'continue',       tier: 'T2', desc: 'Continue.dev' },
  { name: 'github-copilot', tier: 'T2', desc: 'GitHub Copilot Chat' },
  { name: 'claude-desktop', tier: 'T2', desc: 'Claude Desktop App' },
  { name: 'gemini-cli',     tier: 'T2', desc: 'Gemini CLI (Google)' },
  { name: 'codex-cli',      tier: 'T2', desc: 'Codex CLI (OpenAI)' },
  { name: 'comate',         tier: 'T2', desc: 'Comate (百度)' },
  { name: 'workbuddy',      tier: 'T2', desc: 'Workbuddy (字节)' },
  { name: 'qwen-code',      tier: 'T2', desc: 'Qwen Code (阿里)' },
  { name: 'aider',          tier: 'T3', desc: 'Aider (CLI)' },
  { name: 'zed',            tier: 'T3', desc: 'Zed Editor' },
  { name: 'goose',          tier: 'T3', desc: 'Goose' },
  { name: 'hermes',         tier: 'T3', desc: 'Hermes' },
  { name: 'openclaw',       tier: 'T3', desc: 'OpenClaw' },
  { name: 'kiro',           tier: 'T3', desc: 'Kiro' },
  { name: 'codeium',        tier: 'T3', desc: 'Codeium' },
  { name: 'droid',          tier: 'T3', desc: 'Droid' },
  { name: 'openhands',      tier: 'T3', desc: 'OpenHands' },
];

function ask(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(query, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function selectClient(): Promise<string> {
  console.log('\n  Select your AI coding assistant:\n');
  const tiers = ['T1', 'T2', 'T3'] as const;
  let index = 1;
  const clientMap = new Map<string, string>();

  for (const tier of tiers) {
    const tierClients = CLIENTS.filter(c => c.tier === tier);
    if (tierClients.length === 0) continue;
    console.log(`  ── Tier ${tier} ──`);
    for (const c of tierClients) {
      console.log(`    ${String(index).padEnd(3)} ${c.name.padEnd(18)} ${c.desc}`);
      clientMap.set(String(index), c.name);
      index++;
    }
  }

  console.log('');
  const choice = await ask('  Enter number (or client name): ');
  if (clientMap.has(choice)) return clientMap.get(choice)!;

  const byName = CLIENTS.find(c => c.name === choice.toLowerCase().trim());
  if (byName) return byName.name;

  console.log(`  ⚠ Invalid choice, using auto-detect.`);
  return 'auto';
}

async function checkPrerequisites(): Promise<boolean> {
  console.log('\n  ── Checking prerequisites ──\n');

  try {
    const nodeVer = execSync('node --version', { encoding: 'utf8' }).trim();
    console.log(`  ✓ Node.js ${nodeVer}`);
    const major = parseInt((nodeVer.match(/\d+/) || ['18'])[0]);
    if (major < 18) {
      console.log('  ✗ Need Node.js 18+. Please upgrade.');
      return false;
    }
  } catch {
    console.log('  ✗ Node.js not found. Install from https://nodejs.org');
    return false;
  }

  return true;
}

async function checkExistingConfig(root: string): Promise<string[]> {
  const issues: string[] = [];
  const checkFiles = [
    { path: '.aza/STATE.yaml', label: 'AzaLoop state file' },
    { path: '.opencode/mcp.json', label: 'OpenCode MCP config' },
    { path: '.cursor/mcp.json', label: 'Cursor MCP config' },
    { path: '.claude/mcp.json', label: 'Claude Code MCP config' },
    { path: '.trae/mcp.json', label: 'Trae MCP config' },
    { path: 'cline_mcp_settings.json', label: 'Cline MCP config' },
  ];

  for (const check of checkFiles) {
    try {
      await fs.access(path.join(root, check.path));
      issues.push(`  ✓ ${check.label} — found`);
    } catch {
      issues.push(`  ○ ${check.label} — not configured`);
    }
  }
  return issues;
}

export async function setupCommand(options: { root?: string; auto?: boolean } = {}): Promise<void> {
  const root = options.root || process.cwd();
  console.log(BANNER);

  // Step 1: Prerequisites
  console.log('  [1/4] Checking environment...');
  const prereqsOk = await checkPrerequisites();
  if (!prereqsOk) {
    console.log('\n  ❌ Setup failed. Please fix the issues above and try again.\n');
    return;
  }

  // Step 2: Client selection
  console.log('\n  [2/4] Detecting AI coding assistant...');
  let clientName = 'auto';
  if (!options.auto) {
    const selected = await selectClient();
    if (selected !== 'auto') clientName = selected;
  }

  if (clientName === 'auto') {
    console.log('  Using auto-detect...');
  } else {
    console.log(`  Selected: ${clientName}`);
  }

  // Step 3: Check existing config
  console.log('\n  [3/4] Checking existing configuration...');
  const issues = await checkExistingConfig(root);
  for (const issue of issues) {
    console.log(issue);
  }

  const hasConfig = issues.some(i => i.startsWith('  ✓'));
  const needsInit = issues.some(i => i.includes('not configured'));

  if (hasConfig && !needsInit) {
    console.log('\n  ✅ AzaLoop is already configured!');
    if (!options.auto) {
      const reconf = await ask('\n  Reconfigure? (y/N): ');
      if (reconf.toLowerCase() !== 'y') {
        console.log('\n  👍 No changes made.\n');
        return;
      }
    }
  }

  // Step 4: Initialize
  console.log('\n  [4/4] Initializing AzaLoop...\n');

  const { initCommand } = await import('./init');
  await initCommand({
    client: clientName !== 'auto' ? clientName : undefined,
    root,
    yes: options.auto,
  });

  // Post-setup tips
  console.log(`
  ── Quick Tips ──

  ✅ Setup complete! Next steps:

  1. Open this project in your AI coding assistant
  2. Type your requirements:
     "Create a React + TypeScript todo app with dark mode"

  3. AzaLoop will auto-execute:
     session_start → PRD generation → 5-stage loop → delivery

  📖  Documentation: docs/CLIENT-INSTALLATION.md
  🔧  Try:          aza status (check project state)
  🚀  Troubleshoot:  aza health (verify MCP connection)
  `);
}