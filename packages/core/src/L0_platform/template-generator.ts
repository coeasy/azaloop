import type { ClientInfo } from './client-detection';

const CONTINUE_RULES = `# AzaLoop Auto-continue Rules (MANDATORY — Execute on session start)

1. Call aza_session_start to initialize the system
2. Call aza_context calibrate to load current state
3. Call aza_conventions list to load learned conventions
4. If .aza/RESUME.md exists: call aza_loop next with current_story from RESUME
5. If no RESUME.md: ask user requirements → call aza_prd generate
6. Always follow the next_action chain from MCP tool responses
7. On cross-session recovery: call aza_memory query to get relevant history
`;

export interface ClientTemplate {
  client: string;
  files: Array<{ path: string; content: string }>;
}

type ConfigFormat = 'mcpServers' | 'mcp.servers' | 'mcpServers[]';

interface ClientConfig {
  configDir: string;
  mcpFile?: string;
  rulesFile?: string;
  continueFile?: string;
  hooksDir?: string;
  format?: ConfigFormat;
}

const CLIENT_CONFIGS: Record<string, ClientConfig> = {
  opencode:     { configDir: '.opencode',   mcpFile: 'mcp.json', rulesFile: 'rules.md', continueFile: 'continue.md' },
  cursor:       { configDir: '.cursor',      mcpFile: 'mcp.json', rulesFile: 'rules/azaloop.mdc', continueFile: 'rules/continue.mdc', hooksDir: 'hooks' },
  'claude-code':{ configDir: '.claude',      mcpFile: 'mcp.json', rulesFile: 'CLAUDE.md', continueFile: 'continue.md' },
  'claude-desktop': { configDir: '.',        mcpFile: 'claude_desktop_config.json', continueFile: 'continue.md' },
  trae:         { configDir: '.trae',        mcpFile: 'mcp.json', rulesFile: 'rules.md', continueFile: 'rules/continue.md' },
  windsurf:     { configDir: '.windsurf',    mcpFile: 'mcp.json', rulesFile: 'rules/azaloop.md', continueFile: 'rules/continue.md' },
  vscode:       { configDir: '.vscode',      mcpFile: 'mcp.json', rulesFile: 'settings.json', continueFile: 'continue.md' },
  'github-copilot': { configDir: '.github',  mcpFile: 'mcp.json', rulesFile: 'copilot-instructions.md', continueFile: 'continue.md' },
  cline:        { configDir: '.',            mcpFile: 'cline_mcp_settings.json', rulesFile: '.clinerules' },
  'roo-code':   { configDir: '.roo',         mcpFile: 'mcp.json', rulesFile: 'azaloop.md' },
  continue:     { configDir: '.continue',     mcpFile: 'config.json', rulesFile: '.continuerules', format: 'mcpServers[]' },
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

export class TemplateGenerator {
  generate(client: ClientInfo): ClientTemplate {
    const files: ClientTemplate['files'] = [];
    const cfg = CLIENT_CONFIGS[client.name];
    if (!cfg) {
      files.push({
        path: `azaloop-${client.name}-rules.md`,
        content: CONTINUE_RULES,
      });
      return { client: client.name, files };
    }

    // Rules file
    if (cfg.rulesFile) {
      files.push({
        path: pathJoin(cfg.configDir, cfg.rulesFile),
        content: this.generateRules(client),
      });
    }

    // Continue file (separate from rules if specified)
    if (cfg.continueFile && cfg.continueFile !== cfg.rulesFile) {
      files.push({
        path: pathJoin(cfg.configDir, cfg.continueFile),
        content: CONTINUE_RULES,
      });
    }

    // MCP config
    if (cfg.mcpFile) {
      files.push({
        path: pathJoin(cfg.configDir, cfg.mcpFile),
        content: JSON.stringify(this.generateMCPConfig(client.name, cfg.format), null, 2),
      });
    }

    return { client: client.name, files };
  }

  private generateRules(client: ClientInfo): string {
    const eng = client.name !== 'opencode' && client.name !== 'trae' && client.name !== 'comate' && client.name !== 'qwen-code' && client.name !== 'workbuddy';
    if (eng) {
      return [
        '# AzaLoop Development Rules',
        '',
        `You are running AzaLoop in **${client.name}** (${client.tier} tier).`,
        '',
        '## Session Start (MANDATORY)',
        '1. Call `aza_session_start` to initialize the system',
        '2. Call `aza_context calibrate` to load current state',
        '3. Call `aza_conventions list` to load learned conventions',
        '',
        '## Auto-Loop (MANDATORY)',
        'Always follow the `next_action` chain from MCP tool responses. Do NOT skip.',
        '',
        '## 5-Stage Pipeline',
        '1. **open** — aza_prd_generate → aza_prd_validate',
        '2. **design** — aza_task_design',
        '3. **build** — TDD: test first → aza_task_implement',
        '4. **verify** — aza_quality_check (5 gates: lint, test, build, security, acceptance)',
        '5. **archive** — aza_doc_generate → aza_conventions_extract',
        '',
        '## Quality Rules',
        '- TypeScript must compile',
        '- All tests must pass',
        '- No critical security findings',
        '- Acceptance criteria documented & met',
        '',
        '## Memory',
        'Record significant decisions via aza_memory_record.',
        'On session start, call aza_memory_query for relevant past experiences.',
        '',
      ].join('\n');
    }
    return [
      '# AzaLoop 开发规则',
      '',
      `你在 ${client.name} 中运行 AzaLoop（${client.tier} 级）。`,
      '',
      '## 会话启动（MANDATORY）',
      '1. 调用 `aza_session_start` 初始化系统',
      '2. 调用 `aza_context calibrate` 获取当前上下文',
      '3. 调用 `aza_conventions list` 加载已学约定',
      '',
      '## 五阶段流水线',
      '1. **open** — aza_prd_generate → aza_prd_validate',
      '2. **design** — aza_task_design',
      '3. **build** — TDD 铁律（先测试后实现）→ aza_task_implement',
      '4. **verify** — aza_quality_check（五级门禁：lint、test、build、security、acceptance）',
      '5. **archive** — aza_doc_generate → aza_conventions_extract',
      '',
      '## 全自动循环（MANDATORY）',
      '必须始终跟随 next_action 链，不得跳过任意步骤。',
      '',
      '## 质量规则',
      '- TypeScript 编译必须通过',
      '- 所有测试必须通过',
      '- 无严重安全漏洞',
      '- 验收标准已编写并满足',
      '',
      '## 记忆',
      '通过 aza_memory_record 记录重要决策。',
      '会话启动时调用 aza_memory_query 获取相关经验。',
      '',
    ].join('\n');
  }

  private generateMCPConfig(clientName: string, format?: ConfigFormat): object {
    const serverEntry = {
      command: 'npx',
      args: ['@azaloop/mcp-server'],
    };

    if (format === 'mcpServers[]') {
      return {
        mcpServers: [
          {
            name: 'azaloop',
            ...serverEntry,
            env: {},
          },
        ],
      };
    }

    if (clientName === 'cline') {
      return {
        mcpServers: {
          azaloop: {
            ...serverEntry,
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

    return {
      mcpServers: {
        azaloop: {
          ...serverEntry,
          env: {},
        },
      },
    };
  }
}

function pathJoin(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}
