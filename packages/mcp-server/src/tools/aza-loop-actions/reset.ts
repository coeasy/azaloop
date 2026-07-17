/**
 * reset action — 清空 scheduler/driver/controller 缓存，重置整个 loop。
 */
import type { ActionHandler } from './context';
import { buildActionResponse } from './response-builder';
import { normalizeRoot } from './normalize';

export const resetAction: ActionHandler = async (ctx) => {
  const normalized = normalizeRoot(ctx.root);
  ctx.scheduler.reset();
  ctx.driver.reset();
  // Drop cached controller so a fresh PRD cycle does not inherit strikes/circuits.
  // Note: cache clearing is handled by the caller (handleAutoLoop) since it
  // has direct access to the singleton caches. The action only resets runtime
  // state of the current driver/scheduler instances.
  return buildActionResponse(ctx, {
    data: {
      status: 'reset',
      iteration: 0,
      cache_cleared: true,
      cache_key: normalized,
    },
    nextAction: {
      tool: 'aza_loop',
      action: 'full',
      reason: 'Caches cleared — continue full-auto loop (cross-session safe)',
    },
    metadata: { iteration: 0, progress: '0%', stage: 'open' },
  });
};
