/**
 * vNext canonical 9-tool registry integration test.
 */

import { describe, it, expect } from 'vitest';
import {
  TOOL_REGISTRY,
  getToolDefinition,
  getToolNames,
  formatToolDefinition,
  getFormattedToolDefinitions,
  validateRegistryConsistency,
} from '../../packages/mcp-server/src/tool-registry';
import { RAW_HANDLERS, getRegistryErrors } from '../../packages/mcp-server/src/index';

const UNIFIED = [
  'aza_session',
  'aza_prd',
  'aza_loop',
  'aza_spec',
  'aza_quality',
  'aza_finish',
  'aza_memory',
  'aza_meta',
  'aza_auto',
];

describe('vNext canonical tool-registry', () => {
  it('exposes exactly 9 canonical tools', () => {
    expect(TOOL_REGISTRY.length).toBe(9);
    expect(getToolNames().sort()).toEqual([...UNIFIED].sort());
  });

  it('every tool has whenToUse + description + object schema', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.whenToUse.length).toBeGreaterThan(10);
      expect(tool.description.length).toBeGreaterThan(5);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.name.startsWith('aza_')).toBe(true);
    }
  });

  it('getToolDefinition resolves unified names', () => {
    const t = getToolDefinition('aza_prd');
    expect(t?.name).toBe('aza_prd');
    expect(formatToolDefinition(t!).description.startsWith('Use when ')).toBe(true);
  });

  it('handlers ≡ registry (zero drift)', () => {
    expect(validateRegistryConsistency(RAW_HANDLERS).length).toBe(0);
    expect(getRegistryErrors().length).toBe(0);
  });

  it('formatted list has 9 entries', () => {
    expect(getFormattedToolDefinitions().length).toBe(9);
  });
});
