/**
 * v13 — P3.2: Memory Key Formatter
 *
 * Convenience wrappers around the AgentDB namespace module. The functions
 * in this file are the public API that knowledge injection code should
 * use; they always validate the resulting key.
 */

import { validateNamespace, formatKey, type NamespaceValidation } from './namespace';

/**
 * Build an AgentDB key from a (namespace, scope, id) triple and validate it.
 * Throws on invalid input.
 */
export function makeKey(namespace: string, scope: string, id: string): string {
  const key = formatKey(namespace, scope, id);
  const v = validateNamespace(key);
  if (!v.valid) {
    throw new Error(`makeKey: invalid key "${key}": ${v.reason}`);
  }
  return key;
}

/**
 * Safe wrapper that returns a validation result instead of throwing.
 */
export function tryMakeKey(namespace: string, scope: string, id: string): NamespaceValidation {
  const key = formatKey(namespace, scope, id);
  return validateNamespace(key);
}
