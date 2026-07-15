/**
 * v14 — v13-P7.1: Pre-Skill Invocation Guard
 *
 * Inspired by obra/superpowers skill composition: each skill declares
 * `when_to_use` and the guard checks whether the current context matches
 * the predicate before the skill is invoked. Mismatches produce a strike
 * (not a hard throw) so the agent can recover via escape hatch.
 *
 * ## Algorithm
 *   1. Tokenize the `when_to_use` clause into keywords.
 *   2. Score the current context (storyId, stage, tags, filePath) for
 *      keyword overlap. A score >= `minMatchScore` passes.
 *   3. Escape hatches: if the user explicitly invokes the skill
 *      (`explicit: true`), the guard always passes.
 *   4. Result: `{ allowed, score, matched, strike, reason }`.
 *
 * ## Integration
 * The guard is consumed by `MCPEventBridge.pre-skill-invocation` so any
 * client (with or without native hooks) benefits from the check.
 *
 * Reference: obra/superpowers v6.x "Skill composition" pattern.
 */

import type { SkillMeta } from '../L5_skill/registry';

// ── Public types ─────────────────────────────────────────────

export interface PreSkillContext {
  /** Current story id (e.g. "STORY-123"). */
  storyId?: string;
  /** Current pipeline stage. */
  stage?: string;
  /** Free-form tags describing the current task. */
  tags?: string[];
  /** Path of the file the agent is working on. */
  filePath?: string;
  /** Free-form description of what the agent is about to do. */
  intent?: string;
  /** User explicitly named the skill (escape hatch). */
  explicit?: boolean;
}

export interface GuardResult {
  /** True iff the skill may be invoked. */
  allowed: boolean;
  /** Overlap score in [0, 1]. */
  score: number;
  /** List of keywords that matched. */
  matched: string[];
  /** True iff a strike should be recorded. */
  strike: boolean;
  /** Human-readable reason for the result. */
  reason: string;
}

// ── Constants ────────────────────────────────────────────────

/** Minimum match score required to allow invocation. */
export const DEFAULT_MIN_MATCH_SCORE = 0.2;

/** Words that should be ignored when tokenizing `when_to_use`. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'this', 'that', 'these', 'those', 'it', 'its',
  'you', 'your', 'i', 'me', 'my', 'we', 'us', 'our',
  'use', 'used', 'using', 'should', 'would', 'could', 'will',
  'not', 'no', 'so', 'as', 'do', 'does', 'did', 'have', 'has', 'had',
  'when', 'where', 'what', 'who', 'how', 'why',
]);

// ── Public API ───────────────────────────────────────────────

/**
 * Create a guard for a single skill invocation.
 *
 * @param skill       The skill metadata (`SkillMeta`).
 * @param context     The current invocation context.
 * @param minScore    Optional override for the minimum match score.
 */
export function checkPreSkill(
  skill: Pick<SkillMeta, 'name' | 'when_to_use'>,
  context: PreSkillContext,
  minScore: number = DEFAULT_MIN_MATCH_SCORE,
): GuardResult {
  // Escape hatch 1: explicit user invocation always passes.
  if (context.explicit === true) {
    return {
      allowed: true,
      score: 1,
      matched: ['<explicit>'],
      strike: false,
      reason: 'Explicit user invocation — guard bypassed',
    };
  }

  const keywords = tokenizeWhenToUse(skill.when_to_use);
  if (keywords.length === 0) {
    // No keywords means the skill is always invocable.
    return {
      allowed: true,
      score: 1,
      matched: [],
      strike: false,
      reason: `Skill "${skill.name}" has no when_to_use keywords — always allowed`,
    };
  }

  const contextTokens = tokenizeContext(context);
  const matched = keywords.filter((kw) => contextTokens.has(kw));
  const score = matched.length / keywords.length;
  const allowed = score >= minScore;

  return {
    allowed,
    score: Math.round(score * 1000) / 1000,
    matched,
    strike: !allowed,
    reason: allowed
      ? `Skill "${skill.name}" matches context (${matched.length}/${keywords.length} keywords, score=${score.toFixed(2)})`
      : `Skill "${skill.name}" does not match context (${matched.length}/${keywords.length} keywords, score=${score.toFixed(2)} < ${minScore})`,
  };
}

/**
 * Class wrapper for use in dependency-injected code paths.
 */
export class PreSkillInvocationGuard {
  private minScore: number;
  constructor(minScore: number = DEFAULT_MIN_MATCH_SCORE) {
    this.minScore = minScore;
  }
  check(skill: Pick<SkillMeta, 'name' | 'when_to_use'>, context: PreSkillContext): GuardResult {
    return checkPreSkill(skill, context, this.minScore);
  }
}

// ── Helpers (exported for testing) ───────────────────────────

/**
 * Tokenize a `when_to_use` clause into normalized keywords.
 * Splits on whitespace + punctuation, lower-cases, drops stop-words
 * and short tokens (< 3 chars).
 */
export function tokenizeWhenToUse(whenToUse: string): string[] {
  if (typeof whenToUse !== 'string') return [];
  const tokens = whenToUse
    .toLowerCase()
    .split(/[\s,.;:!?()\[\]{}"'`/\\|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  return Array.from(new Set(tokens));
}

/**
 * Build a set of normalized tokens from the current invocation context.
 * Combines storyId, stage, tags, filePath, and intent into a single bag.
 */
export function tokenizeContext(context: PreSkillContext): Set<string> {
  const tokens = new Set<string>();
  const push = (val: unknown) => {
    if (typeof val !== 'string') return;
    for (const t of val.toLowerCase().split(/[\s,.;:!?()\[\]{}"'`/\\|_-]+/)) {
      if (t.length >= 3 && !STOP_WORDS.has(t)) tokens.add(t);
    }
  };
  if (context.storyId) push(context.storyId);
  if (context.stage) push(context.stage);
  if (context.tags) for (const t of context.tags) push(t);
  if (context.filePath) push(context.filePath);
  if (context.intent) push(context.intent);
  return tokens;
}
