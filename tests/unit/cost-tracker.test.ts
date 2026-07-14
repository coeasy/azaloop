import { describe, it, expect } from 'vitest';
import { CostTracker } from '../../packages/core/src/L7_loop/cost-tracker';

describe('v14-P8.5 Token cost tracker', () => {
  it('1) 80% triggers warning, 100% triggers reject + strike', () => {
    const t = new CostTracker({ budget: 100 });
    // 0-79: silent
    expect(t.consume(50, 'src-a').warning).toBe(false);
    expect(t.consume(20, 'src-b').warning).toBe(false);
    expect(t.consume(5, 'src-a').warning).toBe(false);
    // 80% crossed → warning
    expect(t.consume(5, 'src-c').warning).toBe(true);
    expect(t.consume(20, 'src-d').warning).toBe(false); // already past 80%, no re-warn
    // 100% → reject
    const r = t.consume(1, 'src-e');
    expect(r.allowed).toBe(false);
    expect(t.getBudgetUsage().rejected).toBe(true);
  });

  it('2) per-source attribution is correct', () => {
    const t = new CostTracker({ budget: 1000 });
    t.consume(100, 'prd-review');
    t.consume(200, 'task-implement');
    t.consume(50, 'prd-review');
    const usage = t.getBudgetUsage();
    expect(usage.perSource['prd-review']).toBe(150);
    expect(usage.perSource['task-implement']).toBe(200);
    expect(usage.consumed).toBe(350);
  });

  it('3) reset clears consumed + rejected flag', () => {
    const t = new CostTracker({ budget: 100 });
    t.consume(100, 'src-a');
    expect(t.getBudgetUsage().rejected).toBe(true);
    t.reset();
    expect(t.getConsumed()).toBe(0);
    expect(t.getBudgetUsage().rejected).toBe(false);
    // After reset, can consume again
    expect(t.consume(50, 'src-b').allowed).toBe(true);
  });

  it('4) invalid token count is rejected with reason', () => {
    const t = new CostTracker({ budget: 1000 });
    const r1 = t.consume(-1, 'src-a');
    expect(r1.allowed).toBe(false);
    expect(r1.reason).toContain('invalid token count');
    const r2 = t.consume(NaN, 'src-a');
    expect(r2.allowed).toBe(false);
  });

  it('5) remaining is clamped at 0 when overshot', () => {
    const t = new CostTracker({ budget: 100 });
    t.consume(150, 'src-a');
    expect(t.getRemaining()).toBe(0);
    expect(t.getConsumed()).toBe(150);
  });

  it('6) onUpdate + onWarn + onReject callbacks fire', () => {
    let updates = 0;
    let warns = 0;
    let rejects = 0;
    const t = new CostTracker({
      budget: 100,
      onUpdate: () => updates++,
      onWarn: () => warns++,
      onReject: () => rejects++,
    });
    t.consume(50); // update only
    t.consume(40); // update + warn (cross 80%)
    t.consume(20); // update + reject (cross 100%)
    expect(updates).toBe(3);
    expect(warns).toBe(1);
    expect(rejects).toBe(1);
  });

  it('7) setBudget updates the limit', () => {
    const t = new CostTracker({ budget: 100 });
    t.consume(50);
    t.setBudget(200);
    const usage = t.getBudgetUsage();
    expect(usage.budget).toBe(200);
    expect(usage.remaining).toBe(150);
  });
});
