import type { DegradationLevel } from './compensation-strategy';

export interface ClientInfo {
  name: string;
  tier: 'T1' | 'T2' | 'T3';
  rulesFile?: string;
  hasMCP: boolean;
  hasHooks: boolean;
  hasSkills: boolean;
  hasNativeLoop: boolean;
  /** Machine-readable client identifier (defaults to `name`). */
  id?: string;
  /** Directory where the client stores its configuration. */
  configDir?: string;
  /** MCP configuration file name used by this client. */
  mcpConfig?: string;
  /** Degradation tier this client falls into. */
  degradationLevel?: DegradationLevel;
}

const CLIENTS: ClientInfo[] = [
  { name: 'cursor', tier: 'T1', rulesFile: '.cursor/rules', hasMCP: true, hasHooks: true, hasSkills: true, hasNativeLoop: true },
  { name: 'claude-code', tier: 'T1', rulesFile: 'CLAUDE.md', hasMCP: true, hasHooks: true, hasSkills: true, hasNativeLoop: true },
  { name: 'trae', tier: 'T1', rulesFile: '.trae/rules', hasMCP: true, hasHooks: true, hasSkills: false, hasNativeLoop: true },
  { name: 'windsurf', tier: 'T1', rulesFile: '.windsurf/rules', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: true },
  { name: 'vscode', tier: 'T2', rulesFile: '.vscode/mcp.json', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false },
  { name: 'cline', tier: 'T2', rulesFile: '.clinerules', hasMCP: true, hasHooks: false, hasSkills: true, hasNativeLoop: true },
  { name: 'continue', tier: 'T2', rulesFile: '.continuerules', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false },
  { name: 'roo-code', tier: 'T2', rulesFile: '.roo/', hasMCP: true, hasHooks: false, hasSkills: true, hasNativeLoop: true },
  { name: 'kiro', tier: 'T2', rulesFile: '.kiro/', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false },
  { name: 'github-copilot', tier: 'T2', rulesFile: '.github/copilot-instructions.md', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false },
  { name: 'openhands', tier: 'T2', rulesFile: '.openhands/', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false },
  { name: 'aider', tier: 'T3', rulesFile: 'CONVENTIONS.md', hasMCP: false, hasHooks: false, hasSkills: false, hasNativeLoop: false },
  { name: 'goose', tier: 'T3', rulesFile: 'config.yaml', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false },
  { name: 'zed', tier: 'T3', rulesFile: '.zed/', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false },
  { name: 'codeium', tier: 'T3', rulesFile: '.codeium/', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false },
  { name: 'droid', tier: 'T3', rulesFile: '.droid/', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false },
  // ── P5: 8 new clients ──
  { name: 'gemini-cli', id: 'gemini-cli', tier: 'T2', rulesFile: '.gemini/rules.md', configDir: '.gemini', mcpConfig: 'mcp.json', hasMCP: true, hasHooks: false, hasSkills: true, hasNativeLoop: true, degradationLevel: 'rule-injected' },
  { name: 'codex-cli', id: 'codex-cli', tier: 'T2', rulesFile: 'AGENTS.md', configDir: '.', mcpConfig: 'mcp.json', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: true, degradationLevel: 'rule-injected' },
  { name: 'hermes', id: 'hermes', tier: 'T3', rulesFile: '.hermes/skills/aza-loop.md', configDir: '.hermes', mcpConfig: 'mcp.json', hasMCP: true, hasHooks: false, hasSkills: true, hasNativeLoop: false, degradationLevel: 'manual-trigger' },
  { name: 'openclaw', id: 'openclaw', tier: 'T3', rulesFile: 'clawhub.json', configDir: '.', mcpConfig: 'mcp.json', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false, degradationLevel: 'manual-trigger' },
  { name: 'claude-desktop', id: 'claude-desktop', tier: 'T2', rulesFile: 'claude_desktop_config.json', configDir: '.', mcpConfig: 'claude_desktop_config.json', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: false, degradationLevel: 'manual-trigger' },
  { name: 'comate', id: 'comate', tier: 'T2', rulesFile: '.comate/rules.md', configDir: '.comate', mcpConfig: 'mcp.json', hasMCP: true, hasHooks: false, hasSkills: true, hasNativeLoop: true, degradationLevel: 'mcp-simulated' },
  { name: 'workbuddy', id: 'workbuddy', tier: 'T2', rulesFile: '.workbuddy/rules.md', configDir: '.workbuddy', mcpConfig: 'mcp.json', hasMCP: true, hasHooks: false, hasSkills: true, hasNativeLoop: true, degradationLevel: 'mcp-simulated' },
  { name: 'qwen-code', id: 'qwen-code', tier: 'T2', rulesFile: '.qwen/rules.md', configDir: '.qwen', mcpConfig: 'mcp.json', hasMCP: true, hasHooks: false, hasSkills: false, hasNativeLoop: true, degradationLevel: 'rule-injected' },
  // ── Current client: OpenCode (host LLM runs AzaLoop via MCP) ──
  { name: 'opencode', id: 'opencode', tier: 'T1', rulesFile: '.opencode/rules.md', configDir: '.opencode', mcpConfig: 'mcp.json', hasMCP: true, hasHooks: true, hasSkills: true, hasNativeLoop: true, degradationLevel: 'full' },
];

export function detectClient(): ClientInfo {
  if (process.env.CURSOR_TRACE_ID) return getClient('cursor');
  if (process.env.CLAUDE_CODE_ENTRYPOINT) return getClient('claude-code');
  // Current client: OpenCode (host LLM runs AzaLoop via MCP).
  if (process.env.OPENCODE || process.env.OPENCODE_SESSION_ID || process.env.OPENCODE_CWD) return getClient('opencode');

  const fs = require('fs');
  const checks: Array<{ name: string; path: string }> = [
    { name: 'opencode', path: '.opencode' },
    { name: 'cursor', path: '.cursor/rules' },
    { name: 'trae', path: '.trae/mcp.json' },
    { name: 'windsurf', path: '.windsurf' },
    { name: 'cline', path: '.clinerules' },
    { name: 'continue', path: '.continuerules' },
    { name: 'roo-code', path: '.roo' },
    { name: 'kiro', path: '.kiro' },
    { name: 'aider', path: 'CONVENTIONS.md' },
    { name: 'goose', path: 'mcp.json' },
    { name: 'zed', path: '.zed' },
    { name: 'github-copilot', path: '.github/copilot-instructions.md' },
    { name: 'openhands', path: '.openhands' },
    { name: 'codeium', path: '.codeium' },
    { name: 'droid', path: '.droid' },
    // P5: new client detection
    { name: 'gemini-cli', path: '.gemini/rules.md' },
    { name: 'codex-cli', path: 'AGENTS.md' },
    { name: 'hermes', path: '.hermes/skills/aza-loop.md' },
    { name: 'openclaw', path: 'clawhub.json' },
    { name: 'claude-desktop', path: 'claude_desktop_config.json' },
    { name: 'comate', path: '.comate/rules.md' },
    { name: 'workbuddy', path: '.workbuddy/rules.md' },
    { name: 'qwen-code', path: '.qwen/rules.md' },
  ];

  for (const check of checks) {
    try {
      if (fs.existsSync(check.path)) {
        return getClient(check.name);
      }
    } catch {
      continue;
    }
  }

  return { name: 'unknown', tier: 'T3', hasMCP: false, hasHooks: false, hasSkills: false, hasNativeLoop: false };
}

export function getClient(name: string): ClientInfo {
  return CLIENTS.find(c => c.name === name) || { name, tier: 'T3', hasMCP: false, hasHooks: false, hasSkills: false, hasNativeLoop: false };
}

export function getAllClients(): ClientInfo[] {
  return [...CLIENTS];
}

/**
 * Detect whether the client has switched since the last recorded session.
 *
 * Compares the currently detected client against `lastClient` (typically read
 * from HEARTBEAT.yaml or RESUME.md). Returns a structured result so callers
 * (AutoLoopEngine, MCP boot, CLI continue) can log the switch and adjust
 * resume behavior.
 *
 * R10 第1轮：跨客户端自动续航触发器
 */
export interface ClientSwitchResult {
  /** True when the current client differs from the last recorded one. */
  switched: boolean;
  /** The client recorded in the previous session (may be 'unknown'). */
  previous_client: string;
  /** The client detected in the current session. */
  current_client: string;
  /** Whether the current client is a different tier (may need degradation). */
  tier_changed: boolean;
  /** The detected ClientInfo for the current session. */
  current_info: ClientInfo;
}

export function detectClientSwitch(lastClient?: string | null): ClientSwitchResult {
  const current = detectClient();
  const currentName = current.name;
  const lastName = (lastClient || '').trim() || 'unknown';
  const switched = lastName !== 'unknown' && lastName !== currentName;
  const lastInfo = getClient(lastName);
  const tierChanged = switched && (lastInfo.tier !== current.tier);
  return {
    switched,
    previous_client: lastName,
    current_client: currentName,
    tier_changed: tierChanged,
    current_info: current,
  };
}
