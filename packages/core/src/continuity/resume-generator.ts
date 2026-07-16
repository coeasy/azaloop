import * as fs from 'fs/promises';
import * as path from 'path';
import { StateManager } from '../state/state-manager';
import type { EpisodicMemory } from '../L2_memory/project-memory';
// R10 第7轮 (D7)：版本兼容性校验依赖迁移注册表
import { hasMigrationPath, getLatestSchemaVersion, getMigrationPath } from '../state/migrations/registry';

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
  /** R2: 任务 ID，跨任务恢复校验用 */
  task_id?: string;
  /** R2: 用户输入哈希（前 16 位），防止 RESUME 错配到不同任务 */
  user_input_hash?: string;
  /** R10: 引擎代际标记，跨客户端/跨版本恢复时用于识别不兼容状态 */
  engine_version?: string;
}

/** 引擎代际标记（与 package.json 解耦，专用于跨客户端恢复校验）。 */
export const AZALOOP_ENGINE_VERSION = '0.1.0';

/**
 * R10 第7轮 (D7)：版本兼容性校验结果。
 *
 * `validateVersion()` 返回此结构，让调用方知道：
 * - 是否兼容当前引擎版本
 * - 应该 `continue` / `migrate` / `reset`
 * - 是否存在完整的 schema 迁移路径（供 state-manager 兜底参考）
 */
export interface VersionCompatibility {
  /** 是否与当前引擎版本兼容 */
  compatible: boolean;
  /** 人类可读的兼容性原因（用于日志/审计） */
  reason: string;
  /** 建议的后续动作 */
  action: 'continue' | 'migrate' | 'reset';
  /** RESUME.md 中记录的引擎版本 */
  resumeVersion: string;
  /** 当前引擎版本 */
  engineVersion: string;
  /** 可选：从 schema v1 到最新版本的迁移步骤清单 */
  schemaMigrationPath?: readonly { from: number; to: number; description: string }[];
  /** 可选：迁移路径是否完整（false 表示迁移链有断裂，调用方需 reset） */
  schemaMigrationPathAvailable?: boolean;
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
    // STATE.yaml is the single source of truth — never let stale RESUME fields win.
    const stage = this.resolveAuthoritativeStage(state);
    const blocked = this.isBlocked(state);
    const hardStopped =
      state.loop.iteration >= (state.loop.max_iterations || 50) || blocked;
    const progress = hardStopped && state.loop.progress === '100%'
      ? this.safeProgress(state)
      : state.loop.progress;

    const stageActions: Record<string, { tool: string; action: string }> = {
      open: { tool: 'aza_prd', action: 'review' },
      design: { tool: 'aza_spec', action: 'design' },
      build: { tool: 'aza_spec', action: 'implement' },
      verify: { tool: 'aza_quality', action: 'check' },
      archive: { tool: 'aza_finish', action: 'ship' },
    };

    let nextTool = 'aza_loop';
    let nextAction = 'full';
    if (blocked) {
      nextTool = 'aza_loop';
      nextAction = 'reset';
    } else if (hardStopped && !state.pipeline.stages.archive?.status?.includes('completed')) {
      nextTool = 'aza_loop';
      nextAction = 'stop';
    } else if (state.loop.current_story) {
      nextTool = 'aza_loop';
      nextAction = 'full';
    } else {
      const entry = stageActions[stage] || { tool: 'aza_loop', action: 'full' };
      nextTool = entry.tool;
      nextAction = entry.action;
    }

    // Only allow safe overlays from extra (client/model/errors/explicit next).
    const safeExtra: Partial<ResumeData> = {};
    if (extra?.client && extra.client !== 'unknown') safeExtra.client = extra.client;
    if (extra?.model && extra.model !== 'unknown') safeExtra.model = extra.model;
    if (extra?.errors_to_avoid?.length) safeExtra.errors_to_avoid = extra.errors_to_avoid;
    if (extra?.last_milestone) safeExtra.last_milestone = extra.last_milestone;
    if (extra?.next_tool && extra?.next_action && !blocked) {
      // Prefer caller-provided next only when not blocked and action is not a legacy continue_* token
      if (!String(extra.next_action).startsWith('continue_')) {
        safeExtra.next_tool = extra.next_tool;
        safeExtra.next_action = extra.next_action;
      }
    }

    const resume: ResumeData = {
      current_stage: stage,
      current_story: state.loop.current_story,
      iteration: state.loop.iteration,
      progress,
      client: state.loop.client,
      model: state.loop.model,
      next_action: nextAction,
      next_tool: nextTool,
      errors_to_avoid: blocked
        ? [`Stage "${stage}" is blocked — call aza_loop(reset) then aza_loop(full)`]
        : [],
      last_milestone: state.updated_at,
      // R2: 透传 task_id + user_input_hash（若有）以便跨任务校验
      task_id: extra?.task_id ?? safeExtra.task_id,
      user_input_hash: extra?.user_input_hash ?? safeExtra.user_input_hash,
      // R10: 透传 engine_version，跨客户端恢复时识别引擎代际
      engine_version: extra?.engine_version ?? AZALOOP_ENGINE_VERSION,
      ...safeExtra,
    };

    await this.write(resume);
    return resume;
  }

  /** Prefer blocked → in_progress → phase.current → pipeline.current_stage. */
  private resolveAuthoritativeStage(state: ReturnType<StateManager['getState']>): string {
    const stages = state.pipeline?.stages || {};
    const order = ['open', 'design', 'build', 'verify', 'archive'] as const;
    for (const s of order) {
      if (stages[s]?.status === 'blocked') return s;
    }
    for (const s of order) {
      if (stages[s]?.status === 'in_progress') return s;
    }
    const phase = (state as any).loops?.phase?.current;
    if (phase && typeof phase === 'string') return phase;
    return state.pipeline.current_stage || 'open';
  }

  private isBlocked(state: ReturnType<StateManager['getState']>): boolean {
    const stages = state.pipeline?.stages || {};
    return Object.values(stages).some((s: any) => s?.status === 'blocked');
  }

  private safeProgress(state: ReturnType<StateManager['getState']>): string {
    const stages = state.pipeline?.stages || {};
    const order = ['open', 'design', 'build', 'verify', 'archive'] as const;
    const completed = order.filter((s) => stages[s]?.status === 'completed').length;
    const pct = Math.min(99, Math.round((completed / order.length) * 100));
    return `${pct}%`;
  }

  async read(): Promise<ResumeData | null> {
    try {
      const content = await fs.readFile(this.getPath(), 'utf8');
      return this.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * R10 第7轮 (D7)：版本兼容性校验。
   *
   * 原先 `validateAndResume()` 把版本检查内嵌为简单的 major 版本对比，
   * 缺少对次要版本/补丁版本的处理逻辑，也无法回答「能否自动迁移」。
   *
   * 本方法集中决策：
   * - 主版本不同 → 不兼容，必须 `reset` 重新开始
   * - 主版本相同 + 次要/补丁版本不同 → 兼容，可 `migrate` 自动迁移
   * - 完全相同 → 兼容，`continue` 直接续跑
   *
   * 注意：engine_version 与 schema_version 是两个独立维度：
   *   - engine_version: 跨客户端/跨会话引擎代际标记（写在 RESUME.md）
   *   - schema_version: STATE.yaml 结构版本（由 state-manager.migrations 处理）
   * 本方法仅校验 engine_version 兼容性；STATE.yaml 的 schema_version 迁移
   * 由 StateManager.loadWithMigration() 在 load() 时独立处理，
   * 但本方法会返回 schema 迁移路径信息供调用方参考。
   *
   * @returns 兼容性结果，调用方根据 `action` 决定后续行为
   */
  validateVersion(resume: ResumeData): VersionCompatibility {
    const resumeVer = resume.engine_version ?? '0.0.0';
    const engineVer = AZALOOP_ENGINE_VERSION;

    const [resumeMajor, resumeMinor = '0', resumePatch = '0'] = resumeVer.split('.');
    const [engineMajor, engineMinor = '0', enginePatch = '0'] = engineVer.split('.');

    // 缺少版本信息 → 视为不兼容，避免误恢复老版本状态
    if (!resume.engine_version) {
      return {
        compatible: false,
        reason: `resume.engine_version missing (resume=${resumeVer}, current=${engineVer})`,
        action: 'reset',
        resumeVersion: resumeVer,
        engineVersion: engineVer,
      };
    }

    // 主版本不同 → 不兼容，无法安全迁移
    if (resumeMajor !== engineMajor) {
      return {
        compatible: false,
        reason: `major version mismatch: resume=${resumeMajor}.x vs current=${engineMajor}.x`,
        action: 'reset',
        resumeVersion: resumeVer,
        engineVersion: engineVer,
      };
    }

    // 主版本相同 → 兼容，可恢复。
    // 同时附带 schema 迁移路径信息：调用方据此判断是否需要触发
    // state-manager.loadWithMigration()（resume 文件本身不带 schema_version，
    // 但调用方在恢复 STATE.yaml 时应始终调用 loadWithMigration 兜底）。
    const schemaMigrationPath = getMigrationPath(1, getLatestSchemaVersion());
    const schemaMigrationPathAvailable = hasMigrationPath(1, getLatestSchemaVersion());

    if (resumeMinor !== engineMinor || resumePatch !== enginePatch) {
      return {
        compatible: true,
        reason: `minor/patch version mismatch but compatible: resume=${resumeVer} vs current=${engineVer}`,
        action: 'migrate',
        resumeVersion: resumeVer,
        engineVersion: engineVer,
        schemaMigrationPath,
        schemaMigrationPathAvailable,
      };
    }

    return {
      compatible: true,
      reason: `version match: ${engineVer}`,
      action: 'continue',
      resumeVersion: resumeVer,
      engineVersion: engineVer,
      schemaMigrationPath,
      schemaMigrationPathAvailable,
    };
  }

  /**
   * Validate a resume and decide whether the loop can auto-continue.
   *
   * R10 第1轮：跨客户端自动续航触发器
   *
   * Checks:
   * 1. RESUME.md exists and parses
   * 2. engine_version is compatible (same major)
   * 3. stage is not terminal (open with 0 iterations, or archive completed)
   * 4. Detects client switch by comparing resume.client with `currentClient`
   *
   * Returns a structured decision so the caller (MCP boot / CLI / engine) can
   * auto-invoke `aza_session(continue)` + `aza_loop(full)` without manual input.
   */
  async validateAndResume(currentClient?: string): Promise<{
    can_resume: boolean;
    reason: string;
    resume: ResumeData | null;
    client_switched: boolean;
    action: 'resume' | 'restart' | 'noop';
  }> {
    const resume = await this.read();
    if (!resume) {
      return { can_resume: false, reason: 'No RESUME.md found', resume: null, client_switched: false, action: 'noop' };
    }

    // R10 第7轮 (D7)：抽取版本校验到 validateVersion()，便于复用与测试
    const versionCheck = this.validateVersion(resume);
    if (!versionCheck.compatible) {
      // 不可恢复（主版本不匹配且无迁移路径）→ 调用方需 reset 重新开始
      return {
        can_resume: false,
        reason: `Engine version incompatible: ${versionCheck.reason}`,
        resume,
        client_switched: false,
        action: versionCheck.action === 'reset' ? 'restart' : 'noop',
      };
    }

    // Terminal state: archive completed
    const isTerminal = resume.current_stage === 'archive' &&
      (resume.next_action === 'done' || resume.next_action === 'ship' || resume.progress === '100%');
    // Fresh start: open stage with zero iterations
    const isFresh = resume.current_stage === 'open' && resume.iteration === 0;

    if (isTerminal) {
      return { can_resume: false, reason: 'Loop already completed (archive done)', resume, client_switched: false, action: 'noop' };
    }
    if (isFresh) {
      return { can_resume: false, reason: 'Fresh start (open, iteration 0)', resume, client_switched: false, action: 'noop' };
    }

    // Client switch detection
    const clientSwitched = !!currentClient &&
      currentClient !== 'unknown' &&
      resume.client !== 'unknown' &&
      resume.client !== currentClient;

    return {
      can_resume: true,
      reason: clientSwitched
        ? `Resuming from ${resume.current_stage} (switched ${resume.client}→${currentClient})`
        : `Resuming from ${resume.current_stage} (iteration ${resume.iteration})`,
      resume,
      client_switched: clientSwitched,
      action: 'resume',
    };
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
    // P2-2: standardized YAML frontmatter + markdown body (planning-with-files aligned)
    const frontmatter = [
      '---',
      'schema_version: "1.0"',
      `stage: ${JSON.stringify(resume.current_stage)}`,
      resume.current_story ? `story: ${JSON.stringify(resume.current_story)}` : null,
      `iteration: ${resume.iteration}`,
      `progress: ${JSON.stringify(resume.progress)}`,
      `client: ${JSON.stringify(resume.client)}`,
      `model: ${JSON.stringify(resume.model)}`,
      `engine_version: ${JSON.stringify(resume.engine_version ?? AZALOOP_ENGINE_VERSION)}`,
      `next_tool: ${JSON.stringify(resume.next_tool)}`,
      `next_action: ${JSON.stringify(resume.next_action)}`,
      `updated_at: ${JSON.stringify(new Date().toISOString())}`,
      '---',
      '',
    ].filter((l) => l !== null).join('\n');

    return [
      frontmatter,
      '# AzaLoop Resume',
      '',
      '> Auto-generated resume file for cross-session continuity (schema_version 1.0)',
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
      '1. Call `aza_session(action=continue)` or `aza_session(action=calibrate)`',
      '2. Call `aza_loop(action=full)` to resume (follow awaitingAction + report_tool)',
      '3. Follow the `next_action` chain automatically — never ask the user to click Continue',
      '',
    ].filter(Boolean).join('\n');
  }

  private parse(content: string): ResumeData {
    // Prefer YAML frontmatter (schema_version 1.0+) when present
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm && fm[1]) {
      const data: Record<string, string> = {};
      for (const line of fm[1].split(/\r?\n/)) {
        const m = line.match(/^(\w+):\s*(.*)$/);
        if (m && m[1] && m[2] !== undefined) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          data[m[1]] = v;
        }
      }
      if (data.stage || data.next_tool) {
        return {
          current_stage: data.stage || 'open',
          current_story: data.story,
          iteration: parseInt(data.iteration || '0', 10),
          progress: data.progress || '0%',
          client: data.client || 'unknown',
          model: data.model || 'unknown',
          next_action: data.next_action || 'full',
          next_tool: data.next_tool || 'aza_loop',
          errors_to_avoid: [],
          last_milestone: data.updated_at || new Date().toISOString(),
          engine_version: data.engine_version,
        };
      }
    }

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
      next_action: data['action'] || 'full',
      next_tool: data['tool'] || 'aza_loop',
      errors_to_avoid: [],
      last_milestone: new Date().toISOString(),
      engine_version: data['engine_version'],
    };
  }

  private getNextTool(stage: string): string {
    const tools: Record<string, string> = {
      open: 'aza_prd',
      design: 'aza_spec',
      build: 'aza_spec',
      verify: 'aza_quality',
      archive: 'aza_finish',
    };
    return tools[stage] || 'aza_loop';
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
