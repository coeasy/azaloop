/**
 * PRD 质量门禁（V21 新增）
 *
 * 借鉴 check-prd-skill 的质量门禁机制，确保 PRD 达到最低质量标准。
 *
 * 门禁规则：
 * 1. 最低分阈值：总分 ≥ 75 分（满分 100）
 * 2. 必须可执行建议数：每个角色至少 1 条 actionable finding
 * 3. Doubt Theater 检测：≥2 周期 reviewer 出实质发现但零 actionable → 升级用户
 * 4. P0 问题零容忍：任何 P0 问题未解决 → 不通过
 * 5. 反模式检测：P0 反模式数量 = 0
 */

import type { PRD } from '@azaloop/shared';
import type { ReviewFinding, MultiRoleReviewResponse } from './prd-llm-prompts';
import { PrdQualityScorer, type PrdQualityScore } from './prd-quality-scorer';
import { PrdQualityChecklist, type ChecklistResult } from './prd-quality-checklist';
import { PrdAntiPatternDetector, type AntiPatternResult } from './prd-anti-patterns';

// ── Types ──

export interface QualityGateResult {
  passed: boolean;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  blockers: string[];
  warnings: string[];
  recommendations: string[];
  details: {
    qualityScore: PrdQualityScore;
    checklist: ChecklistResult;
    antiPatterns: AntiPatternResult;
    multiRoleReview?: MultiRoleReviewResponse;
    doubtTheater?: DoubtTheaterResult;
  };
}

export interface DoubtTheaterResult {
  detected: boolean;
  cycles: number;
  description: string;
  action: 'escalate' | 'continue';
}

export interface QualityGateConfig {
  minScore: number;              // 最低分阈值（默认 75）
  minActionablePerRole: number;  // 每个角色最少 actionable 数（默认 1）
  maxP0Issues: number;           // 最大 P0 问题数（默认 0）
  maxP1Issues: number;           // 最大 P1 问题数（默认 3）
  enableDoubtTheater: boolean;   // 启用 Doubt Theater 检测（默认 true）
  doubtTheaterCycles: number;    // Doubt Theater 周期阈值（默认 2）
}

// ── Quality Gate ──

export class PrdQualityGate {
  private config: QualityGateConfig;
  private scorer: PrdQualityScorer;
  private checklist: PrdQualityChecklist;
  private antiPatternDetector: PrdAntiPatternDetector;

  // Doubt Theater 追踪
  private reviewHistory: Array<{
    cycle: number;
    findings: ReviewFinding[];
    actionableCount: number;
  }> = [];

  constructor(config: Partial<QualityGateConfig> = {}) {
    this.config = {
      minScore: config.minScore ?? 75,
      minActionablePerRole: config.minActionablePerRole ?? 1,
      maxP0Issues: config.maxP0Issues ?? 0,
      maxP1Issues: config.maxP1Issues ?? 3,
      enableDoubtTheater: config.enableDoubtTheater ?? true,
      doubtTheaterCycles: config.doubtTheaterCycles ?? 2,
    };
    this.scorer = new PrdQualityScorer();
    this.checklist = new PrdQualityChecklist();
    this.antiPatternDetector = new PrdAntiPatternDetector();
  }

  /**
   * 运行质量门禁
   */
  evaluate(
    prd: PRD,
    multiRoleReview?: MultiRoleReviewResponse,
  ): QualityGateResult {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    // 1. 量化评分
    const qualityScore = this.scorer.score(prd);
    if (qualityScore.totalScore < this.config.minScore) {
      blockers.push(
        `质量评分 ${qualityScore.totalScore} 分，低于最低阈值 ${this.config.minScore} 分`,
      );
    }
    if (qualityScore.grade === 'D') {
      blockers.push(`质量等级 D（不通过），必须达到 B 级以上`);
    }

    // 2. 自查清单
    const checklist = this.checklist.run(prd);
    if (!checklist.passed) {
      blockers.push(
        `自查清单未通过：${checklist.summary.p0Failed} 个 P0 问题，${checklist.summary.p1Failed} 个 P1 问题`,
      );
      blockers.push(...checklist.blockers.slice(0, 5));
    }

    // 3. 反模式检测
    const antiPatterns = this.antiPatternDetector.detect(prd);
    if (antiPatterns.summary.p0 > 0) {
      blockers.push(`发现 ${antiPatterns.summary.p0} 个 P0 反模式`);
      antiPatterns.patterns
        .filter((p) => p.severity === 'P0')
        .slice(0, 3)
        .forEach((p) => blockers.push(`  - ${p.name}: ${p.description}`));
    }
    if (antiPatterns.summary.p1 > this.config.maxP1Issues) {
      warnings.push(`发现 ${antiPatterns.summary.p1} 个 P1 反模式（阈值 ${this.config.maxP1Issues}）`);
    }

    // 4. 多角色审查
    if (multiRoleReview) {
      // 4.1 检查每个角色的 actionable 数量
      const roleActionableCounts = this.countActionablePerRole(multiRoleReview.findings);
      for (const [role, count] of Object.entries(roleActionableCounts)) {
        if (count < this.config.minActionablePerRole) {
          warnings.push(
            `${role} 角色只有 ${count} 条 actionable 建议（最少 ${this.config.minActionablePerRole} 条）`,
          );
        }
      }

      // 4.2 检查 P0 问题
      const p0Findings = multiRoleReview.findings.filter(
        (f) => f.severity === 'P0' && !f.passed,
      );
      if (p0Findings.length > this.config.maxP0Issues) {
        blockers.push(
          `发现 ${p0Findings.length} 个 P0 问题（阈值 ${this.config.maxP0Issues}）`,
        );
        p0Findings.slice(0, 3).forEach((f) => {
          blockers.push(`  - [${f.role}] ${f.message}`);
        });
      }

      // 4.3 Doubt Theater 检测
      let doubtTheater: DoubtTheaterResult | undefined;
      if (this.config.enableDoubtTheater) {
        this.recordReviewCycle(multiRoleReview.findings);
        doubtTheater = this.detectDoubtTheater();
        if (doubtTheater.detected) {
          blockers.push(doubtTheater.description);
        }
      }

      // 4.4 多角色评分
      if (multiRoleReview.score < this.config.minScore) {
        blockers.push(
          `多角色审查评分 ${multiRoleReview.score} 分，低于最低阈值 ${this.config.minScore} 分`,
        );
      }
    }

    // 5. 生成改进建议
    recommendations.push(...qualityScore.recommendations);
    recommendations.push(...antiPatterns.recommendations);

    // 6. 最终判定
    const passed = blockers.length === 0;
    const score = qualityScore.totalScore;
    const grade = qualityScore.grade;

    return {
      passed,
      score,
      grade,
      blockers,
      warnings,
      recommendations,
      details: {
        qualityScore,
        checklist,
        antiPatterns,
        multiRoleReview,
        doubtTheater: this.config.enableDoubtTheater
          ? this.detectDoubtTheater()
          : undefined,
      },
    };
  }

  /**
   * 重置审查历史（新 PRD 评审时调用）
   */
  reset(): void {
    this.reviewHistory = [];
  }

  // ── Private Methods ──

  /**
   * 统计每个角色的 actionable 数量
   */
  private countActionablePerRole(
    findings: ReviewFinding[],
  ): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const finding of findings) {
      if (finding.actionable && !finding.passed) {
        counts[finding.role] = (counts[finding.role] || 0) + 1;
      }
    }
    return counts;
  }

  /**
   * 记录审查周期（用于 Doubt Theater 检测）
   */
  private recordReviewCycle(findings: ReviewFinding[]): void {
    const actionableCount = findings.filter(
      (f) => f.actionable && !f.passed,
    ).length;
    const substantialFindings = findings.filter(
      (f) => f.severity === 'P0' || f.severity === 'P1',
    ).length;

    this.reviewHistory.push({
      cycle: this.reviewHistory.length + 1,
      findings,
      actionableCount,
    });

    // 只保留最近 N 个周期
    if (this.reviewHistory.length > 5) {
      this.reviewHistory.shift();
    }
  }

  /**
   * Doubt Theater 检测
   *
   * 规则：≥2 周期 reviewer 出实质发现（P0/P1）但零 actionable → 升级用户
   *
   * 这意味着 reviewer 在挑刺但没有给出可执行的修复建议，
   * 属于「为批评而批评」的行为，需要人工介入。
   */
  private detectDoubtTheater(): DoubtTheaterResult {
    if (this.reviewHistory.length < this.config.doubtTheaterCycles) {
      return {
        detected: false,
        cycles: this.reviewHistory.length,
        description: '',
        action: 'continue',
      };
    }

    // 检查最近 N 个周期
    const recentCycles = this.reviewHistory.slice(
      -this.config.doubtTheaterCycles,
    );

    let suspiciousCycles = 0;
    for (const cycle of recentCycles) {
      const substantialFindings = cycle.findings.filter(
        (f) => f.severity === 'P0' || f.severity === 'P1',
      ).length;
      const actionableCount = cycle.actionableCount;

      // 有实质发现但零 actionable → 可疑
      if (substantialFindings >= 2 && actionableCount === 0) {
        suspiciousCycles++;
      }
    }

    // ≥2 个周期可疑 → 触发 Doubt Theater
    if (suspiciousCycles >= this.config.doubtTheaterCycles) {
      return {
        detected: true,
        cycles: suspiciousCycles,
        description: `Doubt Theater 检测：连续 ${suspiciousCycles} 个周期 reviewer 提出实质问题但无可执行建议，建议升级用户审查`,
        action: 'escalate',
      };
    }

    return {
      detected: false,
      cycles: this.reviewHistory.length,
      description: '',
      action: 'continue',
    };
  }
}

/**
 * 便捷函数：一次性运行质量门禁
 */
export function evaluatePrdQuality(
  prd: PRD,
  multiRoleReview?: MultiRoleReviewResponse,
  config?: Partial<QualityGateConfig>,
): QualityGateResult {
  const gate = new PrdQualityGate(config);
  return gate.evaluate(prd, multiRoleReview);
}
