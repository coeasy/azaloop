import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * A single workspace journal entry.
 */
export interface JournalRecord {
  /** ISO timestamp */
  timestamp: string;
  /** Session identifier (ISO date-based) */
  session_id: string;
  /** Pipeline stage when journal was created */
  stage: string;
  /** Summary of work done in this session */
  work_summary: string;
  /** Key decisions made */
  decisions: string[];
  /** Issues encountered */
  issues: string[];
  /** Next steps for the following session */
  next_steps: string[];
  /** Iteration count at journal time */
  iteration: number;
}

/**
 * WorkspaceJournal — automatic session journaling for cross-session continuity.
 *
 * Borrows from Trellis's workspace journals pattern: every `finish-work`
 * event automatically archives a session log. On next session start,
 * the most recent journal summary is injected as context.
 *
 * Journal files are stored as JSONL at `{azaDir}/journals/workspace-journal.jsonl`.
 */
export class WorkspaceJournal {
  private azaDir: string;
  private journalDir: string;

  constructor(azaDir: string) {
    this.azaDir = azaDir;
    this.journalDir = path.join(azaDir, 'journals');
  }

  /**
   * Archive the current session's work as a journal entry.
   * Called automatically on finish-work / on-stop events.
   */
  async archive(options: {
    stage: string;
    work_summary: string;
    decisions?: string[];
    issues?: string[];
    next_steps?: string[];
    iteration?: number;
  }): Promise<JournalRecord> {
    const record: JournalRecord = {
      timestamp: new Date().toISOString(),
      session_id: `session-${Date.now()}`,
      stage: options.stage,
      work_summary: options.work_summary,
      decisions: options.decisions ?? [],
      issues: options.issues ?? [],
      next_steps: options.next_steps ?? [],
      iteration: options.iteration ?? 0,
    };

    await fs.mkdir(this.journalDir, { recursive: true });
    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(this.getJournalPath(), line, 'utf8');

    return record;
  }

  /**
   * Load all journal entries.
   */
  async loadAll(): Promise<JournalRecord[]> {
    try {
      const raw = await fs.readFile(this.getJournalPath(), 'utf8');
      const entries: JournalRecord[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as JournalRecord;
          if (parsed && parsed.session_id && parsed.work_summary) {
            entries.push(parsed);
          }
        } catch { /* skip malformed */ }
      }
      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Get the most recent journal entry for session-start context injection.
   */
  async getLatest(): Promise<JournalRecord | null> {
    const entries = await this.loadAll();
    if (entries.length === 0) return null;
    const last = entries[entries.length - 1];
    return last ?? null;
  }

  /**
   * Generate a context injection string from the latest journal.
   * Used at session start to provide continuity.
   */
  async generateSessionContext(): Promise<string> {
    const latest = await this.getLatest();
    if (!latest) {
      return 'No previous session journal found — starting fresh.';
    }

    const parts: string[] = [
      `Previous session (${latest.session_id}, ${latest.timestamp}):`,
      `  Stage: ${latest.stage} (iteration ${latest.iteration})`,
      `  Work: ${latest.work_summary}`,
    ];

    if (latest.decisions.length > 0) {
      parts.push(`  Decisions: ${latest.decisions.join('; ')}`);
    }
    if (latest.issues.length > 0) {
      parts.push(`  Issues: ${latest.issues.join('; ')}`);
    }
    if (latest.next_steps.length > 0) {
      parts.push(`  Next steps: ${latest.next_steps.join('; ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Get the journal file path.
   */
  getJournalPath(): string {
    return path.join(this.journalDir, 'workspace-journal.jsonl');
  }
}

// ── v14 — P9.1: Auto journal entry helper ────────────────────

/**
 * Auto-append a journal entry without instantiating the full class.
 * Designed for `auto-loop-engine.ts` which calls this on every stage
 * transition. Best-effort: failures are caught and logged but never
 * re-thrown so the loop can continue.
 *
 * @param azaDir  workspace `.aza` directory
 * @param entry   minimal entry payload
 */
export async function autoAppendJournalEntry(
  azaDir: string,
  entry: {
    stage: string;
    summary: string;
    decisions?: string[];
    openQuestions?: string[];
    iteration?: number;
  },
): Promise<JournalRecord | null> {
  try {
    const journal = new WorkspaceJournal(azaDir);
    const record = await journal.archive({
      stage: entry.stage,
      work_summary: entry.summary,
      decisions: entry.decisions,
      issues: entry.openQuestions,
      next_steps: [],
      iteration: entry.iteration,
    });
    return record;
  } catch (err) {
    // best-effort: swallow and warn
    try {
      // eslint-disable-next-line no-console
      console.warn(`autoAppendJournalEntry: ${(err as Error).message}`);
    } catch {
      // ignore
    }
    return null;
  }
}
