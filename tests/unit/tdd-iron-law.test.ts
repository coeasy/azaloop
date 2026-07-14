/**
 * T32 — TDD Iron Law tests
 *
 * Covers:
 *   1. positive matches for 12 phrases
 *   2. negative matches for innocent text
 *   3. override (escape hatch) marking
 *   4. multi-language (English + Chinese)
 */

import { describe, it, expect } from 'vitest';
import { checkTddIronLaw, TDD_IRON_LAW_PHRASES } from '../../packages/core/src/L4_discipline/tdd-iron-law';

describe('T32 — TDD Iron Law', () => {
  it('1) TDD_IRON_LAW_PHRASES has 12 entries', () => {
    expect(TDD_IRON_LAW_PHRASES).toHaveLength(12);
  });

  it('2) catches English shortcut: "skip the test"', () => {
    const r = checkTddIronLaw("Let's skip the test for now.");
    expect(r.violated).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it('3) catches English shortcut: "works on my machine"', () => {
    const r = checkTddIronLaw('It works on my machine, so it must be fine.');
    expect(r.violated).toBe(true);
  });

  it('4) catches Chinese shortcut: "先上线"', () => {
    const r = checkTddIronLaw('先上线吧，回头补测试。');
    expect(r.violated).toBe(true);
  });

  it('5) catches Chinese shortcut: "以后加测试"', () => {
    const r = checkTddIronLaw('这个功能我们以后加测试。');
    expect(r.violated).toBe(true);
  });

  it('6) does NOT flag innocent text', () => {
    const r = checkTddIronLaw('I wrote tests first, then made them pass with the implementation.');
    expect(r.violated).toBe(false);
  });

  it('7) does NOT flag TDD-compliant narrative', () => {
    const r = checkTddIronLaw('RED → GREEN → REFACTOR: I wrote a failing test, then made it pass, then refactored.');
    expect(r.violated).toBe(false);
  });

  it('8) override escape hatch: violation nearby a "test was added first" marker', () => {
    const text = 'I will skip the test, but only after test was added first.';
    const r = checkTddIronLaw(text, { overrideWindow: 200 });
    // The match is overridden.
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0]!.overridden).toBe(true);
  });

  it('9) override Chinese escape hatch: "先写测试"', () => {
    const text = '我们先写测试，然后再实现功能。';
    const r = checkTddIronLaw(text, { overrideWindow: 200 });
    // No violation phrase in this text, so nothing to override.
    expect(r.violated).toBe(false);
  });

  it('10) returns empty results for empty input', () => {
    expect(checkTddIronLaw('').violated).toBe(false);
    expect(checkTddIronLaw('').matches).toEqual([]);
  });

  it('11) catches "lgtm" as a violation', () => {
    const r = checkTddIronLaw('PR is ready, lgtm!');
    expect(r.violated).toBe(true);
  });

  it('12) catches "fix in followup" as a violation', () => {
    const r = checkTddIronLaw('Will fix in followup PR.');
    expect(r.violated).toBe(true);
  });
});
