/**
 * TDD Iron Law (T32) — L4 Discipline
 *
 * Implements superpowers' "TDD Iron Law" as a phrase-list scan. The
 * Iron Law is the principle: NO PRODUCTION CODE WITHOUT A FAILING
 * TEST FIRST. This module checks the agent's output (or commit
 * message) for rationalization phrases that signal a TDD violation.
 *
 * Reference: obra/superpowers (test-driven-development skill)
 *   - https://github.com/obra/superpowers
 *
 * Twelve phrases across English and Chinese, plus intent-preserving
 * "escape hatches" for explicit overrides (e.g. "RED-GREEN-REFACTOR
 * complete: tests added before code" — an explicit signal that the
 * agent DID write a failing test first).
 *
 * When the scan finds a violation, callers should:
 *   1. Record a strike (`tdd_iron_law_violation` or `skipped_tests`)
 *   2. Block the verify-stage gate until the violation is explained
 */

export interface TddIronLawMatch {
  /** Index into TDD_IRON_LAW_PHRASES (0-based). */
  phrase: number;
  /** Text excerpt around the match (≤ 60 chars). */
  excerpt: string;
  /** Character offset of the match in the input. */
  offset: number;
  /** True if the match was within an "escape hatch" override. */
  overridden: boolean;
}

/**
 * 12 anti-TDD phrases. Phrases span:
 *   - English shortcuts ("skip the test", "just deploy")
 *   - Chinese shortcuts ("先上线", "回头补")
 *   - Trust-me / verbal-only verification ("works on my machine")
 *   - Anti-test rationalizations ("tests are slow")
 *
 * Each phrase is a RegExp. English phrases use `\b` word boundaries
 * to reduce false positives; Chinese phrases omit `\b` because the
 * JS `\b` assertion is only defined around `[A-Za-z0-9_]` characters
 * and does not apply to CJK text.
 */
export const TDD_IRON_LAW_PHRASES: readonly RegExp[] = [
  // English shortcuts
  /\b(skip the test|verify manually|trust me it works|works on my machine|should work|later|just deploy|we'll add tests|tests are slow)\b/i,
  /\b(it will work|just ship|deploy first|fix later|add tests later|works for me|good enough)\b/i,
  /\b(commit it|ship it|push it|merge it|skip ci|skip test|skip review|lgtm)\b/i,
  // Chinese shortcuts (no \b — JS word boundaries don't apply to CJK)
  /(承诺.*能跑|一定能跑|应该可以|先上线|回头补|以后加测试|相信我|没问题|先发版|上线再说|口头验证|手动测一下)/,
  // Trust-me / verbal verification
  /\b(tested manually|manually verified|verified by eye|looks right|should be fine)\b/i,
  // Anti-test rationalizations
  /\b(framework tests|integration tests cover it|e2e covers it|smoke test only|too small to test|trivial change)\b/i,
  // Ship-now / no-QA
  /\b(urgent|hotfix|prod down|ship now|fast track|expedite)\b/i,
  // Coverage-blocking
  /\b(skip coverage|skip lint|no time for tests|cut tests|remove tests)\b/i,
  // Knowledge shortcuts
  /\b(i know it works|i tested it locally|ran it locally|on my laptop|on my machine)\b/i,
  // False confidence
  /\b(100% sure|definitely works|certainly works|guaranteed|obviously correct)\b/i,
  // "Just this once"
  /\b(just this once|exception|special case|one off|one-off|not gonna happen again)\b/i,
  // "PR will fix it later"
  /\b(fix in followup|fix in next pr|address in followup|cover later)\b/i,
];

/**
 * Explicit "I did follow TDD" markers. If one of these appears within
 * 200 chars of a violation match, the violation is marked as
 * `overridden: true` so the caller can decide to allow it.
 */
export const TDD_ESCAPE_HATCHES: readonly RegExp[] = [
  /\b(test was added first|tests added before|red[- ]green[- ]refactor|tested in isolation|test fails before passing)\b/i,
  /\b(先写测试|测试先于代码|测试先行|已加测试|写了测试)\b/,
];

/**
 * v13 — P1.2: Additional "STOP" phrases consolidated from
 * `phase-gates.ts:TDD_IRON_LAW_STOP_PHRASES`. These are the spec-superflow
 * stop-phrase set; they did not overlap with the Iron Law phrases above,
 * which created two divergent phrase tables. We merge them here into a
 * single source of truth.
 */
export const TDD_IRON_LAW_STOP_PHRASES: readonly RegExp[] = [
  /skip\s+the\s*test/i,
  /verify\s+manually/i,
  /test\s+is\s+not\s+necessary/i,
  /not\s+worothy\s+of\s+test/i,
  /test\s+overhead/i,
  /tests?\s+can\s+be\s+written\s+later/i,
  /trust\s+me\s+it\s+works/i,
  /works\s+for\s+me/i,
  /probably\s+works/i,
  /assume\s+it\s+is\s+correct/i,
  /test\s+it\s+myself/i,
  /manual\s+verification\s+is\s+enough/i,
];

/**
 * v13 — P1.2: Combined phrase list (24 entries: 12 Iron Law + 12 STOP).
 * Use this in places that need to scan BOTH sets (e.g. verify gate,
 * strike hook). Iron Law alone remains available for soft checks via
 * `checkTddIronLaw`.
 */
export const TDD_IRON_LAW_PHRASES_COMBINED: readonly RegExp[] = [
  ...TDD_IRON_LAW_PHRASES,
  ...TDD_IRON_LAW_STOP_PHRASES,
];

/**
 * Scan `text` for any of the 12 TDD Iron Law phrases. Returns all
 * matches with their location and a `overridden` flag (true if an
 * escape-hatch phrase is nearby).
 */
export function checkTddIronLaw(
  text: string,
  options: { overrideWindow?: number } = {},
): { violated: boolean; matches: TddIronLawMatch[] } {
  const overrideWindow = options.overrideWindow ?? 200;
  const matches: TddIronLawMatch[] = [];
  if (typeof text !== 'string' || text.length === 0) {
    return { violated: false, matches: [] };
  }

  for (let i = 0; i < TDD_IRON_LAW_PHRASES.length; i++) {
    const re = TDD_IRON_LAW_PHRASES[i]!;
    // Reset lastIndex for global regexes (defensive — we used non-global).
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    // We need to scan the full text. Use a global-friendly exec loop.
    const local = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    while ((m = local.exec(text)) !== null) {
      const offset = m.index;
      const excerpt = text.slice(Math.max(0, offset - 20), Math.min(text.length, offset + 40));
      const start = Math.max(0, offset - overrideWindow);
      const end = Math.min(text.length, offset + m[0].length + overrideWindow);
      const ctx = text.slice(start, end);
      const overridden = TDD_ESCAPE_HATCHES.some((h) => h.test(ctx));
      matches.push({ phrase: i, excerpt, offset, overridden });
      // Guard against zero-width matches to avoid infinite loop.
      if (m.index === local.lastIndex) local.lastIndex++;
    }
  }

  // Sort by offset for stable output.
  matches.sort((a, b) => a.offset - b.offset);
  // Violated iff at least one non-overridden match exists.
  const violated = matches.some((m) => !m.overridden);
  return { violated, matches };
}

/**
 * v13 — P1.2: Strict TDD Iron Law check that combines BOTH the Iron Law
 * phrase list AND the STOP phrase list, and reports each match with
 * enough metadata to drive a strike.
 *
 * Unlike `checkTddIronLaw` (which is a soft scan used for advisory
 * output), `checkTddIronLawStrict` is the HARD-BLOCK entry point used
 * by the verify-stage gate and the strike system.
 *
 * Escape hatches apply to BOTH the Iron Law and STOP phrase scans —
 * this prevents the "skip the test" → "skip the test" overlap from
 * double-striking when the agent provided an explicit "I wrote the
 * test first" marker nearby. The escape hatch regex matches within
 * a 200-char window of the violation in either direction.
 *
 * Returned `strike: true` is the signal the caller should use to
 * record a strike and block the gate. `phrase` is the matched text
 * (helpful in strike messages).
 */
export function checkTddIronLawStrict(
  text: string,
  options: { overrideWindow?: number } = {},
): {
  violated: boolean;
  strike: boolean;
  matches: Array<{ source: 'iron_law' | 'stop'; phrase: string; offset: number; excerpt: string }>;
} {
  const overrideWindow = options.overrideWindow ?? 200;
  const matches: Array<{ source: 'iron_law' | 'stop'; phrase: string; offset: number; excerpt: string }> = [];
  if (typeof text !== 'string' || text.length === 0) {
    return { violated: false, strike: false, matches };
  }

  // Helper: check if any escape hatch appears in a window around the match.
  const isOverridden = (offset: number, length: number): boolean => {
    const start = Math.max(0, offset - overrideWindow);
    const end = Math.min(text.length, offset + length + overrideWindow);
    const ctx = text.slice(start, end);
    return TDD_ESCAPE_HATCHES.some((h) => h.test(ctx));
  };

  // Iron Law phrases — escape hatches apply (soft). We track ALL
  // matched ranges (including overridden ones) so the STOP scan can
  // know which regions are already covered by an escape hatch.
  const coveredRanges: Array<[number, number]> = [];
  for (const re of TDD_IRON_LAW_PHRASES) {
    const local = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = local.exec(text)) !== null) {
      coveredRanges.push([m.index, m.index + m[0].length]);
      if (!isOverridden(m.index, m[0].length)) {
        matches.push({
          source: 'iron_law',
          phrase: m[0],
          offset: m.index,
          excerpt: text.slice(Math.max(0, m.index - 20), Math.min(text.length, m.index + 40)),
        });
      }
      if (m.index === local.lastIndex) local.lastIndex++;
    }
  }

  // STOP phrases — escape hatches apply only if the same region is
  // covered by an Iron Law match. Because STOP phrases overlap with
  // Iron Law phrases (e.g. "skip the test"), the escape hatch marker
  // ("tests added before") must take effect for both. We track the
  // "covered" ranges from the Iron Law scan and skip STOP matches
  // whose start falls within a covered range. The covered ranges
  // include BOTH overridden and non-overridden Iron Law matches so
  // the STOP scan can know that an escape hatch marker applies.
  const inCoveredRange = (offset: number, length: number): boolean => {
    const end = offset + length;
    return coveredRanges.some(([s, e]) => offset >= s && end <= e + 10);
  };

  for (const re of TDD_IRON_LAW_STOP_PHRASES) {
    const local = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = local.exec(text)) !== null) {
      // Skip STOP matches that fall within a range already covered by
      // an Iron Law match — the escape hatch on the Iron Law side
      // should also suppress the STOP side. This avoids double-
      // striking the same text region.
      if (inCoveredRange(m.index, m[0].length)) {
        if (m.index === local.lastIndex) local.lastIndex++;
        continue;
      }
      matches.push({
        source: 'stop',
        phrase: m[0],
        offset: m.index,
        excerpt: text.slice(Math.max(0, m.index - 20), Math.min(text.length, m.index + 40)),
      });
      if (m.index === local.lastIndex) local.lastIndex++;
    }
  }

  matches.sort((a, b) => a.offset - b.offset);
  // Any non-overridden match (Iron Law or STOP) strikes.
  const strike = matches.length > 0;
  return { violated: strike, strike, matches };
}
