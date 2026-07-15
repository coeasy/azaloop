/**
 * v14 — v13-P7.4: Capability Matrix Reader
 *
 * Lightweight YAML reader for the `capability-matrix.yaml` file. We
 * use a small custom parser (no `js-yaml` dependency at the core
 * level) because the file is a simple, predictable shape.
 *
 * Reference: ruvnet/ruflo capability matrix + mindfold-ai/Trellis
 * `Supported Platforms` table.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Public types ─────────────────────────────────────────────

export type CapabilityValue = boolean | 'partial';

export interface ClientCapabilities {
  tier: 'T1' | 'T2' | 'T3';
  capabilities: Record<string, CapabilityValue>;
}

export interface CapabilityMatrix {
  clients: Record<string, ClientCapabilities>;
}

export type CapabilityName =
  | 'hooks'
  | 'rules'
  | 'mcp'
  | 'skills'
  | 'native_loop'
  | 'stop_hook'
  | 'webhook'
  | 'cron'
  | 'event_bus'
  | 'feature_flag'
  | 'secrets'
  | 'metrics';

// ── Default matrix (fallback) ────────────────────────────────

/**
 * Default capability matrix. Used when the file is missing.
 * Mirrors the most permissive values from `capability-matrix.yaml`.
 */
export const DEFAULT_CAPABILITY_MATRIX: CapabilityMatrix = {
  clients: {
    cursor: {
      tier: 'T1',
      capabilities: {
        hooks: true,
        rules: true,
        mcp: true,
        skills: true,
        native_loop: true,
        stop_hook: true,
        webhook: true,
        cron: false,
        event_bus: true,
        feature_flag: false,
        secrets: false,
        metrics: true,
      },
    },
    'claude-code': {
      tier: 'T1',
      capabilities: {
        hooks: true,
        rules: true,
        mcp: true,
        skills: true,
        native_loop: true,
        stop_hook: true,
        webhook: true,
        cron: false,
        event_bus: true,
        feature_flag: false,
        secrets: false,
        metrics: true,
      },
    },
  },
};

// ── Public API ───────────────────────────────────────────────

/**
 * Resolve the default capability matrix file path.
 */
export function capabilityMatrixPath(azaDir: string = '.aza'): string {
  return path.join(azaDir, '..', 'packages', 'core', 'src', 'L0_platform', 'capability-matrix.yaml');
}

/**
 * Read the capability matrix from disk. Falls back to defaults if the
 * file is missing or malformed. Best-effort: never throws.
 */
export function readCapabilityMatrix(filePath?: string): CapabilityMatrix {
  const fp = filePath ?? capabilityMatrixPath();
  if (!fs.existsSync(fp)) {
    return DEFAULT_CAPABILITY_MATRIX;
  }
  try {
    const text = fs.readFileSync(fp, 'utf8');
    return parseCapabilityMatrix(text);
  } catch {
    return DEFAULT_CAPABILITY_MATRIX;
  }
}

/**
 * Get the capabilities of a specific client. Returns an empty
 * capability set if the client is unknown.
 */
export function getClientCapabilities(
  client: string,
  matrix?: CapabilityMatrix,
): ClientCapabilities {
  const m = matrix ?? readCapabilityMatrix();
  return (
    m.clients[client] ?? {
      tier: 'T3',
      capabilities: Object.fromEntries(
        // V18: Guard against undefined — noUncheckedIndexedAccess makes .cursor possibly undefined
        (Object.keys((DEFAULT_CAPABILITY_MATRIX.clients.cursor ?? { capabilities: {} }).capabilities) as CapabilityName[]).map(
          (k) => [k, false] as const,
        ),
      ),
    }
  );
}

/**
 * Check if a client supports a specific capability. Returns `false`
 * for unknown clients/capabilities.
 */
export function hasCapability(
  client: string,
  capability: CapabilityName,
  matrix?: CapabilityMatrix,
): boolean {
  const c = getClientCapabilities(client, matrix);
  const v = c.capabilities[capability];
  if (v === true) return true;
  if (v === 'partial') return capability === 'hooks';
  return false;
}

/**
 * List all clients of a given tier.
 */
export function listClientsByTier(
  tier: 'T1' | 'T2' | 'T3',
  matrix?: CapabilityMatrix,
): string[] {
  const m = matrix ?? readCapabilityMatrix();
  return Object.entries(m.clients)
    .filter(([, c]) => c.tier === tier)
    .map(([name]) => name);
}

// ── Minimal YAML parser ──────────────────────────────────────

/**
 * Parse the capability matrix YAML format. Supports the subset used
 * by `capability-matrix.yaml`:
 *   - `key:` lines at indent 0
 *   - `key:` lines at indent 2 (nested under `clients:` or `capabilities:`)
 *   - `key: value` lines at indent 4 (nested under each client)
 *
 * Booleans and strings ('true', 'false', 'partial', 'T1', 'T2', 'T3')
 * are converted to their typed values.
 */
export function parseCapabilityMatrix(text: string): CapabilityMatrix {
  const matrix: CapabilityMatrix = { clients: {} };
  const lines = text.split(/\r?\n/);
  let currentClient: string | null = null;
  let currentCapabilities: Record<string, CapabilityValue> | null = null;

  for (const raw of lines) {
    if (raw.trim().startsWith('#') || raw.trim().length === 0) continue;
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (indent === 0) {
      if (trimmed === 'clients:') {
        // start of clients section
        currentClient = null;
        currentCapabilities = null;
      }
      continue;
    }
    if (indent === 2) {
      const m = trimmed.match(/^([a-z0-9-]+):\s*$/);
      if (m && m[1]) {
        currentClient = m[1];
        currentCapabilities = {};
        matrix.clients[currentClient] = {
          tier: 'T3',
          capabilities: currentCapabilities,
        };
      }
      continue;
    }
    if (indent === 4) {
      if (!currentClient || !currentCapabilities) continue;
      const m = trimmed.match(/^([a-z0-9_]+):\s*(.*)$/);
      if (!m || !m[1] || m[2] === undefined) continue;
      const key = m[1];
      const value = m[2].trim();
      if (key === 'tier') {
        if (value === 'T1' || value === 'T2' || value === 'T3') {
          const clientEntry = matrix.clients[currentClient];
          if (clientEntry) clientEntry.tier = value;
        }
      } else if (key === 'capabilities') {
        // start of capabilities map; keys follow at indent 6
      } else {
        // Allow inline cap at indent 4 for flat fixtures
        currentCapabilities[key] = parseScalar(value);
      }
      continue;
    }
    // capability entries under `capabilities:` (indent 6)
    if (indent >= 6) {
      if (!currentClient || !currentCapabilities) continue;
      const m = trimmed.match(/^([a-z0-9_]+):\s*(.*)$/);
      if (!m || !m[1] || m[2] === undefined) continue;
      currentCapabilities[m[1]] = parseScalar(m[2].trim());
    }
  }
  return matrix;
}

function parseScalar(value: string): CapabilityValue {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'partial') return 'partial';
  return value as CapabilityValue;
}
