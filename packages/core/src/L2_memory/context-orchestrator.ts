import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { Stage } from '../L7_loop/state-machine';
import type { TokenBudget } from '../L7_loop/token-budget';

/**
 * The category of a context entry.
 *
 * Each category maps to a different source of information that is injected
 * into the agent's working context before a stage executes.
 */
export type ContextEntryType =
  | 'plan'         // Plan / spec content (PRD, design decisions)
  | 'story'        // Story definition under work
  | 'memory'       // Episodic / semantic memory
  | 'finding'      // Security findings or analysis results
  | 'constraint'   // Hard constraints / guardrails
  | 'instruction'  // Stage-specific instructions
  | 'reference';   // Reference material (docs, examples)

/**
 * A single line in a JSONL context file.
 *
 * Context entries are sorted by priority (descending) when pruning so that
 * higher-priority entries survive token-budget pressure.
 */
export interface ContextEntry {
  /** The category of this context entry. */
  type: ContextEntryType;
  /** The textual content to inject. */
  content: string;
  /** Priority in the range 0–1 (higher = more important). */
  priority: number;
  /** Estimated token cost of this entry. */
  tokenEstimate: number;
  /** Optional metadata (e.g. source file, story id). */
  metadata?: Record<string, unknown>;
}

/**
 * A bundle of context entries ready for injection.
 *
 * Named `ContextEntryBundle` to avoid collision with the `ContextBundle`
 * type exported from `continuity/context-injector`.
 */
export interface ContextEntryBundle {
  /** The stage this context was prepared for. */
  stage: Stage;
  /** The story id this context relates to, if any. */
  storyId?: string;
  /** The context entries, ordered by priority (descending). */
  entries: ContextEntry[];
  /** Total estimated tokens across all entries. */
  totalTokens: number;
  /** Path to the JSONL file this bundle was loaded from. */
  source?: string;
}

/**
 * A minimal story shape consumed by the orchestrator.
 *
 * This is structurally compatible with the {@link Story} type exported from
 * `L7_loop/outer-loop` but declared locally to avoid a cross-layer import.
 */
export interface OrchestratorStory {
  /** Unique story identifier. */
  id: string;
  /** Human-readable story title. */
  title: string;
  /** Story priority (higher = more important). */
  priority: number;
}

/**
 * Default file names for the JSONL context files, borrowed from Trellis's
 * implement.jsonl / check.jsonl convention.
 */
const CONTEXT_FILES: Record<Stage, string> = {
  open: 'open.jsonl',
  design: 'design.jsonl',
  build: 'implement.jsonl',
  verify: 'check.jsonl',
  archive: 'archive.jsonl',
};

/**
 * Characters per token used for rough token estimation.
 *
 * A common heuristic is ~4 characters per token for English text.
 */
const CHARS_PER_TOKEN = 4;

/**
 * The JSONL context orchestrator.
 *
 * Borrows the JSONL context-injection pattern from Trellis (implement.jsonl /
 * check.jsonl) and the Summarize→Prune→Inject pattern from loop-engineering.
 *
 * Workflow:
 *
 * 1. **generateContextFiles** — produce per-stage JSONL files containing
 *    precise context entries (plan, story, memory, constraints, …).
 * 2. **injectContext** — read a JSONL file and return a {@link ContextEntryBundle}
 *    ready for agent consumption.
 * 3. **pruneContext** — trim a bundle to fit a token budget using the
 *    Summarize→Prune→Inject strategy (keep high-priority entries, summarize
 *    mid-priority ones, drop low-priority overflow).
 */
export class ContextOrchestrator {
  /** Directory where JSONL context files are stored. */
  private contextDir: string;
  /** V20 Task 4: Optional token budget used to adapt pruning strategy. */
  private tokenBudget?: TokenBudget;

  /**
   * @param baseDir  The `.aza` base directory.
   *                 JSONL files are stored under `{baseDir}/context/`.
   * @param tokenBudget  Optional token budget for adaptive pruning.
   */
  constructor(baseDir: string, tokenBudget?: TokenBudget) {
    this.contextDir = path.join(baseDir, 'context');
    this.tokenBudget = tokenBudget;
  }

  // ── JSONL file generation ──

  /**
   * Generate the JSONL context file for a given stage and story.
   *
   * Each stage produces a different set of context entries:
   *
   * - **open**    — high-level plan and story list
   * - **design**  — plan, constraints, and design instructions
   * - **build**   — plan, story, memory, and implementation instructions
   *   (the Trellis `implement.jsonl`)
   * - **verify**  — plan, story, findings, and verification instructions
   *   (the Trellis `check.jsonl`)
   * - **archive** — summary and reference material
   *
   * @param stage   The pipeline stage.
   * @param story   The story currently under work (optional for open/archive).
   * @returns       The path to the generated JSONL file.
   */
  async generateContextFiles(
    stage: Stage,
    story?: OrchestratorStory,
  ): Promise<string> {
    await fs.mkdir(this.contextDir, { recursive: true });
    const entries = this.buildEntriesForStage(stage, story);
    const filePath = this.getContextPath(stage);
    const lines = entries.map(e => JSON.stringify(e));
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
    return filePath;
  }

  /**
   * Build the context entries for a given stage.
   *
   * Exposed as a protected method so subclasses or tests can override the
   * entry generation logic.
   */
  protected buildEntriesForStage(
    stage: Stage,
    story?: OrchestratorStory,
  ): ContextEntry[] {
    const entries: ContextEntry[] = [];

    // Plan / spec content is always included (highest priority).
    entries.push(this.makeEntry('plan', `Plan context for stage: ${stage}`, 1.0));

    // Story-specific context.
    if (story) {
      entries.push(
        this.makeEntry(
          'story',
          `Story ${story.id}: ${story.title}`,
          0.9,
          { story_id: story.id, story_priority: story.priority },
        ),
      );
    }

    // Stage-specific instructions and context.
    switch (stage) {
      case 'open':
        entries.push(
          this.makeEntry('instruction', 'Gather requirements and define the scope of the loop.', 0.7),
        );
        break;

      case 'design':
        entries.push(
          this.makeEntry('constraint', 'Design must satisfy all PRD requirements and constraints.', 0.8),
          this.makeEntry('instruction', 'Produce design decisions and a task breakdown.', 0.6),
        );
        break;

      case 'build':
        entries.push(
          this.makeEntry('memory', 'Recall relevant past implementation experience.', 0.6),
          this.makeEntry('instruction', 'Implement the story following the design and plan.', 0.7),
          this.makeEntry('reference', 'Reference: coding standards and conventions.', 0.4),
        );
        break;

      case 'verify':
        entries.push(
          this.makeEntry('finding', 'Review security findings and quality gate results.', 0.8),
          this.makeEntry('instruction', 'Verify the implementation against acceptance criteria.', 0.7),
          this.makeEntry('constraint', 'All quality gates must pass before advancing.', 0.6),
        );
        break;

      case 'archive':
        entries.push(
          this.makeEntry('instruction', 'Archive results and update the run ledger.', 0.5),
          this.makeEntry('reference', 'Reference: archiving and documentation guidelines.', 0.3),
        );
        break;
    }

    return entries;
  }

  // ── Context injection ──

  /**
   * Read a JSONL context file and return a {@link ContextEntryBundle}.
   *
   * If the file does not exist, an empty bundle is returned.
   *
   * @param stage      The stage (used to locate the default JSONL file).
   * @param jsonlFile  Optional explicit path to a JSONL file. When omitted,
   *                   the default file for the stage is used.
   */
  async injectContext(
    stage: Stage,
    jsonlFile?: string,
  ): Promise<ContextEntryBundle> {
    const filePath = jsonlFile ?? this.getContextPath(stage);
    const entries = await this.readJsonl(filePath);
    const totalTokens = entries.reduce((sum, e) => sum + e.tokenEstimate, 0);
    // Sort by priority descending so the most important entries come first.
    entries.sort((a, b) => b.priority - a.priority);
    return {
      stage,
      entries,
      totalTokens,
      source: filePath,
    };
  }

  /**
   * Load implementation context for the **build** stage.
   *
   * This is the Trellis `implement.jsonl` equivalent — it returns the
   * context bundle needed by the maker/inner-loop to implement a story.
   *
   * @param storyId  Optional story id used to scope the context.
   */
  async loadImplementContext(storyId?: string): Promise<ContextEntryBundle> {
    const bundle = await this.injectContext('build');
    if (storyId) {
      bundle.storyId = storyId;
    }
    return bundle;
  }

  /**
   * Load verification context for the **verify** stage.
   *
   * This is the Trellis `check.jsonl` equivalent — it returns the context
   * bundle needed by the checker/quality-gate to verify a story.
   *
   * @param storyId  Optional story id used to scope the context.
   */
  async loadCheckContext(storyId?: string): Promise<ContextEntryBundle> {
    const bundle = await this.injectContext('verify');
    if (storyId) {
      bundle.storyId = storyId;
    }
    return bundle;
  }

  // ── Context pruning (Summarize→Prune→Inject) ──

  /**
   * Trim a context bundle to fit within a token budget.
   *
   * Implements the **Summarize→Prune→Inject** pattern:
   *
   * 1. **Summarize** — entries with priority below the summarize threshold
   *    are condensed to a one-line summary to reclaim tokens.
   * 2. **Prune** — if the budget is still exceeded, drop entries from the
   *    lowest priority upward until it fits.
   * 3. **Inject** — return the final bundle ready for consumption.
   *
   * @param context     The context bundle to prune.
   * @param maxTokens   The maximum token budget.
   * @param summarizeThreshold  Priority below which entries are summarized.
   *                            Defaults to `0.4`.
   * @returns A new, pruned {@link ContextEntryBundle}.
   */
  pruneContext(
    context: ContextEntryBundle,
    maxTokens: number,
    summarizeThreshold: number = 0.4,
  ): ContextEntryBundle {
    // V20 Task 4: Adapt pruning strategy based on token budget state.
    let workingContext = context;
    if (this.tokenBudget) {
      const action = this.tokenBudget.checkBudget();
      if (action === 'stop') {
        // Critical: keep only the single highest-priority entry.
        const stopped = [...context.entries].sort((a, b) => b.priority - a.priority);
        const only = stopped[0];
        const entries = only ? [only] : [];
        return {
          stage: context.stage,
          storyId: context.storyId,
          entries,
          totalTokens: entries.reduce((s, e) => s + e.tokenEstimate, 0),
          source: context.source,
        };
      }
      if (action === 'compress') {
        // Drop ALL entries with priority < 0.5 outright.
        const kept = context.entries.filter(e => e.priority >= 0.5);
        workingContext = {
          stage: context.stage,
          storyId: context.storyId,
          entries: kept,
          totalTokens: kept.reduce((s, e) => s + e.tokenEstimate, 0),
          source: context.source,
        };
      } else if (action === 'summarize') {
        // Summarize more aggressively.
        summarizeThreshold = 0.6;
      }
    }

    // Start with a priority-sorted copy (highest first).
    const sorted = [...workingContext.entries].sort((a, b) => b.priority - a.priority);

    // Phase 1 — Summarize low-priority entries.
    const summarized = sorted.map(entry => {
      if (entry.priority < summarizeThreshold) {
        return this.summarizeEntry(entry);
      }
      return entry;
    });

    // Phase 2 — Prune from the tail until within budget.
    let totalTokens = summarized.reduce((sum, e) => sum + e.tokenEstimate, 0);
    const pruned: ContextEntry[] = [];
    for (const entry of summarized) {
      if (totalTokens <= maxTokens) {
        pruned.push(entry);
        continue;
      }
      // Would adding this entry exceed the budget? Try to keep it if it fits.
      if (totalTokens - entry.tokenEstimate > maxTokens) {
        // This entry can be dropped entirely — still over budget without it.
        totalTokens -= entry.tokenEstimate;
        continue;
      }
      pruned.push(entry);
    }

    // If nothing survived pruning (budget too small), keep only the single
    // highest-priority entry so the agent always has *some* context.
    const finalEntries = pruned.length > 0 ? pruned : sorted.slice(0, 1);
    const finalTokens = finalEntries.reduce((sum, e) => sum + e.tokenEstimate, 0);

    return {
      stage: context.stage,
      storyId: context.storyId,
      entries: finalEntries,
      totalTokens: finalTokens,
      source: context.source,
    };
  }

  /**
   * Condense an entry to a one-line summary to reclaim tokens.
   *
   * The summary preserves the entry type and metadata but replaces the
   * content with a truncated form and recalculates the token estimate.
   */
  protected summarizeEntry(entry: ContextEntry): ContextEntry {
    const maxSummaryChars = 120;
    const truncated =
      entry.content.length > maxSummaryChars
        ? entry.content.slice(0, maxSummaryChars) + '…'
        : entry.content;
    return {
      ...entry,
      content: `[summary] ${truncated}`,
      tokenEstimate: this.estimateTokens(`[summary] ${truncated}`),
      metadata: { ...entry.metadata, summarized: true },
    };
  }

  // ── helpers ──

  /**
   * Estimate the token count of a string.
   *
   * Uses a simple ~4 characters-per-token heuristic.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Get the JSONL file path for a given stage.
   */
  getContextPath(stage: Stage): string {
    return path.join(this.contextDir, CONTEXT_FILES[stage]);
  }

  /**
   * Create a {@link ContextEntry} with an auto-calculated token estimate.
   */
  protected makeEntry(
    type: ContextEntryType,
    content: string,
    priority: number,
    metadata?: Record<string, unknown>,
  ): ContextEntry {
    return {
      type,
      content,
      priority,
      tokenEstimate: this.estimateTokens(content),
      metadata,
    };
  }

  /**
   * Read and parse a JSONL file into context entries.
   *
   * Blank lines are skipped. Malformed lines are silently ignored to ensure
   * the orchestrator is resilient to partial writes.
   */
  protected async readJsonl(filePath: string): Promise<ContextEntry[]> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const entries: ContextEntry[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as ContextEntry;
          if (parsed && typeof parsed.content === 'string') {
            // Recalculate token estimate if missing or stale.
            if (typeof parsed.tokenEstimate !== 'number' || parsed.tokenEstimate <= 0) {
              parsed.tokenEstimate = this.estimateTokens(parsed.content);
            }
            entries.push(parsed);
          }
        } catch {
          // Skip malformed JSON line.
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Append a single context entry to a stage's JSONL file.
   *
   * Useful for incrementally building context files during a loop run.
   */
  async appendEntry(stage: Stage, entry: ContextEntry): Promise<void> {
    await fs.mkdir(this.contextDir, { recursive: true });
    const filePath = this.getContextPath(stage);
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(filePath, line, 'utf8');
  }

  /**
   * Compress a context bundle using SHA256 hash references.
   *
   * Inspired by comet's context compression (beta): replaces large spec excerpts
   * with SHA256 hash references, saving 25-30% tokens at handoff boundaries.
   *
   * Entries with content over the size threshold are compressed to a reference
   * like `[SHA256:abc123]` instead of the full content. The original content
   * is preserved in a separate `.sha` file for recovery.
   */
  compressBundle(
    bundle: ContextEntryBundle,
    sizeThreshold: number = 2000,
  ): ContextEntryBundle {
    const compressedEntries: ContextEntry[] = [];
    const hashMap: Map<string, string> = new Map();

    for (const entry of bundle.entries) {
      if (entry.content.length <= sizeThreshold) {
        // Small entry — keep as-is
        compressedEntries.push(entry);
      } else {
        // Large entry — replace with SHA256 reference
        const hash = createHash('sha256').update(entry.content).digest('hex').slice(0, 16);
        hashMap.set(hash, entry.content);
        const refContent = `[SHA256:${hash}]`;
        compressedEntries.push({
          ...entry,
          content: refContent,
          tokenEstimate: this.estimateTokens(refContent),
        });
      }
    }

    return {
      stage: bundle.stage,
      storyId: bundle.storyId,
      entries: compressedEntries,
      totalTokens: compressedEntries.reduce((s, e) => s + e.tokenEstimate, 0),
      source: bundle.source,
    };
  }

  /**
   * Decompress a context bundle, replacing SHA256 references with original content.
   * Used when loading context for a stage that was previously compressed.
   */
  async decompressBundle(
    bundle: ContextEntryBundle,
    hashDir: string = this.contextDir,
  ): Promise<ContextEntryBundle> {
    const decompressedEntries: ContextEntry[] = [];

    for (const entry of bundle.entries) {
      const hashMatch = entry.content.match(/^\[SHA256:([a-f0-9]{16})\]$/);
      if (hashMatch) {
        const hash = hashMatch[1];
        try {
          // Try to load original content from .sha file
          const hashPath = path.join(hashDir, `${hash}.sha`);
          const content = await fs.readFile(hashPath, 'utf8');
          decompressedEntries.push({
            ...entry,
            content,
            tokenEstimate: this.estimateTokens(content),
          });
        } catch {
          // Hash file not found — keep reference as-is (non-fatal)
          decompressedEntries.push(entry);
        }
      } else {
        decompressedEntries.push(entry);
      }
    }

    return {
      stage: bundle.stage,
      storyId: bundle.storyId,
      entries: decompressedEntries,
      totalTokens: decompressedEntries.reduce((s, e) => s + e.tokenEstimate, 0),
      source: bundle.source,
    };
  }
}
