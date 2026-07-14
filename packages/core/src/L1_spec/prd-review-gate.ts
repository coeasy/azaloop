import { PRDGenerator, type PRDGenerationInput, type Complexity } from './prd-generator';
import { PRDChecker, type PRDCheckResult } from './prd-checker';
import type { StateManager } from '../state/state-manager';
import type { ResumeGenerator } from '../continuity/resume-generator';
import type { NextAction } from '@azaloop/shared';
import { BRAINSTORMING_RED_FLAGS, topBrainstormingRedFlags, type RedFlag } from './brainstorming-red-flags';
import type { SkillMeta } from '../L5_skill/registry';

export interface PRDReviewResult {
  prd_id: string;
  title: string;
  summary: string;
  mermaid_diagram: string;
  key_decisions: string[];
  open_questions: string[];
  complexity: Complexity;
  quality_score: number;
  self_optimize_iterations: number;
  needs_user_approval: boolean;
  timeout_ms: number;
  instruction: string;
  /** T25 — Red Flag table shown to the user during HARD-GATE. */
  red_flags?: RedFlag[];
  /** T25 — explicit HARD-GATE flag (true when requires_approval triggers). */
  hard_gate?: boolean;
  /** T25 — input source: 'openspec' (T23) or 'aza-prd' (default). */
  source?: 'openspec' | 'aza-prd';
}

export interface ApprovalResult {
  approved: boolean;
  stage: string;
  message: string;
  next_action: NextAction;
  /**
   * v13 — P3.1: T17+T23+T25 three-way bridge data. Carries the
   * OpenSpec artifact path (when openspec source was used) and
   * the ExecutionContract path so downstream tools (LoopController,
   * InnerLoop) can reference them.
   */
  data?: {
    openspec_path?: string;
    contract_path?: string;
    /** Path to the contract intent_lock field (for hard-bridge validation). */
    intent_lock?: string;
  };
}

/**
 * PRDReviewGate — PRD 先行展示+审批闸门
 *
 * 借鉴 Cursor Plan Mode（先展示计划再执行）+ Qoder Quest（待确认状态）+ Trae（60s 超时自动确认）
 *
 * 流程：
 *   1. review() — 生成 PRD + 自检 + 展示摘要给用户
 *   2. 等待用户响应（approve/modify/cancel/60s超时）
 *   3. approve() — 用户确认 → 进入执行
 *   4. modify() — 用户修改 → 重新生成 → 重新展示
 *   5. autoApproveOnTimeout() — 60s 无输入 → 自动确认
 *   6. cancel() — 用户取消
 */
export class PRDReviewGate {
  private prdGenerator: PRDGenerator;
  private prdChecker: PRDChecker;
  private stateManager: StateManager;
  private resumeGenerator: ResumeGenerator;
  private timeoutMs: number;
  private pendingReview: PRDReviewResult | null = null;

  constructor(options: {
    stateManager: StateManager;
    resumeGenerator: ResumeGenerator;
    prdGenerator?: PRDGenerator;
    prdChecker?: PRDChecker;
    timeoutMs?: number;
  }) {
    this.prdGenerator = options.prdGenerator ?? new PRDGenerator();
    this.prdChecker = options.prdChecker ?? new PRDChecker();
    this.stateManager = options.stateManager;
    this.resumeGenerator = options.resumeGenerator;
    this.timeoutMs = options.timeoutMs ?? 60000;
  }

  /**
   * Phase 0-1~4: 需求分析 → 生成 PRD → 自检 → 展示摘要
   *
   * T25 — When the caller passes a `skillMeta` with `requires_approval: true`,
   * the gate enters HARD-GATE mode: the result includes 3 brainstorming
   * red flags and a `hard_gate: true` marker. The matching `approve()` call
   * MUST include an `answers` map with at least one entry per displayed
   * red flag, otherwise approval fails.
   */
  async review(
    input: PRDGenerationInput & {
      skillMeta?: SkillMeta;
      source?: 'openspec' | 'aza-prd';
    },
  ): Promise<PRDReviewResult> {
    // 1. 生成 PRD（带自优化）
    const prd = this.prdGenerator.generate(input, {
      enable_self_optimization: true,
      max_optimization_rounds: 5,
      auto_stories: true,
      auto_architecture: true,
    });

    // 2. 最终检查
    const checkResult = this.prdChecker.check(prd);

    // 3. 提取展示信息
    const complexity = (prd as any)._complexity || 'L2';
    const mermaid = prd.architecture[0]?.mermaid || 'graph TD\n  A[需求] --> B[PRD] --> C[设计] --> D[实现] --> E[验证] --> F[交付]';

    // T25 — HARD-GATE detection. Any `requires_approval: true` skill
    // forces the gate into the strict red-flag flow.
    const isHardGate = input.skillMeta?.requires_approval === true;
    const displayedFlags = isHardGate ? topBrainstormingRedFlags(3) : undefined;

    const result: PRDReviewResult = {
      prd_id: prd.id,
      title: prd.title,
      summary: this.formatSummary(prd, complexity, checkResult),
      mermaid_diagram: mermaid,
      key_decisions: this.extractKeyDecisions(prd),
      open_questions: this.extractOpenQuestions(prd, checkResult),
      complexity,
      quality_score: checkResult.score,
      self_optimize_iterations: 0,
      needs_user_approval: true,
      timeout_ms: this.timeoutMs,
      instruction: isHardGate
        ? 'HARD-GATE: Answer the 3 red-flag questions before approval. Pass `answers: { "<flag>": "..." }` to approve().'
        : this.formatInstruction(),
      red_flags: displayedFlags,
      hard_gate: isHardGate || undefined,
      source: input.source ?? 'aza-prd',
    };

    // T17 / T38: stash the full PRD on the pending review so that
    // `approve()` can derive an ExecutionContract (and any future
    // open-spec intent) from it. PRDReviewResult only exposes a subset
    // of the PRD, so we attach the full document via a non-enumerable
    // property to avoid leaking it through `JSON.stringify` to MCP
    // clients while still letting `approve()` reach it.
    Object.defineProperty(result, 'prd', {
      value: prd,
      enumerable: false,
      writable: false,
      configurable: false,
    });

    this.pendingReview = result;
    return result;
  }

  /**
   * 用户确认 PRD — SHA-256 锁定 + 进入执行
   *
   * T25 — When the pending review is in HARD-GATE mode, the caller MUST
   * supply `answers` with at least one non-empty entry per displayed red
   * flag. Missing answers cause the approval to fail with a descriptive
   * message so the user can correct the input.
   */
  async approve(answers?: Record<string, string>): Promise<ApprovalResult> {
    if (!this.pendingReview) {
      return {
        approved: false,
        stage: 'open',
        message: 'No pending PRD review to approve',
        next_action: { tool: 'aza_prd_review', action: 'review', reason: 'No pending review' },
      };
    }

    // T25 — HARD-GATE validation. The user must provide an answer for
    // every displayed red flag. The keys are the `thought` text and the
    // values are the user's reasoned answer (at least 3 chars to
    // discourage vacuous responses).
    if (this.pendingReview.hard_gate && this.pendingReview.red_flags) {
      const flags = this.pendingReview.red_flags;
      if (!answers || typeof answers !== 'object') {
        return {
          approved: false,
          stage: 'open',
          message: `HARD-GATE: missing answers map. Provide one answer per flag (${flags.length} required).`,
          next_action: { tool: 'aza_prd_review', action: 'review', reason: 'HARD-GATE requires answers' },
        };
      }
      const missing = flags.filter(
        (f) => !answers[f.thought] || (answers[f.thought] ?? '').trim().length < 3,
      );
      if (missing.length > 0) {
        return {
          approved: false,
          stage: 'open',
          message: `HARD-GATE: ${missing.length} red flag(s) unanswered: ${missing.map((f) => `"${f.thought}"`).join(', ')}`,
          next_action: { tool: 'aza_prd_review', action: 'review', reason: 'HARD-GATE answers missing' },
        };
      }
    }

    // 更新 STATE
    const state = this.stateManager.getState();
    await this.stateManager.update({
      pipeline: { ...state.pipeline, current_stage: 'open' as any },
      loop: { ...state.loop, current_story: this.pendingReview.prd_id },
    });

    // 预写 RESUME
    await this.resumeGenerator.generate(this.stateManager, {
      last_milestone: `PRD approved: ${this.pendingReview.title}`,
    });

    // T25 — record red-flag answers in RESUME for traceability. The
    // answers map is written to a sibling `.aza/red_flag_answers.json`
    // file (best-effort) so the audit trail captures which rationalizations
    // the user accepted and which they pushed back on.
    if (this.pendingReview.hard_gate && answers) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const azaDir = this.stateManager.azaDir ?? '.aza';
        const answersPath = path.join(azaDir, 'red_flag_answers.json');
        await fs.promises.mkdir(path.dirname(answersPath), { recursive: true });
        await fs.promises.writeFile(
          answersPath,
          JSON.stringify(
            {
              prd_id: this.pendingReview.prd_id,
              approved_at: new Date().toISOString(),
              answers,
            },
            null,
            2,
          ),
          'utf8',
        );
      } catch {
        // best-effort
      }
    }

    // T17: generate the execution contract (spec-superflow pattern) so the
    // build stage has a hard bridge to the approved intent. Failures are
    // non-fatal — the loop continues even if writing the contract fails,
    // because we don't want to block a successful PRD approval on a
    // disk-write error. The caller can re-derive the contract from the
    // approved PRD later.
    let contractPath: string | undefined;
    let intentLock: string | undefined;
    try {
      const { generateExecutionContract, writeContract } = await import('./execution-contract');
      const reviewWithPrd = this.pendingReview as any;
      const prd = reviewWithPrd.prd;
      if (prd) {
        const contract = generateExecutionContract(prd);
        const azaDir = this.stateManager.azaDir ?? '.aza';
        await writeContract(contract, azaDir);
        contractPath = `${azaDir}/contract.md`;
        intentLock = contract.intent_lock;
      }
    } catch (err) {
      // best-effort — log but don't fail the approval
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[PRDReviewGate] contract write failed: ${msg}`);
    }

    // T23 / v2 (PRDReviewGate ↔ OpenSpec): when the caller opted in to
    // the openspec source during `review()`, generate the OpenSpec four-
    // piece set (proposal / design / tasks / spec) under
    // `<azaDir>/openspec/changes/<slug>/`. We do this AFTER contract
    // write so the build stage can fall back to the contract if the
    // openspec scaffold is incomplete.
    //
    // We use OUR OWN `scaffoldChange` implementation rather than
    // shelling out to an external openspec CLI, because:
    //   1. The implementation already mirrors the ralphy-openspec four-
    //      piece set verbatim (T23 / wenqingyu/ralphy-openspec).
    //   2. External CLI invocation would couple azaloop to node version
    //      and a globally-installed package.
    //   3. We need the artifact path on the LoopResponse so downstream
    //      tools can reference it.
    //
    // v13 — P3.1: pass the contract reference (intent_lock + task_batches)
    // into writeChangeFolder so proposal.md includes an
    // `## Execution Contract` section. This is the hard bridge from
    // T17 (contract) → T23 (openspec).
    let openspecArtifactPath: string | undefined;
    if (this.pendingReview.source === 'openspec') {
      try {
        const { writeChangeFolder } = await import('./change-folder');
        const azaDir = this.stateManager.azaDir ?? '.aza';
        const projectRoot = azaDir.replace(/\/\.aza$/, '').replace(/\\\.aza$/, '');
        const slug = this.slugifyForOpenSpec(this.pendingReview.title);
        const capability = this.inferCapabilityFromTitle(this.pendingReview.title);
        const result = await writeChangeFolder(
          {
            intent: this.pendingReview.summary,
            capability,
            slug,
            author: 'azaloop',
            whatChanges: [
              `Implement: ${this.pendingReview.title}`,
              `Add PRD-traceable requirements under capability \`${capability}\``,
              `Bridge OpenSpec → ExecutionContract (T17) → LoopController`,
            ],
            addedRequirements: [
              `The system MUST implement the ${this.pendingReview.title} capability.`,
            ],
            tasks: [
              { id: '1.1', title: `Scaffold: ${this.pendingReview.title}`, verification: 'OpenSpec four-piece set is on disk' },
              { id: '1.2', title: 'Build: implementation', verification: 'ExecutionContract passes build stage' },
              { id: '1.3', title: 'Verify: quality gate', verification: '7 quality gates pass' },
            ],
            // v13 — P3.1: bridge contract → openspec proposal
            contract: intentLock ? {
              intent_lock: intentLock,
              task_batches: [
                { id: '1.1', title: `Scaffold: ${this.pendingReview.title}`, verification: 'OpenSpec four-piece set is on disk' },
                { id: '1.2', title: 'Build: implementation', verification: 'ExecutionContract passes build stage' },
                { id: '1.3', title: 'Verify: quality gate', verification: '7 quality gates pass' },
              ],
            } : undefined,
          },
          projectRoot || '.',
        );
        openspecArtifactPath = result.path;
      } catch (err) {
        // best-effort — log but don't fail the approval
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[PRDReviewGate] openspec scaffold failed: ${msg}`);
      }
    }

    this.pendingReview = null;

    // v13 — P3.1: build the data bridge so callers (MCP tools, LoopController)
    // can read the openspec path + contract path + intent_lock.
    const data: NonNullable<ApprovalResult['data']> = {};
    if (openspecArtifactPath) data.openspec_path = openspecArtifactPath;
    if (contractPath) data.contract_path = contractPath;
    if (intentLock) data.intent_lock = intentLock;

    return {
      approved: true,
      stage: 'open',
      message: openspecArtifactPath
        ? `PRD 已确认，OpenSpec 工件已生成于 ${openspecArtifactPath}，开始自动执行`
        : 'PRD 已确认，开始自动执行',
      next_action: { tool: 'aza_loop_next', action: 'next', reason: 'PRD approved, entering execution' },
      data: Object.keys(data).length > 0 ? data : undefined,
    };
  }

  /**
   * 用户修改 PRD — 根据反馈调整后重新展示
   */
  async modify(feedback: string): Promise<PRDReviewResult> {
    const originalTitle = this.pendingReview?.title || 'Modified Project';
    const modifiedInput: PRDGenerationInput = {
      title: originalTitle,
      description: feedback,
    };
    return this.review(modifiedInput);
  }

  /**
   * 超时自动确认 — 60s 无输入时自动执行
   */
  async autoApproveOnTimeout(): Promise<ApprovalResult> {
    await this.resumeGenerator.generate(this.stateManager, {
      last_milestone: 'PRD auto-approved due to timeout (60s no input)',
    });
    return this.approve();
  }

  /**
   * 用户取消
   */
  async cancel(): Promise<{ cancelled: boolean; next_action: NextAction }> {
    this.pendingReview = null;
    return {
      cancelled: true,
      next_action: { tool: 'aza_loop_next', action: 'done', reason: 'PRD review cancelled by user' },
    };
  }

  /**
   * 获取当前待审阅的 PRD（用于跨会话恢复）
   */
  getPendingReview(): PRDReviewResult | null {
    return this.pendingReview;
  }

  // ── 私有辅助方法 ──

  /**
   * Convert a PRD title into a URL-safe slug for the OpenSpec change folder.
   * Mirrors ralphy-openspec's slug convention (kebab-case, lowercase,
   * ASCII letters + digits + hyphen, max 64 chars).
   */
  private slugifyForOpenSpec(title: string): string {
    const ascii = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')      // strip non-word / non-hyphen
      .replace(/[\s_]+/g, '-')         // collapse whitespace and underscores
      .replace(/-+/g, '-')             // collapse consecutive hyphens
      .replace(/^-|-$/g, '');          // trim leading/trailing hyphens
    return (ascii || 'change').slice(0, 64);
  }

  /**
   * Best-effort capability inference from a PRD title. Used to populate
   * the OpenSpec capability field when the caller did not supply one
   * explicitly. The mapping is intentionally simple: pick a domain word
   * from the title, fall back to "core" when nothing matches.
   */
  private inferCapabilityFromTitle(title: string): string {
    const lower = title.toLowerCase();
    const candidates = [
      'auth', 'billing', 'review', 'chat', 'search', 'feed', 'order',
      'payment', 'task', 'project', 'user', 'admin', 'dashboard',
      'api', 'cli', 'mcp', 'plugin', 'extension', 'integration',
    ];
    for (const c of candidates) {
      if (lower.includes(c)) return c;
    }
    return 'core';
  }

  private formatSummary(prd: any, complexity: string, checkResult: PRDCheckResult): string {
    const lines: string[] = [
      `📋 PRD 摘要`,
      `═══════════════════════════════════════`,
      ``,
      `📌 项目名称：${prd.title}`,
      `📊 复杂度等级：${complexity}`,
      `⭐ 质量评分：${checkResult.score}/100`,
      `🔧 P0 问题：${checkResult.p0_count}（已自动修复）`,
      `📝 用户故事：${prd.stories?.length || 0} 个`,
      `🏗️ 架构图：${prd.architecture?.length || 0} 个`,
      `⚠️ 风险项：${prd.risks?.length || 0} 个`,
      ``,
      `✅ 确认后输入"开始执行"`,
      `✏️  修改请直接描述您的修改意见`,
      `❌ 取消请输入"取消"`,
      `⏳ ${this.timeoutMs / 1000}s 内无输入将自动执行当前方案`,
    ];
    return lines.join('\n');
  }

  private formatInstruction(): string {
    return [
      `请审阅以上 PRD 摘要。`,
      `⏳ ${this.timeoutMs / 1000}s 内无输入将自动执行当前方案。`,
      `✅ 确认后输入"开始执行"`,
      `✏️ 修改请直接描述修改意见`,
      `❌ 取消请输入"取消"`,
    ].join('\n');
  }

  private extractKeyDecisions(prd: any): string[] {
    const decisions: string[] = [];
    if (prd.architecture?.length > 0) {
      decisions.push(`架构模式：${prd.architecture[0].description || '默认组件架构'}`);
    }
    if (prd.stories?.length > 0) {
      const p0Count = prd.stories.filter((s: any) => s.priority === 'P0').length;
      decisions.push(`MVP 范围：${p0Count} 个 P0 故事，${prd.stories.length} 个总故事`);
    }
    if (prd.risks?.length > 0) {
      const highRisks = prd.risks.filter((r: any) => r.probability === 'high');
      if (highRisks.length > 0) {
        decisions.push(`高风险项：${highRisks.length} 个需要重点关注`);
      }
    }
    return decisions;
  }

  private extractOpenQuestions(prd: any, checkResult: PRDCheckResult): string[] {
    const questions: string[] = [];
    const p1Issues = checkResult.details.filter(d => d.severity === 'P1' && !d.passed);
    for (const issue of p1Issues.slice(0, 5)) {
      questions.push(`${issue.id}: ${issue.description}`);
    }
    if (questions.length === 0) {
      questions.push('无待确认问题 — PRD 质量良好');
    }
    return questions;
  }
}
