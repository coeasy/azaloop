/**
 * Failure Classifier (T32) — L4 Discipline
 *
 * Classifies an error into one of 4 tiers (ralphy-style) so the loop
 * can decide between retry/backoff/strike:
 *
 *   - auth         — 401 / 403 / "unauthorized" / "forbidden"
 *                    → never retry; record auth_error strike; prompt user
 *   - rate-limit   — 429 / "rate limit" / "too many requests"
 *                    → backoff (exponential), then retry
 *   - transient    — 5xx / network timeouts / "service unavailable"
 *                    → retry up to 3 times, then strike
 *   - permanent    — 4xx (not 401/403/429) / "bad request" / schema errors
 *                    → never retry; record permanent_failure strike
 *
 * Reference: michaelshimeles/ralphy (3-tier retry)
 *            + ruflo (failure classification hooks)
 */

export type FailureClass = 'auth' | 'rate-limit' | 'transient' | 'permanent';

export interface FailureClassification {
  class: FailureClass;
  reason: string;
  retryable: boolean;
  /** Suggested backoff in ms (only set for `rate-limit` and `transient`). */
  backoffMs?: number;
}

const RATE_LIMIT_BACKOFF_MS = 30_000;
const TRANSIENT_BASE_BACKOFF_MS = 1_000;

/**
 * Classify an error. `error` may be an Error instance, a string, or any
 * object with a `.message` / `.status` / `.code` field. The function
 * always returns a structured classification.
 */
export function classifyFailure(
  error: Error | string | unknown,
  context: { retryCount?: number } = {},
): FailureClassification {
  const retryCount = context.retryCount ?? 0;
  const status = extractStatus(error);
  const message = extractMessage(error).toLowerCase();

  // 1) Auth
  if (status === 401 || status === 403 || /\b(unauthor[ie]z[ae]d|forbidden|invalid[_ -]?(token|api[_ -]?key)|auth[_ -]?fail)\b/.test(message)) {
    return {
      class: 'auth',
      reason: 'Authentication or authorization failed (401/403).',
      retryable: false,
    };
  }

  // 2) Rate limit
  if (status === 429 || /\b(rate[_ -]?limit|too many request|quota[_ -]?exceeded|throttl)\b/.test(message)) {
    return {
      class: 'rate-limit',
      reason: 'Rate limit hit (429).',
      retryable: true,
      backoffMs: RATE_LIMIT_BACKOFF_MS,
    };
  }

  // 3) Transient (5xx, network)
  if (status !== undefined && status >= 500 && status < 600) {
    return {
      class: 'transient',
      reason: `Transient server error (${status}).`,
      retryable: retryCount < 3,
      backoffMs: TRANSIENT_BASE_BACKOFF_MS * Math.pow(2, retryCount),
    };
  }
  if (/\b(econnreset|econnrefused|etimedout|enotfound|enetunreach|service[_ -]?unavailab|temporar|timeout|fetch[_ -]?fail)\b/.test(message)) {
    return {
      class: 'transient',
      reason: 'Transient network error.',
      retryable: retryCount < 3,
      backoffMs: TRANSIENT_BASE_BACKOFF_MS * Math.pow(2, retryCount),
    };
  }

  // 4) Permanent (4xx other than 401/403/429, plus schema/syntax errors)
  if (status !== undefined && status >= 400 && status < 500) {
    return {
      class: 'permanent',
      reason: `Permanent client error (${status}).`,
      retryable: false,
    };
  }
  if (/\b(bad[_ -]?request|invalid[_ -]?argument|schema[_ -]?error|syntax[_ -]?error|type[_ -]?error|cannot[_ -]?find[_ -]?module)\b/.test(message)) {
    return {
      class: 'permanent',
      reason: 'Permanent code/schema error.',
      retryable: false,
    };
  }

  // 5) Default: treat as transient (be permissive — would rather retry than miss)
  return {
    class: 'transient',
    reason: 'Unknown error — treating as transient.',
    retryable: retryCount < 3,
    backoffMs: TRANSIENT_BASE_BACKOFF_MS * Math.pow(2, retryCount),
  };
}

/**
 * Decide whether a failure should record a strike on the strike system.
 * Auth and permanent failures always strike; transient only after 3
 * retries; rate-limit never strikes (we back off and retry).
 */
export function shouldStrike(
  error: Error | string | unknown,
  classResult: FailureClassification,
  context: { retryCount?: number } = {},
): boolean {
  const retryCount = context.retryCount ?? 0;
  switch (classResult.class) {
    case 'auth':
      return true;
    case 'permanent':
      return true;
    case 'transient':
      return retryCount >= 3;
    case 'rate-limit':
      return false;
  }
}

// ── Internals ──

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as Record<string, unknown>;
  if (typeof e.status === 'number') return e.status;
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (typeof e.code === 'string') {
    const n = Number(e.code);
    if (!Number.isNaN(n) && n >= 100 && n < 600) return n;
  }
  if (typeof e.response === 'object' && e.response !== null) {
    const r = e.response as Record<string, unknown>;
    if (typeof r.status === 'number') return r.status;
  }
  return undefined;
}

function extractMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.error === 'string') return e.error;
  }
  return String(error ?? '');
}
