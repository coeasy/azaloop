/**
 * v14 — v13-P2.x: ANTI_DRIFT defaults parser + enforcer
 *
 * Parses `anti-drift-defaults.yaml` and provides an
 * `enforceAntiDrift(clientConfig, defaults)` helper used by the L8
 * TopologySelector before recommending a topology. Client configs
 * that try to disable any `lock_*` flag are rejected.
 *
 * Reference: ruvnet/ruflo anti-drift system.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Public types ─────────────────────────────────────────────

export interface AntiDriftConfig {
  lockHardGate: boolean;
  lockRecursionGuard: boolean;
  lockCircuitBreaker: boolean;
  lockTddIronLaw: boolean;
  lockVerificationPhrases: boolean;
  lockAuditJsonl: boolean;
  lockStateChecksum: boolean;
  forbidConstructs: string[];
  forbidModules: string[];
  topology: {
    minRaftThreshold: number;
    maxParallelUncoordinated: number;
  };
  budget: {
    warnAtPct: number;
    rejectAtPct: number;
    defaultBudget: number;
  };
}

export interface AntiDriftViolation {
  field: string;
  attempted: unknown;
  required: unknown;
  reason: string;
}

// ── Defaults ─────────────────────────────────────────────────

/**
 * Hard-coded fallback if the YAML file cannot be loaded. Mirrors
 * `anti-drift-defaults.yaml`.
 */
export const ANTI_DRIFT_DEFAULTS: AntiDriftConfig = {
  lockHardGate: true,
  lockRecursionGuard: true,
  lockCircuitBreaker: true,
  lockTddIronLaw: true,
  lockVerificationPhrases: true,
  lockAuditJsonl: true,
  lockStateChecksum: true,
  forbidConstructs: ['eval', 'with', 'Function'],
  forbidModules: ['moment', 'lodash', 'request', 'bluebird'],
  topology: { minRaftThreshold: 5, maxParallelUncoordinated: 3 },
  budget: { warnAtPct: 80, rejectAtPct: 100, defaultBudget: 50000 },
};

// ── Public API ───────────────────────────────────────────────

/**
 * Resolve the path to the default anti-drift YAML file.
 */
export function antiDriftPath(azaDir: string = '.aza'): string {
  return path.join(
    azaDir,
    '..',
    'packages',
    'core',
    'src',
    'L8_orchestrator',
    'anti-drift-defaults.yaml',
  );
}

/**
 * Load the ANTI_DRIFT defaults. Falls back to {@link ANTI_DRIFT_DEFAULTS}
 * on any error so the system can still boot.
 */
export function loadAntiDriftDefaults(filePath?: string): AntiDriftConfig {
  const fp = filePath ?? antiDriftPath();
  if (!fs.existsSync(fp)) return ANTI_DRIFT_DEFAULTS;
  try {
    const text = fs.readFileSync(fp, 'utf8');
    return parseAntiDrift(text);
  } catch {
    return ANTI_DRIFT_DEFAULTS;
  }
}

/**
 * Enforce the defaults against a client-supplied configuration.
 * Returns a list of violations. An empty list means the client config
 * is safe to use.
 */
export function enforceAntiDrift(
  clientConfig: Record<string, unknown>,
  defaults: AntiDriftConfig = ANTI_DRIFT_DEFAULTS,
): AntiDriftViolation[] {
  const violations: AntiDriftViolation[] = [];

  // 1) Lock checks: every `lock_*` must remain `true`.
  if (defaults.lockHardGate && clientConfig['hard_gate'] === false) {
    violations.push({
      field: 'hard_gate',
      attempted: false,
      required: true,
      reason: 'hard-gate is a critical safety feature and cannot be disabled',
    });
  }
  if (defaults.lockRecursionGuard && clientConfig['recursion_guard'] === false) {
    violations.push({
      field: 'recursion_guard',
      attempted: false,
      required: true,
      reason: 'recursion-guard prevents infinite loops and cannot be disabled',
    });
  }
  if (defaults.lockCircuitBreaker && clientConfig['circuit_breaker'] === false) {
    violations.push({
      field: 'circuit_breaker',
      attempted: false,
      required: true,
      reason: 'circuit-breaker prevents runaway costs and cannot be disabled',
    });
  }
  if (defaults.lockTddIronLaw && clientConfig['tdd_iron_law'] === false) {
    violations.push({
      field: 'tdd_iron_law',
      attempted: false,
      required: true,
      reason: 'TDD Iron Law is a quality requirement and cannot be disabled',
    });
  }
  if (defaults.lockVerificationPhrases && clientConfig['verification_phrases'] === false) {
    violations.push({
      field: 'verification_phrases',
      attempted: false,
      required: true,
      reason: 'Verification phrase detection is required for evidence-based reviews',
    });
  }
  if (defaults.lockAuditJsonl && clientConfig['audit_jsonl'] === false) {
    violations.push({
      field: 'audit_jsonl',
      attempted: false,
      required: true,
      reason: 'audit.jsonl is required for traceability',
    });
  }
  if (defaults.lockStateChecksum && clientConfig['state_checksum'] === false) {
    violations.push({
      field: 'state_checksum',
      attempted: false,
      required: true,
      reason: 'STATE.yaml checksum is required for integrity',
    });
  }

  // 2) Topology floors: client cannot lower below the floor.
  if (typeof clientConfig['min_raft_threshold'] === 'number') {
    const v = clientConfig['min_raft_threshold'] as number;
    if (v < defaults.topology.minRaftThreshold) {
      violations.push({
        field: 'min_raft_threshold',
        attempted: v,
        required: defaults.topology.minRaftThreshold,
        reason: `min_raft_threshold must be >= ${defaults.topology.minRaftThreshold}`,
      });
    }
  }

  // 3) Budget: warn/reject thresholds cannot be lowered.
  if (typeof clientConfig['warn_at_pct'] === 'number') {
    const v = clientConfig['warn_at_pct'] as number;
    if (v < defaults.budget.warnAtPct) {
      violations.push({
        field: 'warn_at_pct',
        attempted: v,
        required: defaults.budget.warnAtPct,
        reason: `warn_at_pct must be >= ${defaults.budget.warnAtPct}`,
      });
    }
  }

  return violations;
}

// ── YAML parser ──────────────────────────────────────────────

/**
 * Parse the ANTI_DRIFT YAML. The schema is fixed so we can use a
 * simple line-based parser.
 */
export function parseAntiDrift(text: string): AntiDriftConfig {
  const config: AntiDriftConfig = JSON.parse(JSON.stringify(ANTI_DRIFT_DEFAULTS));
  const lines = text.split(/\r?\n/);
  let section: 'top' | 'topology' | 'budget' | null = null;

  for (const raw of lines) {
    if (raw.trim().startsWith('#') || raw.trim().length === 0) continue;
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (indent === 0) {
      if (trimmed === 'topology:') section = 'topology';
      else if (trimmed === 'budget:') section = 'budget';
      else section = 'top';
      continue;
    }
    if (indent === 2 && section === 'top') {
      const m = trimmed.match(/^([a-z_]+):\s*(true|false)$/);
      if (m) {
        const key = m[1];
        const value = m[2] === 'true';
        if (key === 'lock_hard_gate') config.lockHardGate = value;
        if (key === 'lock_recursion_guard') config.lockRecursionGuard = value;
        if (key === 'lock_circuit_breaker') config.lockCircuitBreaker = value;
        if (key === 'lock_tdd_iron_law') config.lockTddIronLaw = value;
        if (key === 'lock_verification_phrases') config.lockVerificationPhrases = value;
        if (key === 'lock_audit_jsonl') config.lockAuditJsonl = value;
        if (key === 'lock_state_checksum') config.lockStateChecksum = value;
      }
      if (trimmed.startsWith('forbid_constructs:') || trimmed.startsWith('forbid_modules:')) {
        const key = trimmed.split(':')[0] ?? '';
        if (key === 'forbid_constructs') config.forbidConstructs = parseListNext(text, lines, raw);
        if (key === 'forbid_modules') config.forbidModules = parseListNext(text, lines, raw);
      }
    }
    if (indent === 4 && section === 'topology') {
      const m = trimmed.match(/^([a-z_]+):\s*(\d+)$/);
      if (m && m[1] && m[2]) {
        if (m[1] === 'min_raft_threshold') config.topology.minRaftThreshold = parseInt(m[2], 10);
        if (m[1] === 'max_parallel_uncoordinated')
          config.topology.maxParallelUncoordinated = parseInt(m[2], 10);
      }
    }
    if (indent === 4 && section === 'budget') {
      const m = trimmed.match(/^([a-z_]+):\s*(\d+)$/);
      if (m && m[1] && m[2]) {
        if (m[1] === 'warn_at_pct') config.budget.warnAtPct = parseInt(m[2], 10);
        if (m[1] === 'reject_at_pct') config.budget.rejectAtPct = parseInt(m[2], 10);
        if (m[1] === 'default_budget') config.budget.defaultBudget = parseInt(m[2], 10);
      }
    }
  }
  return config;
}

function parseListNext(_text: string, lines: string[], headerLine: string): string[] {
  const idx = lines.indexOf(headerLine);
  if (idx < 0) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i] ?? '';
    const indent = l.length - l.trimStart().length;
    if (indent === 0) break;
    if (indent === 4) {
      const m = l.match(/^-\s*(.+)$/);
      if (m && m[1]) out.push(m[1].trim());
    }
  }
  return out;
}
