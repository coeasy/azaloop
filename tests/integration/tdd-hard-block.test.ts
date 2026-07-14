/**
 * v13 — P1.2: TDD Iron Law hard-block test
 *
 * Verifies that the new `checkTddIronLawStrict` function:
 *   1. Combines Iron Law + STOP phrase lists (24 total)
 *   2. Returns `strike: true` for any STOP phrase
 *   3. Returns `strike: true` for non-overridden Iron Law phrases
 *   4. Returns `strike: false` for escape-hatched Iron Law phrases
 *   5. Hard-block integrates with the verify-stage phase gate
 */

import { describe, it, expect } from 'vitest';
import {
  TDD_IRON_LAW_PHRASES,
  TDD_IRON_LAW_STOP_PHRASES,
  TDD_IRON_LAW_PHRASES_COMBINED,
  TDD_ESCAPE_HATCHES,
  checkTddIronLaw,
  checkTddIronLawStrict,
  evaluateStageGate,
} from '@azaloop/core';

describe('v13 P1.2 — TDD Iron Law hard-block', () => {
  it('1) TDD_IRON_LAW_PHRASES_COMBINED has 24 entries (12 Iron Law + 12 STOP)', () => {
    expect(TDD_IRON_LAW_PHRASES.length).toBe(12);
    expect(TDD_IRON_LAW_STOP_PHRASES.length).toBe(12);
    expect(TDD_IRON_LAW_PHRASES_COMBINED.length).toBe(24);
  });

  it('2) checkTddIronLawStrict detects an Iron Law phrase and strikes', () => {
    const r = checkTddIronLawStrict('skip the test, trust me');
    expect(r.strike).toBe(true);
    expect(r.violated).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it('3) checkTddIronLawStrict detects a STOP phrase and strikes', () => {
    // Use a STOP-only phrase (not also in the Iron Law list) so the
    // match source is unambiguously 'stop'. "test is not necessary"
    // appears in STOP phrases but not in the Iron Law phrases.
    const r = checkTddIronLawStrict('test is not necessary, ship it');
    expect(r.strike).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
    const sources = r.matches.map((m) => m.source);
    expect(sources).toContain('stop');
  });

  it('4) checkTddIronLawStrict respects escape hatches for Iron Law phrases', () => {
    // The Iron Law phrase "skip the test" is allowed if escape hatch
    // "tests added before" appears within 200 chars.
    const text = 'I will skip the test for now, but I have tests added before the change in a follow-up.';
    const r = checkTddIronLawStrict(text);
    // The escape hatch "tests added before" should mark this Iron Law
    // phrase as overridden, leaving no matches in the strict scan.
    expect(r.strike).toBe(false);
    expect(r.matches).toHaveLength(0);
  });

  it('5) pure STOP phrases (no Iron Law overlap) are not escape-hatched', () => {
    // "test is not necessary" is in STOP but NOT in Iron Law. The
    // escape hatch "tests added before" should NOT suppress it.
    const text = 'test is not necessary, but I have tests added before.';
    const r = checkTddIronLawStrict(text);
    // No Iron Law match → no covered range → STOP match should strike.
    expect(r.strike).toBe(true);
    expect(r.matches.some((m) => m.source === 'stop')).toBe(true);
  });

  it('6) checkTddIronLawStrict returns no matches for clean text', () => {
    const r = checkTddIronLawStrict('I added the test, ran the suite, all green.');
    expect(r.strike).toBe(false);
    expect(r.matches).toHaveLength(0);
  });

  it('7) TDD_ESCAPE_HATCHES contains both English and Chinese markers', () => {
    expect(TDD_ESCAPE_HATCHES.length).toBeGreaterThanOrEqual(2);
    const sources = TDD_ESCAPE_HATCHES.map((re) => re.source);
    // English: should mention "red" (red-green-refactor) and "tests added"
    expect(sources.some((s) => s.includes('red') && s.includes('green'))).toBe(true);
    // Chinese: should contain 先写测试 or similar
    expect(sources.some((s) => s.includes('先写测试'))).toBe(true);
  });

  it('8) verify-stage gate marks strike on TDD phrase', () => {
    const out = evaluateStageGate('verify', {
      gates_passed: 5,
      verify_output: 'skip the test, the user just wants the demo to run',
    });
    // Find the TDD Iron Law check result.
    const tddCheck = out.results.find((r) => r.id === 'tdd_iron_law');
    expect(tddCheck).toBeDefined();
    expect(tddCheck!.result.passed).toBe(false);
    expect(tddCheck!.result.strike).toBe(true);
  });

  it('9) verify-stage gate passes for clean verify output', () => {
    const out = evaluateStageGate('verify', {
      gates_passed: 5,
      verify_output: 'I added the test, ran vitest, all green, ready to ship.',
    });
    const tddCheck = out.results.find((r) => r.id === 'tdd_iron_law');
    expect(tddCheck).toBeDefined();
    expect(tddCheck!.result.passed).toBe(true);
    expect(tddCheck!.result.strike).toBeFalsy();
  });

  it('10) checkTddIronLaw (soft) still works for non-strict callers', () => {
    // The legacy soft check should still return `violated` but no `strike`.
    const r = checkTddIronLaw('skip the test');
    expect(r.violated).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
  });
});
