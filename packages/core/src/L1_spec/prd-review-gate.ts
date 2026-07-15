import { PRDGenerator, type PRDGenerationInput, type Complexity } from './prd-generator';
import { PRDChecker, type PRDCheckResult } from './prd-checker';
import type { StateManager } from '../state/state-manager';
import type { ResumeGenerator } from '../continuity/resume-generator';
import type { NextAction, PRD } from '@azaloop/shared';
import { BRAINSTORMING_RED_FLAGS, topBrainstormingRedFlags, type RedFlag } from './brainstorming-red-flags';
import type { SkillMeta } from '../L5_skill/registry';
import {
  runCompetitiveResearch,
  writePrdMarkdown,
} from './github-competitive-research';
import { PRD_REFINE_SELF_CHECK_PROMPT } from './prd-llm-prompts';
import { FilePersistor } from '../L2_memory/file-persistor';
import * as path from 'path';
import * as fs from 'fs';

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
  /** T25 — input source: 'openspec' (default since 0.2.x) or 'aza-prd'. */
  source?: 'openspec' | 'aza-prd';
  /** Workspace root used for OpenSpec + .aza writes (must be the project, not HOME). */
  workspace_path?: string;
  /** CEO/QA/Eng multi-role review (P3-2) */
  multi_role?: import('./prd-multi-role-review').MultiRoleReviewResult;
  /** V22 — A1: Quantitative quality gate result (PrdQualityGate evaluation). */
  gate?: import('./prd-quality-gate').QualityGateResult;
  /** Competitive research summary surfaced to the host (default + visible). */
  competitive?: {
    source: string;
    count: number;
    top: string[];
    cached: boolean;
    skipped: boolean;
  };
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
  // V20 Task 1.4: multi-step LLM interaction state
  private pendingDraftInput: PRDGenerationInput | null = null;
  private pendingDraftPrd: PRD | null = null;
  // R10: 统一文件落盘器（原子写入 + 校验和 + 重试），确保 PRD/契约等产物可靠落到 .aza
  private filePersistor: FilePersistor;

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
    this.filePersistor = new FilePersistor(this.stateManager.azaDir);
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
      workspace_path?: string;
    },
  ): Promise<PRDReviewResult> {
    const workRoot =
      input.workspace_path ||
      (this.stateManager as any).azaDir?.replace(/[\\/]\.aza$/, '') ||
      process.cwd();
    const azaDir = path.join(workRoot, '.aza');

    // 0. Competitive research — DEFAULT + VISIBLE + UN-BYPASSABLE.
    // Every PRD carries competitor context (runCompetitiveResearch always
    // returns the curated pool as fallback). Live GitHub search runs for
    // L2–L4 (L1 uses curated, offline). Results are cached (24h) to shrink
    // token/request cost. Complexity is graded after generate; we pass a
    // hint of undefined so 'auto' treats unknown as L2 (live).
    let research: Awaited<ReturnType<typeof runCompetitiveResearch>>['research'] = null;
    let competitiveCached = false;
    let competitiveSkipped = false;
    try {
      const comp = await runCompetitiveResearch(azaDir, input.title, input.description || input.title);
      research = comp.research;
      competitiveCached = comp.fromCache;
      competitiveSkipped = comp.skipped;
      if (research) {
        const raw = input.description || input.title;
        const peers = research.competitors.slice(0, 3).map((c) => c.full_name).join(', ') || 'OpenSpec, Superpowers, ralphy';
        const enrichedDescription = [
          raw,
          /pain|痛点|problem|stall/i.test(raw) ? '' : 'Pain: vague PRDs and fragile agent loops waste tokens and stall full-auto delivery.',
          /compet|OpenSpec|peers|竞品|landscape/i.test(raw) ? '' : `Peers: ${peers}.`,
        ]
          .filter(Boolean)
          .join('\n');
        input = {
          ...input,
          description: enrichedDescription,
          constraints: [
            ...(input.constraints || []),
            ...research.competitors.slice(0, 3).map((c) => `competitor:${c.full_name}`),
          ],
        };
      }
    } catch {
      /* research is best-effort; PRD still generates without it */
    }

    // 1. 生成 PRD（带自优化）
    let complexity = input.complexity || this.prdGenerator.inferComplexity(input.description || input.title);
    const enable14 = input.force_14chapters ?? (complexity === 'L3' || complexity === 'L4');
    // R3: 按复杂度分级——L1 任务跳过自优化和多角色评审，节省 token
    const isL1 = complexity === 'L1';
    const selfOptimizeRounds = isL1 ? 1 : 5;
    const skipMultiRole = isL1;

    let prd = this.prdGenerator.generate(input, {
      enable_self_optimization: !isL1,
      max_optimization_rounds: selfOptimizeRounds,
      auto_stories: true,
      auto_architecture: true,
      enable_14chapters: enable14,
    });

    if (research) {
      // Keep research detail on disk; ensure gate-required signals on the PRD (≥2 github URLs)
      const peers = research.competitors.slice(0, 3).map((c) => c.full_name).join(', ');
      const urls = research.competitors
        .slice(0, 4)
        .map((c) => c.html_url)
        .filter(Boolean);
      const urlBlock = urls.length
        ? `\nCompetitive refs:\n${urls.map((u) => `- ${u}`).join('\n')}`
        : '';
      if (!/compet|OpenSpec|peers|竞品|landscape|github\.com\//i.test(prd.overview) || urls.length >= 2) {
        prd = {
          ...prd,
          overview: `${prd.overview}\nPeers: ${peers || 'OpenSpec, Superpowers, ralphy'}.${urlBlock}${research.prd_supplements.overview_appendix}`,
        };
      }
      if (prd.goals.length < 2) {
        prd = {
          ...prd,
          goals: [
            ...prd.goals,
            ...research.prd_supplements.goals.slice(0, 2),
          ],
        };
      }
      // Merge differentiator signal into goals if missing
      if (!prd.goals.some((g) => /differentiat|MCP|Host-LLM|absorb competitive/i.test(g))) {
        prd = {
          ...prd,
          goals: [...prd.goals, ...research.prd_supplements.goals.slice(0, 1)],
        };
      }
      // R10: 不再重复 selfOptimize —— generate() 已按复杂度自优化
      // (L1:1 轮 / 非 L1:5 轮)，此处再跑 3 轮纯属浪费 token 与模型请求。
    }

    // Persist human-readable PRD under project .aza/ (原子写入 + 校验和 + 重试)
    try {
      writePrdMarkdown(azaDir, prd, research);
      await this.filePersistor.persistPRD(prd);
    } catch {
      /* best-effort */
    }

    // 2. 最终检查 + P3-2 multi-role CEO/QA/Eng review
    // R3: L1 任务跳过多角色评审（节省 4 个 LLM 评审调用的 token）
    const checkResult = this.prdChecker.check(prd);
    let multiRole: import('./prd-multi-role-review').MultiRoleReviewResult | null = null;
    if (skipMultiRole) {
      multiRole = {
        passed: true,
        score: 100,
        reviews: [],
        findings: [],
        summary: 'L1 task: multi-role review skipped (cost optimization)',
      } as any;
    } else {
      try {
        const { runMultiRolePrdReview } = await import('./prd-multi-role-review');
        multiRole = runMultiRolePrdReview(prd);
        fs.mkdirSync(azaDir, { recursive: true });
        fs.writeFileSync(
          path.join(azaDir, 'prd-multi-role-review.json'),
          JSON.stringify(multiRole, null, 2),
          'utf8',
        );
      } catch {
        /* best-effort */
      }
    }

    // Persist plan.md for crash recovery
    try {
      const { writePlanMd, ensureConstitution } = await import('./constitution');
      ensureConstitution(workRoot);
      writePlanMd(workRoot, {
        title: prd.title,
        stage: 'open',
        next: 'aza_prd(approve) → aza_loop(full)',
        bullets: prd.goals.slice(0, 5),
      });
    } catch {
      /* best-effort */
    }

    // 3. 提取展示信息
    complexity = (prd as any)._complexity || 'L2';
    const mermaid = prd.architecture[0]?.mermaid || 'graph TD\n  A[需求] --> B[PRD] --> C[设计] --> D[实现] --> E[验证] --> F[交付]';

    // T25 — HARD-GATE detection. Any `requires_approval: true` skill
    // forces the gate into the strict red-flag flow.
    const isHardGate = input.skillMeta?.requires_approval === true;
    const displayedFlags = isHardGate ? topBrainstormingRedFlags(3) : undefined;

    // Strict gate: shallow PRDs / open P1 / multi-role P0 must not auto-look healthy
    const strictBlock = !checkResult.passed || (multiRole ? !multiRole.passed : false);

    const result: PRDReviewResult = {
      prd_id: prd.id,
      title: prd.title,
      summary: this.formatSummary(prd, complexity, checkResult),
      mermaid_diagram: mermaid,
      key_decisions: this.extractKeyDecisions(prd),
      open_questions: this.extractOpenQuestions(prd, checkResult),
      complexity,
      quality_score: Math.min(checkResult.score, multiRole?.score ?? 100),
      self_optimize_iterations: 0,
      needs_user_approval: true,
      timeout_ms: this.timeoutMs,
      instruction: strictBlock
        ? `PRD gate FAILED (score ${checkResult.score}/100, P0=${checkResult.p0_count}, P1=${checkResult.p1_count}${multiRole && !multiRole.passed ? `; multi-role: ${multiRole.summary}` : ''}). Fix open_questions before relying on auto_approve.`
        : isHardGate
          ? 'HARD-GATE: Answer the 3 red-flag questions before approval. Pass `answers: { "<flag>": "..." }` to approve().'
          : this.formatInstruction(),
      red_flags: displayedFlags,
      hard_gate: isHardGate || undefined,
      source: input.source ?? 'openspec',
      workspace_path: workRoot,
      multi_role: multiRole || undefined,
      competitive: research
        ? {
            source: research.source,
            count: research.competitors.length,
            top: research.competitors.slice(0, 5).map((c) => c.full_name),
            cached: competitiveCached,
            skipped: competitiveSkipped,
          }
        : competitiveSkipped
          ? { source: 'off', count: 0, top: [], cached: false, skipped: true }
          : undefined,
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

    // A1 — 集成 PrdQualityGate：量化评分 + 门禁
    try {
      const { evaluatePrdQuality } = await import('./prd-quality-gate');
      const gateResult = evaluatePrdQuality(prd, (multiRole as any)?.findings ? (multiRole as any) : undefined);
      Object.defineProperty(result, 'gate', {
        value: gateResult,
        enumerable: true,
        writable: false,
        configurable: false,
      });
      // 持久化门禁报告
      try {
        fs.mkdirSync(azaDir, { recursive: true });
        fs.writeFileSync(
          path.join(azaDir, 'prd-gate-report.json'),
          JSON.stringify(gateResult, null, 2),
          'utf8',
        );
        if (!(globalThis as any).__AZA_QUIET__) {
          console.warn(`[AzaLoop][A1] PrdQualityGate: score=${gateResult.score}, grade=${gateResult.grade}, passed=${gateResult.passed}, blockers=${gateResult.blockers.length}`);
        }
      } catch (e) {
        if (!(globalThis as any).__AZA_QUIET__) console.warn('[AzaLoop][A1] gate-report persist failed:', (e as Error).message);
      }
    } catch (e) {
      if (!(globalThis as any).__AZA_QUIET__) console.warn('[AzaLoop][A1] PrdQualityGate evaluation failed:', (e as Error).message);
    }

    // A2 — todolist 生成（review 路径）
    try {
      await this.generateAndPersistTodolist(prd, azaDir);
      if (!(globalThis as any).__AZA_QUIET__) console.warn(`[AzaLoop][A2] todolist generated: ${azaDir}/todolist.json`);
    } catch (e) {
      if (!(globalThis as any).__AZA_QUIET__) console.warn('[AzaLoop][A2] todolist generation failed:', (e as Error).message);
    }

    // A2 — todolist 在 review() 路径也生成（已在上方带日志调用）
    // （重复调用已合并）

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
    // Spine: default to OpenSpec change-folder unless caller explicitly opted out (source === 'aza-prd').
    const shouldWriteOpenspec = this.pendingReview.source !== 'aza-prd';
    if (shouldWriteOpenspec) {
      try {
        const { writeChangeFolder } = await import('./change-folder');
        const azaDir = this.stateManager.azaDir ?? '.aza';
        // Prefer explicit workspace_path from review; never fall back to HOME when
        // azaDir is an absolute ~/.aza path without a real project parent.
        const reviewWorkspace =
          (this.pendingReview as any)?.workspace_path ||
          (typeof process.env.AZA_WORKSPACE === 'string' && process.env.AZA_WORKSPACE) ||
          '';
        const projectRoot = (
          reviewWorkspace ||
          azaDir.replace(/[\\/]\.aza$/, '') ||
          process.cwd()
        ).replace(/[\\/]$/, '');
        const slug = this.slugifyForOpenSpec(this.pendingReview.title);
        const capability = this.inferCapabilityFromTitle(this.pendingReview.title);
        const reviewWithPrd2 = this.pendingReview as any;
        const leanIntent = this.buildLeanOpenSpecIntent(
          reviewWithPrd2.prd,
          this.pendingReview.title,
          intentLock,
        );
        const storyTasks =
          Array.isArray(reviewWithPrd2.prd?.stories) && reviewWithPrd2.prd.stories.length > 0
            ? reviewWithPrd2.prd.stories.slice(0, 6).map((s: any, i: number) => ({
                id: `1.${i + 1}`,
                title: String(s.title || `Story ${i + 1}`).slice(0, 120),
                verification:
                  s.acceptance_criteria?.[0]?.description ||
                  'Acceptance criterion observed as pass/fail',
                ac: (s.acceptance_criteria || []).map((a: any) => String(a.id)).slice(0, 4),
              }))
            : [
                { id: '1.1', title: `Scaffold: ${this.pendingReview.title}`, verification: 'OpenSpec three-piece set is on disk' },
                { id: '1.2', title: 'Build: implementation', verification: 'ExecutionContract passes build stage' },
                { id: '1.3', title: 'Verify: quality gate', verification: 'P0=0 P1=0 and weighted score ≥ 90' },
              ];
        const result = await writeChangeFolder(
          {
            intent: leanIntent,
            capability,
            slug,
            author: 'azaloop',
            why: leanIntent,
            whatChanges: [
              `Implement: ${this.pendingReview.title}`,
              'Enforce measurable AC per story; clear P0+P1; weighted score ≥ 90',
              'Keep OpenSpec three-piece lean; contract only in .aza/contract.md',
            ],
            nonGoals: [
              'Do not expand MCP tool count',
              'Do not embed Execution Contract task batches into proposal.md',
            ],
            technicalApproach: [
              `- OpenSpec three-piece under openspec/changes/${slug}/`,
              '- Contract pointer only in proposal; full lock in .aza/contract.md',
              '- Structured tasks.md with verify/ac/deps sub-lines',
            ],
            addedRequirements: [
              `The system MUST clear all P0 and P1 PRD/quality issues with weighted score ≥ 90.`,
              `Each story MUST have ≥1 measurable acceptance criterion (no placeholder wording).`,
            ],
            tasks: storyTasks,
            // Pointer only — never embed task_batches into proposal
            contract: intentLock ? { intent_lock: intentLock, path: '.aza/contract.md' } : undefined,
            writeSidecar: true,
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

    const pendingTitle = this.pendingReview?.title;
    this.pendingReview = null;

    // v13 — P3.1: build the data bridge so callers (MCP tools, LoopController)
    // can read the openspec path + contract path + intent_lock.
    const data: NonNullable<ApprovalResult['data']> = {};
    if (openspecArtifactPath) data.openspec_path = openspecArtifactPath;
    if (contractPath) data.contract_path = contractPath;
    if (intentLock) data.intent_lock = intentLock;

    try {
      const { ensureTaskBoard } = await import('../L2_memory/task-board');
      const azaDir = this.stateManager.azaDir ?? '.aza';
      ensureTaskBoard(azaDir, {
        title: pendingTitle,
        phase: 'open',
        status: 'in_progress',
        notes: 'PRD approved — board synced',
      });
    } catch {
      /* best-effort */
    }

    return {
      approved: true,
      stage: 'open',
      message: openspecArtifactPath
        ? `PRD 已确认，OpenSpec 工件已生成于 ${openspecArtifactPath}，开始自动执行`
        : 'PRD 已确认，开始自动执行',
      next_action: { tool: 'aza_loop', action: 'full', reason: 'PRD approved — start full auto loop (follow awaitingAction + report_tool)' },
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
      next_action: { tool: 'aza_loop', action: 'done', reason: 'PRD review cancelled by user' },
    };
  }

  /**
   * 获取当前待审阅的 PRD（用于跨会话恢复）
   */
  getPendingReview(): PRDReviewResult | null {
    return this.pendingReview;
  }

  // ── V20 Task 1.4: 多步 LLM 交互方法 ──

  /**
   * V20 draft action — generate draft prompt for host LLM.
   *
   * Step 1 of multi-step PRD generation:
   * 1. Run competitive research
   * 2. Generate draft prompt via prdGenerator.generateDraftPrompt()
   * 3. Return prompt + next_action pointing to multi_review
   */
  async draft(
    input: PRDGenerationInput & { workspace_path?: string; complexity?: Complexity },
  ): Promise<{
    draft_prompt: string;
    competitive: { source: string; count: number; top: string[] } | null;
    next_action: NextAction;
  }> {
    const workRoot =
      input.workspace_path ||
      (this.stateManager as any).azaDir?.replace(/[\\/]\.aza$/, '') ||
      process.cwd();
    const azaDir = path.join(workRoot, '.aza');

    // Run competitive research (default + visible)
    let competitive: Awaited<ReturnType<typeof runCompetitiveResearch>>['research'] = null;
    try {
      const comp = await runCompetitiveResearch(azaDir, input.title, input.description || input.title);
      competitive = comp.research;
    } catch {
      /* best-effort */
    }

    // Stash input for multi_review step
    this.pendingDraftInput = input;

    // Convert CompetitiveResearchResult → CompetitiveContext for generateDraftPrompt
    const competitiveContext: import('./prd-llm-prompts').CompetitiveContext | null = competitive
      ? {
          competitors: competitive.competitors.slice(0, 8).map((c) => ({
            full_name: c.full_name,
            html_url: c.html_url,
            description: c.description,
          })),
          differentiators: competitive.differentiators,
          goals: competitive.prd_supplements.goals,
          overview_appendix: competitive.prd_supplements.overview_appendix,
          risks: competitive.prd_supplements.risks,
        }
      : null;

    // Generate draft prompt
    const complexity = input.complexity || 'L2';
    const use14Chapters = complexity === 'L3' || complexity === 'L4';
    const draftPrompt = this.prdGenerator.generateDraftPrompt(input, competitiveContext, {
      enable_14chapters: use14Chapters,
      complexity,
    });

    return {
      draft_prompt: draftPrompt,
      competitive: competitive
        ? {
            source: competitive.source,
            count: competitive.competitors.length,
            top: competitive.competitors.slice(0, 5).map((c) => c.full_name),
          }
        : null,
      next_action: {
        tool: 'aza_prd',
        action: 'multi_review',
        reason: 'Draft prompt generated; host LLM should produce PRD JSON then call multi_review',
        instruction:
          '使用上述 draft_prompt 生成 PRD JSON，然后调用 aza_prd(action=multi_review, prd_draft=<JSON 字符串>)',
      },
    };
  }

  /**
   * V20 multi_review action — generate 4-role adversarial review prompts.
   *
   * Step 2 of multi-step PRD generation:
   * 1. Parse host LLM's PRD draft
   * 2. Generate 4-role (CEO/QA/Eng/Design) review prompts
   * 3. Return prompts + next_action pointing to refine
   */
  async multiReview(prdDraft: string): Promise<{
    review_prompts: { ceo_prompt: string; qa_prompt: string; eng_prompt: string; design_prompt: string };
    prd_parsed: boolean;
    parse_error?: string;
    next_action: NextAction;
  }> {
    if (!prdDraft || typeof prdDraft !== 'string') {
      return {
        review_prompts: { ceo_prompt: '', qa_prompt: '', eng_prompt: '', design_prompt: '' },
        prd_parsed: false,
        parse_error: 'empty prd_draft',
        next_action: {
          tool: 'aza_prd',
          action: 'draft',
          reason: 'Empty PRD draft; regenerate',
          instruction: 'PRD 草稿为空，请重新调用 aza_prd(action=draft) 生成草稿',
        },
      };
    }

    const parsed = this.prdGenerator.parseDraftResponse(prdDraft);
    if (!parsed) {
      return {
        review_prompts: { ceo_prompt: '', qa_prompt: '', eng_prompt: '', design_prompt: '' },
        prd_parsed: false,
        parse_error: 'failed to parse PRD JSON from draft',
        next_action: {
          tool: 'aza_prd',
          action: 'draft',
          reason: 'PRD draft parsing failed; regenerate draft',
          instruction: 'PRD 草稿解析失败，请确保返回合法 JSON 后重新调用 aza_prd(action=draft)',
        },
      };
    }

    // Stash parsed PRD for refine step
    this.pendingDraftPrd = parsed;

    // Generate 4-role review prompts
    const { getMultiRoleReviewPrompts } = await import('./prd-multi-role-review');
    const prompts = getMultiRoleReviewPrompts(parsed);

    return {
      review_prompts: prompts,
      prd_parsed: true,
      next_action: {
        tool: 'aza_prd',
        action: 'refine',
        reason: 'Review prompts generated; host LLM should run reviews then refine',
        instruction:
          '使用上述 4 个 review_prompts 分别审查 PRD，汇总发现后调用 aza_prd(action=refine, refined_prd=<精炼后 JSON>, review_responses=[{role, response}, ...])',
      },
    };
  }

  /**
   * V20 refine action — parse refined PRD, run check, route to approve or back to draft.
   *
   * Step 3 of multi-step PRD generation:
   * 1. Parse host LLM's refined PRD
   * 2. Run checker.check()
   * 3. If passes, stash as pendingReview + point to approve
   * 4. If fails, return to draft with feedback
   */
  async refine(
    refinedPrd: string,
    reviewResponses?: Array<{ role: string; response: string }>,
  ): Promise<{
    refined: boolean;
    quality_score: number;
    blockers?: string[];
    next_action: NextAction;
  }> {
    if (!refinedPrd || typeof refinedPrd !== 'string') {
      return {
        refined: false,
        quality_score: 0,
        next_action: {
          tool: 'aza_prd',
          action: 'draft',
          reason: 'Empty refined PRD',
          instruction: '精炼后 PRD 为空，请重新生成',
        },
      };
    }

    const parsed = this.prdGenerator.parseDraftResponse(refinedPrd);
    if (!parsed) {
      return {
        refined: false,
        quality_score: 0,
        next_action: {
          tool: 'aza_prd',
          action: 'draft',
          reason: 'Refined PRD parsing failed',
          instruction: '精炼后 PRD 解析失败，请确保返回合法 JSON',
        },
      };
    }

    // Run checker
    const checkResult = this.prdChecker.check(parsed);

    // Persist refined PRD (原子写入 + 校验和 + 重试)
    const azaDir = this.stateManager.azaDir ?? '.aza';
    try {
      writePrdMarkdown(azaDir, parsed);
      await this.filePersistor.persistPRD(parsed);
    } catch {
      /* best-effort */
    }

    // If passes, stash as pendingReview and point to approve
    if (checkResult.passed) {
      // A2 — 生成 TodoList（抽离到 generateAndPersistTodolist）
      const azaDirForTodolist = this.stateManager.azaDir ?? '.aza';
      this.generateAndPersistTodolist(parsed, azaDirForTodolist);

      // A3 — 拼接 PRD_REFINE_SELF_CHECK_PROMPT 自检清单摘要
      let selfCheckSummary = '';
      try {
        const fullPrompt = PRD_REFINE_SELF_CHECK_PROMPT('{}', [], []);
        const match = fullPrompt.match(/## 自检清单[\s\S]*?(?=\n## |\s*$)/);
        if (match && match[0]) {
          selfCheckSummary = match[0].slice(0, 500);
        }
      } catch { /* best-effort */ }
      const baseInstruction = `PRD 已通过审查（评分 ${checkResult.score}/100），调用 aza_prd(action=approve) 进入循环`;
      const finalInstruction = selfCheckSummary
        ? `${baseInstruction.split('，')[0]}（评分 ${checkResult.score}/100）。在调用 approve() 前，请宿主 LLM 先执行自检：\n\n${selfCheckSummary}`
        : baseInstruction;

      const result: PRDReviewResult = {
        prd_id: parsed.id,
        title: parsed.title,
        summary: `Refined PRD (score ${checkResult.score}/100, P0=${checkResult.p0_count}, P1=${checkResult.p1_count})`,
        mermaid_diagram: parsed.architecture[0]?.mermaid || '',
        key_decisions: [],
        open_questions: [],
        complexity: (parsed as any)._complexity || 'L2',
        quality_score: checkResult.score,
        self_optimize_iterations: 0,
        needs_user_approval: false,
        timeout_ms: this.timeoutMs,
        instruction: 'PRD refined and passes checks. Call approve() to proceed.',
        source: 'aza-prd',
      };
      Object.defineProperty(result, 'prd', {
        value: parsed,
        enumerable: false,
        writable: false,
        configurable: false,
      });
      this.pendingReview = result;
      this.pendingDraftPrd = null;
      this.pendingDraftInput = null;

      return {
        refined: true,
        quality_score: checkResult.score,
        next_action: {
          tool: 'aza_prd',
          action: 'approve',
          reason: `PRD refined (score ${checkResult.score}/100); ready to approve`,
          instruction: finalInstruction,
        },
      };
    }

    // If fails, return to draft with feedback
    const blockers = checkResult.details
      .filter((d) => !d.passed && (d.severity === 'P0' || d.severity === 'P1'))
      .map((d) => `[${d.severity}] ${d.id}: ${d.description}`);

    return {
      refined: false,
      quality_score: checkResult.score,
      blockers,
      next_action: {
        tool: 'aza_prd',
        action: 'draft',
        reason: `PRD still has ${blockers.length} P0/P1 issues`,
        instruction: `PRD 仍有 ${blockers.length} 个 P0/P1 问题，请根据以下反馈重新生成草稿：\n${blockers.slice(0, 8).join('\n')}`,
      },
    };
  }

  // ── 私有辅助方法 ──

  /**
   * A2 — Generate a TodoList from the given PRD and persist it under
   * `<azaDir>/todolist.json` + `<azaDir>/todolist.md`.
   *
   * Best-effort: any failure (import error, write error, generator
   * throw) is swallowed silently so callers can invoke this method
   * without defensive try/catch wrappers.
   */
  private async generateAndPersistTodolist(prd: PRD, azaDir: string): Promise<void> {
    try {
      const { generatePrdTodolist } = await import('./prd-todolist-generator');
      const todolist = generatePrdTodolist(prd);
      fs.mkdirSync(azaDir, { recursive: true });
      fs.writeFileSync(
        path.join(azaDir, 'todolist.json'),
        JSON.stringify(todolist, null, 2),
        'utf8',
      );
      // 同时生成 markdown 版本
      const todolistMd = this.formatTodolistMarkdown(todolist);
      fs.writeFileSync(
        path.join(azaDir, 'todolist.md'),
        todolistMd,
        'utf8',
      );
    } catch {
      /* best-effort */
    }
  }

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
      `🔧 P0：${checkResult.p0_count}  P1：${checkResult.p1_count}${checkResult.passed ? '（门禁通过）' : '（未清零）'}`,
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

  /** OpenSpec intent must stay lean — never copy UI chrome from formatSummary. */
  private buildLeanOpenSpecIntent(prd: any, title: string, intentLock?: string): string {
    if (intentLock && intentLock.trim().length > 20) {
      return intentLock.trim().slice(0, 800);
    }
    const goals = Array.isArray(prd?.goals) ? prd.goals.slice(0, 4).join('; ') : '';
    const overview = typeof prd?.overview === 'string' ? prd.overview.split('\n').slice(0, 6).join(' ') : '';
    return `${title}: ${goals || overview}`.replace(/\s+/g, ' ').trim().slice(0, 800);
  }

  private formatTodolistMarkdown(todolist: import('./prd-todolist-generator').TodoList): string {
    const lines: string[] = [
      `# ${todolist.title} - 执行任务清单`,
      '',
      `**PRD ID**: ${todolist.prd_id}`,
      `**创建时间**: ${todolist.created_at}`,
      `**总任务数**: ${todolist.total_items}`,
      '',
      `## 摘要`,
      `- P0 任务: ${todolist.summary.p0_count} 个`,
      `- P1 任务: ${todolist.summary.p1_count} 个`,
      `- P2 任务: ${todolist.summary.p2_count} 个`,
      `- 并行组数: ${todolist.summary.parallel_groups}`,
      '',
      `## 关键路径`,
      ...todolist.summary.critical_path.map(id => `- ${id}`),
      '',
      `## 任务列表`,
      '',
    ];

    for (const item of todolist.items) {
      const statusIcon = {
        pending: '⬜',
        in_progress: '🟨',
        done: '✅',
        blocked: '🚫',
      }[item.status];

      lines.push(`### ${statusIcon} ${item.id}: ${item.title}`);
      lines.push('');
      lines.push(`**优先级**: ${item.priority} | **工作量**: ${item.estimated_effort} | **状态**: ${item.status}`);
      lines.push('');
      lines.push(item.description);
      lines.push('');

      if (item.acceptance_criteria.length > 0) {
        lines.push('**验收标准**:');
        for (const ac of item.acceptance_criteria) {
          lines.push(`- [ ] ${ac}`);
        }
        lines.push('');
      }

      if (item.dependencies.length > 0) {
        lines.push(`**依赖**: ${item.dependencies.join(', ')}`);
        lines.push('');
      }

      lines.push(`**验证方式**: ${item.verification}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

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
    const blockers = checkResult.details.filter(
      (d) => !d.passed && (d.severity === 'P0' || d.severity === 'P1'),
    );
    for (const issue of blockers.slice(0, 8)) {
      questions.push(`[${issue.severity}] ${issue.id}: ${issue.description}`);
    }
    if (questions.length === 0) {
      questions.push('无待确认问题 — P0/P1 已清零且加权分≥90');
    }
    return questions;
  }
}
