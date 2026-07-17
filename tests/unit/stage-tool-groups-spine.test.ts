/**
 * Ensures STAGE_TOOL_GROUPS never hides the full-auto spine tools.
 * Regression: open-only session/prd/meta made aza_loop/aza_auto invisible to hosts.
 */
import { describe, it, expect } from 'vitest';
import {
  STAGE_TOOL_GROUPS,
  getFormattedToolDefinitionsForStage,
  getFormattedToolDefinitions,
  TOOL_REGISTRY,
} from '../../packages/mcp-server/src/tool-registry.ts';

const SPINE = [
  'aza_session',
  'aza_loop',
  'aza_memory',
  'aza_meta',
  'aza_quality',
  'aza_auto',
] as const;

describe('STAGE_TOOL_GROUPS spine visibility', () => {
  for (const stage of ['open', 'design', 'build', 'verify', 'archive'] as const) {
    it(`${stage} includes full-auto spine (loop + auto)`, () => {
      const group = STAGE_TOOL_GROUPS[stage];
      expect(group).toBeDefined();
      for (const tool of SPINE) {
        expect(group).toContain(tool);
      }
    });
  }

  it('open stage exposes aza_prd and aza_loop so approve→full works', () => {
    const open = STAGE_TOOL_GROUPS.open;
    expect(open).toContain('aza_prd');
    expect(open).toContain('aza_loop');
    expect(open).toContain('aza_auto');
  });

  it('getFormattedToolDefinitionsForStage(open) returns loop+auto defs', () => {
    const defs = getFormattedToolDefinitionsForStage('open');
    const names = defs.map((d) => d.name);
    expect(names).toContain('aza_loop');
    expect(names).toContain('aza_auto');
    expect(names).toContain('aza_prd');
  });

  it('full registry includes aza_auto', () => {
    expect(TOOL_REGISTRY.map((t) => t.name)).toContain('aza_auto');
    expect(getFormattedToolDefinitions().map((d) => d.name)).toContain('aza_auto');
  });
});
