/**
 * v13 — P6.2: Verification Phrase Detection
 *
 * Catches the "looks-good" anti-pattern where an agent says things like
 * "looks good", "should work", "seems fine" instead of producing actual
 * verification evidence. Inspired by superpowers' "verification before
 * completion" rule.
 *
 * Reference: obra/superpowers — "Don't claim a file was created or
 * modified unless it actually exists on disk."
 */

const VERIFICATION_PHRASES: RegExp[] = [
  /\blooks good\b/i,
  /\bshould work\b/i,
  /\bseems fine\b/i,
  /\bI think this is done\b/i,
  /\bprobably works\b/i,
  /\blooks correct\b/i,
  /\bappears to work\b/i,
  /\bappears correct\b/i,
  /\bmaybe works\b/i,
  /\bI believe (it|this) works\b/i,
  /\bI think (it|this) works\b/i,
  /\bI assume (it|this) works\b/i,
  /\bI hope (it|this) works\b/i,
];

export interface VerificationPhraseResult {
  violated: boolean;
  phrases: string[];
}

/**
 * Check the given text for verification anti-pattern phrases.
 */
export function checkVerificationPhrases(text: string): VerificationPhraseResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { violated: false, phrases: [] };
  }
  const phrases: string[] = [];
  for (const re of VERIFICATION_PHRASES) {
    const m = text.match(re);
    if (m) {
      phrases.push(m[0]);
    }
  }
  return {
    violated: phrases.length > 0,
    phrases: Array.from(new Set(phrases)),
  };
}

/**
 * The list of verification anti-pattern phrases. Exposed for tests.
 */
export const VERIFICATION_PHRASE_PATTERNS: readonly RegExp[] = VERIFICATION_PHRASES;
