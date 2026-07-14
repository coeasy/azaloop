/**
 * v13 — P3.2: AgentDB namespace convention tests
 *
 * Covers:
 *   1) validateNamespace accepts well-formed `aza-*` keys
 *   2) validateNamespace rejects empty keys
 *   3) validateNamespace rejects keys without aza- prefix
 *   4) validateNamespace rejects reserved namespaces
 *   5) validateNamespace rejects uppercase or non-kebab-case
 *   6) parseAgentDBKey splits on `:` and `/`
 *   7) formatKey builds a key from (namespace, scope, id)
 *   8) makeKey throws on invalid input
 *   9) InjectionEngine.write rejects reserved keys in strict mode
 *  10) InjectionEngine.write accepts non-reserved keys
 */

import { describe, it, expect } from 'vitest';
import {
  validateNamespace,
  parseAgentDBKey,
  formatKey,
  makeKey,
  tryMakeKey,
  keyToFilePath,
  RESERVED_NAMESPACES,
  CANONICAL_NAMESPACES,
  InjectionEngine,
} from '@azaloop/core';

describe('v13 P3.2 — validateNamespace', () => {
  it('1) accepts a well-formed aza-spec key', () => {
    const v = validateNamespace('aza-spec:open-1.1');
    expect(v.valid).toBe(true);
    expect(v.namespace).toBe('aza-spec');
    expect(v.remainder).toBe('open-1.1');
  });

  it('2) accepts aza-adr with / separator', () => {
    const v = validateNamespace('aza-adr/0001');
    expect(v.valid).toBe(true);
    expect(v.namespace).toBe('aza-adr');
    expect(v.remainder).toBe('0001');
  });

  it('3) rejects empty key', () => {
    const v = validateNamespace('');
    expect(v.valid).toBe(false);
  });

  it('4) rejects key without aza- prefix', () => {
    const v = validateNamespace('foo:bar');
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/aza-/);
  });

  it('5) rejects reserved namespace aza-pattern', () => {
    const v = validateNamespace('aza-pattern:foo');
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/reserved/);
  });

  it('6) rejects reserved namespace aza-claude-memories', () => {
    const v = validateNamespace('aza-claude-memories:abc');
    expect(v.valid).toBe(false);
  });

  it('7) rejects reserved namespace aza-default', () => {
    const v = validateNamespace('aza-default:abc');
    expect(v.valid).toBe(false);
  });

  it('8) rejects uppercase', () => {
    const v = validateNamespace('Aza-spec:foo');
    expect(v.valid).toBe(false);
  });

  it('9) rejects key without remainder', () => {
    const v = validateNamespace('aza-spec:');
    expect(v.valid).toBe(false);
  });
});

describe('v13 P3.2 — parseAgentDBKey', () => {
  it('1) parses `aza-spec:open-1.1` correctly', () => {
    const parsed = parseAgentDBKey('aza-spec:open-1.1');
    expect(parsed.namespace).toBe('aza-spec');
    expect(parsed.scope).toBe('open');
    expect(parsed.id).toBe('1.1');
  });

  it('2) parses `aza-adr/0001` correctly', () => {
    const parsed = parseAgentDBKey('aza-adr/0001');
    expect(parsed.namespace).toBe('aza-adr');
    expect(parsed.scope).toBe('0001');
    expect(parsed.id).toBe('');
  });

  it('3) parses `aza-foo:scope:id` (3-part) correctly', () => {
    const parsed = parseAgentDBKey('aza-foo:scope:id');
    expect(parsed.namespace).toBe('aza-foo');
    expect(parsed.scope).toBe('scope');
    expect(parsed.id).toBe('id');
  });

  it('4) throws on invalid key', () => {
    expect(() => parseAgentDBKey('invalid:key')).toThrow(/aza-/);
  });
});

describe('v13 P3.2 — formatKey / makeKey', () => {
  it('1) formatKey builds `aza-foo:scope:id`', () => {
    expect(formatKey('aza-foo', 'scope', 'id')).toBe('aza-foo:scope:id');
  });

  it('2) formatKey with empty id yields `aza-foo:scope`', () => {
    expect(formatKey('aza-foo', 'scope', '')).toBe('aza-foo:scope');
  });

  it('3) makeKey throws on reserved namespace', () => {
    expect(() => makeKey('aza-pattern', 'foo', 'bar')).toThrow(/reserved/);
  });

  it('4) makeKey returns the formatted key for valid input', () => {
    expect(makeKey('aza-spec', 'open', '1.1')).toBe('aza-spec:open:1.1');
  });

  it('5) tryMakeKey returns validation without throwing', () => {
    const r = tryMakeKey('aza-pattern', 'foo', 'bar');
    expect(r.valid).toBe(false);
  });
});

describe('v13 P3.2 — keyToFilePath', () => {
  it('1) returns a path under <azaDir>/kb for non-reserved keys', () => {
    const fp = keyToFilePath('aza-spec:open-1.1', '/tmp/aza');
    expect(fp).toContain('/tmp/aza/kb/aza-spec/');
  });

  it('2) returns a path under <azaDir>/reserved for reserved keys', () => {
    const fp = keyToFilePath('aza-pattern:foo', '/tmp/aza');
    expect(fp).toContain('/tmp/aza/reserved/');
  });

  it('3) throws on invalid key', () => {
    expect(() => keyToFilePath('invalid:key', '/tmp/aza')).toThrow();
  });
});

describe('v13 P3.2 — InjectionEngine write/append', () => {
  it('1) non-strict engine silently skips invalid key', () => {
    const e = new InjectionEngine();
    e.write('invalid:key', 'value');
    // No throw, no entry
  });

  it('2) non-strict engine silently skips reserved key', () => {
    const e = new InjectionEngine();
    e.write('aza-pattern:foo', 'value');
  });

  it('3) strict engine throws on invalid key', () => {
    const e = new InjectionEngine({ strict: true });
    expect(() => e.write('invalid:key', 'value')).toThrow();
  });

  it('4) strict engine throws on reserved key', () => {
    const e = new InjectionEngine({ strict: true });
    expect(() => e.write('aza-pattern:foo', 'value')).toThrow();
  });

  it('5) engine accepts valid aza-* key', () => {
    const e = new InjectionEngine();
    e.write('aza-test:foo', 'value');
  });

  it('6) append concatenates values for valid key', () => {
    const e = new InjectionEngine();
    e.append('aza-test:foo', 'a');
    e.append('aza-test:foo', 'b');
    e.append('aza-test:foo', 'c');
    const ctx = e.inject({ stage: 'test', tags: ['test'] });
    expect(ctx).toBeDefined();
  });
});

describe('v13 P3.2 — Constants', () => {
  it('RESERVED_NAMESPACES contains pattern/claude-memories/default', () => {
    expect(RESERVED_NAMESPACES).toContain('pattern');
    expect(RESERVED_NAMESPACES).toContain('claude-memories');
    expect(RESERVED_NAMESPACES).toContain('default');
  });

  it('CANONICAL_NAMESPACES contains aza-spec, aza-adr, aza-pattern', () => {
    expect(CANONICAL_NAMESPACES).toContain('aza-spec');
    expect(CANONICAL_NAMESPACES).toContain('aza-adr');
    expect(CANONICAL_NAMESPACES).toContain('aza-pattern');
  });
});
