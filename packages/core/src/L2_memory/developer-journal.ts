import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * Per-developer journal system.
 *
 * Inspired by Trellis's `.trellis/workspace/{name}/journal-N.md`.
 * Each session appends to the developer's journal.
 * SessionStart reads the last journal entry to recall context.
 */
export interface JournalEntry {
  id: string; // SHA256 hash
  timestamp: string;
  developer: string;
  stage: string;
  story: string | null;
  summary: string;
  actions: string[];
  learnings: string[];
  next_steps: string[];
}

/**
 * Record a journal entry for the current session.
 */
export async function recordJournalEntry(
  azaDir: string,
  developer: string,
  entry: Omit<JournalEntry, 'id' | 'timestamp' | 'developer'>,
): Promise<JournalEntry> {
  const journalDir = path.join(azaDir, 'workspace', developer);
  await fs.mkdir(journalDir, { recursive: true });

  const journalFile = path.join(journalDir, 'journal.md');
  const newEntry: JournalEntry = {
    id: createHash('sha256').update(`${developer}:${Date.now()}`).digest('hex').slice(0, 16),
    timestamp: new Date().toISOString(),
    developer,
    ...entry,
  };

  const entryText = `
## ${newEntry.timestamp}
**Stage:** ${newEntry.stage}
**Story:** ${newEntry.story || 'N/A'}
**Summary:** ${newEntry.summary}

### Actions
${newEntry.actions.map(a => `- ${a}`).join('\n')}

### Learnings
${newEntry.learnings.map(l => `- ${l}`).join('\n')}

### Next Steps
${newEntry.next_steps.map(n => `- ${n}`).join('\n')}
`;

  try {
    await fs.appendFile(journalFile, entryText + '\n', 'utf8');
  } catch {
    // File might not exist — create it
    await fs.writeFile(journalFile, '# Developer Journal\n' + entryText + '\n', 'utf8');
  }

  return newEntry;
}

/**
 * Get the last N journal entries for a developer.
 * Used by SessionStart to recall context.
 */
export async function getRecentJournals(
  azaDir: string,
  developer: string,
  limit: number = 3,
): Promise<JournalEntry[]> {
  const journalFile = path.join(azaDir, 'workspace', developer, 'journal.md');
  try {
    const content = await fs.readFile(journalFile, 'utf8');
    const entries: JournalEntry[] = [];
    const sections = content.split(/^## /m).filter(s => s.trim());

    for (const section of sections) {
      const match = section.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
      if (!match) continue;

      const stageMatch = section.match(/\*\*Stage:\*\* (.+)/);
      const storyMatch = section.match(/\*\*Story:\*\* (.+)/);
      const summaryMatch = section.match(/\*\*Summary:\*\* (.+)/);
      const actionsMatch = section.match(/### Actions\n((?:- .+\n?)*)/);
      const learningsMatch = section.match(/### Learnings\n((?:- .+\n?)*)/);
      const nextStepsMatch = section.match(/### Next Steps\n((?:- .+\n?)*)/);

      entries.push({
        id: createHash('sha256').update(section).digest('hex').slice(0, 16),
        timestamp: match?.[1] ?? '',
        developer,
        stage: stageMatch?.[1]?.trim() ?? 'unknown',
        story: storyMatch?.[1]?.trim() ?? null,
        summary: summaryMatch?.[1]?.trim() ?? '',
        actions: actionsMatch?.[1]?.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()) ?? [],
        learnings: learningsMatch?.[1]?.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()) ?? [],
        next_steps: nextStepsMatch?.[1]?.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()) ?? [],
      });
    }

    return entries.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Generate SessionStart recall message from recent journals.
 * Returns a natural language message like "Hi, last session you finished..."
 */
export function generateSessionStartMessage(
  recentJournals: JournalEntry[],
  developer: string,
): string {
  if (recentJournals.length === 0) {
    return `Welcome, ${developer}! This is a new session. Let's get started.`;
  }

  const last = recentJournals[recentJournals.length - 1]!;
  const messageParts: string[] = [];

  messageParts.push(`Welcome back, ${developer}! Last session you were at **${last.stage}** stage.`);

  if (last.story) {
    messageParts.push(`You were working on story: ${last.story}`);
  }

  if (last.next_steps.length > 0) {
    messageParts.push(`**Pending next steps:**`);
    for (const step of last.next_steps) {
      messageParts.push(`- ${step}`);
    }
  }

  if (last.learnings.length > 0) {
    messageParts.push(`**Learnings from last session:**`);
    for (const learning of last.learnings) {
      messageParts.push(`- ${learning}`);
    }
  }

  return messageParts.join('\n');
}
