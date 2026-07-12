import * as fs from 'fs';
import type { SecurityFinding } from './scanners/secret';

/**
 * Finding kind categories for policy-based filtering.
 */
export type FindingKind =
  | 'secret'
  | 'pii'
  | 'overseas'
  | 'env-perm'
  | 'prompt_injection'
  | 'data_exfiltration'
  | 'mcp_poisoning'
  | 'code_injection'
  | 'sql_injection'
  | 'xss'
  | 'dependency';

/**
 * Severity levels for policy-based filtering.
 */
export type Severity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Fail-on configuration — defines which findings block the pipeline.
 */
export interface FailOnConfig {
  /** Fail if any finding matches these kinds. */
  kinds?: FindingKind[];
  /** Fail if any finding matches these severity levels. */
  severities?: Severity[];
}

/**
 * Overseas whitelist entry for allowed external endpoints.
 */
export interface OverseasWhitelistEntry {
  /** Domain or URL pattern to whitelist. */
  domain: string;
  /** Reason for whitelisting. */
  reason: string;
}

/**
 * Declarative security policy configuration.
 * Modeled after `.shellward.json`-style config.
 */
export interface SecurityPolicy {
  /** Policy name / identifier. */
  name: string;
  /** Policy version. */
  version: string;
  /** Whether the policy is enabled. */
  enabled: boolean;
  /** Conditions that cause the pipeline to fail (block). */
  failOn: FailOnConfig;
  /** Maximum number of findings before blocking (0 = no limit). */
  maxFindings: number;
  /** Whitelist of allowed overseas endpoints. */
  allowOverseas: OverseasWhitelistEntry[];
  /** Whether to also warn (not block) on non-failOn findings. */
  warnOnNonBlocking: boolean;
}

/**
 * Result of evaluating findings against a policy.
 */
export interface PolicyEvaluationResult {
  /** Whether the policy check passed (no blocking findings). */
  passed: boolean;
  /** Findings that caused the policy to block. */
  blockedFindings: SecurityFinding[];
  /** Findings that triggered a warning (non-blocking). */
  warnedFindings: SecurityFinding[];
  /** Human-readable reason for pass/fail. */
  reason: string;
  /** Total findings evaluated. */
  totalFindings: number;
  /** Number of blocked findings. */
  blockedCount: number;
  /** Number of warned findings. */
  warnedCount: number;
}

/**
 * Default security policy (strict — blocks on critical/secrets/overseas).
 */
export const DEFAULT_POLICY: SecurityPolicy = {
  name: 'default',
  version: '1.0.0',
  enabled: true,
  failOn: {
    kinds: ['secret', 'overseas', 'prompt_injection', 'data_exfiltration', 'mcp_poisoning'],
    severities: ['critical'],
  },
  maxFindings: 0,
  allowOverseas: [],
  warnOnNonBlocking: true,
};

/**
 * Map a finding's `type` field to a `FindingKind`.
 */
function getFindingKind(finding: SecurityFinding): FindingKind {
  const typeMap: Record<string, FindingKind> = {
    secret: 'secret',
    pii: 'pii',
    overseas: 'overseas',
    env_perm: 'env-perm',
    'env-perm': 'env-perm',
    prompt_injection: 'prompt_injection',
    data_exfiltration: 'data_exfiltration',
    mcp_poisoning: 'mcp_poisoning',
    code_injection: 'code_injection',
    sql_injection: 'sql_injection',
    xss: 'xss',
    dependency: 'dependency',
  };
  return typeMap[finding.type] ?? 'secret';
}

/**
 * Check if a finding matches the fail-on configuration.
 */
function matchesFailOn(
  finding: SecurityFinding,
  failOn: FailOnConfig,
): boolean {
  // Check kind match
  if (failOn.kinds && failOn.kinds.length > 0) {
    const kind = getFindingKind(finding);
    if (failOn.kinds.includes(kind)) {
      return true;
    }
  }

  // Check severity match
  if (failOn.severities && failOn.severities.length > 0) {
    if (failOn.severities.includes(finding.severity as Severity)) {
      return true;
    }
  }

  // If neither kinds nor severities specified, fail on all
  if ((!failOn.kinds || failOn.kinds.length === 0) && (!failOn.severities || failOn.severities.length === 0)) {
    return true;
  }

  return false;
}

/**
 * Check if an overseas finding is whitelisted.
 */
function isOverseasWhitelisted(
  finding: SecurityFinding,
  whitelist: OverseasWhitelistEntry[],
): boolean {
  if (whitelist.length === 0) return false;

  // Extract domain from finding description
  const domainMatch = finding.description.match(/https?:\/\/([^/\s]+)/i);
  if (!domainMatch || !domainMatch[1]) return false;

  const domain = domainMatch[1].toLowerCase();

  for (const entry of whitelist) {
    const allowedDomain = entry.domain.toLowerCase();
    // Support wildcard subdomains (*.example.com)
    if (allowedDomain.startsWith('*.')) {
      const baseDomain = allowedDomain.slice(2);
      if (domain === baseDomain || domain.endsWith('.' + baseDomain)) {
        return true;
      }
    } else if (domain === allowedDomain || domain.endsWith('.' + allowedDomain)) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluate security findings against a declarative policy.
 *
 * @param findings - Array of security findings to evaluate.
 * @param policy - The security policy to apply.
 * @returns Evaluation result indicating pass/fail and blocked findings.
 */
export function evaluate(
  findings: SecurityFinding[],
  policy: SecurityPolicy,
): PolicyEvaluationResult {
  // If policy is disabled, always pass
  if (!policy.enabled) {
    return {
      passed: true,
      blockedFindings: [],
      warnedFindings: [],
      reason: 'Policy is disabled — all findings allowed',
      totalFindings: findings.length,
      blockedCount: 0,
      warnedCount: 0,
    };
  }

  const blockedFindings: SecurityFinding[] = [];
  const warnedFindings: SecurityFinding[] = [];

  for (const finding of findings) {
    const isOverseas = getFindingKind(finding) === 'overseas';

    // Check overseas whitelist first
    if (isOverseas && isOverseasWhitelisted(finding, policy.allowOverseas)) {
      warnedFindings.push(finding);
      continue;
    }

    // Check if finding matches fail-on criteria
    if (matchesFailOn(finding, policy.failOn)) {
      blockedFindings.push(finding);
    } else if (policy.warnOnNonBlocking) {
      warnedFindings.push(finding);
    }
  }

  // Check maxFindings limit
  let maxFindingsExceeded = false;
  let maxFindingsReason = '';
  if (policy.maxFindings > 0 && findings.length > policy.maxFindings) {
    maxFindingsExceeded = true;
    maxFindingsReason = `Total findings (${findings.length}) exceed maxFindings limit (${policy.maxFindings})`;
  }

  const passed = blockedFindings.length === 0 && !maxFindingsExceeded;

  // Build reason string
  const reasons: string[] = [];
  if (blockedFindings.length > 0) {
    const kindCounts = new Map<string, number>();
    for (const f of blockedFindings) {
      const kind = getFindingKind(f);
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
    }
    const breakdown = Array.from(kindCounts.entries())
      .map(([kind, count]) => `${kind}: ${count}`)
      .join(', ');
    reasons.push(`Blocked by fail-on criteria (${blockedFindings.length} findings: ${breakdown})`);
  }
  if (maxFindingsExceeded) {
    reasons.push(maxFindingsReason);
  }
  if (passed) {
    if (findings.length === 0) {
      reasons.push('No findings — policy passed');
    } else {
      reasons.push(`All ${findings.length} findings are within policy limits`);
    }
  }

  return {
    passed,
    blockedFindings,
    warnedFindings,
    reason: reasons.join('; '),
    totalFindings: findings.length,
    blockedCount: blockedFindings.length,
    warnedCount: warnedFindings.length,
  };
}

/**
 * Evaluate findings against the default policy.
 */
export function evaluateWithDefault(findings: SecurityFinding[]): PolicyEvaluationResult {
  return evaluate(findings, DEFAULT_POLICY);
}

/**
 * Create a policy from a partial configuration (merges with defaults).
 */
export function createPolicy(
  config: Partial<SecurityPolicy>,
): SecurityPolicy {
  return {
    ...DEFAULT_POLICY,
    ...config,
    failOn: {
      ...DEFAULT_POLICY.failOn,
      ...config.failOn,
    },
    allowOverseas: config.allowOverseas ?? DEFAULT_POLICY.allowOverseas,
  };
}

/**
 * Validate a policy configuration.
 * Returns an array of error messages (empty if valid).
 */
export function validatePolicy(policy: SecurityPolicy): string[] {
  const errors: string[] = [];

  if (!policy.name || policy.name.trim().length === 0) {
    errors.push('Policy name is required');
  }

  if (!policy.version || policy.version.trim().length === 0) {
    errors.push('Policy version is required');
  }

  if (policy.maxFindings < 0) {
    errors.push('maxFindings must be >= 0');
  }

  if (policy.failOn) {
    if (policy.failOn.kinds) {
      const validKinds: FindingKind[] = [
        'secret', 'pii', 'overseas', 'env-perm',
        'prompt_injection', 'data_exfiltration', 'mcp_poisoning',
        'code_injection', 'sql_injection', 'xss', 'dependency',
      ];
      for (const kind of policy.failOn.kinds) {
        if (!validKinds.includes(kind)) {
          errors.push(`Invalid fail-on kind: ${kind}`);
        }
      }
    }

    if (policy.failOn.severities) {
      const validSeverities: Severity[] = ['low', 'medium', 'high', 'critical'];
      for (const sev of policy.failOn.severities) {
        if (!validSeverities.includes(sev)) {
          errors.push(`Invalid fail-on severity: ${sev}`);
        }
      }
    }
  }

  if (policy.allowOverseas) {
    for (const entry of policy.allowOverseas) {
      if (!entry.domain || entry.domain.trim().length === 0) {
        errors.push('Overseas whitelist entry missing domain');
      }
    }
  }

  return errors;
}

/**
 * Load a SecurityPolicy from a YAML file.
 *
 * Uses a lightweight built-in parser (no external YAML dependency).
 * Falls back to DEFAULT_POLICY if the file is missing or unparseable.
 *
 * @param filePath - Path to the policy.yaml file.
 * @returns The parsed policy, merged with defaults.
 */
export function loadPolicyFromFile(filePath: string): SecurityPolicy {
  try {
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_POLICY };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseSimpleYaml(content);
    return createPolicy({
      name: (parsed.name as string) || DEFAULT_POLICY.name,
      version: String(parsed.version || DEFAULT_POLICY.version),
      enabled: parsed.enabled !== false,
      failOn: {
        kinds: ((parsed.fail_on as any)?.kinds as FindingKind[]) || DEFAULT_POLICY.failOn.kinds,
        severities: ((parsed.fail_on as any)?.severities as Severity[]) || DEFAULT_POLICY.failOn.severities,
      },
      maxFindings: typeof parsed.max_findings === 'number' ? parsed.max_findings : DEFAULT_POLICY.maxFindings,
      allowOverseas: (parsed.allow_overseas as OverseasWhitelistEntry[]) || DEFAULT_POLICY.allowOverseas,
      warnOnNonBlocking: parsed.warn_on_non_blocking !== undefined
        ? parsed.warn_on_non_blocking === true
        : DEFAULT_POLICY.warnOnNonBlocking,
    });
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

/**
 * Lightweight YAML parser for policy.yaml subset.
 * Handles: scalar values, lists (- item), nested objects (key:), comments (#).
 * NOT a full YAML parser — only supports the structure used in policy.yaml.
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  const stack: { indent: number; obj: Record<string, unknown> }[] = [{ indent: -1, obj: result }];
  let currentKey = '';

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!.obj;

    // List item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();
      if (currentKey && Array.isArray(parent[currentKey])) {
        (parent[currentKey] as unknown[]).push(parseValue(value));
      }
      continue;
    }

    // Key: value
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const rawValue = trimmed.slice(colonIdx + 1).trim();

      if (rawValue === '' || rawValue === '|' || rawValue === '>') {
        // Nested object or list — will be filled by subsequent lines
        const child: Record<string, unknown> = {};
        parent[key] = child;
        stack.push({ indent, obj: child });
        currentKey = key;
      } else {
        parent[key] = parseValue(rawValue);
        currentKey = key;
      }
    }
  }

  return result;
}

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;
  // Remove quotes
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;
  return raw;
}
