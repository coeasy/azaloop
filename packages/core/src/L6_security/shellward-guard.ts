/**
 * shellward-inspired 8-layer DLP guard for MCP pre-tool / host tool args.
 *
 * Layers:
 *  1. secrets
 *  2. prompt injection
 *  3. dangerous shell commands
 *  4. code injection
 *  5. data exfiltration
 *  6. MCP poisoning signals (in tool name / description-like args)
 *  7. SQL injection + XSS
 *  8. dependency / ADR compliance markers in payloads
 */
import { scanSecrets, type SecurityFinding } from './scanners/secret';
import { scanPromptInjection } from './scanners/prompt-injection';
import { scanCodeInjection } from './scanners/code-injection';
import { scanDataExfiltrationContent } from './scanners/data-exfiltration';
import { scanSQLInjection } from './scanners/sql-injection';
import { scanXSS } from './scanners/xss';
import { scanDependencies } from './scanners/dependency';
import { evaluate, type SecurityPolicy } from './policy-as-code';

/** Pre-tool policy: block secrets / exfil / MCP poison / any critical severity. */
const SHELLWARD_PRETOOL_POLICY: SecurityPolicy = {
  name: 'shellward-pretool',
  version: '1.0.0',
  enabled: true,
  failOn: {
    kinds: ['secret', 'data_exfiltration', 'mcp_poisoning'],
    severities: ['critical'],
  },
  maxFindings: 0,
  allowOverseas: [],
  warnOnNonBlocking: true,
};

export const SHELLWARD_LAYERS = [
  'secrets',
  'prompt_injection',
  'dangerous_command',
  'code_injection',
  'data_exfiltration',
  'mcp_poisoning',
  'owasp_injection',
  'dependency_adr',
] as const;

export type ShellwardLayer = (typeof SHELLWARD_LAYERS)[number];

export interface ShellwardFinding extends SecurityFinding {
  layer: ShellwardLayer;
}

export interface ShellwardResult {
  passed: boolean;
  blocked: boolean;
  reason?: string;
  findings: ShellwardFinding[];
  layers_run: ShellwardLayer[];
}

const DANGEROUS_CMD: Array<{ pattern: RegExp; description: string; severity: SecurityFinding['severity'] }> = [
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\s+\/(?:\s|$)/, description: 'Destructive rm targeting filesystem root', severity: 'critical' },
  { pattern: /\brm\s+-rf\s+\/\b/, description: 'Destructive rm -rf /', severity: 'critical' },
  { pattern: /\bmkfs\b|\bdd\s+if=.*of=\/dev\//i, description: 'Disk wipe / raw device write', severity: 'critical' },
  { pattern: /\bcurl\s+[^\n]*\|\s*(?:ba)?sh\b/i, description: 'Pipe remote script to shell', severity: 'critical' },
  { pattern: /\bwget\s+[^\n]*\|\s*(?:ba)?sh\b/i, description: 'wget pipe to shell', severity: 'critical' },
  { pattern: /\bsudo\s+(?:rm|dd|mkfs|chmod\s+-R\s+777)\b/i, description: 'Privileged destructive command', severity: 'critical' },
  { pattern: /\b(?:shutdown|reboot|halt)\b/i, description: 'System power command', severity: 'high' },
  { pattern: /\bchmod\s+-R\s+777\b/, description: 'World-writable recursive chmod', severity: 'high' },
  { pattern: /\b:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, description: 'Fork bomb', severity: 'critical' },
];

const MCP_POISON: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i, description: 'MCP tool arg asks to ignore prior instructions' },
  { pattern: /you\s+are\s+now\s+(?:in\s+)?(?:admin|developer|god)\s+mode/i, description: 'Role-escalation phrasing in tool args' },
  { pattern: /exfiltrate|send\s+all\s+(?:secrets|keys|tokens)\s+to/i, description: 'Exfil instruction embedded in MCP args' },
];

function tag(layer: ShellwardLayer, findings: SecurityFinding[]): ShellwardFinding[] {
  return findings.map((f) => ({ ...f, layer }));
}

function scanDangerousCommands(content: string, file: string): ShellwardFinding[] {
  const out: ShellwardFinding[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    for (const rule of DANGEROUS_CMD) {
      if (rule.pattern.test(line)) {
        out.push({
          type: 'dangerous_command',
          severity: rule.severity,
          file,
          line: i + 1,
          description: rule.description,
          layer: 'dangerous_command',
        });
      }
    }
  }
  return out;
}

function scanMcpPoisonSignals(content: string, file: string): ShellwardFinding[] {
  const out: ShellwardFinding[] = [];
  for (const rule of MCP_POISON) {
    if (rule.pattern.test(content)) {
      out.push({
        type: 'mcp_poisoning',
        severity: 'critical',
        file,
        line: 1,
        description: rule.description,
        layer: 'mcp_poisoning',
      });
    }
  }
  return out;
}

/**
 * Run all 8 shellward layers against arbitrary content (usually JSON-stringified tool args).
 */
export function runShellwardGuard(
  content: string,
  source = 'tool-args',
  opts?: { blockOnFail?: boolean },
): ShellwardResult {
  const blockOnFail = opts?.blockOnFail ?? true;
  const file = source;
  const findings: ShellwardFinding[] = [];

  findings.push(...tag('secrets', scanSecrets(content, file)));

  const pi = scanPromptInjection(content, file);
  findings.push(
    ...tag(
      'prompt_injection',
      pi.findings.map((f) => ({
        type: f.type,
        severity: f.severity,
        file: f.file,
        line: f.line,
        description: f.description,
      })),
    ),
  );

  findings.push(...scanDangerousCommands(content, file));
  findings.push(...tag('code_injection', scanCodeInjection(content, file)));

  const exfil = scanDataExfiltrationContent(content, file);
  findings.push(
    ...tag(
      'data_exfiltration',
      exfil.findings.map((f) => ({
        type: f.type,
        severity: f.severity,
        file: f.file,
        line: f.line,
        description: f.description,
      })),
    ),
  );

  findings.push(...scanMcpPoisonSignals(content, file));

  findings.push(
    ...tag('owasp_injection', [
      ...scanSQLInjection(content, file),
      ...scanXSS(content, file),
    ]),
  );

  // Layer 8: dependency strings / lockfile snippets inside payloads
  findings.push(...tag('dependency_adr', scanDependencies(content, file)));

  const policy = evaluate(findings, SHELLWARD_PRETOOL_POLICY);
  const blocked = blockOnFail && !policy.passed;
  return {
    passed: policy.passed,
    blocked,
    reason: policy.reason,
    findings,
    layers_run: [...SHELLWARD_LAYERS],
  };
}

/**
 * Convenience for MCP pre-tool: stringify args and optionally throw.
 */
export function assertShellwardPreTool(
  toolName: string,
  args: Record<string, unknown>,
): ShellwardResult {
  const content = JSON.stringify({ tool: toolName, args });
  const result = runShellwardGuard(content, `pre-tool:${toolName}`, { blockOnFail: true });
  if (result.blocked) {
    throw new Error(
      `shellward DLP blocked tool '${toolName}': ${result.reason || 'policy failed'} ` +
        `(${result.findings.length} findings across ${result.layers_run.length} layers)`,
    );
  }
  return result;
}
