/**
 * v0.2 — Converged 8-tool registry integration test.
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
import { resolveToolCall } from '../../packages/mcp-server/src/legacy-router';

const UNIFIED = [
  'aza_session',
  'aza_prd',
  'aza_loop',
  'aza_spec',
  'aza_quality',
  'aza_finish',
  'aza_memory',
  'aza_meta',
];

describe('v0.2 converged tool-registry', () => {
  it('exposes exactly 8 unified tools', () => {
    expect(TOOL_REGISTRY.length).toBe(8);
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

  it('formatted list has 8 entries', () => {
    expect(getFormattedToolDefinitions().length).toBe(8);
  });

  it('legacy names resolve to unified tools', () => {
    expect(resolveToolCall('aza_prd_review', { title: 't', description: 'd' }).tool).toBe('aza_prd');
    expect(resolveToolCall('aza_auto_loop', { action: 'full' }).tool).toBe('aza_loop');
    expect(resolveToolCall('aza_finish_work', {}).tool).toBe('aza_finish');
    expect(resolveToolCall('aza_quality_check', {}).tool).toBe('aza_quality');
  });
});
