import type { ClientInfo } from './client-detection';

export interface CompensationStrategy {
  missing_capability: string;
  compensation_tool: string;
  compensation_mechanism: string;
  applicable_clients: string[];
}

// ── 5-Tier Degradation Strategy ─────────────────────────────────────

/**
 * The five degradation tiers, ordered from highest to lowest automation.
 *
 * - **full**          — Native Hook + MCP (Cursor, Claude Code)
 * - **partial-hook**  — Partial Hook + MCP (Cline, Trae)
 * - **mcp-simulated** — MCP Event Simulator (Windsurf, VS Code, Roo …)
 * - **rule-injected** — continue.md rules + MCP (Kiro, Gemini CLI …)
 * - **manual-trigger** — Manual `aza continue` (Aider, Goose, Zed …)
 */
export type DegradationLevel =
  | 'full'
  | 'partial-hook'
  | 'mcp-simulated'
  | 'rule-injected'
  | 'manual-trigger';

/**
 * Describes a single degradation tier.
 */
export interface DegradationTier {
  /** Machine-readable tier identifier. */
  level: DegradationLevel;
  /** Human-readable tier name. */
  name: string;
  /** Short description of the tier's compensation mechanism. */
  description: string;
  /** Automation percentage (0–100) achievable in this tier. */
  automation_percent: number;
  /** How AzaLoop compensates for missing native capabilities. */
  mechanism: string;
  /** Client names that fall into this tier. */
  clients: string[];
}

const STRATEGIES: CompensationStrategy[] = [
  {
    missing_capability: 'Stop Hook',
    compensation_tool: 'aza_continue',
    compensation_mechanism: 'Auto-update RESUME after every tool call',
    applicable_clients: ['vscode', 'continue', 'aider', 'goose', 'zed', 'codeium', 'droid', 'github-copilot', 'openhands'],
  },
  {
    missing_capability: 'Rules Injection',
    compensation_tool: 'aza_context calibrate',
    compensation_mechanism: 'Return constitution + iron_rules via MCP',
    applicable_clients: ['vscode', 'aider', 'goose', 'codeium', 'droid'],
  },
  {
    missing_capability: 'Skills',
    compensation_tool: 'aza_skill search/list',
    compensation_mechanism: 'MCP tool returns skill content',
    applicable_clients: ['windsurf', 'continue', 'aider', 'vscode', 'kiro', 'github-copilot', 'goose', 'zed', 'codeium', 'droid', 'openhands'],
  },
  {
    missing_capability: 'Native Loop',
    compensation_tool: 'aza_loop next',
    compensation_mechanism: 'next_action chain drives LLM auto-continuation',
    applicable_clients: ['vscode', 'continue', 'aider', 'goose', 'zed', 'codeium', 'droid', 'github-copilot'],
  },
  {
    missing_capability: 'TDD / Quality',
    compensation_tool: 'aza_quality check',
    compensation_mechanism: '5-gate pipeline enforced via MCP',
    applicable_clients: ['*'],
  },
  {
    missing_capability: 'Memory',
    compensation_tool: 'aza_memory query/list',
    compensation_mechanism: 'Three-tier memory read/write via MCP',
    applicable_clients: ['*'],
  },
  {
    missing_capability: 'Document Generation',
    compensation_tool: 'aza_doc generate',
    compensation_mechanism: '6 document types auto-generated',
    applicable_clients: ['*'],
  },
];

export function getCompensation(client: ClientInfo): CompensationStrategy[] {
  if (client.tier === 'T1') return [];
  return STRATEGIES.filter(s =>
    s.applicable_clients.includes('*') || s.applicable_clients.includes(client.name)
  );
}

export function getAllStrategies(): CompensationStrategy[] {
  return [...STRATEGIES];
}

// ── Degradation Tier Data ───────────────────────────────────────────

/**
 * The five degradation tiers, ordered from highest to lowest automation.
 *
 * | Tier             | Automation | Clients                                        |
 * | ---------------- | ---------- | ---------------------------------------------- |
 * | Full             | 100%       | Cursor, Claude Code                            |
 * | Partial-Hook     | 95%        | Cline, Trae                                    |
 * | MCP-Simulated     | 90%        | Windsurf, VS Code, Roo, OpenCode, Comate, WorkBuddy |
 * | Rule-Injected     | 85%        | Kiro, Gemini CLI, Codex CLI                    |
 * | Manual-Trigger    | 75%        | Hermes, OpenClaw, Claude Desktop, Aider, Goose, Zed |
 */
const DEGRADATION_TIERS: DegradationTier[] = [
  {
    level: 'full',
    name: 'Full',
    description: 'Native Hook + MCP — full automatic lifecycle',
    automation_percent: 100,
    mechanism: 'Native Hook events (pre-tool, post-tool, on-stop) drive the full AzaLoop lifecycle automatically. MCP tools provide direct state access.',
    clients: ['cursor', 'claude-code'],
  },
  {
    level: 'partial-hook',
    name: 'Partial-Hook',
    description: 'Partial Hook + MCP — near-full automation with minor gaps',
    automation_percent: 95,
    mechanism: 'Partial Hook support covers most lifecycle events. MCP tools fill the remaining gaps. Occasional manual intervention may be needed for edge cases.',
    clients: ['cline', 'trae'],
  },
  {
    level: 'mcp-simulated',
    name: 'MCP-Simulated',
    description: 'MCP Event Simulator — Hook events simulated via MCP bridge',
    automation_percent: 90,
    mechanism: 'MCPEventBridge wraps every tool call with simulatePreTool / simulatePostTool, emitting Hook events on the EventBus and pre-writing RESUME on every call.',
    clients: ['windsurf', 'vscode', 'roo-code', 'opencode', 'comate', 'workbuddy'],
  },
  {
    level: 'rule-injected',
    name: 'Rule-Injected',
    description: 'continue.md rules + MCP — rules guide the LLM, MCP provides tools',
    automation_percent: 85,
    mechanism: 'Rules file (e.g. .kiro/rules) injects AzaLoop discipline into the system prompt. MCP tools provide state and loop control. The LLM must follow rules voluntarily.',
    clients: ['kiro', 'gemini-cli', 'codex-cli', 'qwen-code'],
  },
  {
    level: 'manual-trigger',
    name: 'Manual-Trigger',
    description: 'Manual aza continue — user triggers each continuation step',
    automation_percent: 75,
    mechanism: 'No Hook support and limited rule injection. User must manually call `aza continue` or `aza_loop next` to advance. RESUME.md provides cross-session continuity.',
    clients: ['hermes', 'openclaw', 'claude-desktop', 'aider', 'goose', 'zed'],
  },
];

/**
 * Fallback tier for unknown clients — defaults to the lowest automation level.
 */
const FALLBACK_TIER: DegradationTier = {
  level: 'manual-trigger',
  name: 'Manual-Trigger',
  description: 'Unknown client — manual aza continue required',
  automation_percent: 75,
  mechanism: 'Unknown client with no detected capabilities. User must manually call `aza continue`.',
  clients: [],
};

/**
 * Get the degradation tier for a specific client.
 *
 * First looks up the client by name in the tier definitions. If the client
 * is not explicitly listed, falls back to capability-based detection:
 *   - `hasHooks && hasMCP` → Full
 *   - `hasMCP`             → MCP-Simulated
 *   - otherwise            → Manual-Trigger
 *
 * @param client - The detected client info.
 * @returns The matching degradation tier.
 */
export function getDegradationTier(client: ClientInfo): DegradationTier {
  const byName = DEGRADATION_TIERS.find(t => t.clients.includes(client.name));
  if (byName) return byName;

  // Capability-based fallback for unknown clients.
  if (client.hasHooks && client.hasMCP) {
    return DEGRADATION_TIERS.find(t => t.level === 'full') ?? FALLBACK_TIER;
  }
  if (client.hasMCP) {
    return DEGRADATION_TIERS.find(t => t.level === 'mcp-simulated') ?? FALLBACK_TIER;
  }
  return FALLBACK_TIER;
}

/**
 * Get all degradation tiers, ordered from highest to lowest automation.
 *
 * @returns A shallow copy of the degradation tier array.
 */
export function getAllDegradationTiers(): DegradationTier[] {
  return [...DEGRADATION_TIERS];
}
