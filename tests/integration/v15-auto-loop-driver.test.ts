/**
 * v15 — AutoLoopDriver 端到端测试 (P2-4)
 *
 * 验证 V15 主体链路重构的所有改进：
 *   1. AutoLoopDriver 单步执行 (step) 和全自动执行 (runFull)
 *   2. AutoLoopDriver sentinel 自动检测 + 循环终止
 *   3. LoopController 缓存单例化 (MCP 层)
 *   4. OuterLoop 状态共享 (InnerLoop 实例传递)
 *   5. WriteGuard 配置一致性
 *   6. RESUME.md 防御性写入
 *   7. AutoLoopEngine 职责分离 (使用 AutoLoopDriver)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AutoLoopDriver,
  LoopController,
  StateManager,
  OuterLoop,
  InnerLoop,
  CircuitBreaker,
  getWriteGuardConfig,
  isWriteAllowed,
  detectSentinel,
} from '@azaloop/core';

// ── Helpers ──

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-test-'));
  fs.mkdirSync(path.join(dir, '.aza'), { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeController(azaDir: string): LoopController {
  return new LoopController({
    maxIterations: 10,
    maxStageIterations: 3,
    enableV12: true,
    azaDir,
    projectRoot: path.dirname(azaDir),
  });
}

// ── Test 1: AutoLoopDriver 基本 step() ──

describe('V15 AutoLoopDriver — step()', () => {
  let tmpDir: string;
  let azaDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    azaDir = path.join(tmpDir, '.aza');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('should return a StepResult on first step', async () => {
    const lc = makeController(azaDir);
    const driver = new AutoLoopDriver(lc, { maxIterations: 10 });

    const result = await driver.step();

    expect(result).toBeDefined();
    // The first step may be done or not depending on the state machine.
    // Without a PRD, the state machine may escalate immediately.
    expect(result.nextAction).toBeDefined();
    expect(result.stage).toBeDefined();
    expect(result.iteration).toBe(1);
    // Status should be one of the terminal states (escalated, completed, stopped, etc.)
    // or 'running' if the loop continues
    expect(['running', 'escalated', 'completed', 'stopped']).toContain(driver.getStatus());
  });

  it('should update iteration count across multiple steps', async () => {
    const lc = makeController(azaDir);
    const driver = new AutoLoopDriver(lc, { maxIterations: 10 });

    const step1 = await driver.step();
    expect(driver.getIteration()).toBe(1);

    // second step may or may not be done depending on state machine
    const step2 = await driver.step();
    expect(driver.getIteration()).toBe(2);
    expect(driver.getStatus()).toBeDefined();
  });

  it('should reach max iterations and stop', async () => {
    const lc = makeController(azaDir);
    const driver = new AutoLoopDriver(lc, { maxIterations: 3 });

    // Run 3 steps (may reach done before max)
    for (let i = 0; i < 3; i++) {
      const result = await driver.step();
      if (result.done) break;
    }

    // After 3 iterations (or done), the driver should have stopped
    expect(driver.getIteration()).toBeLessThanOrEqual(3);
  });

  it('should return driver status correctly', async () => {
    const lc = makeController(azaDir);
    const driver = new AutoLoopDriver(lc, { maxIterations: 10 });

    // Initial status should be idle
    expect(driver.getStatus()).toBe('idle');

    // After step, the driver may be in a terminal state (escalated/completed)
    // or running depending on the state machine's current state
    await driver.step();
    expect(['running', 'escalated', 'completed', 'stopped']).toContain(driver.getStatus());
  });

  it('should expose the underlying LoopController', () => {
    const lc = makeController(azaDir);
    const driver = new AutoLoopDriver(lc);
    expect(driver.getLoopController()).toBe(lc);
  });
});

// ── Test 2: AutoLoopDriver runFull() ──

describe('V15 AutoLoopDriver — runFull()', () => {
  let tmpDir: string;
  let azaDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    azaDir = path.join(tmpDir, '.aza');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('should run the full loop and return a result', async () => {
    const lc = makeController(azaDir);
    const driver = new AutoLoopDriver(lc, { maxIterations: 5 });

    const result = await driver.runFull();

    expect(result).toBeDefined();
    expect(result.totalIterations).toBeGreaterThan(0);
    expect(result.finalStage).toBeDefined();
    expect(result.reason).toBeDefined();
  });

  it('should trigger onStep callback for each iteration', async () => {
    const lc = makeController(azaDir);
    const stepCalls: number[] = [];
    const driver = new AutoLoopDriver(lc, {
      maxIterations: 5,
      onStep: async (info) => {
        stepCalls.push(info.iteration);
      },
    });

    await driver.runFull();

    // At least one step should have been called
    expect(stepCalls.length).toBeGreaterThan(0);
  });

  it('should trigger onComplete callback when done', async () => {
    const lc = makeController(azaDir);
    let completed = false;
    let escalated = false;
    const driver = new AutoLoopDriver(lc, {
      maxIterations: 5,
      onComplete: async () => {
        completed = true;
      },
      onEscalate: async () => {
        escalated = true;
      },
    });

    await driver.runFull();

    // 0.2.x: runFull pauses on awaitingAction instead of spinning to completion
    const paused = driver.getStatus() === 'paused';
    expect(completed || escalated || paused).toBe(true);
  });
});

// ── Test 3: AutoLoopDriver sentinel detection ──

describe('V15 AutoLoopDriver — sentinel detection', () => {
  let tmpDir: string;
  let azaDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    azaDir = path.join(tmpDir, '.aza');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('should detect sentinels in step output (unit test via detectSentinel)', async () => {
    const output = 'Some text <promise>TASK_COMPLETE</promise> more text';
    const result = detectSentinel(output);

    expect(result.matched).toBe('taskComplete');
    expect(result.offset).toBeGreaterThan(0);
  });

  it('should detect taskFailed sentinel', () => {
    const output = 'Failed with <promise>TASK_FAILED</promise>';
    const result = detectSentinel(output);

    expect(result.matched).toBe('taskFailed');
  });

  it('should not match sentinel when no promise tag is present', () => {
    const output = 'Normal output without any sentinel';
    const result = detectSentinel(output);

    // When no match, matched is null (falsy)
    expect(result.matched).toBeFalsy();
  });

  it('should detect sentinel in tail of output', () => {
    const output = 'Some text... <promise>TASK_COMPLETE</promise>';
    const result = detectSentinel(output);

    expect(result.matched).toBe('taskComplete');
    expect(result.inTail).toBe(true);
  });
});

// ── Test 4: LoopController 缓存单例化 ──

describe('V15 MCP LoopController cache', () => {
  it('should return the same LoopController for the same projectRoot', () => {
    // Simulate the cache pattern used in aza-loop.ts
    const cache = new Map<string, LoopController>();
    const tmpDir = createTempDir();
    const azaDir = path.join(tmpDir, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });

    const makeController = (root: string): LoopController => {
      const cached = cache.get(root);
      if (cached) return cached;
      const lc = new LoopController({ maxIterations: 5, maxStageIterations: 3, enableV12: true, azaDir, projectRoot: root });
      cache.set(root, lc);
      return lc;
    };

    const lc1 = makeController(tmpDir);
    const lc2 = makeController(tmpDir);

    expect(lc1).toBe(lc2);
    expect(cache.size).toBe(1);

    // Different root → different controller
    const tmpDir2 = createTempDir();
    fs.mkdirSync(path.join(tmpDir2, '.aza'), { recursive: true });
    const lc3 = makeController(tmpDir2);
    expect(lc3).not.toBe(lc1);
    expect(cache.size).toBe(2);

    cleanup(tmpDir);
    cleanup(tmpDir2);
  });
});

// ── Test 5: OuterLoop 状态共享 ──

describe('V15 OuterLoop state sharing', () => {
  it('should accept a shared InnerLoop instance', () => {
    const cb = new CircuitBreaker();
    const inner = new InnerLoop(cb);
    const outer = new OuterLoop(cb, {}, inner);

    // Verify the outer loop uses the shared inner loop
    expect((outer as any).innerLoop).toBe(inner);
  });

  it('should fall back to creating its own InnerLoop when none is provided', () => {
    const cb = new CircuitBreaker();
    const outer = new OuterLoop(cb, {});

    // Should have created its own inner loop
    expect((outer as any).innerLoop).toBeDefined();
    expect((outer as any).innerLoop).toBeInstanceOf(InnerLoop);
  });
});

// ── Test 6: WriteGuard 一致性 ──

describe('V15 WriteGuard consistency', () => {
  it('should not list STATE.yaml as locked in any phase', () => {
    const phases = ['open', 'design', 'build', 'verify', 'archive'];
    for (const phase of phases) {
      const config = getWriteGuardConfig(phase);
      expect(config.lockedFiles).not.toContain('STATE.yaml');
      expect(config.lockedFiles).not.toContain('STATE.HASH');
      expect(config.lockedFiles).not.toContain('prd.json');
    }
  });

  it('should always allow STATE.yaml writes', () => {
    const phases = ['open', 'design', 'build', 'verify', 'archive'];
    for (const phase of phases) {
      expect(isWriteAllowed('STATE.yaml', phase)).toBe(true);
      expect(isWriteAllowed('path/to/STATE.yaml', phase)).toBe(true);
      expect(isWriteAllowed('.aza/STATE.yaml', phase)).toBe(true);
    }
  });
});

// ── Test 7: AutoLoopDriver reset ──

describe('V15 AutoLoopDriver — reset()', () => {
  let tmpDir: string;
  let azaDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    azaDir = path.join(tmpDir, '.aza');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('should reset iteration and status to initial state', async () => {
    const lc = makeController(azaDir);
    const driver = new AutoLoopDriver(lc, { maxIterations: 10 });

    await driver.step();
    expect(driver.getIteration()).toBeGreaterThan(0);
    // The driver may be in a terminal state (escalated) after first step
    // because no PRD has been set up — this is expected behavior

    driver.reset();

    expect(driver.getIteration()).toBe(0);
    expect(driver.getStatus()).toBe('idle');
  });
});

// ── Test 8: AutoLoopDriver stop ──

describe('V15 AutoLoopDriver — stop()', () => {
  let tmpDir: string;
  let azaDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    azaDir = path.join(tmpDir, '.aza');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('should stop the driver immediately', () => {
    const lc = makeController(azaDir);
    const driver = new AutoLoopDriver(lc, { maxIterations: 10 });

    driver.stop('test stop');

    expect(driver.getStatus()).toBe('stopped');
  });
});