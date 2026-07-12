import { describe, it, expect, beforeEach } from 'vitest';
import {
  CompletionGate,
  DEFAULT_BLOCK_COUNT_LIMIT,
} from '@azaloop/core';
import type { CompletionGateInput } from '@azaloop/core';

describe('CompletionGate 5 conditions', () => {
  let gate: CompletionGate;

  beforeEach(() => {
    gate = new CompletionGate();
  });

  // Helper: create an input with all conditions passing
  function allPassInput(overrides: Partial<CompletionGateInput> = {}): CompletionGateInput {
    return {
      gated_mode_enabled: true,
      has_in_progress_stage: true,
      all_stages_completed: false,
      stop_hook_active: false,
      block_count: 0,
      block_count_limit: 5,
      ledger_has_progress: true,
      attestation_verified: true,
      ...overrides,
    };
  }

  describe('All conditions pass -> gate opens', () => {
    it('should allow stop when all 6 conditions are satisfied', () => {
      const result = gate.evaluate(allPassInput());

      expect(result.canStop).toBe(true);
      expect(result.blockedReason).toBeUndefined();
      expect(result.conditions).toHaveLength(6);
      expect(result.conditions.every(c => c.satisfied)).toBe(true);
    });

    it('should have exactly 6 conditions', () => {
      const result = gate.evaluate(allPassInput());

      expect(result.conditions).toHaveLength(6);
      expect(result.conditions.map(c => c.index)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('should name all 6 conditions correctly', () => {
      const result = gate.evaluate(allPassInput());

      const ids = result.conditions.map(c => c.id);
      expect(ids).toContain('gated_mode_enabled');
      expect(ids).toContain('has_in_progress_or_completed');
      expect(ids).toContain('stop_hook_inactive');
      expect(ids).toContain('block_count_under_limit');
      expect(ids).toContain('ledger_has_progress');
      expect(ids).toContain('attestation_verified');
    });
  });

  describe('Any single condition fails -> gate blocks', () => {
    it('should block when condition 1 (gated_mode_enabled) fails', () => {
      const result = gate.evaluate(allPassInput({ gated_mode_enabled: false }));

      expect(result.canStop).toBe(false);
      expect(result.blockedReason).toBeDefined();
      const failed = result.conditions.find(c => !c.satisfied);
      expect(failed!.id).toBe('gated_mode_enabled');
    });

    it('should block when condition 2 (has_in_progress_or_completed) fails', () => {
      const result = gate.evaluate(allPassInput({ has_in_progress_stage: false, all_stages_completed: false }));

      expect(result.canStop).toBe(false);
      const failed = result.conditions.find(c => !c.satisfied);
      expect(failed!.id).toBe('has_in_progress_or_completed');
    });

    it('should block when condition 3 (stop_hook_active) is true', () => {
      const result = gate.evaluate(allPassInput({ stop_hook_active: true }));

      expect(result.canStop).toBe(false);
      const failed = result.conditions.find(c => !c.satisfied);
      expect(failed!.id).toBe('stop_hook_inactive');
    });

    it('should block when condition 4 (block_count >= limit)', () => {
      const result = gate.evaluate(allPassInput({ block_count: 5, block_count_limit: 5 }));

      expect(result.canStop).toBe(false);
      const failed = result.conditions.find(c => !c.satisfied);
      expect(failed!.id).toBe('block_count_under_limit');
    });

    it('should block when condition 5 (ledger_has_progress) fails', () => {
      const result = gate.evaluate(allPassInput({ ledger_has_progress: false }));

      expect(result.canStop).toBe(false);
      const failed = result.conditions.find(c => !c.satisfied);
      expect(failed!.id).toBe('ledger_has_progress');
    });

    it('should report the correct number of failures in blockedReason', () => {
      const result = gate.evaluate(allPassInput({ ledger_has_progress: false }));

      expect(result.canStop).toBe(false);
      expect(result.blockedReason).toContain('1 condition(s) unsatisfied');
    });

    it('should report multiple failures when multiple conditions fail', () => {
      const result = gate.evaluate(allPassInput({
        gated_mode_enabled: false,
        ledger_has_progress: false,
      }));

      expect(result.canStop).toBe(false);
      expect(result.blockedReason).toContain('2 condition(s) unsatisfied');
    });
  });

  describe('Block count limit enforcement', () => {
    it('should allow stop when block_count is below limit', () => {
      const result = gate.evaluate(allPassInput({ block_count: 3, block_count_limit: 5 }));

      expect(result.canStop).toBe(true);
      const cond = result.conditions.find(c => c.id === 'block_count_under_limit');
      expect(cond!.satisfied).toBe(true);
    });

    it('should block when block_count equals limit', () => {
      const result = gate.evaluate(allPassInput({ block_count: 5, block_count_limit: 5 }));

      expect(result.canStop).toBe(false);
      const cond = result.conditions.find(c => c.id === 'block_count_under_limit');
      expect(cond!.satisfied).toBe(false);
    });

    it('should block when block_count exceeds limit', () => {
      const result = gate.evaluate(allPassInput({ block_count: 10, block_count_limit: 5 }));

      expect(result.canStop).toBe(false);
      const cond = result.conditions.find(c => c.id === 'block_count_under_limit');
      expect(cond!.satisfied).toBe(false);
    });

    it('should allow stop when block_count is 0 and limit is positive', () => {
      const result = gate.evaluate(allPassInput({ block_count: 0, block_count_limit: 5 }));

      expect(result.canStop).toBe(true);
    });

    it('should block when block_count is 1 and limit is 1', () => {
      const result = gate.evaluate(allPassInput({ block_count: 1, block_count_limit: 1 }));

      expect(result.canStop).toBe(false);
    });
  });

  describe('DEFAULT_BLOCK_COUNT_LIMIT', () => {
    it('should be defined and equal to 5', () => {
      expect(DEFAULT_BLOCK_COUNT_LIMIT).toBeDefined();
      expect(DEFAULT_BLOCK_COUNT_LIMIT).toBe(5);
    });

    it('should work as the block_count_limit in evaluation', () => {
      const result = gate.evaluate(allPassInput({
        block_count: DEFAULT_BLOCK_COUNT_LIMIT - 1,
        block_count_limit: DEFAULT_BLOCK_COUNT_LIMIT,
      }));

      expect(result.canStop).toBe(true);
    });

    it('should block when block_count reaches DEFAULT_BLOCK_COUNT_LIMIT', () => {
      const result = gate.evaluate(allPassInput({
        block_count: DEFAULT_BLOCK_COUNT_LIMIT,
        block_count_limit: DEFAULT_BLOCK_COUNT_LIMIT,
      }));

      expect(result.canStop).toBe(false);
    });
  });

  describe('Static check method', () => {
    it('should work via static CompletionGate.check()', () => {
      const result = CompletionGate.check(allPassInput());

      expect(result.canStop).toBe(true);
    });

    it('should block via static check when condition fails', () => {
      const result = CompletionGate.check(allPassInput({ stop_hook_active: true }));

      expect(result.canStop).toBe(false);
    });
  });
});
