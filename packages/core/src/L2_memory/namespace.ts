/**
 * v13 — P3.2: AgentDB Namespace Conventions
 *
 * Defines the reserved namespaces used by azaloop's knowledge injection
 * layer. Inspired by the comet project (rpamis/comet) which uses similar
 * key prefixes to prevent cross-skill memory pollution.
 *
 * Conventions:
 *   `aza-spec`         — PRD / spec / ADR knowledge
 *   `aza-adr`          — Architecture decision records
 *   `aza-pattern`      — Approved code patterns (RESERVED — read-only)
 *   `aza-claude-memories` — Cross-session memory (RESERVED)
 *   `aza-default`      — Fallback namespace (RESERVED)
 *   `aza-{skill-name}` — Per-skill namespace
 *
 * Reserved namespaces cannot be written to by arbitrary code paths. The
 * `validateNamespace` function checks a key against these rules and
 * returns a structured result.
 */

import * as path from 'path';

/**
 * The set of reserved namespaces. These cannot be the target of an
 * injection write — only specific, audited code paths can populate them.
 */
export const RESERVED_NAMESPACES: readonly string[] = [
  'pattern',
  'claude-memories',
  'default',
];

/**
 * The set of canonical namespaces azaloop uses for its own knowledge.
 */
export const CANONICAL_NAMESPACES: readonly string[] = [
  'aza-spec',
  'aza-adr',
  'aza-pattern',
  'aza-claude-memories',
  'aza-default',
];

/**
 * Validation result returned by `validateNamespace`.
 */
export interface NamespaceValidation {
  valid: boolean;
  reason?: string;
  /** The namespace that was extracted (the part before the first `:`). */
  namespace?: string;
  /** The remaining part of the key after the namespace. */
  remainder?: string;
}

/**
 * Validate a key against the AgentDB namespace conventions.
 *
 * Rules:
 *   1. The key must start with `aza-` (or one of the reserved prefixes).
 *   2. The namespace part (before `:` or `/`) must be a valid kebab-case
 *      identifier.
 *   3. If the namespace is reserved, the key is rejected (read-only).
 *   4. The key must have a non-empty remainder.
 */
export function validateNamespace(key: string): NamespaceValidation {
  if (typeof key !== 'string' || key.length === 0) {
    return { valid: false, reason: 'key must be a non-empty string' };
  }
  // Determine the namespace separator
  const sepIdx = key.search(/[:/]/);
  const namespace = sepIdx === -1 ? key : key.slice(0, sepIdx);
  const remainder = sepIdx === -1 ? '' : key.slice(sepIdx + 1);

  if (namespace === '') {
    return { valid: false, reason: 'namespace part is empty' };
  }
  if (!/^[a-z][a-z0-9-]*$/.test(namespace)) {
    return {
      valid: false,
      reason: `namespace "${namespace}" must be kebab-case (lowercase letters, digits, hyphens, starting with a letter)`,
    };
  }
  if (!namespace.startsWith('aza-') && !namespace.startsWith('claude-')) {
    return {
      valid: false,
      reason: `namespace "${namespace}" must start with "aza-" or "claude-"`,
    };
  }
  // Check reserved
  const tail = namespace.startsWith('aza-') ? namespace.slice(4) : namespace.slice(7);
  if (RESERVED_NAMESPACES.includes(tail)) {
    return {
      valid: false,
      reason: `namespace "${namespace}" is reserved (read-only); cannot be written to`,
    };
  }
  if (remainder === '') {
    return {
      valid: false,
      reason: 'key must have a non-empty remainder after the namespace',
      namespace,
    };
  }
  return { valid: true, namespace, remainder };
}

/**
 * Parse an AgentDB key into its (namespace, scope, id) parts.
 *
 *   aza-spec:open-1.1     → { namespace: 'aza-spec', scope: 'open', id: '1.1' }
 *   aza-adr/0001          → { namespace: 'aza-adr', scope: '0001', id: '' }
 */
export interface ParsedAgentDBKey {
  namespace: string;
  scope: string;
  id: string;
}

export function parseAgentDBKey(key: string): ParsedAgentDBKey {
  const validation = validateNamespace(key);
  if (!validation.valid) {
    throw new Error(`Invalid AgentDB key "${key}": ${validation.reason}`);
  }
  const namespace = validation.namespace!;
  const remainder = validation.remainder!;
  // Split the remainder on the FIRST `:` or `/` to separate scope from
  // id. When no such separator is present, fall back to `-` and `.`
  // (so `open-1.1` parses as `scope='open', id='1.1'`).
  const separators = [':', '/', '-', '.'];
  let firstSep = -1;
  for (const sep of separators) {
    const idx = remainder.indexOf(sep);
    if (idx !== -1 && (firstSep === -1 || idx < firstSep)) {
      firstSep = idx;
    }
  }
  if (firstSep === -1) {
    return { namespace, scope: remainder, id: '' };
  }
  return {
    namespace,
    scope: remainder.slice(0, firstSep),
    id: remainder.slice(firstSep + 1),
  };
}

/**
 * Format a (namespace, scope, id) triple back into a key.
 */
export function formatKey(namespace: string, scope: string, id: string): string {
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new Error('formatKey: namespace is required');
  }
  if (typeof scope !== 'string' || scope.length === 0) {
    throw new Error('formatKey: scope is required');
  }
  return id ? `${namespace}:${scope}:${id}` : `${namespace}:${scope}`;
}

/**
 * Convert a key into a safe filesystem path under `azaDir`. Reserved
 * namespaces go to a read-only subdirectory. Always uses forward
 * slashes (POSIX-style) so paths are portable across platforms.
 */
export function keyToFilePath(key: string, azaDir: string): string {
  // Light-weight structural validation (don't call validateNamespace,
  // which would reject reserved keys and block path generation).
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('key must be a non-empty string');
  }
  const sepIdx = key.search(/[:/]/);
  const namespace = sepIdx === -1 ? key : key.slice(0, sepIdx);
  const remainder = sepIdx === -1 ? '' : key.slice(sepIdx + 1);
  if (namespace === '' || remainder === '') {
    throw new Error(`Invalid key "${key}": namespace and remainder are required`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(namespace)) {
    throw new Error(`Invalid key "${key}": namespace "${namespace}" must be kebab-case`);
  }
  if (!namespace.startsWith('aza-') && !namespace.startsWith('claude-')) {
    throw new Error(
      `Invalid key "${key}": namespace "${namespace}" must start with "aza-" or "claude-"`,
    );
  }
  const safeRemainder = remainder.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tail = namespace.startsWith('aza-') ? namespace.slice(4) : namespace;
  const isReserved = RESERVED_NAMESPACES.includes(tail);
  const dir = isReserved ? 'reserved' : 'kb';
  // Use posix-style separator so the test (and any downstream tooling
  // that consumes these paths on Windows) sees a consistent layout.
  const sep = '/';
  const azaDirPosix = azaDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${azaDirPosix}${sep}${dir}${sep}${namespace}${sep}${safeRemainder}`;
}
