import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Learn-from-task conventions writer.
 *
 * Inspired by Trellis's `trellis-update-spec`: after each task completes,
 * learned conventions are written to `.aza/spec-conventions/` so the next
 * session starts smarter. This creates a compounding knowledge loop.
 */
export interface ConventionsEntry {
  /** Short tag for the convention (e.g., 'tdd', 'security', 'architecture'). */
  tag: string;
  /** Human-readable description of the learned convention. */
  description: string;
  /** Source stage or story that produced this convention. */
  source: string;
  /** Timestamp when the convention was recorded. */
  recorded_at: string;
}

/**
 * Write learned conventions to the spec-conventions directory.
 * Appends to existing conventions rather than overwriting.
 */
export async function writeConventions(
  azaDir: string,
  entry: ConventionsEntry,
): Promise<void> {
  const conventionsDir = path.join(azaDir, 'spec-conventions');
  await fs.mkdir(conventionsDir, { recursive: true });

  // Read existing conventions
  const conventionsPath = path.join(conventionsDir, 'conventions.jsonl');
  let existingEntries: ConventionsEntry[] = [];
  try {
    const content = await fs.readFile(conventionsPath, 'utf8');
    for (const line of content.split('\n')) {
      if (line.trim()) {
        existingEntries.push(JSON.parse(line) as ConventionsEntry);
      }
    }
  } catch {
    // File doesn't exist yet — start fresh
  }

  // Add new entry
  existingEntries.push(entry);

  // Write back
  const lines = existingEntries.map(e => JSON.stringify(e));
  await fs.writeFile(conventionsPath, lines.join('\n') + '\n', 'utf8');
}

/**
 * Load all conventions from the spec-conventions directory.
 * Used at session start to inject learned conventions.
 */
export async function loadConventions(azaDir: string): Promise<ConventionsEntry[]> {
  const conventionsPath = path.join(azaDir, 'spec-conventions', 'conventions.jsonl');
  try {
    const content = await fs.readFile(conventionsPath, 'utf8');
    const entries: ConventionsEntry[] = [];
    for (const line of content.split('\n')) {
      if (line.trim()) {
        const parsed = JSON.parse(line) as ConventionsEntry;
        if (parsed.tag && parsed.description) {
          entries.push(parsed);
        }
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Auto-generated conventions from a completed task.
 * Extracts conventions from the task's work summary and gate results.
 */
export function extractConventionsFromTask(
  workSummary: string,
  stage: string,
  iteration: number,
): ConventionsEntry[] {
  const entries: ConventionsEntry[] = [];
  const now = new Date().toISOString();

  // Extract TDD patterns from work summary
  if (/tsc\s+--noEmit\s*\(?\d+?\)/i.test(workSummary) || /test.*pass.*100/i.test(workSummary)) {
    entries.push({
      tag: 'tdd',
      description: 'Enforce type-check before test suite to catch compile errors early',
      source: `${stage}:iter${iteration}`,
      recorded_at: now,
    });
  }

  // Extract security patterns
  if (/secret.*scan.*pass/i.test(workSummary) || /security.*gate.*pass/i.test(workSummary)) {
    entries.push({
      tag: 'security',
      description: 'Run security scan as part of verify gate, not as optional post-hoc check',
      source: `${stage}:iter${iteration}`,
      recorded_at: now,
    });
  }

  // Extract PRD quality patterns
  if (/prd.*score.*\d+%.*critical.*0/i.test(workSummary)) {
    entries.push({
      tag: 'prd',
      description: 'P0 issues must be 0 before design stage — auto-generate PRD with minimum viable stories',
      source: `${stage}:iter${iteration}`,
      recorded_at: now,
    });
  }

  // Generic: always record stage completion pattern
  entries.push({
    tag: 'stage-completion',
    description: `${stage} stage passed all quality gates after ${iteration} iterations`,
    source: `${stage}:iter${iteration}`,
    recorded_at: now,
  });

  return entries;
}
