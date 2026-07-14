/**
 * T32 — Failure Classifier tests
 *
 * Covers:
 *   1. auth (401/403, "unauthorized")
 *   2. rate-limit (429, "rate limit")
 *   3. transient (5xx, network errors)
 *   4. permanent (4xx other than 401/403/429, "bad request")
 */

import { describe, it, expect } from 'vitest';
import { classifyFailure, shouldStrike } from '../../packages/core/src/L4_discipline/failure-classifier';

describe('T32 — Failure Classifier', () => {
  it('1) 401 → auth, not retryable', () => {
    const r = classifyFailure({ status: 401, message: 'Unauthorized' });
    expect(r.class).toBe('auth');
    expect(r.retryable).toBe(false);
  });

  it('2) "unauthorized" message → auth', () => {
    const r = classifyFailure(new Error('Unauthorized access'));
    expect(r.class).toBe('auth');
  });

  it('3) 429 → rate-limit, retryable with backoff', () => {
    const r = classifyFailure({ status: 429, message: 'Too many requests' });
    expect(r.class).toBe('rate-limit');
    expect(r.retryable).toBe(true);
    expect(r.backoffMs).toBeGreaterThan(0);
  });

  it('4) "rate limit" message → rate-limit', () => {
    const r = classifyFailure('Hit rate limit on API');
    expect(r.class).toBe('rate-limit');
  });

  it('5) 500 → transient, retryable', () => {
    const r = classifyFailure({ status: 500, message: 'Server error' });
    expect(r.class).toBe('transient');
    expect(r.retryable).toBe(true);
  });

  it('6) 502 → transient', () => {
    const r = classifyFailure({ status: 502, message: 'Bad gateway' });
    expect(r.class).toBe('transient');
  });

  it('7) ECONNRESET → transient', () => {
    const r = classifyFailure(new Error('read ECONNRESET'));
    expect(r.class).toBe('transient');
  });

  it('8) ETIMEDOUT → transient', () => {
    const r = classifyFailure(new Error('connect ETIMEDOUT'));
    expect(r.class).toBe('transient');
  });

  it('9) 400 → permanent, not retryable', () => {
    const r = classifyFailure({ status: 400, message: 'Bad request' });
    expect(r.class).toBe('permanent');
    expect(r.retryable).toBe(false);
  });

  it('10) "bad request" message → permanent', () => {
    const r = classifyFailure(new Error('Bad request: missing field'));
    expect(r.class).toBe('permanent');
  });

  it('11) "schema error" message → permanent', () => {
    const r = classifyFailure(new Error('Schema error: type mismatch'));
    expect(r.class).toBe('permanent');
  });

  it('12) transient stops being retryable after 3 retries', () => {
    const r1 = classifyFailure({ status: 500 }, { retryCount: 0 });
    const r3 = classifyFailure({ status: 500 }, { retryCount: 3 });
    expect(r1.retryable).toBe(true);
    expect(r3.retryable).toBe(false);
  });

  it('13) shouldStrike: auth always strikes', () => {
    const r = classifyFailure({ status: 401 });
    expect(shouldStrike({ status: 401 }, r)).toBe(true);
  });

  it('14) shouldStrike: permanent always strikes', () => {
    const r = classifyFailure({ status: 400 });
    expect(shouldStrike({ status: 400 }, r)).toBe(true);
  });

  it('15) shouldStrike: rate-limit never strikes', () => {
    const r = classifyFailure({ status: 429 });
    expect(shouldStrike({ status: 429 }, r)).toBe(false);
  });

  it('16) shouldStrike: transient strikes only after 3 retries', () => {
    const r = classifyFailure({ status: 500 });
    expect(shouldStrike({ status: 500 }, r, { retryCount: 0 })).toBe(false);
    expect(shouldStrike({ status: 500 }, r, { retryCount: 2 })).toBe(false);
    expect(shouldStrike({ status: 500 }, r, { retryCount: 3 })).toBe(true);
  });

  it('17) string error is supported', () => {
    const r = classifyFailure('connection timeout');
    expect(r.class).toBe('transient');
  });

  it('18) unknown error defaults to transient', () => {
    const r = classifyFailure(new Error('something weird happened'));
    expect(r.class).toBe('transient');
  });
});
