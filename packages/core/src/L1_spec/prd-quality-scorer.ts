/**
 * PRD 量化评分体系（V21 新增）
 * 
 * 借鉴需求评审智能体的 4 维度量化评分方法：
 * 1. 规范完整性（30分）：核心要素完整率、术语合规率
 * 2. 业务清晰度（35分）：歧义点占比、边界条件覆盖率
 * 3. 风险可识别性（20分）：风险场景明确度、异常流程定义
 * 4. 可测试/可落地性（15分）：验收标准明确度、非歧义需求占比
 * 
 * 总分 100 分，分级标准：
 * - ≥90分：A级（直接通过）
 * - 75-89分：B级（minor修改）
 * - 60-74分：C级（需重大调整）
 * - <60分：D级（不通过，打回重写）
 */

import type { PRD, Story, AcceptanceCriteria } from '@azaloop/shared';

export interface PrdQualityScore {
  totalScore: number;
  grade: 'A' | 'B' | 'C' | 'D';
  dimensions: {
    completeness: DimensionScore;      // 规范完整性（30分）
    clarity: DimensionScore;           // 业务清晰度（35分）
    riskIdentification: DimensionScore; // 风险可识别性（20分）
    testability: DimensionScore;       // 可测试/可落地性（15分）
  };
  issues: QualityIssue[];
  recommendations: string[];
}

export interface DimensionScore {
  score: number;
  maxScore: number;
  percentage: number;
  details: string[];
}

export interface QualityIssue {
  dimension: 'completeness' | 'clarity' | 'riskIdentification' | 'testability';
  severity: 'P0' | 'P1' | 'P2';
  description: string;
  suggestion: string;
}

/**
 * PRD 质量评分器
 */
export class PrdQualityScorer {
  /**
   * 对 PRD 进行量化评分
   */
  score(prd: PRD): PrdQualityScore {
    const completeness = this.scoreCompleteness(prd);
    const clarity = this.scoreClarity(prd);
    const riskIdentification = this.scoreRiskIdentification(prd);
    const testability = this.scoreTestability(prd);

    const totalScore = 
      completeness.score + 
      clarity.score + 
      riskIdentification.score + 
      testability.score;

    const grade = this.calculateGrade(totalScore);
    const issues = this.collectIssues(prd, completeness, clarity, riskIdentification, testability);
    const recommendations = this.generateRecommendations(issues);

    return {
      totalScore,
      grade,
      dimensions: {
        completeness,
        clarity,
        riskIdentification,
        testability,
      },
      issues,
      recommendations,
    };
  }

  /**
   * 维度1：规范完整性（30分）
   * 
   * 检查项：
   * - 核心要素完整率（15分）：overview, goals, stories, AC, architecture, risks
   * - 术语合规率（10分）：无歧义术语、无未定义缩写
   * - 模板符合度（5分）：符合 PRD Schema 结构
   */
  private scoreCompleteness(prd: PRD): DimensionScore {
    const details: string[] = [];
    let score = 0;
    const maxScore = 30;

    // 核心要素完整率（15分）
    const coreElements = [
      { name: 'overview', present: !!prd.overview && prd.overview.length >= 100 },
      { name: 'goals', present: !!prd.goals && prd.goals.length >= 2 },
      { name: 'target_users', present: !!prd.target_users && prd.target_users.length >= 1 },
      { name: 'functional_requirements', present: !!prd.functional_requirements && prd.functional_requirements.length >= 2 },
      { name: 'stories', present: !!prd.stories && prd.stories.length >= 1 },
      { name: 'acceptance_criteria', present: !!prd.acceptance_criteria && prd.acceptance_criteria.length >= 1 },
      { name: 'architecture', present: !!prd.architecture && prd.architecture.length >= 1 },
      { name: 'risks', present: !!prd.risks && prd.risks.length >= 1 },
    ];

    const presentCount = coreElements.filter(e => e.present).length;
    const completenessRatio = presentCount / coreElements.length;
    const coreScore = Math.round(completenessRatio * 15);
    score += coreScore;

    if (completenessRatio < 1) {
      const missing = coreElements.filter(e => !e.present).map(e => e.name);
      details.push(`缺少核心要素：${missing.join(', ')}（-${15 - coreScore}分）`);
    } else {
      details.push(`✓ 核心要素完整（15/15分）`);
    }

    // 术语合规率（10分）
    const terminologyIssues = this.checkTerminology(prd);
    const terminologyScore = Math.max(0, 10 - terminologyIssues.length * 2);
    score += terminologyScore;

    if (terminologyIssues.length > 0) {
      details.push(`发现 ${terminologyIssues.length} 个术语问题（-${10 - terminologyScore}分）：${terminologyIssues.slice(0, 3).join(', ')}`);
    } else {
      details.push(`✓ 术语使用规范（10/10分）`);
    }

    // 模板符合度（5分）
    const schemaCompliant = this.checkSchemaCompliance(prd);
    const schemaScore = schemaCompliant ? 5 : 0;
    score += schemaScore;

    if (!schemaCompliant) {
      details.push(`PRD 结构不符合 Schema 规范（-5分）`);
    } else {
      details.push(`✓ 符合 Schema 规范（5/5分）`);
    }

    return {
      score,
      maxScore,
      percentage: Math.round((score / maxScore) * 100),
      details,
    };
  }

  /**
   * 维度2：业务清晰度（35分）
   * 
   * 检查项：
   * - 歧义点占比（15分）：无模糊表述
   * - 边界条件覆盖率（10分）：每个 story 都有边界条件
   * - 关联模块明确率（10分）：依赖关系清晰
   */
  private scoreClarity(prd: PRD): DimensionScore {
    const details: string[] = [];
    let score = 0;
    const maxScore = 35;

    // 歧义点占比（15分）
    const ambiguousPhrases = [
      '尽量', '必要时', '体验更好', '优化', '改进',
      '尽可能', '适当', '合理', '快速', '高效',
      'as soon as possible', 'better', 'optimize', 'improve',
    ];

    const prdText = JSON.stringify(prd, null, 2).toLowerCase();
    const ambiguityCount = ambiguousPhrases.filter(phrase => 
      prdText.includes(phrase.toLowerCase())
    ).length;

    const ambiguityScore = Math.max(0, 15 - ambiguityCount * 3);
    score += ambiguityScore;

    if (ambiguityCount > 0) {
      details.push(`发现 ${ambiguityCount} 处模糊表述（-${15 - ambiguityScore}分）`);
    } else {
      details.push(`✓ 无模糊表述（15/15分）`);
    }

    // 边界条件覆盖率（10分）
    const storiesWithBoundaries = prd.stories.filter(story => 
      this.hasBoundaryConditions(story)
    );
    const boundaryRatio = prd.stories.length > 0 
      ? storiesWithBoundaries.length / prd.stories.length 
      : 0;
    const boundaryScore = Math.round(boundaryRatio * 10);
    score += boundaryScore;

    if (boundaryRatio < 1) {
      details.push(`${Math.round((1 - boundaryRatio) * 100)}% 的 story 缺少边界条件（-${10 - boundaryScore}分）`);
    } else {
      details.push(`✓ 所有 story 都有边界条件（10/10分）`);
    }

    // 关联模块明确率（10分）
    const storiesWithDependencies = prd.stories.filter(story => 
      story.dependencies && story.dependencies.length > 0
    );
    const dependencyRatio = prd.stories.length > 0
      ? storiesWithDependencies.length / prd.stories.length
      : 0;
    const dependencyScore = Math.round(dependencyRatio * 10);
    score += dependencyScore;

    if (dependencyRatio < 0.5 && prd.stories.length > 1) {
      details.push(`${Math.round((1 - dependencyRatio) * 100)}% 的 story 未明确依赖关系（-${10 - dependencyScore}分）`);
    } else {
      details.push(`✓ 依赖关系清晰（10/10分）`);
    }

    return {
      score,
      maxScore,
      percentage: Math.round((score / maxScore) * 100),
      details,
    };
  }

  /**
   * 维度3：风险可识别性（20分）
   * 
   * 检查项：
   * - 风险场景明确度（10分）：每个风险都有 mitigation
   * - 异常流程定义（10分）：story 中包含异常处理
   */
  private scoreRiskIdentification(prd: PRD): DimensionScore {
    const details: string[] = [];
    let score = 0;
    const maxScore = 20;

    // 风险场景明确度（10分）
    const risksWithMitigation = prd.risks.filter(risk => 
      risk.mitigation && risk.mitigation.length > 10
    );
    const mitigationRatio = prd.risks.length > 0
      ? risksWithMitigation.length / prd.risks.length
      : 0;
    const riskScore = Math.round(mitigationRatio * 10);
    score += riskScore;

    if (mitigationRatio < 1 && prd.risks.length > 0) {
      details.push(`${prd.risks.length - risksWithMitigation.length} 个风险缺少缓解措施（-${10 - riskScore}分）`);
    } else if (prd.risks.length === 0) {
      details.push(`未识别任何风险（-10分）`);
      score = 0;
    } else {
      details.push(`✓ 所有风险都有缓解措施（10/10分）`);
    }

    // 异常流程定义（10分）
    const storiesWithExceptionHandling = prd.stories.filter(story => 
      this.hasExceptionHandling(story)
    );
    const exceptionRatio = prd.stories.length > 0
      ? storiesWithExceptionHandling.length / prd.stories.length
      : 0;
    const exceptionScore = Math.round(exceptionRatio * 10);
    score += exceptionScore;

    if (exceptionRatio < 1) {
      details.push(`${Math.round((1 - exceptionRatio) * 100)}% 的 story 缺少异常处理（-${10 - exceptionScore}分）`);
    } else {
      details.push(`✓ 所有 story 都有异常处理（10/10分）`);
    }

    return {
      score,
      maxScore,
      percentage: Math.round((score / maxScore) * 100),
      details,
    };
  }

  /**
   * 维度4：可测试/可落地性（15分）
   * 
   * 检查项：
   * - 验收标准明确度（10分）：AC 可测试、无歧义
   * - 非歧义需求占比（5分）：需求描述清晰
   */
  private scoreTestability(prd: PRD): DimensionScore {
    const details: string[] = [];
    let score = 0;
    const maxScore = 15;

    // 验收标准明确度（10分）
    const allACs = [
      ...prd.acceptance_criteria,
      ...prd.stories.flatMap(s => s.acceptance_criteria || []),
    ];

    const testableACs = allACs.filter(ac => this.isTestableAC(ac));
    const testableRatio = allACs.length > 0
      ? testableACs.length / allACs.length
      : 0;
    const acScore = Math.round(testableRatio * 10);
    score += acScore;

    if (testableRatio < 1) {
      details.push(`${allACs.length - testableACs.length} 条 AC 不可测试（-${10 - acScore}分）`);
    } else {
      details.push(`✓ 所有 AC 都可测试（10/10分）`);
    }

    // 非歧义需求占比（5分）
    const clearRequirements = prd.functional_requirements.filter(fr => 
      this.isClearRequirement(fr.description)
    );
    const clearRatio = prd.functional_requirements.length > 0
      ? clearRequirements.length / prd.functional_requirements.length
      : 0;
    const clearScore = Math.round(clearRatio * 5);
    score += clearScore;

    if (clearRatio < 1) {
      details.push(`${prd.functional_requirements.length - clearRequirements.length} 条需求描述不清晰（-${5 - clearScore}分）`);
    } else {
      details.push(`✓ 所有需求描述清晰（5/5分）`);
    }

    return {
      score,
      maxScore,
      percentage: Math.round((score / maxScore) * 100),
      details,
    };
  }

  /**
   * 检查术语问题
   */
  private checkTerminology(prd: PRD): string[] {
    const issues: string[] = [];
    const prdText = JSON.stringify(prd);

    // 检查未定义缩写
    const undefinedAbbreviations = ['API', 'SDK', 'UI', 'UX', 'SLA', 'KPI'];
    for (const abbr of undefinedAbbreviations) {
      if (prdText.includes(abbr) && !prdText.includes(`${abbr}（`)) {
        issues.push(`未定义缩写：${abbr}`);
      }
    }

    // 检查歧义术语
    const ambiguousTerms = ['用户', '系统', '数据', '功能'];
    for (const term of ambiguousTerms) {
      const regex = new RegExp(`${term}[^a-zA-Z]`, 'g');
      const matches = prdText.match(regex);
      if (matches && matches.length > 5) {
        issues.push(`术语「${term}」使用过于频繁且未明确定义`);
      }
    }

    return issues;
  }

  /**
   * 检查 Schema 符合度
   */
  private checkSchemaCompliance(prd: PRD): boolean {
    return !!(
      prd.id &&
      prd.title &&
      prd.version &&
      prd.created_at &&
      prd.overview &&
      prd.goals &&
      prd.stories
    );
  }

  /**
   * 检查 story 是否有边界条件
   */
  private hasBoundaryConditions(story: Story): boolean {
    const acText = (story.acceptance_criteria || [])
      .map(ac => ac.description)
      .join(' ')
      .toLowerCase();

    const boundaryKeywords = [
      '边界', '极限', '最大', '最小', '超过', '不足',
      'boundary', 'limit', 'maximum', 'minimum', 'exceed', 'less than',
    ];

    return boundaryKeywords.some(keyword => acText.includes(keyword));
  }

  /**
   * 检查 story 是否有异常处理
   */
  private hasExceptionHandling(story: Story): boolean {
    const acText = (story.acceptance_criteria || [])
      .map(ac => ac.description)
      .join(' ')
      .toLowerCase();

    const exceptionKeywords = [
      '失败', '错误', '异常', '超时', '网络', '断开',
      'fail', 'error', 'exception', 'timeout', 'network', 'disconnect',
    ];

    return exceptionKeywords.some(keyword => acText.includes(keyword));
  }

  /**
   * 检查 AC 是否可测试
   */
  private isTestableAC(ac: AcceptanceCriteria): boolean {
    const description = ac.description.toLowerCase();

    // 不可测试的模式
    const untestablePatterns = [
      /系统应该.*安全/,
      /用户体验.*好/,
      /性能.*优化/,
      /尽量/,
      /必要时/,
      /system should be.*secure/,
      /user experience.*good/,
      /performance.*optimized/,
    ];

    return !untestablePatterns.some(pattern => pattern.test(description));
  }

  /**
   * 检查需求描述是否清晰
   */
  private isClearRequirement(description: string): boolean {
    const lowerDesc = description.toLowerCase();

    // 模糊表述
    const vaguePatterns = [
      /实现.*功能/,
      /提供.*服务/,
      /支持.*操作/,
      /implement.*feature/,
      /provide.*service/,
      /support.*operation/,
    ];

    return !vaguePatterns.some(pattern => pattern.test(lowerDesc));
  }

  /**
   * 计算等级
   */
  private calculateGrade(totalScore: number): 'A' | 'B' | 'C' | 'D' {
    if (totalScore >= 90) return 'A';
    if (totalScore >= 75) return 'B';
    if (totalScore >= 60) return 'C';
    return 'D';
  }

  /**
   * 收集质量问题
   */
  private collectIssues(
    prd: PRD,
    completeness: DimensionScore,
    clarity: DimensionScore,
    riskIdentification: DimensionScore,
    testability: DimensionScore,
  ): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 完整性问题
    if (completeness.percentage < 80) {
      issues.push({
        dimension: 'completeness',
        severity: completeness.percentage < 60 ? 'P0' : 'P1',
        description: `规范完整性不足（${completeness.percentage}%）`,
        suggestion: '补充缺失的核心要素：overview, goals, stories, AC, architecture, risks',
      });
    }

    // 清晰度问题
    if (clarity.percentage < 80) {
      issues.push({
        dimension: 'clarity',
        severity: clarity.percentage < 60 ? 'P0' : 'P1',
        description: `业务清晰度不足（${clarity.percentage}%）`,
        suggestion: '消除模糊表述，补充边界条件和依赖关系',
      });
    }

    // 风险识别问题
    if (riskIdentification.percentage < 80) {
      issues.push({
        dimension: 'riskIdentification',
        severity: riskIdentification.percentage < 60 ? 'P0' : 'P1',
        description: `风险识别不足（${riskIdentification.percentage}%）`,
        suggestion: '为每个风险添加缓解措施，在 story 中补充异常处理',
      });
    }

    // 可测试性问题
    if (testability.percentage < 80) {
      issues.push({
        dimension: 'testability',
        severity: testability.percentage < 60 ? 'P0' : 'P1',
        description: `可测试性不足（${testability.percentage}%）`,
        suggestion: '确保所有 AC 都可测试，需求描述清晰无歧义',
      });
    }

    return issues;
  }

  /**
   * 生成改进建议
   */
  private generateRecommendations(issues: QualityIssue[]): string[] {
    const recommendations: string[] = [];

    const p0Issues = issues.filter(i => i.severity === 'P0');
    const p1Issues = issues.filter(i => i.severity === 'P1');

    if (p0Issues.length > 0) {
      recommendations.push(`【紧急】发现 ${p0Issues.length} 个 P0 问题，必须立即修复：`);
      p0Issues.forEach((issue, idx) => {
        recommendations.push(`  ${idx + 1}. ${issue.description}：${issue.suggestion}`);
      });
    }

    if (p1Issues.length > 0) {
      recommendations.push(`【重要】发现 ${p1Issues.length} 个 P1 问题，建议修复：`);
      p1Issues.forEach((issue, idx) => {
        recommendations.push(`  ${idx + 1}. ${issue.description}：${issue.suggestion}`);
      });
    }

    if (issues.length === 0) {
      recommendations.push('✓ PRD 质量优秀，可以直接进入下一阶段');
    }

    return recommendations;
  }
}
