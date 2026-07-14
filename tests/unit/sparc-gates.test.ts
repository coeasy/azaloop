/**
 * T26 — SPARC 5-Phase Gate tests
 *
 * Verifies the four core behaviors:
 *   1. SPARC_GATE_CRITERIA covers all 5 phases with valid minScore
 *   2. sparcPhaseForStage maps state-machine stages correctly
 *   3. evaluateSparcGate correctly handles score boundaries (0.6/0.7/0.8/0.9)
 *   4. StateMachine.getCurrentSparcPhase() works end-to-end
 */
import { describe, it, expect } from 'vitest';
import {
  SPARC_GATE_CRITERIA,
  SPARC_PHASE_ORDER,
  sparcPhaseForStage,
  nextSPARCPhase,
  evaluateSparcGate,
  evidenceFromMap,
  validateSparcConfig,
  StateMachine,
} from '@azaloop/core';

describe('SPARC 5-Phase Gates (T26)', () => {
  describe('SPARC_GATE_CRITERIA configuration', () => {
    it('covers all 5 SPARC phases with valid config', () => {
      expect(SPARC_PHASE_ORDER).toEqual([
        'specification',
        'pseudocode',
        'architecture',
        'refinement',
        'completion',
      ]);
      for (const phase of SPARC_PHASE_ORDER) {
        const config = SPARC_GATE_CRITERIA[phase];
        expect(config.criteria.length).toBeGreaterThan(0);
        expect(config.minScore).toBeGreaterThanOrEqual(0);
        expect(config.minScore).toBeLessThanOrEqual(1);
        expect(config.description.length).toBeGreaterThan(0);
      }
    });

    it('has escalating minScore thresholds (0.6 → 0.6 → 0.7 → 0.8 → 0.9)', () => {
      expect(SPARC_GATE_CRITERIA.specification.minScore).toBe(0.6);
      expect(SPARC_GATE_CRITERIA.pseudocode.minScore).toBe(0.6);
      expect(SPARC_GATE_CRITERIA.architecture.minScore).toBe(0.7);
      expect(SPARC_GATE_CRITERIA.refinement.minScore).toBe(0.8);
      expect(SPARC_GATE_CRITERIA.completion.minScore).toBe(0.9);
    });

    it('validateSparcConfig returns ok=true for current config', () => {
      const result = validateSparcConfig();
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('sparcPhaseForStage mapping', () => {
    it('maps open → specification', () => {
      expect(sparcPhaseForStage('open')).toBe('specification');
    });

    it('maps design with progress<0.3 → pseudocode', () => {
      expect(sparcPhaseForStage('design', 0)).toBe('pseudocode');
      expect(sparcPhaseForStage('design', 0.1)).toBe('pseudocode');
      expect(sparcPhaseForStage('design', 0.29)).toBe('pseudocode');
    });

    it('maps design with progress≥0.3 → architecture', () => {
      expect(sparcPhaseForStage('design', 0.3)).toBe('architecture');
      expect(sparcPhaseForStage('design', 0.5)).toBe('architecture');
      expect(sparcPhaseForStage('design', 1.0)).toBe('architecture');
    });

    it('maps design without progress → pseudocode (default)', () => {
      expect(sparcPhaseForStage('design')).toBe('pseudocode');
    });

    it('maps build → refinement', () => {
      expect(sparcPhaseForStage('build')).toBe('refinement');
    });

    it('maps verify / archive → completion', () => {
      expect(sparcPhaseForStage('verify')).toBe('completion');
      expect(sparcPhaseForStage('archive')).toBe('completion');
    });
  });

  describe('nextSPARCPhase', () => {
    it('walks the strict phase order', () => {
      expect(nextSPARCPhase('specification')).toBe('pseudocode');
      expect(nextSPARCPhase('pseudocode')).toBe('architecture');
      expect(nextSPARCPhase('architecture')).toBe('refinement');
      expect(nextSPARCPhase('refinement')).toBe('completion');
    });

    it('returns null at the end of the chain', () => {
      expect(nextSPARCPhase('completion')).toBeNull();
    });
  });

  describe('evaluateSparcGate (score boundaries)', () => {
    it('returns score=0 + passed=false for empty evidence', () => {
      const result = evaluateSparcGate('specification', []);
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
      expect(result.missingCriteria.length).toBe(SPARC_GATE_CRITERIA.specification.criteria.length);
    });

    it('passes at exactly minScore (0.6 for specification)', () => {
      // 3/5 = 0.6 — exactly at minScore, must pass
      const ev = [
        { name: 'Acceptance criteria', passed: true, weight: 1 },
        { name: 'Constraints documented', passed: true, weight: 1 },
        { name: 'Edge cases', passed: true, weight: 1 },
        { name: 'extra 1', passed: false, weight: 1 },
        { name: 'extra 2', passed: false, weight: 1 },
      ];
      const result = evaluateSparcGate('specification', ev);
      expect(result.score).toBe(0.6);
      expect(result.passed).toBe(true);
    });

    it('fails just below minScore (0.59 for specification)', () => {
      const ev = [
        { name: 'Acceptance criteria', passed: true, weight: 1 },
        { name: 'Constraints documented', passed: true, weight: 1 },
        { name: 'Edge cases', passed: true, weight: 1 },
        { name: 'Out of scope', passed: false, weight: 1 },
        { name: 'extra 1', passed: false, weight: 1 },
        { name: 'extra 2', passed: false, weight: 1 },
      ];
      const result = evaluateSparcGate('specification', ev);
      // 3/6 = 0.5 < 0.6
      expect(result.score).toBeCloseTo(0.5, 2);
      expect(result.passed).toBe(false);
    });

    it('respects weighted evidence (heavy criterion dominates)', () => {
      const ev = [
        { name: 'Acceptance criteria', passed: true, weight: 10 },
        { name: 'extra 1', passed: false, weight: 1 },
      ];
      const result = evaluateSparcGate('specification', ev);
      // 10 / 11 ≈ 0.91 — passes
      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.6);
    });

    it('completion phase requires higher minScore (0.9)', () => {
      // 9/10 = 0.9 — at boundary, must pass
      const ev = Array.from({ length: 9 }, (_, i) => ({
        name: `criterion ${i}`,
        passed: true,
        weight: 1,
      })).concat([{ name: 'fail', passed: false, weight: 1 }]);
      const result = evaluateSparcGate('completion', ev);
      expect(result.score).toBe(0.9);
      expect(result.passed).toBe(true);
    });

    it('completion phase fails at 0.89', () => {
      const ev = Array.from({ length: 8 }, (_, i) => ({
        name: `criterion ${i}`,
        passed: true,
        weight: 1,
      })).concat([
        { name: 'criterion 8', passed: true, weight: 1 },
        { name: 'fail', passed: false, weight: 2 },
      ]);
      // 9 / 11 ≈ 0.818 < 0.9
      const result = evaluateSparcGate('completion', ev);
      expect(result.passed).toBe(false);
    });

    it('returns missingCriteria with the criteria not covered by passed evidence', () => {
      const ev = [
        { name: 'Acceptance criteria', passed: true, weight: 1 },
      ];
      const result = evaluateSparcGate('specification', ev);
      // Only "Acceptance criteria ≥ 3" is covered; the other 3 are missing.
      expect(result.passedCriteria).toContain('Acceptance criteria ≥ 3');
      expect(result.missingCriteria.length).toBe(3);
    });
  });

  describe('evidenceFromMap convenience', () => {
    it('converts a record into Evidence[]', () => {
      const ev = evidenceFromMap({ a: true, b: false, c: true });
      expect(ev).toEqual([
        { name: 'a', passed: true },
        { name: 'b', passed: false },
        { name: 'c', passed: true },
      ]);
    });
  });

  describe('StateMachine integration', () => {
    it('getCurrentSparcPhase() returns the mapped phase for each stage', () => {
      const sm = new StateMachine();
      // Default stage is 'open'
      expect(sm.getCurrentSparcPhase()).toBe('specification');

      sm.setStageStatus('open', 'completed');
      sm.advance();
      expect(sm.getCurrentStage()).toBe('design');
      // story_attempts=0 / max=3 = 0.0 → pseudocode
      expect(sm.getCurrentSparcPhase()).toBe('pseudocode');

      sm.setInnerLoopState({ story_attempts: 2 });
      // 2/3 = 0.667 → architecture
      expect(sm.getCurrentSparcPhase()).toBe('architecture');
    });
  });
});
