import { describe, it, expect } from 'vitest';
import {
  parseCapabilityMatrix,
  hasCapability,
  getClientCapabilities,
  listClientsByTier,
  DEFAULT_CAPABILITY_MATRIX,
} from '../../packages/core/src/L0_platform/capability-reader';

const SAMPLE_YAML = `
clients:
  cursor:
    tier: T1
    capabilities:
      hooks: true
      rules: true
      mcp: true
      skills: true
      native_loop: true
      stop_hook: true
      webhook: true
      cron: false
      event_bus: true
      feature_flag: false
      secrets: false
      metrics: true

  cline:
    tier: T2
    capabilities:
      hooks: false
      rules: true
      mcp: true
      skills: true
      native_loop: true
      stop_hook: false
      webhook: false
      cron: false
      event_bus: true
      feature_flag: false
      secrets: false
      metrics: false
`;

describe('Capability Matrix Reader (v14-P7.4)', () => {
  it('1) parseCapabilityMatrix returns clients and tiers', () => {
    const m = parseCapabilityMatrix(SAMPLE_YAML);
    expect(Object.keys(m.clients).sort()).toEqual(['cline', 'cursor']);
    expect(m.clients.cursor.tier).toBe('T1');
    expect(m.clients.cline.tier).toBe('T2');
  });

  it('2) parseCapabilityMatrix handles 6 new capabilities (v14)', () => {
    const m = parseCapabilityMatrix(SAMPLE_YAML);
    expect(m.clients.cursor.capabilities.webhook).toBe(true);
    expect(m.clients.cursor.capabilities.cron).toBe(false);
    expect(m.clients.cursor.capabilities.event_bus).toBe(true);
    expect(m.clients.cursor.capabilities.feature_flag).toBe(false);
    expect(m.clients.cursor.capabilities.secrets).toBe(false);
    expect(m.clients.cursor.capabilities.metrics).toBe(true);
  });

  it('3) parseCapabilityMatrix handles comments and blank lines', () => {
    const text = `
# header
clients:
  # client comment
  x:
    tier: T3
    capabilities:
      mcp: true
`;
    const m = parseCapabilityMatrix(text);
    expect(m.clients.x.tier).toBe('T3');
    expect(m.clients.x.capabilities.mcp).toBe(true);
  });

  it('4) getClientCapabilities returns empty set for unknown client', () => {
    const c = getClientCapabilities('unknown-client');
    expect(c.tier).toBe('T3');
    expect(c.capabilities.hooks).toBe(false);
  });

  it('5) hasCapability returns true for T1 clients on default caps', () => {
    const m = DEFAULT_CAPABILITY_MATRIX;
    expect(hasCapability('cursor', 'hooks', m)).toBe(true);
    expect(hasCapability('cursor', 'webhook', m)).toBe(true);
    expect(hasCapability('cursor', 'cron', m)).toBe(false);
    expect(hasCapability('unknown', 'hooks', m)).toBe(false);
  });

  it('6) hasCapability treats "partial" as true for hooks only', () => {
    const m = parseCapabilityMatrix(`
clients:
  trae:
    tier: T1
    capabilities:
      hooks: partial
      rules: true
      mcp: true
`);
    expect(hasCapability('trae', 'hooks', m)).toBe(true);
    expect(hasCapability('trae', 'rules', m)).toBe(true);
    expect(hasCapability('trae', 'webhook', m)).toBe(false);
  });

  it('7) listClientsByTier filters by tier', () => {
    const m = parseCapabilityMatrix(SAMPLE_YAML);
    expect(listClientsByTier('T1', m)).toEqual(['cursor']);
    expect(listClientsByTier('T2', m)).toEqual(['cline']);
    expect(listClientsByTier('T3', m)).toEqual([]);
  });
});
