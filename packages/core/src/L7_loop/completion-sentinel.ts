/**
 * Completion Sentinel Detection (T27)
 *
 * Implements ralphy-openspec's `<promise>...</promise>` completion sentinel
 * pattern as a safe-guard for LLM-driven loops. The sentinel is the single
 * contract by which an agent signals "task done" / "task failed" / "task
 * blocked" — when the loop detects a sentinel in the agent's output it
 * terminates and routes to the appropriate handler.
 *
 * Reference: wenqingyu/ralphy-openspec
 *   - https://github.com/wenqingyu/ralphy-openspec
 *
 * Three default sentinels (extensible via SkillMeta.completion_sentinel):
 *   <promise>TASK_COMPLETE</promise>
 *   <promise>TASK_FAILED</promise>
 *   <promise>TASK_BLOCKED</promise>
 *
 * The detector only looks at the **tail** of the text (last 200 chars by
 * default) to avoid false positives from earlier prose that happened to
 * mention `<promise>` as a token.
 */

export const DEFAULT_SENTINELS = {
  taskComplete: '<promise>TASK_COMPLETE</promise>',
  taskFailed: '<promise>TASK_FAILED</promise>',
  taskBlocked: '<promise>TASK_BLOCKED</promise>',
} as const;

export type SentinelKey = keyof typeof DEFAULT_SENTINELS;

export interface SentinelMatch {
  matched: SentinelKey | null;
  sentinel: string | null;
  offset: number;            // character offset of the sentinel in the input
  inTail: boolean;           // true when the match was within the tail window
}

export interface SentinelAllMatch {
  key: SentinelKey;
  sentinel: string;
  offset: number;
  inTail: boolean;
}

/**
 * Detect a single completion sentinel in `text`. Returns the first match
 * (in document order). The match is reported with the document offset
 * and whether it fell within the `tailWindow` of the input.
 *
 * The `tailWindow` is a defensive measure: agents occasionally echo
 * `<promise>` tokens in earlier prose (e.g. "the response will be wrapped
 * in <promise>TASK_COMPLETE</promise>"). Restricting detection to the
 * tail avoids that false positive.
 */
export function detectSentinel(
  text: string,
  options: { tailWindow?: number; sentinels?: Record<SentinelKey, string> } = {},
): SentinelMatch {
  const tailWindow = options.tailWindow ?? 200;
  const sentinels = options.sentinels ?? DEFAULT_SENTINELS;

  if (typeof text !== 'string' || text.length === 0) {
    return { matched: null, sentinel: null, offset: -1, inTail: false };
  }

  // Compute the start of the tail window (clamped to 0)
  const tailStart = Math.max(0, text.length - tailWindow);

  // Only search within the tail window. This is the strict policy:
  // a sentinel in earlier prose (e.g. "the response will contain
  // <promise>...</promise>") must NOT trigger a loop termination.
  const tailSlice = text.slice(tailStart);
  for (const key of Object.keys(sentinels) as SentinelKey[]) {
    const sentinel = sentinels[key];
    const idx = tailSlice.indexOf(sentinel);
    if (idx >= 0) {
      return {
        matched: key,
        sentinel,
        offset: tailStart + idx,
        inTail: true,
      };
    }
  }

  return { matched: null, sentinel: null, offset: -1, inTail: false };
}

/**
 * Detect ALL sentinels in the text (useful for logging / debugging).
 * Returns matches in document order.
 */
export function detectAllSentinels(
  text: string,
  options: { tailWindow?: number; sentinels?: Record<SentinelKey, string> } = {},
): SentinelAllMatch[] {
  const tailWindow = options.tailWindow ?? 200;
  const sentinels = options.sentinels ?? DEFAULT_SENTINELS;

  if (typeof text !== 'string' || text.length === 0) return [];

  const tailStart = Math.max(0, text.length - tailWindow);
  const out: SentinelAllMatch[] = [];

  for (const key of Object.keys(sentinels) as SentinelKey[]) {
    const sentinel = sentinels[key];
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(sentinel, from);
      if (idx < 0) break;
      out.push({
        key,
        sentinel,
        offset: idx,
        inTail: idx >= tailStart,
      });
      from = idx + sentinel.length;
    }
  }

  // Sort by offset
  out.sort((a, b) => a.offset - b.offset);
  return out;
}

/**
 * Convenience predicate: does the text contain a TASK_COMPLETE sentinel?
 */
export function isTaskComplete(
  text: string,
  options?: { tailWindow?: number },
): boolean {
  return detectSentinel(text, options).matched === 'taskComplete';
}
