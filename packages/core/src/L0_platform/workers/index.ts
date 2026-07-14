/**
 * Worker registry barrel (T28)
 *
 * Re-exports all 12 ruflo-style workers + scheduler/registry types.
 * Consumers typically:
 *
 *   import { WorkerScheduler, WorkerRegistry, runUltralearn, ... } from './workers';
 *
 *   const registry = new WorkerRegistry();
 *   registry.register('ultralearn', runUltralearn);
 *   // ... register the other 11
 *   const scheduler = new WorkerScheduler({ azaDir, stateManager, registry });
 *   scheduler.registerTriggers(DEFAULT_TRIGGERS);
 *   scheduler.start();
 */

export * from './scheduler';

// ── Worker implementations (12) ──

export { runUltralearn } from './ultralearn';
export { runOptimize } from './optimize';
export { runConsolidate } from './consolidate';
export { runPredict } from './predict';
export { runAudit } from './audit';
export { runMap } from './map';
export { runPreload } from './preload';
export { runDeepdive } from './deepdive';
export { runDocument } from './document';
export { runRefactor } from './refactor';
export { runBenchmark } from './benchmark';
export { runTestGaps } from './testgaps';

// ── Convenience: register all 12 with a fresh registry ──

import { WorkerRegistry } from './scheduler';
import { runUltralearn } from './ultralearn';
import { runOptimize } from './optimize';
import { runConsolidate } from './consolidate';
import { runPredict } from './predict';
import { runAudit } from './audit';
import { runMap } from './map';
import { runPreload } from './preload';
import { runDeepdive } from './deepdive';
import { runDocument } from './document';
import { runRefactor } from './refactor';
import { runBenchmark } from './benchmark';
import { runTestGaps } from './testgaps';

/**
 * Build a `WorkerRegistry` with all 12 ruflo workers pre-registered.
 * Pass the result to `WorkerScheduler` for a complete background
 * observation layer.
 */
export function buildDefaultRegistry(): WorkerRegistry {
  const r = new WorkerRegistry();
  r.register('ultralearn', runUltralearn);
  r.register('optimize', runOptimize);
  r.register('consolidate', runConsolidate);
  r.register('predict', runPredict);
  r.register('audit', runAudit);
  r.register('map', runMap);
  r.register('preload', runPreload);
  r.register('deepdive', runDeepdive);
  r.register('document', runDocument);
  r.register('refactor', runRefactor);
  r.register('benchmark', runBenchmark);
  r.register('testgaps', runTestGaps);
  return r;
}
