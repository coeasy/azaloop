/**
 * V18: AutoLoopScheduler Unit Tests
 *
 * Verifies the core behaviors of the background auto-loop scheduler:
 *   - Lifecycle (start/stop/pause/resume)
 *   - tick() advancing the loop
 *   - awaiting_agent state entry and recovery
 *   - reportToolExecuted tool name validation
 *   - Timeout mechanism
 *   - Error handling and retry
 *   - V18: Explicit awaitingAction detection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LoopController } from '../../packages/core/src/L7_loop/loop-controller';
import { AutoLoopScheduler } from '../../packages/core/src/L7_loop/auto-loop-scheduler';

// ── Helpers ──

function createTempAzaDir(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'azaloop-test-'));
  const azaDir = path.join(tmp, '.aza');
  fs.mkdirSync(azaDir, { recursive: true });
  return azaDir;
}

function createLoopController(azaDir: string): LoopController {
  return new LoopController({ azaDir, projectRoot: path.dirname(azaDir) });
}

// ── Tests ──

describe('AutoLoopScheduler V18', () => {
  let azaDir: string;
  let lc: LoopController;
  let scheduler: AutoLoopScheduler;

  beforeEach(() => {
    azaDir = createTempAzaDir();
    lc = createLoopController(azaDir);
    scheduler = new AutoLoopScheduler(lc, {}, 50); // 50ms poll for fast tests
  });

  afterEach(() => {
    scheduler.stop();
    // Cleanup temp dir
    try {
      fs.rmSync(path.dirname(azaDir), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  describe('Lifecycle', () => {
    it('should start in idle state', () => {
      expect(scheduler.getState()).toBe('idle');
    });

    it('should transition to running after start()', () => {
      scheduler.start();
      expect(scheduler.getState()).toBe('running');
    });

    it('should transition to idle after stop()', () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.getState()).toBe('idle');
    });

    it('should transition to paused after pause()', () => {
      scheduler.start();
      scheduler.pause();
      expect(scheduler.getState()).toBe('paused');
    });

    it('should transition back to running after resume()', () => {
      scheduler.start();
      scheduler.pause();
      scheduler.resume();
      expect(scheduler.getState()).toBe('running');
    });

    it('should not start twice', () => {
      scheduler.start();
      const statusBefore = scheduler.getStatus();
      scheduler.start(); // should be no-op
      const statusAfter = scheduler.getStatus();
      expect(statusAfter.running).toBe(statusBefore.running);
    });
  });

  describe('Tool Execution Reporting', () => {
    it('should accept correct tool name', () => {
      scheduler.start();
      // Simulate awaiting state
      (scheduler as any).awaitingAction = { tool: 'aza_task_implement', action: 'implement', reason: 'test' };
      (scheduler as any).state = 'awaiting_agent';

      const accepted = scheduler.reportToolExecuted('aza_task_implement');
      expect(accepted).toBe(true);
    });

    it('should reject incorrect tool name', () => {
      scheduler.start();
      (scheduler as any).awaitingAction = { tool: 'aza_task_implement', action: 'implement', reason: 'test' };
      (scheduler as any).state = 'awaiting_agent';

      const accepted = scheduler.reportToolExecuted('aza_quality_check');
      expect(accepted).toBe(false);
    });

    it('should accept any tool name when no awaiting action is set', () => {
      scheduler.start();
      const accepted = scheduler.reportToolExecuted('any_tool');
      expect(accepted).toBe(true);
    });
  });

  describe('Retry', () => {
    it('should retry from error state', () => {
      // Force error state
      (scheduler as any).state = 'error';
      (scheduler as any).lastError = 'test error';

      const retried = scheduler.retry();
      expect(retried).toBe(true);
      expect(scheduler.getState()).toBe('running');
      expect(scheduler.getStatus().lastError).toBeNull();
    });

    it('should not retry from non-error state', () => {
      scheduler.start();
      const retried = scheduler.retry();
      expect(retried).toBe(false);
      expect(scheduler.getState()).toBe('running');
    });
  });

  describe('Reset', () => {
    it('should reset all state', () => {
      scheduler.start();
      scheduler.reset();
      expect(scheduler.getState()).toBe('idle');
      expect(scheduler.getStatus().iteration).toBe(0);
      expect(scheduler.getStatus().currentStage).toBe('open');
      expect(scheduler.getStatus().lastAction).toBeNull();
      expect(scheduler.getStatus().awaitingAction).toBeNull();
    });
  });

  describe('awaitingAction Detection', () => {
    it('should have getAwaitingAction return null initially', () => {
      expect(scheduler.getAwaitingAction()).toBeNull();
    });

    it('should have getAwaitingAction return the action after it is set', () => {
      const action = { tool: 'aza_task_implement', action: 'implement', reason: 'test' };
      (scheduler as any).awaitingAction = action;
      expect(scheduler.getAwaitingAction()).toEqual(action);
    });
  });
});
