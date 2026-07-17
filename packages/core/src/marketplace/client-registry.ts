/**
 * R10 第11轮 (P6 客户端市场) — Marketplace 客户端模板发布器。
 *
 * 借鉴 ai-coding-guide「客户端选择指南」+ 「marketplace registry」+ spec-kit「adapter layer」：
 *
 * 痛点：AzaLoop 4 T1 客户端（cursor/trae/opencode/claude-code）已认证，但
 *       25+ 客户端覆盖度靠手工维护 docs/clients/<name>.md。
 *
 * 解法：把 marketplace 抽象为：
 *   1. Registry: 客户单模板元数据（name/category/requiredVars/setup/install）
 *   2. Renderer: 从 registry 渲染 docs/clients/<name>.md
 *   3. Publisher: 把 client + middleware 配置打进 packages/mcp-server/dist/clients/<name>.json
 *   4. Verifier: 检查 marketplace 声明与 docs/clients 是否一致
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ClientCategory = 'ide' | 'cli' | 'web' | 'desktop' | 'cloud';

export interface ClientTemplate {
  id: string;                    // 'cursor'
  name: string;                  // 'Cursor'
  category: ClientCategory;
  /** 是否 T1（必认证） */
  tier1: boolean;
  /** 必需环境变量列表 */
  requiredEnv: string[];
  /** 安装步骤（参考 ai-coding-guide 模板） */
  install: string[];
  /** 启动命令模板 */
  launchCmd: string;
  /** 该客户端推荐的 next_action fallback 工具 */
  primaryTools: string[];
  /** 已知限制 */
  limitations: string[];
  /** 显示版本 */
  since: string;
}

const REGISTRY: readonly ClientTemplate[] = [
  {
    id: 'cursor', name: 'Cursor', category: 'ide', tier1: true,
    requiredEnv: ['AZA_CLIENT_NAME=cursor', 'AZA_CLIENT_VERSION'],
    install: [
      '1. 安装 Cursor IDE (cursor.com)',
      '2. 安装 AzaLoop MCP server: pnpm add -g @azaloop/mcp-server',
      '3. 在 Cursor 设置 → Features → Model Context Protocol 添加 server',
      '4. 配置 stdio 启动: aza mcp serve',
    ],
    launchCmd: 'aza mcp serve --client cursor',
    primaryTools: ['aza_session', 'aza_prd', 'aza_auto', 'aza_loop', 'aza_meta'],
    limitations: ['Composer 不响应 next_action，需手动复制', '没有 terminal 写入能力时降级到 file_write'],
    since: '0.1.0',
  },
  {
    id: 'trae', name: 'Trae', category: 'ide', tier1: true,
    requiredEnv: ['AZA_CLIENT_NAME=trae', 'AZA_CLIENT_VERSION'],
    install: [
      '1. 安装 Trae (trae.ai)',
      '2. pnpm add -g @azaloop/mcp-server',
      '3. 在 Trae AI 助手设置 → MCP Server 添加',
      '4. 配置 aza mcp serve --client trae',
    ],
    launchCmd: 'aza mcp serve --client trae',
    primaryTools: ['aza_session', 'aza_prd', 'aza_auto', 'aza_loop', 'aza_meta'],
    limitations: ['部分 next_action 需 ai run 显式调用'],
    since: '0.1.0',
  },
  {
    id: 'opencode', name: 'OpenCode', category: 'cli', tier1: true,
    requiredEnv: ['AZA_CLIENT_NAME=opencode', 'AZA_CLIENT_VERSION'],
    install: [
      '1. 编译 opencode (github.com/sst/opencode)',
      '2. 配置 ~/.opencode/config.yaml 加入 aza mcp serve',
      '3. 命令: opencode --mcp-server aza',
    ],
    launchCmd: 'opencode --mcp-server "aza mcp serve"',
    primaryTools: ['aza_session', 'aza_prd', 'aza_auto', 'aza_loop', 'aza_meta'],
    limitations: ['CLI 模式需要更多手动控制'],
    since: '0.1.0',
  },
  {
    id: 'claude-code', name: 'Claude Code', category: 'cli', tier1: true,
    requiredEnv: ['AZA_CLIENT_NAME=claude-code', 'ANTHROPIC_API_KEY'],
    install: [
      '1. 安装 Claude Code (npm i -g @anthropic-ai/claude-code)',
      '2. 配置 ~/.claude/mcp.json 加入 aza mcp serve',
      '3. claude --mcp-server aza',
    ],
    launchCmd: 'claude --mcp-server "aza mcp serve"',
    primaryTools: ['aza_session', 'aza_prd', 'aza_auto', 'aza_loop', 'aza_meta'],
    limitations: ['仅支持 stdio MCP'],
    since: '0.1.0',
  },
  // T2 客户端（experimental 模板）
  { id: 'windsurf', name: 'Windsurf', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=windsurf'], install: ['安装 Windsurf → MCP → aza mcp serve'], launchCmd: 'aza mcp serve --client windsurf', primaryTools: ['aza_session', 'aza_auto', 'aza_loop'], limitations: ['MCP 支持较新'], since: '0.1.1' },
  { id: 'cline', name: 'Cline', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=cline'], install: ['VSCode + Cline 扩展 + 配置 mcpServers'], launchCmd: 'claude-code --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['依赖 VSCode'], since: '0.1.1' },
  { id: 'aider', name: 'Aider', category: 'cli', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=aider'], install: ['pip install aider-chat + 配置 --mcp-server'], launchCmd: 'aider --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['CLI 模式'], since: '0.1.1' },
  { id: 'continue', name: 'Continue', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=continue'], install: ['VSCode + Continue + config.yaml'], launchCmd: 'continue --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['依赖 VSCode'], since: '0.1.1' },
  { id: 'zed', name: 'Zed', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=zed'], install: ['Zed + extension + mcp 配置'], launchCmd: 'zed --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['MCP 实验阶段'], since: '0.1.1' },
  { id: 'roo-code', name: 'Roo Code (Cline fork)', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=roo-code'], install: ['VSCode + Roo Code + mcpServers'], launchCmd: 'claude-code --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['VSCode 依赖'], since: '0.1.1' },
  // T2 客户端（experimental 模板，第二批）
  { id: 'gemini-cli', name: 'Gemini CLI', category: 'cli', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=gemini-cli', 'GOOGLE_API_KEY'], install: ['npm i -g @google/gemini-cli', '配置 ~/.gemini/settings.json 加入 mcpServers'], launchCmd: 'gemini --mcp-server aza', primaryTools: ['aza_session', 'aza_auto', 'aza_loop'], limitations: ['MCP 实验阶段'], since: '0.1.2' },
  { id: 'github-copilot', name: 'GitHub Copilot', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=github-copilot', 'GH_TOKEN'], install: ['VSCode + Copilot Chat 扩展 + 启用 MCP 协议'], launchCmd: 'copilot --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['MCP 协议需 Copilot Chat ≥ 0.18'], since: '0.1.2' },
  { id: 'claude-desktop', name: 'Claude Desktop', category: 'desktop', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=claude-desktop', 'ANTHROPIC_API_KEY'], install: ['安装 Claude Desktop (claude.com/download)', '编辑 claude_desktop_config.json 加入 mcpServers'], launchCmd: 'claude-desktop --mcp-server aza', primaryTools: ['aza_session', 'aza_auto', 'aza_loop'], limitations: ['仅 macOS/Windows'], since: '0.1.2' },
  { id: 'comate', name: 'Comate (百度文心)', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=comate'], install: ['VSCode/IntelliJ 安装 Comate 扩展', '启用 MCP 模式'], launchCmd: 'comate --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['国内 LLM 接入', 'MCP 适配需 ≥ 3.2'], since: '0.1.2' },
  { id: 'qwen-code', name: 'Qwen Code (通义灵码)', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=qwen-code', 'DASHSCOPE_API_KEY'], install: ['VSCode/JetBrains 安装 Lingma 扩展', '切换 Qwen Code 模式'], launchCmd: 'qwen-code --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['国内 token 走 DashScope'], since: '0.1.2' },
  { id: 'openhands', name: 'OpenHands', category: 'cloud', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=openhands', 'OPENHANDS_API_KEY'], install: ['docker pull allhandsai/openhands', '配置 runtime 挂载 aza mcp'], launchCmd: 'openhands --mcp-server "aza mcp serve"', primaryTools: ['aza_session', 'aza_auto', 'aza_loop', 'aza_meta'], limitations: ['云端 runtime', '需 Docker'], since: '0.1.2' },
  { id: 'droid', name: 'Droid (Factory)', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=droid'], install: ['factory.ai 安装 Droid 扩展', '配置 MCP server'], launchCmd: 'droid --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['macOS only'], since: '0.1.2' },
  { id: 'goose', name: 'Goose (Block)', category: 'cli', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=goose'], install: ['pip install goose-ai', '配置 ~/.config/goose/config.yaml'], launchCmd: 'goose session --with-mcp aza', primaryTools: ['aza_session', 'aza_auto', 'aza_loop'], limitations: ['CLI 模式'], since: '0.1.2' },
  { id: 'kiro', name: 'Kiro', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=kiro'], install: ['VSCode 安装 Kiro 扩展', '配置 mcpServers'], launchCmd: 'kiro --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['MCP 实验阶段'], since: '0.1.2' },
  { id: 'hermes', name: 'Hermes (Nous Research)', category: 'cli', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=hermes', 'NOUS_API_KEY'], install: ['pip install hermes-agent', '配置 ~/.hermes/mcp.json'], launchCmd: 'hermes --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['CLI 模式'], since: '0.1.2' },
  { id: 'workbuddy', name: 'Workbuddy', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=workbuddy'], install: ['VSCode 安装 Workbuddy 扩展', '配置 mcpServers'], launchCmd: 'workbuddy --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['团队版限制'], since: '0.1.2' },
  { id: 'vscode', name: 'VSCode (Continue/Copilot)', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=vscode'], install: ['VSCode + Continue 或 Copilot + mcpServers'], launchCmd: 'code --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['依赖扩展'], since: '0.1.2' },
  { id: 'codex-cli', name: 'Codex CLI (OpenAI)', category: 'cli', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=codex-cli', 'OPENAI_API_KEY'], install: ['npm i -g @openai/codex', '配置 ~/.codex/config.toml'], launchCmd: 'codex --mcp-server aza', primaryTools: ['aza_session', 'aza_auto', 'aza_loop'], limitations: ['CLI 模式'], since: '0.1.2' },
  { id: 'codeium', name: 'Codeium', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=codeium'], install: ['VSCode/IntelliJ 安装 Codeium 扩展', '启用 Cascade'], launchCmd: 'codeium --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['MCP 适配需 ≥ 1.5'], since: '0.1.2' },
  { id: 'openclaw', name: 'OpenClaw', category: 'ide', tier1: false, requiredEnv: ['AZA_CLIENT_NAME=openclaw'], install: ['OpenClaw 桌面 + 配置 MCP'], launchCmd: 'openclaw --mcp-server aza', primaryTools: ['aza_session', 'aza_loop'], limitations: ['实验性'], since: '0.1.2' },
];

export function listMarketplace(): readonly ClientTemplate[] {
  return REGISTRY;
}

export function getClientTemplate(id: string): ClientTemplate | undefined {
  return REGISTRY.find((c) => c.id === id);
}

export function listTier1(): readonly ClientTemplate[] {
  return REGISTRY.filter((c) => c.tier1);
}

/**
 * 把单个 client 渲染为 Markdown。
 */
export function renderClientMarkdown(t: ClientTemplate): string {
  const lines: string[] = [];
  lines.push(`# ${t.name} (\`${t.id}\`)`);
  lines.push('');
  lines.push(`> Tier1: ${t.tier1 ? '✅' : '⚪ experimental'} | Category: ${t.category} | Since: ${t.since}`);
  lines.push('');
  lines.push(`## 环境变量`);
  lines.push('');
  for (const env of t.requiredEnv) lines.push(`- \`${env}\``);
  lines.push('');
  lines.push(`## 安装步骤`);
  lines.push('');
  for (const step of t.install) lines.push(`- ${step}`);
  lines.push('');
  lines.push(`## 启动命令`);
  lines.push('');
  lines.push('```bash');
  lines.push(t.launchCmd);
  lines.push('```');
  lines.push('');
  lines.push(`## 推荐工具`);
  lines.push('');
  for (const tool of t.primaryTools) lines.push(`- \`${tool}\``);
  lines.push('');
  if (t.limitations.length > 0) {
    lines.push(`## 已知限制`);
    lines.push('');
    for (const l of t.limitations) lines.push(`- ${l}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 渲染完整 marketplace index。
 */
export function renderMarketplaceIndex(): string {
  const lines: string[] = [];
  lines.push('# AzaLoop 客户端 Marketplace');
  lines.push('');
  lines.push('> 全部 client 模板从此 registry 自动生成。');
  lines.push('');
  lines.push(`| 客户端 | Tier1 | Category | 启动 |`);
  lines.push(`|--------|-------|----------|------|`);
  for (const t of REGISTRY) {
    const tier = t.tier1 ? '✅' : '⚪';
    lines.push(`| [${t.name}](docs/clients/${t.id}.md) | ${tier} | ${t.category} | \`${t.launchCmd}\` |`);
  }
  return lines.join('\n') + '\n';
}

/**
 * 落盘：把 registry 渲染到 docs/clients/。
 */
export function publishMarketplace(root: string = process.cwd()): { written: string[]; failed: string[] } {
  const outDir = path.join(root, 'docs', 'clients');
  fs.mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  const failed: string[] = [];
  for (const t of REGISTRY) {
    const outPath = path.join(outDir, `${t.id}.md`);
    try {
      fs.writeFileSync(outPath, renderClientMarkdown(t), 'utf8');
      written.push(outPath);
    } catch (err) {
      failed.push(`${t.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Index
  const indexPath = path.join(root, 'docs', 'CLIENTS.md');
  fs.writeFileSync(indexPath, renderMarketplaceIndex(), 'utf8');
  written.push(indexPath);

  // Manifest (machine-readable)
  const manifestPath = path.join(root, 'docs', 'marketplace.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    clients: REGISTRY,
    summary: {
      total: REGISTRY.length,
      tier1: REGISTRY.filter((c) => c.tier1).length,
      byCategory: REGISTRY.reduce<Record<string, number>>((acc, c) => {
        acc[c.category] = (acc[c.category] ?? 0) + 1;
        return acc;
      }, {}),
    },
  }, null, 2), 'utf8');
  written.push(manifestPath);
  return { written, failed };
}

/**
 * 验证 marketplace 与 docs/clients/ 一致性。
 */
export function verifyMarketplaceConsistency(root: string = process.cwd()): {
  total: number;
  consistent: number;
  missing: string[];
  extra: string[];
} {
  const docsDir = path.join(root, 'docs', 'clients');
  const onDisk = fs.existsSync(docsDir) ? fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')) : [];
  const declared = REGISTRY.map((c) => `${c.id}.md`);
  const missing = declared.filter((d) => !onDisk.includes(d));
  const extra = onDisk.filter((o) => !declared.includes(o));
  return {
    total: declared.length,
    consistent: declared.length - missing.length,
    missing,
    extra,
  };
}
