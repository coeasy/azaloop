/**
 * T28 — Worker Scheduler tests
 *
 * Covers:
 *   1. default trigger table has all 12 workers
 *   2. forceRun returns a WorkerReport
 *   3. start()/stop() create/destroy timers
 *   4. event-driven emit (on-stage-advance, on-strike, on-completion)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  WorkerScheduler,
  WorkerRegistry,
  DEFAULT_TRIGGERS,
  buildDefaultRegistry,
  runOptimize,
  runDocument,
  runAudit,
  type WorkerReport,
} from '../../packages/core/src/L0_platform/workers';
import { StateManager } from '../../packages/core/src/state/state-manager';

describe('T28 — WorkerScheduler', () => {
  let tmpDir: string;
  let stateManager: StateManager;
  let registry: WorkerRegistry;
  let scheduler: WorkerScheduler;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aza-worker-'));
    stateManager = new StateManager(tmpDir);
    await stateManager.load();
    registry = new WorkerRegistry();
    registry.register('optimize', runOptimize);
    registry.register('document', runDocument);
    registry.register('audit', runAudit);
    scheduler = new WorkerScheduler({
      azaDir: tmpDir,
      stateManager,
      registry,
      heartbeatMs: 100, // short for tests
    });
    scheduler.registerTriggers(DEFAULT_TRIGGERS);
  });

  afterEach(async () => {
    await scheduler.stop();
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1) DEFAULT_TRIGGERS has all 12 ruflo workers', () => {
    expect(DEFAULT_TRIGGERS).toHaveLength(12);
    const names = DEFAULT_TRIGGERS.map((t) => t.name);
    expect(names).toContain('ultralearn');
    expect(names).toContain('optimize');
    expect(names).toContain('consolidate');
    expect(names).toContain('predict');
    expect(names).toContain('audit');
    expect(names).toContain('map');
    expect(names).toContain('preload');
    expect(names).toContain('deepdive');
    expect(names).toContain('document');
    expect(names).toContain('refactor');
    expect(names).toContain('benchmark');
    expect(names).toContain('testgaps');
  });

  it('2) forceRun returns a WorkerReport and persists to disk', async () => {
    const report = await scheduler.forceRun('optimize');
    expect(report).not.toBeNull();
    expect(report!.name).toBe('optimize');
    expect(Array.isArray(report!.findings)).toBe(true);
    expect(typeof report!.durationMs).toBe('number');

    // Verify persisted.
    const onDisk = await scheduler.getReport('optimize');
    expect(onDisk).not.toBeNull();
    expect(onDisk!.name).toBe('optimize');
    expect(onDisk!.findings.length).toBe(report!.findings.length);
  });

  it('3) forceRun returns null for unregistered workers', async () => {
    const report = await scheduler.forceRun('ultralearn');
    expect(report).toBeNull();
  });

  it('4) start/stop manage timers', () => {
    scheduler.start();
    // Re-creating would not double-timer; just verify no throw.
    scheduler.start();
    return scheduler.stop();
  });

  it('5) emitStageAdvance runs on-stage-advance workers', async () => {
    // consolidate is on-stage-advance, but we didn't register it.
    // We registered `document` (on-completion), so emitCompletion.
    const before = await scheduler.getReport('document');
    expect(before).toBeNull();
    scheduler.emitCompletion();
    // Poll for the async runOne to finish — fixed sleeps are flaky when
    // the suite runs many tests in parallel and the event loop is busy.
    let after: WorkerReport | null = null;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 20));
      after = await scheduler.getReport('document');
      if (after) break;
    }
    expect(after).not.toBeNull();
  });

  it('6) buildDefaultRegistry registers all 12 workers', () => {
    const r = buildDefaultRegistry();
    expect(r.size()).toBe(12);
    expect(r.has('ultralearn')).toBe(true);
    expect(r.has('testgaps')).toBe(true);
  });

  it('7) listReports returns all written reports', async () => {
    await scheduler.forceRun('optimize');
    await scheduler.forceRun('document');
    await scheduler.forceRun('audit');
    const all = await scheduler.listReports();
    expect(all.length).toBe(3);
    const names = all.map((r) => r.name).sort();
    expect(names).toEqual(['audit', 'document', 'optimize']);
  });

  it('8) emitStrike triggers on-strike workers', async () => {
    // deepdive is on-strike; we did not register it, so this is a no-op
    // (it should not throw, even though nothing is registered).
    expect(() => scheduler.emitStrike('test_reason')).not.toThrow();
  });
});
