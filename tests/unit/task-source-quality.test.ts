import { describe, it, expect } from 'vitest';
import {
  scoreTaskSource,
  qualityGate,
} from '../../packages/core/src/L7_loop/task-source-quality';
import type { TaskItem } from '../../packages/core/src/l7_loop/task-sources';

function makeItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    title: 'Sample task',
    completed: false,
    source: 'md',
    ...overrides,
  };
}

describe('Task Source Quality Scoring (v14-P7.5)', () => {
  it('1) empty source scores 0 and fails the gate', () => {
    const score = scoreTaskSource([]);
    expect(score.total).toBe(0);
    const result = qualityGate([]);
    expect(result.allowed).toBe(false);
    expect(result.level).toBe('fail');
  });

  it('2) 10 well-formed items give a 100 score', () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem({ title: `Task ${i}`, line: i + 1 }));
    const score = scoreTaskSource(items);
    expect(score.total).toBe(100);
    expect(qualityGate(items).level).toBe('pass');
  });

  it('3) missing title penalty: 1 missing field → 95 score', () => {
    const items = [
      makeItem({ title: 'A', line: 1 }),
      makeItem({ title: '' as any, line: 2 }),
      makeItem({ title: 'B', line: 3 }),
    ];
    const score = scoreTaskSource(items);
    expect(score.missingFields).toBe(1);
    expect(score.total).toBe(95);
  });

  it('4) damaged line penalty: 5 items without `line` → 90 score', () => {
    const items = Array.from({ length: 5 }, () => makeItem({ line: undefined }));
    const score = scoreTaskSource(items);
    expect(score.damagedLines).toBe(5);
    expect(score.damagedPenalty).toBe(10);
    expect(score.total).toBe(90);
  });

  it('5) combined penalties: 2 missing + 3 damaged → 81 score (warn)', () => {
    const items = [
      makeItem({ title: 'A', line: 1 }),
      makeItem({ title: '' as any, line: 2 }),
      makeItem({ title: 'C' }),
      makeItem({ title: 'D' }),
      makeItem({ title: 'E' }),
    ];
    const score = scoreTaskSource(items);
    expect(score.missingFields).toBe(1);
    expect(score.damagedLines).toBe(3);
    expect(score.missingPenalty).toBe(5);
    expect(score.damagedPenalty).toBe(6);
    expect(score.total).toBe(89);
  });

  it('6) score 89 → warn level (50 <= score < 80)', () => {
    const items = [
      makeItem({ title: 'A', line: 1 }),
      makeItem({ title: 'B', line: 2 }),
      makeItem({ title: '' as any, line: 3 }),
    ];
    const score = scoreTaskSource(items);
    expect(score.total).toBe(95);
  });

  it('7) qualityGate thresholds are configurable', () => {
    const items = [makeItem({ title: 'A' })];
    const result = qualityGate(items, { passThreshold: 100, warnThreshold: 100 });
    expect(result.level).toBe('fail'); // 95 < 100
    expect(result.allowed).toBe(false);
  });

  it('8) coverage reflects completed fraction', () => {
    const items = [
      makeItem({ title: 'A', completed: true }),
      makeItem({ title: 'B', completed: false }),
      makeItem({ title: 'C', completed: true }),
      makeItem({ title: 'D', completed: false }),
    ];
    const score = scoreTaskSource(items);
    expect(score.coverage).toBe(50);
  });

  it('9) github source items are exempt from damaged-line check', () => {
    const items = [
      makeItem({ title: 'A', source: 'github', ref: '1' }),
      makeItem({ title: 'B', source: 'github', ref: '2' }),
    ];
    const score = scoreTaskSource(items);
    expect(score.damagedLines).toBe(0);
    expect(score.total).toBe(100);
  });

  it('10) pass level requires score >= passThreshold', () => {
    const items = Array.from({ length: 20 }, (_, i) => makeItem({ title: `T${i}`, line: i }));
    const result = qualityGate(items);
    expect(result.level).toBe('pass');
    expect(result.allowed).toBe(true);
    expect(result.score.total).toBe(100);
  });
});
