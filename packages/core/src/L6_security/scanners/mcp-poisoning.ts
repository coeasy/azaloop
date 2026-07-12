import type { SecurityFinding } from './secret';
import { scanPromptInjection } from './prompt-injection';

/**
 * Represents an MCP tool definition for scanning.
 */
export interface MCPToolDefinition {
  /** Tool name. */
  name: string;
  /** Tool description (high-risk surface for hidden instructions). */
  description: string;
  /** Tool input schema (JSON Schema as object). */
  inputSchema?: Record<string, unknown>;
  /** Tool server / origin identifier. */
  server?: string;
}

/**
 * A fingerprint of a tool description for rug-pull detection.
 */
export interface ToolFingerprint {
  /** Tool name. */
  toolName: string;
  /** SHA-256-like hash of the description (simple hash for demo). */
  hash: string;
  /** The original description text (first seen). */
  description: string;
  /** Timestamp of first observation. */
  firstSeen: string;
}

/**
 * Result of scanning a single MCP tool for poisoning.
 */
export interface MCPToolScanResult {
  toolName: string;
  findings: SecurityFinding[];
  risk_level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  has_hidden_instructions: boolean;
  has_invisible_chars: boolean;
  has_hide_from_user: boolean;
  risk_score: number;
}

/**
 * Result of a rug-pull detection (tool description changed silently).
 */
export interface RugPullResult {
  toolName: string;
  changed: boolean;
  oldHash: string;
  newHash: string;
  oldDescription: string;
  newDescription: string;
  severity: 'high' | 'critical';
  description: string;
}

/**
 * Invisible character detection pattern.
 * Reused from prompt-injection for consistency.
 */
const INVISIBLE_CHAR_PATTERN = /[\u200B\u200C\u200D\u200E\u200F\u2060\u2061\u2062\u2063\u2064\uFEFF\u00AD\u3164\uFFA0\u2800]/;

/**
 * "Hide from user" patterns — detect instructions that tell the model
 * to conceal information from the user.
 */
const HIDE_FROM_USER_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /(?:不要|别|不可|禁止)(?:告诉|告知|通知|透露|显示|展示)(?:用户|使用者)/i, description: 'Chinese: hide from user instruction' },
  { pattern: /(?:隐藏|藏起来|不显示|屏蔽|对用户保密)/i, description: 'Chinese: conceal from user' },
  { pattern: /(?:hide|conceal|keep)(?:\s+this)?\s+(?:from|away\s+from)\s+(?:the\s+)?user/i, description: 'English: hide from user instruction' },
  { pattern: /(?:don't|do\s+not|never)\s+(?:tell|inform|notify|reveal|show|display)(?:\s+this)?\s+(?:to\s+)?(?:the\s+)?user/i, description: 'English: do not tell user' },
  { pattern: /user\s+(?:must\s+not|should\s+not|cannot|can't)\s+(?:see|know|access)/i, description: 'English: user must not see/know' },
];

/**
 * Hidden instruction patterns specific to MCP tool descriptions.
 * These detect instructions embedded in tool descriptions that try to
 * override the model's behavior.
 */
const HIDDEN_INSTRUCTION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /(?:忽略|不要遵守)(?:之前|以上|系统)(?:的)?(?:指令|提示|规则)/i, description: 'Chinese: override system instructions in tool desc' },
  { pattern: /ignore\s+(?:previous|prior|above|system)\s+(?:instructions?|prompts?|rules?)/i, description: 'English: override system instructions in tool desc' },
  { pattern: /(?:你(?:现在|从现在起)是|假装你是|扮演)/i, description: 'Chinese: role hijack in tool desc' },
  { pattern: /you\s+are\s+now\s+(?:a|an)\s/i, description: 'English: role hijack in tool desc' },
  { pattern: /(?:before|after|when)\s+(?:calling|using|executing)\s+this\s+tool.*(?:ignore|forget|bypass)/i, description: 'Conditional override in tool desc' },
  { pattern: /(?:IMPORTANT|NOTE|SYSTEM)[:\s].*(?:ignore|forget|override|bypass)/i, description: 'Fake system note with override in tool desc' },
  { pattern: /<system>|<\/system>|<\!--.*-->/i, description: 'Fake system tags in tool description' },
  { pattern: /(?:execute|run|eval)\s+(?:the\s+)?(?:following|below|this)\s+(?:code|command|script)/i, description: 'Code execution instruction in tool desc' },
];

/**
 * Scan a single MCP tool definition for poisoning.
 *
 * Detects:
 * 1. Hidden instructions in tool descriptions
 * 2. Invisible characters (zero-width)
 * 3. "Hide from user" patterns
 * 4. Prompt injection patterns (delegates to scanPromptInjection)
 *
 * @param tool - The MCP tool definition to scan.
 * @returns Scan result with findings and risk assessment.
 */
export function scanMCPTool(tool: MCPToolDefinition): MCPToolScanResult {
  const findings: SecurityFinding[] = [];
  let riskScore = 0;
  let hasHiddenInstructions = false;
  let hasInvisibleChars = false;
  let hasHideFromUser = false;

  const desc = tool.description;
  const source = `mcp-tool:${tool.name}`;

  // 1. Check for hidden instructions
  for (const { pattern, description } of HIDDEN_INSTRUCTION_PATTERNS) {
    if (pattern.test(desc)) {
      findings.push({
        type: 'mcp_poisoning',
        severity: 'critical',
        file: source,
        line: 1,
        description: `Hidden instruction in tool description: ${description}`,
      });
      riskScore += 40;
      hasHiddenInstructions = true;
    }
  }

  // 2. Check for invisible characters
  if (INVISIBLE_CHAR_PATTERN.test(desc)) {
    const invisibleCount = (desc.match(new RegExp(INVISIBLE_CHAR_PATTERN.source, 'g')) || []).length;
    findings.push({
      type: 'mcp_poisoning',
      severity: 'high',
      file: source,
      line: 1,
      description: `Invisible/zero-width character detected in tool description (${invisibleCount} found)`,
    });
    riskScore += 30;
    hasInvisibleChars = true;
  }

  // 3. Check for "hide from user" patterns
  for (const { pattern, description } of HIDE_FROM_USER_PATTERNS) {
    if (pattern.test(desc)) {
      findings.push({
        type: 'mcp_poisoning',
        severity: 'critical',
        file: source,
        line: 1,
        description: `Hide-from-user instruction in tool description: ${description}`,
      });
      riskScore += 45;
      hasHideFromUser = true;
    }
  }

  // 4. Delegate to prompt injection scanner for comprehensive check
  const piResult = scanPromptInjection(desc, source);
  if (piResult.findings.length > 0) {
    for (const f of piResult.findings) {
      findings.push({
        type: 'mcp_poisoning',
        severity: f.severity,
        file: f.file,
        line: f.line,
        description: `Prompt injection in tool description: ${f.description}`,
      });
    }
    riskScore += piResult.total_risk_score * 0.5; // weight prompt injection results
    hasHiddenInstructions = hasHiddenInstructions || piResult.findings.length > 0;
  }

  // 5. Check input schema for suspicious patterns in description fields
  if (tool.inputSchema) {
    const schemaStr = JSON.stringify(tool.inputSchema);
    for (const { pattern, description } of HIDDEN_INSTRUCTION_PATTERNS) {
      if (pattern.test(schemaStr)) {
        findings.push({
          type: 'mcp_poisoning',
          severity: 'high',
          file: source,
          line: 1,
          description: `Hidden instruction in input schema: ${description}`,
        });
        riskScore += 25;
        hasHiddenInstructions = true;
      }
    }
    if (INVISIBLE_CHAR_PATTERN.test(schemaStr)) {
      findings.push({
        type: 'mcp_poisoning',
        severity: 'medium',
        file: source,
        line: 1,
        description: 'Invisible character in input schema',
      });
      riskScore += 15;
      hasInvisibleChars = true;
    }
  }

  const finalScore = Math.min(Math.round(riskScore), 100);

  const riskLevel = determineRiskLevel(finalScore, findings);

  return {
    toolName: tool.name,
    findings,
    risk_level: riskLevel,
    has_hidden_instructions: hasHiddenInstructions,
    has_invisible_chars: hasInvisibleChars,
    has_hide_from_user: hasHideFromUser,
    risk_score: finalScore,
  };
}

/**
 * Scan multiple MCP tools at once.
 */
export function scanMCPTools(tools: MCPToolDefinition[]): MCPToolScanResult[] {
  return tools.map(tool => scanMCPTool(tool));
}

/**
 * Rug-pull detection: compare current tool descriptions against known fingerprints.
 * Flags tools whose descriptions have silently changed.
 *
 * @param tools - Current tool definitions.
 * @param fingerprints - Previously recorded fingerprints (first-seen descriptions).
 * @returns Array of rug-pull detection results.
 */
export function detectRugPulls(
  tools: MCPToolDefinition[],
  fingerprints: Map<string, ToolFingerprint>,
): RugPullResult[] {
  const results: RugPullResult[] = [];

  for (const tool of tools) {
    const existing = fingerprints.get(tool.name);
    if (!existing) continue; // New tool, not a rug-pull

    const newHash = hashDescription(tool.description);
    if (newHash !== existing.hash) {
      // Description changed — potential rug-pull
      const severity = detectSeverityOfChange(existing.description, tool.description);
      results.push({
        toolName: tool.name,
        changed: true,
        oldHash: existing.hash,
        newHash,
        oldDescription: existing.description,
        newDescription: tool.description,
        severity,
        description: `Tool "${tool.name}" description changed silently — potential rug-pull attack`,
      });
    }
  }

  return results;
}

/**
 * Record fingerprints for tools (first-seen baseline).
 * Should be called when tools are first discovered/trusted.
 */
export function recordFingerprints(
  tools: MCPToolDefinition[],
  existing: Map<string, ToolFingerprint> = new Map(),
): Map<string, ToolFingerprint> {
  const fingerprints = new Map(existing);
  const now = new Date().toISOString();

  for (const tool of tools) {
    if (!fingerprints.has(tool.name)) {
      fingerprints.set(tool.name, {
        toolName: tool.name,
        hash: hashDescription(tool.description),
        description: tool.description,
        firstSeen: now,
      });
    }
  }

  return fingerprints;
}

/**
 * Simple hash function for tool descriptions (non-cryptographic, for change detection).
 */
function hashDescription(text: string): string {
  let hash = 0;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Return as unsigned hex
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Determine the severity of a description change.
 * Critical if new description contains injection patterns, high otherwise.
 */
function detectSeverityOfChange(
  oldDesc: string,
  newDesc: string,
): 'high' | 'critical' {
  const hasInjection = HIDDEN_INSTRUCTION_PATTERNS.some(({ pattern }) => pattern.test(newDesc));
  const hasInvisible = INVISIBLE_CHAR_PATTERN.test(newDesc);
  const hasHideFromUser = HIDE_FROM_USER_PATTERNS.some(({ pattern }) => pattern.test(newDesc));

  if (hasInjection || hasHideFromUser) return 'critical';
  if (hasInvisible) return 'critical';
  return 'high';
}

/**
 * Determine overall risk level from score and findings.
 */
function determineRiskLevel(
  score: number,
  findings: SecurityFinding[],
): MCPToolScanResult['risk_level'] {
  const hasCritical = findings.some(f => f.severity === 'critical');
  const hasHigh = findings.some(f => f.severity === 'high');

  if (hasCritical || score >= 80) return 'critical';
  if (hasHigh || score >= 50) return 'high';
  if (score >= 25) return 'medium';
  if (score > 0) return 'low';
  return 'safe';
}
