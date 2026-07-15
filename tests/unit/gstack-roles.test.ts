/**
 * Unit smoke for gstack roles + slash catalog.
 */
import { describe, it, expect } from 'vitest';
import { DynamicBinder } from '../../packages/core/src/L3_roles/dynamic-binder';

describe('gstack DynamicBinder roles', () => {
  const binder = new DynamicBinder();

  it('exposes ceo/eng/qa/ship/cso/design', () => {
    for (const name of ['ceo', 'eng', 'qa', 'ship', 'cso', 'design'] as const) {
      expect(binder.getRole(name).prompt.length).toBeGreaterThan(20);
    }
  });

  it('stage open prefers ceo', () => {
    const names = binder.getRoleForStage('open').map((r) => r.name);
    expect(names).toContain('ceo');
  });

  it('slash catalog has /aza-ceo and /aza-ship', () => {
    const slashes = binder.getSlashCatalog().map((s) => s.slash);
    expect(slashes).toContain('/aza-ceo');
    expect(slashes).toContain('/aza-ship');
  });

  it('maker/checker prompts are non-empty', () => {
    expect(binder.getMakerPrompt('build').length).toBeGreaterThan(10);
    expect(binder.getCheckerPrompt('verify').length).toBeGreaterThan(10);
  });
});
