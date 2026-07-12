import { describe, it, expect, beforeEach } from 'vitest';
import {
  InnerLoop,
  StateMachine,
  CircuitBreaker,
} from '@azaloop/core';
import type {
  StageHandlerProvider,
  StageHandlers,
  Stage,
  PhaseGateInput,
} from '@azaloop/core';

describe('InnerLoop three-level loop + state sharing', () => {
  // Helper: create a handler provider where all stages pass on the first try
  function createPassingProvider(): StageHandlerProvider {
    return (_stage: Stage): StageHandlers => ({
      maker: async (stage, iteration) => ({
        work: `${stage} work v${iteration}`,
        tokensUsed: 100,
      }),
      checker: async (stage, _work) => {
        const inputMap: Record<Stage, PhaseGateInput> = {
          open: { p0_issues: 0, p1_issues: 1 },
          design: { diagrams_complete: 7, design_review_passed: true },
          build: { tdd_enforced: true, unit_test_pass_pct: 100 },
          verify: { gates_passed: 5, security_optional_downgrade: false },
              archive: { documents_complete: 6, spec_sync_done: true, conventions_written: true },
        };
        return { input: inputMap[stage] || {}, tokensUsed: 50 };
      },
      optimizer: async (stage, work, _evaluation) => ({
        work: `${work} [optimized]`,
        tokensUsed: 50,
      }),
    });
  }

  // Helper: create a handler provider where the checker always fails
  function createFailingProvider(): StageHandlerProvider {
    return (stage: Stage): StageHandlers => ({
      maker: async (_stage, iteration) => ({
        work: `${stage} work v${iteration}`,
        tokensUsed: 100,
      }),
      checker: async (stage, _work) => {
        // Return metrics that will fail the gate for every stage
        const failingInput: PhaseGateInput = {};
        return { input: failingInput, tokensUsed: 50 };
      },
      optimizer: async (_stage, work, _evaluation) => ({
        work: `${work} [optimized]`,
        tokensUsed: 50,
      }),
    });
  }

  describe('Stage progression: open -> design -> build -> verify -> archive', () => {
    it('should complete all 5 stages in order with passing handlers', async () => {
      const il = new InnerLoop();
      const result = await il.run('STORY-001', createPassingProvider());

      expect(result.success).toBe(true);
      expect(result.completed).toBe(true);
      expect(result.story_id).toBe('STORY-001');
      expect(result.escalated).toBe(false);

      // All 5 stages should be in the history
      expect(result.stage_history).toHaveLength(5);

      // Verify stage order
      const stages = result.stage_history.map(r => r.stage);
      expect(stages).toEqual(['open', 'design', 'build', 'verify', 'archive']);
    });

    it('should accumulate total_iterations across all stages', async () => {
      const il = new InnerLoop();
      const result = await il.run('STORY-001', createPassingProvider());

      // Each stage should take at least 1 iteration
      expect(result.total_iterations).toBeGreaterThanOrEqual(5);
    });

    it('should produce a work_summary with all stages', async () => {
      const il = new InnerLoop();
      const result = await il.run('STORY-001', createPassingProvider());

      expect(result.work_summary).toContain('open');
      expect(result.work_summary).toContain('design');
      expect(result.work_summary).toContain('build');
      expect(result.work_summary).toContain('verify');
      expect(result.work_summary).toContain('archive');
    });

    it('should auto-transition between stages', async () => {
      const il = new InnerLoop();
      const result = await il.run('STORY-001', createPassingProvider());

      // All non-archive stages should be auto-transitioned
      const autoTransitioned = result.stage_history.filter(r => r.auto_transitioned);
      expect(autoTransitioned.length).toBe(4); // open, design, build, verify (not archive)
    });
  });

  describe('Injected StateMachine is shared (not independent)', () => {
    it('should use the injected StateMachine and reflect changes on it', async () => {
      const sm = new StateMachine();
      const il = new InnerLoop(undefined, {}, sm);

      // Verify initial state
      expect(sm.getCurrentStage()).toBe('open');
      expect(sm.isCompleted()).toBe(false);

      await il.run('STORY-001', createPassingProvider());

      // The shared StateMachine should reflect the completed stages
      expect(sm.isCompleted()).toBe(true);
      expect(sm.getStageInfo('open').status).toBe('completed');
      expect(sm.getStageInfo('design').status).toBe('completed');
      expect(sm.getStageInfo('build').status).toBe('completed');
      expect(sm.getStageInfo('verify').status).toBe('completed');
      expect(sm.getStageInfo('archive').status).toBe('completed');
    });

    it('should not create an independent StateMachine when one is injected', async () => {
      const sm = new StateMachine();
      const il = new InnerLoop(undefined, {}, sm);

      // Run the loop
      await il.run('STORY-001', createPassingProvider());

      // The InnerLoop.getState() should return the same state as the injected sm
      expect(il.getState().current_stage).toBe(sm.getState().current_stage);
      expect(il.getCurrentStage()).toBe(sm.getCurrentStage());
    });

    it('should reflect pre-existing state from injected StateMachine', async () => {
      const sm = new StateMachine();
      // Pre-set some state
      sm.setStageStatus('open', 'completed');
      sm.advance();
      expect(sm.getCurrentStage()).toBe('design');

      const il = new InnerLoop(undefined, {}, sm);

      // The InnerLoop should start from the injected state
      // It will still run all 5 stages (open through archive)
      const result = await il.run('STORY-001', createPassingProvider());

      expect(result.success).toBe(true);
      // The injected sm should now show all stages completed
      expect(sm.isCompleted()).toBe(true);
    });
  });

  describe('maxPhaseIterations enforcement', () => {
    it('should escalate when maxPhaseIterations is exceeded', async () => {
      const cb = new CircuitBreaker({ maxIterations: 100, tokenBudget: 200000, stagnationThreshold: 100, noProgressThreshold: 100 });
      const il = new InnerLoop(cb, { maxPhaseIterations: 2 });

      const result = await il.run('STORY-001', createFailingProvider());

      // Should escalate because the gate never passes within 2 iterations
      expect(result.escalated).toBe(true);
      expect(result.success).toBe(false);
      expect(result.escalation_reason).toBeDefined();
    });

    it('should not exceed maxPhaseIterations per stage', async () => {
      const cb = new CircuitBreaker({ maxIterations: 100, tokenBudget: 200000, stagnationThreshold: 100, noProgressThreshold: 100 });
      const il = new InnerLoop(cb, { maxPhaseIterations: 3 });

      const result = await il.run('STORY-001', createFailingProvider());

      // Each stage should not exceed 3 iterations
      // Total iterations should be at most 3 (first stage fails and escalates)
      expect(result.total_iterations).toBeLessThanOrEqual(3);
    });

    it('should pass when maxPhaseIterations is sufficient and gate eventually passes', async () => {
      let attemptCount = 0;
      const provider: StageHandlerProvider = (stage: Stage): StageHandlers => ({
        maker: async (_s, iter) => ({ work: `${stage} v${iter}`, tokensUsed: 100 }),
        checker: async (stage, _work) => {
          attemptCount++;
          // Pass on the 2nd attempt
          if (attemptCount >= 2) {
            const inputMap: Record<Stage, PhaseGateInput> = {
              open: { p0_issues: 0, p1_issues: 1 },
              design: { diagrams_complete: 7, design_review_passed: true },
              build: { tdd_enforced: true, unit_test_pass_pct: 100 },
              verify: { gates_passed: 5, security_optional_downgrade: false },
          archive: { documents_complete: 6, spec_sync_done: true, conventions_written: true },
            };
            return { input: inputMap[stage] || {}, tokensUsed: 50 };
          }
          return { input: {}, tokensUsed: 50 };
        },
        optimizer: async (_s, work) => ({ work: `${work} [opt]`, tokensUsed: 50 }),
      });

      const il = new InnerLoop(undefined, { maxPhaseIterations: 5 });
      const result = await il.run('STORY-001', provider);

      expect(result.success).toBe(true);
      expect(result.completed).toBe(true);
    });
  });

  describe('Stage failure counting', () => {
    it('should escalate when a stage fails (phase escalated)', async () => {
      const cb = new CircuitBreaker({ maxIterations: 100, tokenBudget: 200000, stagnationThreshold: 100, noProgressThreshold: 100 });
      const il = new InnerLoop(cb, { maxStageFailures: 3, maxPhaseIterations: 2 });

      const result = await il.run('STORY-001', createFailingProvider());

      // The phase escalates on failure, which causes the inner loop to escalate
      expect(result.escalated).toBe(true);
      expect(result.success).toBe(false);
      expect(result.escalation_reason).toBeDefined();
    });

    it('should escalate immediately when maxStageFailures is 1', async () => {
      const cb = new CircuitBreaker({ maxIterations: 100, tokenBudget: 200000, stagnationThreshold: 100, noProgressThreshold: 100 });
      const il = new InnerLoop(cb, { maxStageFailures: 1, maxPhaseIterations: 1 });

      const result = await il.run('STORY-001', createFailingProvider());

      expect(result.escalated).toBe(true);
      expect(result.success).toBe(false);
    });

    it('should record stage history for failed stages', async () => {
      const cb = new CircuitBreaker({ maxIterations: 100, tokenBudget: 200000, stagnationThreshold: 100, noProgressThreshold: 100 });
      const il = new InnerLoop(cb, { maxStageFailures: 3, maxPhaseIterations: 2 });

      const result = await il.run('STORY-001', createFailingProvider());

      expect(result.stage_history.length).toBeGreaterThanOrEqual(1);
      // The first stage (open) should be in the history
      expect(result.stage_history[0]!.stage).toBe('open');
    });

    it('should set stage status to blocked when a stage fails', async () => {
      const sm = new StateMachine();
      const cb = new CircuitBreaker({ maxIterations: 100, tokenBudget: 200000, stagnationThreshold: 100, noProgressThreshold: 100 });
      const il = new InnerLoop(cb, { maxStageFailures: 3, maxPhaseIterations: 2 }, sm);

      await il.run('STORY-001', createFailingProvider());

      // The first stage should be blocked
      expect(sm.getStageInfo('open').status).toBe('blocked');
    });
  });
});
