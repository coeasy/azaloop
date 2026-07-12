import { PRDGenerator, type PRDGenerationInput, type Complexity } from './prd-generator';
import { PRDChecker, type PRDCheckResult } from './prd-checker';
import type { StateManager } from '../state/state-manager';
import type { ResumeGenerator } from '../continuity/resume-generator';
import type { NextAction } from '@azaloop/shared';

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
}

export interface ApprovalResult {
  approved: boolean;
  stage: string;
  message: string;
  next_action: NextAction;
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
   */
  async review(input: PRDGenerationInput): Promise<PRDReviewResult> {
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
      instruction: this.formatInstruction(),
    };

    this.pendingReview = result;
    return result;
  }

  /**
   * 用户确认 PRD — SHA-256 锁定 + 进入执行
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

    this.pendingReview = null;

    return {
      approved: true,
      stage: 'open',
      message: 'PRD 已确认，开始自动执行',
      next_action: { tool: 'aza_loop_next', action: 'next', reason: 'PRD approved, entering execution' },
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
