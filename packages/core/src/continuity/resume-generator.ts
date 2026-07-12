import * as fs from 'fs/promises';
import * as path from 'path';
import { StateManager } from '../state/state-manager';
import type { EpisodicMemory } from '../L2_memory/project-memory';

export interface ResumeData {
  current_stage: string;
  current_story?: string;
  iteration: number;
  progress: string;
  client: string;
  model: string;
  next_action: string;
  next_tool: string;
  errors_to_avoid: string[];
  last_milestone: string;
}

/**
 * A single question in the 5-Question Reboot Test.
 */
export interface RebootQuestion {
  /** Question number (1–5). */
  index: number;
  /** The question in Chinese. */
  question: string;
  /** English translation of the question. */
  question_en: string;
  /** The answer derived from current state and memory. */
  answer: string;
  /** Optional supporting detail. */
  detail?: string;
}

/**
 * Result of the 5-Question Reboot Test.
 *
 * The reboot test verifies that enough context is available to safely
 * resume the loop after a session reboot.
 */
export interface RebootTestResult {
  /** The five questions with their answers. */
  questions: RebootQuestion[];
  /** Whether all five questions could be answered (sufficient context). */
  can_reboot: boolean;
  /** ISO timestamp of when the test was generated. */
  generated_at: string;
}

/**
 * The type of a run-ledger entry.
 *
 * - **ledger-append**   — a generic append record (progress, actions, notes)
 * - **ledger-summary**  — a summary marker produced by {@link generateRunLedger}
 * - **phase-status**    — a phase/stage status change record
 */
export type LedgerEntryType = 'ledger-append' | 'ledger-summary' | 'phase-status';

/**
 * A single entry in the append-only JSONL run ledger.
 */
export interface LedgerEntry {
  /** The entry type. */
  type: LedgerEntryType;
  /** ISO timestamp of the entry. */
  timestamp: string;
  /** The pipeline stage, if applicable. */
  stage?: string;
  /** The loop iteration, if applicable. */
  iteration?: number;
  /** The human-readable message. */
  message: string;
  /** Optional structured metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Summary of the run ledger produced by {@link ResumeGenerator.generateRunLedger}.
 */
export interface LedgerSummary {
  /** Total number of entries in the ledger. */
  total_entries: number;
  /** Number of `phase-status` entries. */
  phase_statuses: number;
  /** Number of `ledger-append` entries. */
  appends: number;
  /** Number of `ledger-summary` entries. */
  summaries: number;
  /** ISO timestamp of the first entry, if any. */
  first_entry?: string;
  /** ISO timestamp of the last entry, if any. */
  last_entry?: string;
  /** The raw entries (optional, for callers that need them). */
  entries?: LedgerEntry[];
}

export class ResumeGenerator {
  private azaDir: string;

  constructor(azaDir: string) {
    this.azaDir = azaDir;
  }

  async generate(stateManager: StateManager, extra?: Partial<ResumeData>): Promise<ResumeData> {
    const state = stateManager.getState();
    const resume: ResumeData = {
      current_stage: state.pipeline.current_stage,
      current_story: state.loop.current_story,
      iteration: state.loop.iteration,
      progress: state.loop.progress,
      client: state.loop.client,
      model: state.loop.model,
      next_action: `continue_${state.pipeline.current_stage}`,
      next_tool: this.getNextTool(state.pipeline.current_stage),
      errors_to_avoid: [],
      last_milestone: state.updated_at,
      ...extra,
    };

    await this.write(resume);
    return resume;
  }

  async read(): Promise<ResumeData | null> {
    try {
      const content = await fs.readFile(this.getPath(), 'utf8');
      return this.parse(content);
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.getPath());
    } catch {
      // File doesn't exist
    }
  }

  getPath(): string {
    return path.join(this.azaDir, 'RESUME.md');
  }

  private async write(resume: ResumeData): Promise<void> {
    await fs.mkdir(this.azaDir, { recursive: true }).catch(() => {});
    const content = this.format(resume);
    await fs.writeFile(this.getPath(), content, 'utf8');
  }

  private format(resume: ResumeData): string {
    return [
      '# AzaLoop Resume',
      '',
      '> Auto-generated resume file for cross-session continuity',
      '',
      '## Current State',
      '',
      `- **Stage:** ${resume.current_stage}`,
      resume.current_story ? `- **Story:** ${resume.current_story}` : '',
      `- **Iteration:** ${resume.iteration}`,
      `- **Progress:** ${resume.progress}`,
      `- **Client:** ${resume.client}`,
      `- **Model:** ${resume.model}`,
      '',
      '## Next Action',
      '',
      `- **Tool:** ${resume.next_tool}`,
      `- **Action:** ${resume.next_action}`,
      '',
      resume.errors_to_avoid.length > 0 ? [
        '## Errors to Avoid',
        '',
        ...resume.errors_to_avoid.map(e => `- ⚠ ${e}`),
        '',
      ].join('\n') : '',
      '## Instructions',
      '',
      '1. Call `aza_context_calibrate` to get current state',
      '2. Call `aza_loop_next` to continue',
      '3. Follow the next_action chain automatically',
      '',
    ].filter(Boolean).join('\n');
  }

  private parse(content: string): ResumeData {
    const lines = content.split('\n');
    const data: Record<string, string> = {};
    for (const line of lines) {
      const match = line.match(/^-\s+\*\*(.+?):\*\*\s+(.+)/);
      if (match && match[1] && match[2]) {
        data[match[1].toLowerCase()] = match[2].trim();
      }
    }
    return {
      current_stage: data['stage'] || 'open',
      current_story: data['story'],
      iteration: parseInt(data['iteration'] || '0', 10),
      progress: data['progress'] || '0%',
      client: data['client'] || 'unknown',
      model: data['model'] || 'unknown',
      next_action: data['action'] || 'continue_open',
      next_tool: data['tool'] || 'aza_prd_generate',
      errors_to_avoid: [],
      last_milestone: new Date().toISOString(),
    };
  }

  private getNextTool(stage: string): string {
    const tools: Record<string, string> = {
      open: 'aza_prd_generate',
      design: 'aza_task_design',
      build: 'aza_task_implement',
      verify: 'aza_quality_check',
      archive: 'aza_doc_generate',
    };
    return tools[stage] || 'aza_loop_next';
  }

  // ── 5-Question Reboot Test ──

  /**
   * Generate the 5-Question Reboot Test for context recovery.
   *
   * The five questions verify that enough context is available to safely
   * resume the loop after a session reboot:
   *
   * 1. **我在哪？** — Where am I? (current stage)
   * 2. **我要去哪？** — Where am I going? (remaining stages)
   * 3. **目标是什么？** — What's the goal? (goal statement from the plan)
   * 4. **我学到了什么？** — What have I learned? (findings / episodic memory)
   * 5. **我做了什么？** — What have I done? (progress / iteration history)
   *
   * @param stateManager  The state manager providing current loop state.
   * @param options       Optional context: episodic memories, plan goal, and
   *                      ledger entries used to answer questions 3–5.
   * @returns The reboot test result with all five answers.
   */
  async generate5QuestionReboot(
    stateManager: StateManager,
    options?: {
      episodicMemories?: EpisodicMemory[];
      planGoal?: string;
      ledgerEntries?: LedgerEntry[];
    },
  ): Promise<RebootTestResult> {
    const state = stateManager.getState();
    const remainingStages = this.getRemainingStages(state.pipeline.current_stage);
    const memories = options?.episodicMemories ?? [];
    const ledger = options?.ledgerEntries ?? await this.readLedger();

    const questions: RebootQuestion[] = [
      {
        index: 1,
        question: '我在哪？',
        question_en: 'Where am I? (current stage)',
        answer: state.pipeline.current_stage,
        detail: `Current stage is "${state.pipeline.current_stage}" (iteration ${state.loop.iteration}, progress ${state.loop.progress}).`,
      },
      {
        index: 2,
        question: '我要去哪？',
        question_en: 'Where am I going? (remaining stages)',
        answer: remainingStages.length > 0 ? remainingStages.join(' → ') : '— (final stage)',
        detail: remainingStages.length > 0
          ? `${remainingStages.length} stage(s) remaining: ${remainingStages.join(', ')}`
          : 'Already at the final stage (archive).',
      },
      {
        index: 3,
        question: '目标是什么？',
        question_en: "What's the goal? (goal statement from the plan)",
        answer: options?.planGoal ?? '(goal not specified)',
        detail: options?.planGoal
          ? 'Goal statement recovered from the plan.'
          : 'No explicit goal was provided — consider attesting the plan for recovery.',
      },
      {
        index: 4,
        question: '我学到了什么？',
        question_en: 'What have I learned? (findings / episodic memory)',
        answer: memories.length > 0
          ? memories.slice(-3).map(m => m.summary).join('; ')
          : '(no episodic memories recorded)',
        detail: memories.length > 0
          ? `${memories.length} episodic memories available; showing the 3 most recent.`
          : 'No episodic memory found — context recovery may be incomplete.',
      },
      {
        index: 5,
        question: '我做了什么？',
        question_en: 'What have I done? (progress / iteration history)',
        answer: ledger.length > 0
          ? `${state.loop.iteration} iteration(s), ${ledger.length} ledger entries`
          : `${state.loop.iteration} iteration(s), progress ${state.loop.progress}`,
        detail: ledger.length > 0
          ? `Ledger has ${ledger.length} entries; last: "${ledger[ledger.length - 1]?.message ?? ''}".`
          : 'No ledger entries found — relying on state progress field only.',
      },
    ];

    const canReboot = questions.every(q => q.answer.trim().length > 0 && !q.answer.startsWith('(no'));

    return {
      questions,
      can_reboot: canReboot,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Compute the stages that come after the current stage.
   */
  private getRemainingStages(currentStage: string): string[] {
    const stages = ['open', 'design', 'build', 'verify', 'archive'];
    const idx = stages.indexOf(currentStage);
    if (idx < 0 || idx >= stages.length - 1) return [];
    return stages.slice(idx + 1);
  }

  // ── Run Ledger (append-only JSONL) ──

  /**
   * Get the path to the run-ledger JSONL file.
   */
  getLedgerPath(): string {
    return path.join(this.azaDir, 'run-ledger.jsonl');
  }

  /**
   * Append a `ledger-append` entry to the run ledger.
   *
   * The ledger is append-only — entries are never modified or deleted.
   *
   * @param message   The human-readable message.
   * @param metadata  Optional structured metadata.
   * @param stage     Optional stage context.
   * @param iteration Optional iteration number.
   * @returns The appended entry.
   */
  async appendLedger(
    message: string,
    metadata?: Record<string, unknown>,
    stage?: string,
    iteration?: number,
  ): Promise<LedgerEntry> {
    const entry: LedgerEntry = {
      type: 'ledger-append',
      timestamp: new Date().toISOString(),
      stage,
      iteration,
      message,
      metadata,
    };
    await this.writeLedgerEntry(entry);
    return entry;
  }

  /**
   * Append a `phase-status` entry to the run ledger.
   *
   * Records a phase/stage status transition for audit and recovery.
   *
   * @param stage      The stage that changed.
   * @param status     The new status.
   * @param iteration  Optional iteration number.
   * @returns The appended entry.
   */
  async recordPhaseStatus(
    stage: string,
    status: string,
    iteration?: number,
  ): Promise<LedgerEntry> {
    const entry: LedgerEntry = {
      type: 'phase-status',
      timestamp: new Date().toISOString(),
      stage,
      iteration,
      message: `Stage "${stage}" → ${status}`,
      metadata: { status },
    };
    await this.writeLedgerEntry(entry);
    return entry;
  }

  /**
   * Generate a summary of the run ledger.
   *
   * Reads all entries from the append-only JSONL ledger and produces a
   * {@link LedgerSummary} with counts and timestamps. A `ledger-summary`
   * marker entry is also appended to the ledger so summaries are auditable.
   *
   * @param appendSummary  Whether to append a `ledger-summary` marker entry.
   *                       Defaults to `true`.
   * @returns The ledger summary.
   */
  async generateRunLedger(appendSummary: boolean = true): Promise<LedgerSummary> {
    const entries = await this.readLedger();

    const summary: LedgerSummary = {
      total_entries: entries.length,
      phase_statuses: entries.filter(e => e.type === 'phase-status').length,
      appends: entries.filter(e => e.type === 'ledger-append').length,
      summaries: entries.filter(e => e.type === 'ledger-summary').length,
      first_entry: entries[0]?.timestamp,
      last_entry: entries.length > 0 ? entries[entries.length - 1]?.timestamp : undefined,
      entries,
    };

    if (appendSummary) {
      const marker: LedgerEntry = {
        type: 'ledger-summary',
        timestamp: new Date().toISOString(),
        message: `Ledger summary: ${summary.total_entries} entries (${summary.phase_statuses} phase-status, ${summary.appends} appends).`,
        metadata: {
          total_entries: summary.total_entries,
          phase_statuses: summary.phase_statuses,
          appends: summary.appends,
        },
      };
      await this.writeLedgerEntry(marker);
    }

    return summary;
  }

  /**
   * Read all entries from the run-ledger JSONL file.
   *
   * Returns an empty array if the ledger does not exist yet.
   */
  async readLedger(): Promise<LedgerEntry[]> {
    try {
      const raw = await fs.readFile(this.getLedgerPath(), 'utf8');
      const entries: LedgerEntry[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as LedgerEntry;
          if (parsed && typeof parsed.type === 'string' && typeof parsed.message === 'string') {
            entries.push(parsed);
          }
        } catch {
          // Skip malformed line.
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Append a single entry to the run-ledger JSONL file.
   */
  private async writeLedgerEntry(entry: LedgerEntry): Promise<void> {
    await fs.mkdir(this.azaDir, { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.getLedgerPath(), line, 'utf8');
  }
}
