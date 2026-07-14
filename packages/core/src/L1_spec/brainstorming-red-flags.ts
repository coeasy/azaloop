/**
 * Brainstorming Red Flags (T25)
 *
 * Implements the 12-item Red Flag table from obra/superpowers' brainstorming
 * skill. These flags represent common "skip-the-design" rationalizations
 * that the agent must explicitly answer before the PRDReviewGate can be
 * approved. They are surfaced during the HARD-GATE review so the user can
 * see *which* flag motivated the question and respond with a thoughtful
 * answer rather than rubber-stamping the approval.
 *
 * Reference: obra/superpowers
 *   - https://github.com/obra/superpowers
 *
 * The Red Flags are intentionally written in plain prose so they can be
 * rendered directly in the PRDReviewGate review summary.
 */

export interface RedFlag {
  /** The user's (or agent's) instinctive thought. */
  thought: string;
  /** The reality that disproves the thought. */
  reality: string;
}

export const BRAINSTORMING_RED_FLAGS: RedFlag[] = [
  {
    thought: 'This is too simple to need a design.',
    reality: 'Simple features ship as 5-step builds; skipping the spec ships 3 of them wrong.',
  },
  {
    thought: 'I already know what to build, let me start.',
    reality: 'You are projecting; the user has not committed to a plan.',
  },
  {
    thought: 'The user said "just code it".',
    reality: 'That is a request for speed, not a waiver of the contract.',
  },
  {
    thought: 'I will design as I build.',
    reality: 'Rework after build is 10x more expensive than design before build.',
  },
  {
    thought: 'We can add indexes later when slow.',
    reality: 'Late indexes corrupt the production data shape.',
  },
  {
    thought: 'We will document the API after the first consumer works.',
    reality: 'Untyped APIs cause 3+ consumer rewrites per endpoint.',
  },
  {
    thought: 'Skip the test, verify manually.',
    reality: 'Manual verification is not a test; it is a prayer.',
  },
  {
    thought: 'I can add tests later.',
    reality: 'Tests never get added; they get skipped.',
  },
  {
    thought: 'It works on my machine.',
    reality: 'Production is not your machine.',
  },
  {
    thought: 'We will refactor this later.',
    reality: 'Tech debt compounds at 30% per quarter; "later" is never.',
  },
  {
    thought: 'This is a quick fix.',
    reality: 'Quick fixes average 3 follow-up fixes and a refactor.',
  },
  {
    thought: 'I am sure this will work.',
    reality: 'Confidence without verification is hallucination.',
  },
];

/**
 * Look up a Red Flag by its `thought` text (case-insensitive substring match).
 * Returns the first matching flag, or `null` if none matches.
 */
export function getBrainstormingRedFlagByThought(thought: string): RedFlag | null {
  if (typeof thought !== 'string' || thought.length === 0) return null;
  const lower = thought.toLowerCase();
  return BRAINSTORMING_RED_FLAGS.find((f) => f.thought.toLowerCase().includes(lower)) ?? null;
}

/**
 * Return the first N Red Flags (default 3). Used to surface a small,
 * non-overwhelming subset during the HARD-GATE review.
 */
export function topBrainstormingRedFlags(n: number = 3): RedFlag[] {
  return BRAINSTORMING_RED_FLAGS.slice(0, Math.max(0, n));
}
