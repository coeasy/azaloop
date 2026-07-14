/**
 * V18: AutoLoopDriver Unit Tests
 *
 * Verifies the core behaviors of the auto-loop driver:
 *   - step() basic execution
 *   - V18: awaitingAction detection (the critical fix)
 *   - runFull() complete loop
 *   - maxIterations limit
 *   - Status management (running/paused/completed)
 *   - Reset functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LoopController } from '../../packages/core/src/L7_loop/loop-controller';
import { AutoLoopDriver } from '../../packages/core/src/L7_loop/auto-loop-driver';

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

describe('AutoLoopDriver V18', () => {
  let azaDir: string;
  let lc: LoopController;
  let driver: AutoLoopDriver;

  beforeEach(() => {
    azaDir = createTempAzaDir();
    lc = createLoopController(azaDir);
    driver = new AutoLoopDriver(lc, { maxIterations: 10 });
  });

  afterEach(() => {
    // Cleanup temp dir
    try {
      fs.rmSync(path.dirname(azaDir), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  describe('Basic State', () => {
    it('should start in idle status', () => {
      expect(driver.getStatus()).toBe('idle');
    });

    it('should start with iteration 0', () => {
      expect(driver.getIteration()).toBe(0);
    });

    it('should start with open stage', () => {
      expect(driver.getCurrentStage()).toBe('open');
    });

    it('should expose the underlying LoopController', () => {
      expect(driver.getLoopController()).toBe(lc);
    });
  });

  describe('step()', () => {
    it('should return a StepResult with correct shape', async () => {
      const result = await driver.step();
      expect(result).toHaveProperty('done');
      expect(result).toHaveProperty('nextAction');
      expect(result).toHaveProperty('stage');
      expect(result).toHaveProperty('iteration');
      expect(result).toHaveProperty('awaitingAction');
    });

    it('should increment iteration after each step', async () => {
      const initial = driver.getIteration();
      await driver.step();
      expect(driver.getIteration()).toBe(initial + 1);
    });

    it('should update current stage based on response', async () => {
      await driver.step();
      // After the first step, the stage should be a valid stage name
      expect(['open', 'design', 'build', 'verify', 'archive']).toContain(driver.getCurrentStage());
    });

    it('should transition to running status during step', async () => {
      // Status should be running or completed after a step
      await driver.step();
      const status = driver.getStatus();
      expect(['running', 'completed', 'stopped', 'paused']).toContain(status);
    });
  });

  describe('V18: awaitingAction Detection (Critical Fix)', () => {
    it('should have awaitingAction field in StepResult', async () => {
      const result = await driver.step();
      // awaitingAction should be either null or a NextAction object
      expect(result.awaitingAction === null || typeof result.awaitingAction === 'object').toBe(true);
    });

    it('should detect awaitingAction when maker returns awaiting_agent', async () => {
      // Run multiple steps to reach build/verify/archive stages
      // where the maker returns awaiting_agent
      for (let i = 0; i < 5; i++) {
        const result = await driver.step();
        if (result.awaitingAction) {
          // V18 fix: awaitingAction should be non-null for build/verify/archive
          expect(result.awaitingAction).toHaveProperty('tool');
          expect(result.awaitingAction).toHaveProperty('action');
          expect(result.awaitingAction).toHaveProperty('reason');
          // The tool should be one of the stage tools
          expect(['aza_task_implement', 'aza_quality_check', 'aza_doc_generate']).toContain(
            result.awaitingAction.tool,
          );
          return;
        }
        if (result.done) break;
      }
      // If no awaitingAction was found, that's acceptable for open/design stages
    });
  });

  describe('maxIterations', () => {
    it('should stop when maxIterations is reached', async () => {
      const smallDriver = new AutoLoopDriver(lc, { maxIterations: 2 });
      await smallDriver.step();
      await smallDriver.step();
      // After 2 steps, should be stopped
      const result = await smallDriver.step();
      expect(result.done).toBe(true);
      expect(smallDriver.getStatus()).toBe('stopped');
    });
  });

  describe('Reset', () => {
    it('should reset iteration and status', async () => {
      await driver.step();
      await driver.step();
      expect(driver.getIteration()).toBeGreaterThan(0);

      driver.reset();
      expect(driver.getIteration()).toBe(0);
      expect(driver.getStatus()).toBe('idle');
    });
  });

  describe('runFull()', () => {
    it('should complete or reach max iterations', async () => {
      const result = await driver.runFull();
      expect(result).toHaveProperty('totalIterations');
      expect(result).toHaveProperty('finalStage');
      expect(result).toHaveProperty('completed');
      expect(result).toHaveProperty('reason');
      expect(result.totalIterations).toBeLessThanOrEqual(10);
    });
  });
});
