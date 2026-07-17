/**
 * Maker/Checker review cap — superpowers-aligned two-stage review limit.
 * After max consecutive checker failures for a story, block the story
 * and refuse to advance (do not burn more tokens).
 */
import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_MAX_CHECKER_FAILURES = 3;

export interface ReviewCapState {
  story_id: string;
  consecutive_checker_failures: number;
  max_failures: number;
  blocked: boolean;
  updated_at: string;
}

function capPath(azaDir: string): string {
  return path.join(azaDir, 'maker-checker-cap.json');
}

export function loadReviewCap(azaDir: string): ReviewCapState | null {
  const p = capPath(azaDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ReviewCapState;
  } catch {
    return null;
  }
}

export function saveReviewCap(azaDir: string, state: ReviewCapState): void {
  fs.mkdirSync(azaDir, { recursive: true });
  fs.writeFileSync(capPath(azaDir), JSON.stringify(state, null, 2), 'utf8');
}

/** Record a checker failure; returns whether story is now blocked. */
export function recordCheckerFailure(
  azaDir: string,
  storyId: string,
  maxFailures = DEFAULT_MAX_CHECKER_FAILURES,
): ReviewCapState {
  const prev = loadReviewCap(azaDir);
  const same = prev?.story_id === storyId;
  const failures = same ? (prev?.consecutive_checker_failures ?? 0) + 1 : 1;
  const state: ReviewCapState = {
    story_id: storyId,
    consecutive_checker_failures: failures,
    max_failures: maxFailures,
    blocked: failures >= maxFailures,
    updated_at: new Date().toISOString(),
  };
  saveReviewCap(azaDir, state);
  return state;
}

/** Reset on checker pass / new story. */
export function recordCheckerPass(azaDir: string, storyId: string): ReviewCapState {
  const state: ReviewCapState = {
    story_id: storyId,
    consecutive_checker_failures: 0,
    max_failures: DEFAULT_MAX_CHECKER_FAILURES,
    blocked: false,
    updated_at: new Date().toISOString(),
  };
  saveReviewCap(azaDir, state);
  return state;
}

export function isStoryBlockedByReviewCap(azaDir: string, storyId?: string): boolean {
  const s = loadReviewCap(azaDir);
  if (!s?.blocked) return false;
  if (storyId && s.story_id !== storyId) return false;
  return true;
}
