import { describe, it, expect, beforeEach } from 'vitest';
import {
  CircuitBreaker,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from '@azaloop/core';
import type { CircuitBreakerLevel, CircuitBreakerDimension } from '@azaloop/core';

describe('CircuitBreaker 4 dimensions x 3 levels', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      maxIterations: 10,
      tokenBudget: 1000,
      stagnationThreshold: 3,
      noProgressThreshold: 5,
    });
  });

  describe('Iteration dimension (iteration_count)', () => {
    it('should not trip when iterations are below max', () => {
      cb.recordSuccess('phase', 10);
      cb.recordSuccess('phase', 10);

      const result = cb.check('phase');
      expect(result.tripped).toBe(false);
    });

    it('should trip when iterations reach max', () => {
      for (let i = 0; i < 10; i++) {
        cb.recordSuccess('phase', 0);
      }

      const result = cb.check('phase');
      expect(result.tripped).toBe(true);
      expect(result.dimension).toBe('iteration_count');
      expect(result.reason).toContain('Iteration count');
    });

    it('should trip via recordFailure iterations', () => {
      for (let i = 0; i < 10; i++) {
        cb.recordFailure('inner', 'some error');
      }

      const result = cb.check('inner');
      expect(result.tripped).toBe(true);
      expect(result.dimension).toBe('iteration_count');
    });
  });

  describe('Token dimension (token_spend)', () => {
    it('should not trip when tokens are below budget', () => {
      cb.recordSuccess('phase', 100);
      cb.recordSuccess('phase', 200);

      const result = cb.check('phase');
      expect(result.tripped).toBe(false);
    });

    it('should trip when tokens exceed budget', () => {
      cb.recordSuccess('phase', 600);
      cb.recordSuccess('phase', 500); // total = 1100 > 1000

      const result = cb.check('phase');
      expect(result.tripped).toBe(true);
      expect(result.dimension).toBe('token_spend');
      expect(result.reason).toContain('Token spend');
    });

    it('should trip via recordFailure tokens', () => {
      cb.recordFailure('inner', 'error', 600);
      cb.recordFailure('inner', 'error', 500);

      const result = cb.check('inner');
      expect(result.tripped).toBe(true);
      expect(result.dimension).toBe('token_spend');
    });
  });

  describe('Stagnation dimension (stagnation)', () => {
    it('should not trip when errors are different', () => {
      cb.recordFailure('phase', 'error A');
      cb.recordFailure('phase', 'error B');
      cb.recordFailure('phase', 'error C');

      const result = cb.check('phase');
      // Should not trip on stagnation (errors are different)
      expect(result.tripped).toBe(false);
    });

    it('should trip when same error is repeated stagnationThreshold times', () => {
      cb.recordFailure('phase', 'same error');
      cb.recordFailure('phase', 'same error');
      cb.recordFailure('phase', 'same error');

      const result = cb.check('phase');
      expect(result.tripped).toBe(true);
      expect(result.dimension).toBe('stagnation');
      expect(result.reason).toContain('Stagnation');
      expect(result.reason).toContain('same error');
    });

    it('should trip when same error is repeated across different calls', () => {
      // Record 3 identical errors
      const errorMsg = 'Build failed: test error';
      for (let i = 0; i < 3; i++) {
        cb.recordFailure('inner', errorMsg);
      }

      const result = cb.check('inner');
      expect(result.tripped).toBe(true);
      expect(result.dimension).toBe('stagnation');
    });
  });

  describe('No-progress dimension (no_progress)', () => {
    it('should not trip when consecutive failures are below threshold', () => {
      cb.recordFailure('phase', 'error 1');
      cb.recordFailure('phase', 'error 2');
      cb.recordFailure('phase', 'error 3');
      cb.recordFailure('phase', 'error 4');

      const result = cb.check('phase');
      // 4 failures < 5 threshold, and errors are different (no stagnation)
      expect(result.tripped).toBe(false);
    });

    it('should trip when consecutive failures reach noProgressThreshold', () => {
      for (let i = 0; i < 5; i++) {
        cb.recordFailure('phase', `unique error ${i}`);
      }

      const result = cb.check('phase');
      expect(result.tripped).toBe(true);
      expect(result.dimension).toBe('no_progress');
      expect(result.reason).toContain('No progress');
      expect(result.reason).toContain('5 consecutive failures');
    });

    it('should reset consecutive failures on recordProgress', () => {
      cb.recordFailure('phase', 'error 1');
      cb.recordFailure('phase', 'error 2');
      cb.recordProgress('phase'); // resets consecutive failures
      cb.recordFailure('phase', 'error 3');
      cb.recordFailure('phase', 'error 4');

      const result = cb.check('phase');
      expect(result.tripped).toBe(false);
    });

    it('should reset consecutive failures on recordSuccess', () => {
      cb.recordFailure('phase', 'error 1');
      cb.recordFailure('phase', 'error 2');
      cb.recordSuccess('phase'); // resets consecutive failures
      cb.recordFailure('phase', 'error 3');
      cb.recordFailure('phase', 'error 4');

      const result = cb.check('phase');
      expect(result.tripped).toBe(false);
    });
  });

  describe('Phase level (phase)', () => {
    it('should track phase level metrics independently', () => {
      cb.recordSuccess('phase', 100);
      cb.recordSuccess('inner', 200);

      const phaseMetrics = cb.getMetrics('phase');
      const innerMetrics = cb.getMetrics('inner');

      expect(phaseMetrics.iterations).toBe(1);
      expect(phaseMetrics.tokensSpent).toBe(100);
      expect(innerMetrics.iterations).toBe(1);
      expect(innerMetrics.tokensSpent).toBe(200);
    });

    it('should check phase level via checkAll() first', () => {
      // Trip phase level only
      for (let i = 0; i < 10; i++) {
        cb.recordSuccess('phase', 0);
      }

      const result = cb.checkAll();
      expect(result).not.toBeNull();
      expect(result!.level).toBe('phase');
      expect(result!.tripped).toBe(true);
    });
  });

  describe('Inner level (inner)', () => {
    it('should track inner level metrics independently', () => {
      cb.recordFailure('inner', 'inner error');
      cb.recordFailure('inner', 'inner error 2');

      const metrics = cb.getMetrics('inner');
      expect(metrics.iterations).toBe(2);
      expect(metrics.consecutiveFailures).toBe(2);
      expect(metrics.recentErrors).toHaveLength(2);
    });

    it('should check inner level via checkAll() when phase is not tripped', () => {
      // Trip inner level only (phase is clean)
      for (let i = 0; i < 10; i++) {
        cb.recordSuccess('inner', 0);
      }

      const result = cb.checkAll();
      expect(result).not.toBeNull();
      expect(result!.level).toBe('inner');
      expect(result!.tripped).toBe(true);
    });
  });

  describe('Outer level (outer)', () => {
    it('should track outer level metrics independently', () => {
      cb.recordFailure('outer', 'outer error');

      const metrics = cb.getMetrics('outer');
      expect(metrics.iterations).toBe(1);
      expect(metrics.consecutiveFailures).toBe(1);
    });

    it('should check outer level via checkAll() when phase and inner are not tripped', () => {
      // Trip outer level only
      for (let i = 0; i < 10; i++) {
        cb.recordSuccess('outer', 0);
      }

      const result = cb.checkAll();
      expect(result).not.toBeNull();
      expect(result!.level).toBe('outer');
      expect(result!.tripped).toBe(true);
    });
  });

  describe('Trip and reset', () => {
    it('should reset all levels', () => {
      // Record failures across all levels
      cb.recordFailure('phase', 'error');
      cb.recordFailure('inner', 'error');
      cb.recordFailure('outer', 'error');

      // Reset
      cb.reset();

      // All levels should have zero metrics
      expect(cb.getMetrics('phase').iterations).toBe(0);
      expect(cb.getMetrics('inner').iterations).toBe(0);
      expect(cb.getMetrics('outer').iterations).toBe(0);
      expect(cb.getMetrics('phase').consecutiveFailures).toBe(0);
      expect(cb.getMetrics('inner').consecutiveFailures).toBe(0);
      expect(cb.getMetrics('outer').consecutiveFailures).toBe(0);
    });

    it('should not trip after reset', () => {
      for (let i = 0; i < 10; i++) {
        cb.recordSuccess('phase', 0);
      }
      expect(cb.check('phase').tripped).toBe(true);

      cb.reset();
      expect(cb.check('phase').tripped).toBe(false);
    });

    it('should clear error history on reset', () => {
      cb.recordFailure('phase', 'error 1');
      cb.recordFailure('phase', 'error 2');
      expect(cb.getMetrics('phase').recentErrors).toHaveLength(2);

      cb.reset();
      expect(cb.getMetrics('phase').recentErrors).toHaveLength(0);
    });

    it('should clear error history on recordProgress', () => {
      cb.recordFailure('phase', 'error 1');
      cb.recordFailure('phase', 'error 2');
      expect(cb.getMetrics('phase').recentErrors).toHaveLength(2);

      cb.recordProgress('phase');
      expect(cb.getMetrics('phase').recentErrors).toHaveLength(0);
    });
  });

  describe('checkAll() priority order', () => {
    it('should check in order: phase -> inner -> outer', () => {
      // Trip all levels
      for (let i = 0; i < 10; i++) {
        cb.recordSuccess('phase', 0);
        cb.recordSuccess('inner', 0);
        cb.recordSuccess('outer', 0);
      }

      const result = cb.checkAll();
      // Phase should be returned first (highest priority)
      expect(result!.level).toBe('phase');
    });

    it('should return null when no level is tripped', () => {
      cb.recordSuccess('phase', 10);
      cb.recordSuccess('inner', 10);

      const result = cb.checkAll();
      expect(result).toBeNull();
    });
  });

  describe('getEscalationTarget()', () => {
    it('should escalate phase -> inner', () => {
      expect(cb.getEscalationTarget('phase')).toBe('inner');
    });

    it('should escalate inner -> outer', () => {
      expect(cb.getEscalationTarget('inner')).toBe('outer');
    });

    it('should escalate outer -> human', () => {
      expect(cb.getEscalationTarget('outer')).toBe('human');
    });
  });

  describe('DEFAULT_CIRCUIT_BREAKER_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.maxIterations).toBe(50);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.tokenBudget).toBe(200_000);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.stagnationThreshold).toBe(3);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.noProgressThreshold).toBe(5);
    });

    it('should be used when no config is provided', () => {
      const defaultCb = new CircuitBreaker();
      // Record 50 successes to trip the iteration_count dimension
      for (let i = 0; i < 50; i++) {
        defaultCb.recordSuccess('phase', 0);
      }
      const result = defaultCb.check('phase');
      expect(result.tripped).toBe(true);
      expect(result.dimension).toBe('iteration_count');
    });
  });
});
