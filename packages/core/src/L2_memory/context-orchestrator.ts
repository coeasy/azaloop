import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { Stage } from '../L7_loop/state-machine';
import type { TokenBudget } from '../L7_loop/token-budget';
// R10 第9轮 (D14)：向量检索历史 episodic memory
import type { ProjectMemory, EpisodicMemory } from './project-memory';

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
  /**
   * R10 第4轮 (D4)：`.aza` 基目录，用于读取真实产物（prd.json/contract.md 等）。
   * 注入真实内容而非静态占位符，避免"注入的不是真实内容"。
   */
  private baseDir: string;
  /** V20 Task 4: Optional token budget used to adapt pruning strategy. */
  private tokenBudget?: TokenBudget;
  /**
   * R10 第9轮 (D14)：可选的 ProjectMemory 引用——用于向量检索历史 episodic memory。
   *
   * 借鉴 ruflo AgentDB：buildEntriesForStage 在生成 memory 条目时，
   * 用当前 stage + story 作为 query 向量检索 top-K 相关历史记忆，
   * 替代原先的静态占位符 "Recall relevant past implementation experience."。
   */
  private projectMemory?: ProjectMemory;

  /**
   * @param baseDir  The `.aza` base directory.
   *                 JSONL files are stored under `{baseDir}/context/`.
   * @param tokenBudget  Optional token budget for adaptive pruning.
   * @param projectMemory  Optional ProjectMemory for vector retrieval (R10 第9轮).
   */
  constructor(baseDir: string, tokenBudget?: TokenBudget, projectMemory?: ProjectMemory) {
    this.baseDir = baseDir;
    this.contextDir = path.join(baseDir, 'context');
    this.tokenBudget = tokenBudget;
    this.projectMemory = projectMemory;
  }

  /**
   * R10 第9轮 (D14)：延迟注入 ProjectMemory。
   *
   * 某些场景下 ProjectMemory 在 ContextOrchestrator 构造之后才初始化
   * （例如 LoopController 先创建 ContextOrchestrator，再创建 ProjectMemory）。
   * 本 setter 让这种场景下也能接入向量检索。
   */
  setProjectMemory(pm: ProjectMemory): void {
    this.projectMemory = pm;
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
    // R10 第4轮 (D4)：buildEntriesForStage 现在是 async（读取真实产物文件）
    const entries = await this.buildEntriesForStage(stage, story);
    // V20 Task 8: 指针化注入 — 大体积条目改为路径+摘要
    const pointerizedEntries = entries.map(entry => {
      if (entry.tokenEstimate > 2000 && entry.metadata?.filePath) {
        const summary = entry.content.length > 120
          ? entry.content.slice(0, 120) + '…'
          : entry.content;
        return {
          ...entry,
          content: `[file: ${entry.metadata.filePath}] ${summary}`,
          tokenEstimate: Math.min(entry.tokenEstimate, 50),
        };
      }
      return entry;
    });
    let totalTokens = pointerizedEntries.reduce((s, e) => s + e.tokenEstimate, 0);
    // R10 第4轮 (D6)：totalTokens > 4000 时压缩大条目为 SHA256 引用，
    // 原始内容写入 .sha 文件，跨会话/跨客户端转移时节省 25-30% token。
    let finalEntries = pointerizedEntries;
    if (totalTokens > 4000) {
      const bundle: ContextEntryBundle = {
        stage,
        entries: pointerizedEntries,
        totalTokens,
        source: this.getContextPath(stage),
      };
      const compressed = await this.compressBundle(bundle);
      finalEntries = compressed.entries;
      totalTokens = compressed.totalTokens;
    }
    const filePath = this.getContextPath(stage);
    const lines = finalEntries.map(e => JSON.stringify(e));
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
    return filePath;
  }

  /**
   * Build the context entries for a given stage.
   *
   * R10 第4轮 (D4)：重写为 async，读取真实产物文件而非静态占位符。
   * - open:    读取 prd.json 注入为 plan 条目
   * - design:  读取 contract.md 注入为 constraint 条目
   * - build:   读取 openspec/changes/{folder}/spec.md 注入为 reference 条目
   * - verify:  读取 quality-report.json 注入为 finding 条目
   * 所有读取添加 try/catch，文件不存在则回退到占位符。
   *
   * Exposed as a protected method so subclasses or tests can override the
   * entry generation logic.
   */
  protected async buildEntriesForStage(
    stage: Stage,
    story?: OrchestratorStory,
  ): Promise<ContextEntry[]> {
    const entries: ContextEntry[] = [];

    // Plan / spec content — read real PRD if available (all stages)
    const prdContent = await this.readArtifact('prd.json');
    if (prdContent) {
      entries.push(this.makeEntry('plan', prdContent, 1.0, { source: 'prd.json' }));
    } else {
      entries.push(this.makeEntry('plan', `Plan context for stage: ${stage}`, 1.0));
    }

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

    // Stage-specific instructions and context — read real artifacts.
    switch (stage) {
      case 'open':
        entries.push(
          this.makeEntry('instruction', 'Gather requirements and define the scope of the loop.', 0.7),
        );
        break;

      case 'design': {
        // R10 第4轮 (D4)：注入真实 contract.md 内容
        const contractContent = await this.readArtifact('contract.md');
        if (contractContent) {
          entries.push(
            this.makeEntry('constraint', contractContent, 0.8, { source: 'contract.md' }),
          );
        } else {
          entries.push(
            this.makeEntry('constraint', 'Design must satisfy all PRD requirements and constraints.', 0.8),
          );
        }
        entries.push(
          this.makeEntry('instruction', 'Produce design decisions and a task breakdown.', 0.6),
        );
        break;
      }

      case 'build': {
        // R10 第4轮 (D4)：注入真实 openspec spec.md 内容
        const specContent = await this.readSpecContent();
        if (specContent) {
          entries.push(
            this.makeEntry('reference', specContent, 0.4, { source: 'openspec' }),
          );
        } else {
          entries.push(
            this.makeEntry('reference', 'Reference: coding standards and conventions.', 0.4),
          );
        }
        // R10 第9轮 (D14)：向量检索 top-K 相关历史 episodic memory
        // 借鉴 ruflo AgentDB：跨会话复用历史推理，减少重复 LLM 推理。
        // 用 stage + story 作为 query，召回相关历史经验/教训。
        // 回退路径：projectMemory 缺失或无结果时退化为静态占位符。
        const memoryEntries = await this.retrieveMemoryEntries(stage, story, 5);
        if (memoryEntries.length > 0) {
          for (const me of memoryEntries) {
            entries.push(me);
          }
        } else {
          entries.push(
            this.makeEntry('memory', 'Recall relevant past implementation experience.', 0.6),
          );
        }
        entries.push(
          this.makeEntry('instruction', 'Implement the story following the design and plan.', 0.7),
        );
        break;
      }

      case 'verify': {
        // R10 第4轮 (D4)：注入真实 quality-report.json 内容
        const qualityContent = await this.readArtifact('quality-report.json');
        if (qualityContent) {
          entries.push(
            this.makeEntry('finding', qualityContent, 0.8, { source: 'quality-report.json' }),
          );
        } else {
          entries.push(
            this.makeEntry('finding', 'Review security findings and quality gate results.', 0.8),
          );
        }
        entries.push(
          this.makeEntry('instruction', 'Verify the implementation against acceptance criteria.', 0.7),
          this.makeEntry('constraint', 'All quality gates must pass before advancing.', 0.6),
        );
        break;
      }

      case 'archive':
        entries.push(
          this.makeEntry('instruction', 'Archive results and update the run ledger.', 0.5),
          this.makeEntry('reference', 'Reference: archiving and documentation guidelines.', 0.3),
        );
        break;
    }

    return entries;
  }

  /**
   * R10 第4轮 (D4)：从 `.aza/` 读取产物文件内容。
   * 文件不存在或读取失败时返回 null（调用方回退到占位符）。
   */
  private async readArtifact(fileName: string): Promise<string | null> {
    try {
      const filePath = path.join(this.baseDir, fileName);
      const content = await fs.readFile(filePath, 'utf8');
      // 对 JSON 文件做美化（若解析失败则原样返回）
      if (fileName.endsWith('.json')) {
        try {
          return JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          return content;
        }
      }
      return content;
    } catch {
      return null;
    }
  }

  /**
   * R10 第4轮 (D4)：读取 `.aza/openspec/changes/{folder}/spec.md` 内容。
   * 拼接所有 change folder 下的 spec.md（若存在），最多取前 2 个避免上下文爆炸。
   */
  private async readSpecContent(): Promise<string | null> {
    try {
      const changesDir = path.join(this.baseDir, 'openspec', 'changes');
      const entries = await fs.readdir(changesDir, { withFileTypes: true });
      const folders = entries.filter(e => e.isDirectory()).map(e => e.name).slice(0, 2);
      if (folders.length === 0) return null;
      const parts: string[] = [];
      for (const folder of folders) {
        try {
          const specPath = path.join(changesDir, folder, 'spec.md');
          const content = await fs.readFile(specPath, 'utf8');
          parts.push(`## ${folder}\n\n${content}`);
        } catch { /* skip missing spec.md */ }
      }
      return parts.length > 0 ? parts.join('\n\n') : null;
    } catch {
      return null;
    }
  }

  /**
   * R10 第9轮 (D14)：从 ProjectMemory 向量检索 top-K 相关历史 episodic memory。
   *
   * 借鉴 ruflo AgentDB + Trellis inject-subagent-context：
   * - 用当前 stage + story 作为 query，召回历史经验/教训
   * - 将每条 episodic memory 包装为 ContextEntry（type='memory'）
   * - priority 按相似度排序后递减分配（0.7 → 0.4）
   *
   * 失败/无结果时返回空数组，调用方回退到静态占位符。
   *
   * @param stage   当前阶段
   * @param story   当前 story（可选）
   * @param k       返回条数上限
   */
  private async retrieveMemoryEntries(
    stage: Stage,
    story: { id: string; title: string } | undefined,
    k: number = 5,
  ): Promise<ContextEntry[]> {
    if (!this.projectMemory) return [];
    try {
      const queryParts: string[] = [stage];
      if (story) {
        queryParts.push(story.id, story.title);
      }
      const query = queryParts.join(' ');
      const memories = await this.projectMemory.searchVector(query, k);
      if (memories.length === 0) return [];
      // priority 从 0.7 递减到 0.4，保证前面的记忆优先保留
      const entries: ContextEntry[] = [];
      const maxPriority = 0.7;
      const minPriority = 0.4;
      const step = memories.length > 1 ? (maxPriority - minPriority) / (memories.length - 1) : 0;
      memories.forEach((m: EpisodicMemory, i: number) => {
        const priority = memories.length === 1 ? maxPriority : maxPriority - step * i;
        const content = [
          `## ${m.type}: ${m.summary}`,
          ``,
          `**ID:** ${m.id}`,
          m.story_id ? `**Story:** ${m.story_id}` : '',
          `**Date:** ${m.created_at}`,
          `**Tags:** ${m.tags.join(', ')}`,
          ``,
          m.details,
        ].filter(Boolean).join('\n');
        entries.push(
          this.makeEntry('memory', content, priority, {
            source: 'project-memory-vector',
            episode_id: m.id,
            episode_type: m.type,
            story_id: m.story_id,
          }),
        );
      });
      return entries;
    } catch {
      return [];
    }
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
    const bundle: ContextEntryBundle = {
      stage,
      entries,
      totalTokens,
      source: filePath,
    };
    // R10 第4轮 (D6)：若 JSONL 中存在 [SHA256:xxx] 引用，自动还原为原始内容，
    // 让 handler 拿到真实内容而非哈希引用。
    const hasHashRef = entries.some(e => /^\[SHA256:[a-f0-9]{16}\]$/.test(e.content));
    if (hasHashRef) {
      return await this.decompressBundle(bundle);
    }
    return bundle;
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
        let kept = context.entries.filter(e => e.priority >= 0.5);

        // V20 Task 8: 指针化大体积条目
        kept = kept.map(entry => {
          if (entry.tokenEstimate > 1000 && entry.metadata?.filePath) {
            const summary = entry.content.length > 120
              ? entry.content.slice(0, 120) + '…'
              : entry.content;
            return {
              ...entry,
              content: `[file: ${entry.metadata.filePath}] ${summary}`,
              tokenEstimate: Math.min(entry.tokenEstimate, 50),
            };
          }
          return entry;
        });

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
   *
   * R10 第4轮 (D6)：原先 compressBundle 只在内存中构建 hashMap，但从不写盘——
   * 导致 decompressBundle 读不到 `.sha` 文件，压缩能力完全闲置。
   * 现在改为 async，把原始内容写入 `<contextDir>/<hash>.sha`，
   * 并在 generateContextFiles/injectContext 中接入。
   */
  async compressBundle(
    bundle: ContextEntryBundle,
    sizeThreshold: number = 2000,
  ): Promise<ContextEntryBundle> {
    const compressedEntries: ContextEntry[] = [];
    await fs.mkdir(this.contextDir, { recursive: true });

    for (const entry of bundle.entries) {
      if (entry.content.length <= sizeThreshold) {
        // Small entry — keep as-is
        compressedEntries.push(entry);
      } else {
        // Large entry — replace with SHA256 reference
        const hash = createHash('sha256').update(entry.content).digest('hex').slice(0, 16);
        // R10 第4轮 (D6)：把原始内容写入 .sha 文件，供 decompressBundle 还原
        try {
          const hashPath = path.join(this.contextDir, `${hash}.sha`);
          await fs.writeFile(hashPath, entry.content, 'utf8');
        } catch { /* best-effort: 压缩失败则保留原文 */ }
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
