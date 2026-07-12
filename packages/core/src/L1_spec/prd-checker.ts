import { type PRD, type Story, type AcceptanceCriteria } from '@azaloop/shared';

/**
 * PRD review dimensions — the 14 dimensions for comprehensive PRD review.
 */
export type ReviewDimension =
  | 'business_research'     // 业务调研
  | 'product_typing'         // 产品定型
  | 'product_positioning'    // 产品定位
  | 'scenario_analysis'      // 场景分析
  | 'document_structure'     // 文档结构
  | 'product_architecture'   // 产品架构
  | 'data_model'             // 数据模型
  | 'process_design'         // 流程设计
  | 'interaction_experience' // 交互体验
  | 'business_analysis'      // 商业分析
  | 'mvp_strategy'           // MVP策略
  | 'exception_handling'      // 异常处理
  | 'ai_features'            // AI功能
  | 'operations_plan';       // 运营计划

/**
 * Display names for the 14 review dimensions (Chinese).
 */
export const DIMENSION_NAMES: Record<ReviewDimension, string> = {
  business_research: '业务调研',
  product_typing: '产品定型',
  product_positioning: '产品定位',
  scenario_analysis: '场景分析',
  document_structure: '文档结构',
  product_architecture: '产品架构',
  data_model: '数据模型',
  process_design: '流程设计',
  interaction_experience: '交互体验',
  business_analysis: '商业分析',
  mvp_strategy: 'MVP策略',
  exception_handling: '异常处理',
  ai_features: 'AI功能',
  operations_plan: '运营计划',
};

/**
 * Priority severity levels (P0 = blocker, P3 = nice-to-have).
 */
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export interface PRDCheckResult {
  passed: boolean;
  score: number;
  total_checks: number;
  passed_checks: number;
  critical_issues: number;
  details: PRDCheckDetail[];
  /** Per-dimension breakdown of the review. */
  dimensionScores: DimensionScore[];
  /** Number of P0 issues (blockers). */
  p0_count: number;
  /** Number of P1 issues (should-fix). */
  p1_count: number;
  /** Number of P2 issues (nice-to-have). */
  p2_count: number;
  /** Number of P3 issues (optional). */
  p3_count: number;
}

export interface DimensionScore {
  dimension: ReviewDimension;
  dimension_name: string;
  score: number;
  passed: boolean;
  issue_count: number;
}

export interface PRDCheckDetail {
  id: string;
  category: string;
  dimension?: ReviewDimension;
  description: string;
  severity: Priority;
  passed: boolean;
  suggestion?: string;
}

/**
 * PRD Checker with 14-dimension review and P0-P3 priority grading.
 */
export class PRDChecker {
  /**
   * Run a comprehensive check on a PRD across all 14 dimensions.
   */
  check(prd: PRD): PRDCheckResult {
    const details: PRDCheckDetail[] = [];

    // Existing checks (backward compatible)
    details.push(...this.checkOverview(prd));
    details.push(...this.checkGoals(prd));
    details.push(...this.checkRequirements(prd));
    details.push(...this.checkStories(prd));
    details.push(...this.checkAcceptanceCriteria(prd));
    details.push(...this.checkArchitecture(prd));
    details.push(...this.checkRisks(prd));

    // New 14-dimension checks
    details.push(...this.checkBusinessResearch(prd));
    details.push(...this.checkProductTyping(prd));
    details.push(...this.checkProductPositioning(prd));
    details.push(...this.checkScenarioAnalysis(prd));
    details.push(...this.checkDocumentStructure(prd));
    details.push(...this.checkProductArchitecture(prd));
    details.push(...this.checkDataModel(prd));
    details.push(...this.checkProcessDesign(prd));
    details.push(...this.checkInteractionExperience(prd));
    details.push(...this.checkBusinessAnalysis(prd));
    details.push(...this.checkMVPStrategy(prd));
    details.push(...this.checkExceptionHandling(prd));
    details.push(...this.checkAIFeatures(prd));
    details.push(...this.checkOperationsPlan(prd));

    const criticalIssues = details.filter(d => d.severity === 'P0' && !d.passed).length;
    const p0Count = details.filter(d => d.severity === 'P0' && !d.passed).length;
    const p1Count = details.filter(d => d.severity === 'P1' && !d.passed).length;
    const p2Count = details.filter(d => d.severity === 'P2' && !d.passed).length;
    const p3Count = details.filter(d => d.severity === 'P3' && !d.passed).length;
    const passed = criticalIssues === 0;
    const passedChecks = details.filter(d => d.passed).length;

    // Build dimension scores
    const dimensionScores = this.buildDimensionScores(details);

    return {
      passed,
      score: Math.round((passedChecks / details.length) * 100),
      total_checks: details.length,
      passed_checks: passedChecks,
      critical_issues: criticalIssues,
      details,
      dimensionScores,
      p0_count: p0Count,
      p1_count: p1Count,
      p2_count: p2Count,
      p3_count: p3Count,
    };
  }

  /**
   * Get top improvement suggestions sorted by priority (P0 first).
   */
  getTopImprovements(result: PRDCheckResult, limit: number = 10): string[] {
    const priorityOrder: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return result.details
      .filter(d => !d.passed)
      .sort((a, b) => priorityOrder[a.severity] - priorityOrder[b.severity])
      .slice(0, limit)
      .map(d => `[${d.severity}] ${d.description}${d.suggestion ? ` — ${d.suggestion}` : ''}`);
  }

  /**
   * Get improvements for a specific dimension.
   */
  getImprovementsByDimension(result: PRDCheckResult, dimension: ReviewDimension): PRDCheckDetail[] {
    return result.details.filter(d => d.dimension === dimension && !d.passed);
  }

  /**
   * Build per-dimension scores from check details.
   */
  private buildDimensionScores(details: PRDCheckDetail[]): DimensionScore[] {
    const dimensions: ReviewDimension[] = [
      'business_research', 'product_typing', 'product_positioning', 'scenario_analysis',
      'document_structure', 'product_architecture', 'data_model', 'process_design',
      'interaction_experience', 'business_analysis', 'mvp_strategy', 'exception_handling',
      'ai_features', 'operations_plan',
    ];

    return dimensions.map(dim => {
      const dimDetails = details.filter(d => d.dimension === dim);
      const total = dimDetails.length;
      const passed = dimDetails.filter(d => d.passed).length;
      const issues = dimDetails.filter(d => !d.passed).length;
      const score = total > 0 ? Math.round((passed / total) * 100) : 100;

      return {
        dimension: dim,
        dimension_name: DIMENSION_NAMES[dim],
        score,
        passed: issues === 0,
        issue_count: issues,
      };
    });
  }

  // ===== Existing checks (backward compatible) =====

  private checkOverview(prd: PRD): PRDCheckDetail[] {
    return [{
      id: 'OV-001',
      category: 'overview',
      dimension: 'document_structure',
      description: 'PRD overview should be at least 50 characters',
      severity: 'P1',
      passed: prd.overview.length >= 50,
      suggestion: prd.overview.length < 50 ? 'Expand the overview with more detail' : undefined,
    }];
  }

  private checkGoals(prd: PRD): PRDCheckDetail[] {
    return [{
      id: 'GL-001',
      category: 'goals',
      dimension: 'product_positioning',
      description: 'PRD should have at least 1 defined goal',
      severity: 'P1',
      passed: prd.goals.length >= 1,
      suggestion: prd.goals.length === 0 ? 'Define at least one measurable project goal' : undefined,
    }];
  }

  private checkRequirements(prd: PRD): PRDCheckDetail[] {
    return [
      {
        id: 'FR-001',
        category: 'functional_requirements',
        dimension: 'product_architecture',
        description: 'PRD should have at least 1 functional requirement',
        severity: 'P0',
        passed: prd.functional_requirements.length >= 1,
        suggestion: prd.functional_requirements.length === 0 ? 'Add at least one functional requirement' : undefined,
      },
      {
        id: 'NFR-001',
        category: 'non_functional_requirements',
        dimension: 'product_architecture',
        description: 'PRD should have at least 1 non-functional requirement',
        severity: 'P1',
        passed: prd.non_functional_requirements.length >= 1,
        suggestion: prd.non_functional_requirements.length === 0 ? 'Add at least one non-functional requirement (performance, security, etc.)' : undefined,
      },
    ];
  }

  private checkStories(prd: PRD): PRDCheckDetail[] {
    const details: PRDCheckDetail[] = [{
      id: 'ST-001',
      category: 'stories',
      dimension: 'mvp_strategy',
      description: 'PRD should have at least 1 user story',
      severity: 'P0',
      passed: prd.stories.length >= 1,
      suggestion: prd.stories.length === 0 ? 'Break down requirements into user stories' : undefined,
    }];

    if (prd.stories.length > 0) {
      const p0Count = prd.stories.filter(s => s.priority === 'P0').length;
      details.push({
        id: 'ST-002',
        category: 'stories',
        dimension: 'mvp_strategy',
        description: 'At least 1 story should be P0 priority',
        severity: 'P2',
        passed: p0Count >= 1,
        suggestion: p0Count === 0 ? 'Mark at least one story as P0 (must-have)' : undefined,
      });

      const todoCount = prd.stories.filter(s => s.status === 'pending').length;
      details.push({
        id: 'ST-003',
        category: 'stories',
        dimension: 'mvp_strategy',
        description: 'All stories should be in valid states',
        severity: 'P1',
        passed: todoCount <= prd.stories.length,
      });
    }

    return details;
  }

  private checkAcceptanceCriteria(prd: PRD): PRDCheckDetail[] {
    const details: PRDCheckDetail[] = [];
    const allAcs = prd.stories.flatMap(s => s.acceptance_criteria);
    const totalAcs = prd.acceptance_criteria.length + allAcs.length;

    details.push({
      id: 'AC-001',
      category: 'acceptance_criteria',
      dimension: 'mvp_strategy',
      description: 'PRD should have at least 1 acceptance criterion',
      severity: 'P0',
      passed: totalAcs >= 1,
      suggestion: totalAcs === 0 ? 'Add acceptance criteria for verification' : undefined,
    });

    const untestable = allAcs.filter(a => !a.testable).length;
    details.push({
      id: 'AC-002',
      category: 'acceptance_criteria',
      dimension: 'mvp_strategy',
      description: 'All acceptance criteria should be testable',
      severity: 'P1',
      passed: untestable === 0,
      suggestion: untestable > 0 ? `Found ${untestable} untestable criteria — make them measurable` : undefined,
    });

    return details;
  }

  private checkArchitecture(prd: PRD): PRDCheckDetail[] {
    return [{
      id: 'AR-001',
      category: 'architecture',
      dimension: 'product_architecture',
      description: 'PRD should have at least 1 architecture diagram',
      severity: 'P2',
      passed: prd.architecture.length >= 1,
      suggestion: prd.architecture.length === 0 ? 'Add at least a system architecture diagram' : undefined,
    }];
  }

  private checkRisks(prd: PRD): PRDCheckDetail[] {
    const details: PRDCheckDetail[] = [{
      id: 'RK-001',
      category: 'risks',
      dimension: 'exception_handling',
      description: 'PRD should document at least 1 risk',
      severity: 'P2',
      passed: prd.risks.length >= 1,
      suggestion: prd.risks.length === 0 ? 'Document at least one project risk' : undefined,
    }];

    const highRisks = prd.risks.filter(r => r.probability === 'high');
    if (highRisks.length > 0) {
      const highWithoutMitigation = highRisks.filter(r => !r.mitigation).length;
      details.push({
        id: 'RK-002',
        category: 'risks',
        dimension: 'exception_handling',
        description: 'High-probability risks must have mitigation plans',
        severity: 'P0',
        passed: highWithoutMitigation === 0,
        suggestion: highWithoutMitigation > 0 ? `${highWithoutMitigation} high-risk items missing mitigation plans` : undefined,
      });
    }

    return details;
  }

  // ===== New 14-dimension checks =====

  /**
   * 1. 业务调研 — Check if business research context is present.
   */
  private checkBusinessResearch(prd: PRD): PRDCheckDetail[] {
    return [{
      id: 'BR-001',
      category: 'business_research',
      dimension: 'business_research',
      description: 'PRD should include business background (industry analysis, pain points)',
      severity: 'P1',
      passed: prd.overview.length >= 100 && /pain|痛点|问题|problem|background|背景|行业/i.test(prd.overview),
      suggestion: 'Add industry analysis and pain point description to the overview',
    }];
  }

  /**
   * 2. 产品定型 — Check if product type is clearly defined.
   */
  private checkProductTyping(prd: PRD): PRDCheckDetail[] {
    return [{
      id: 'PT-001',
      category: 'product_typing',
      dimension: 'product_typing',
      description: 'PRD should clearly define product type (business/tool/transaction/infrastructure)',
      severity: 'P1',
      passed: prd.target_users.length > 0 && prd.functional_requirements.length > 0,
      suggestion: 'Define target users and functional requirements to clarify product type',
    }];
  }

  /**
   * 3. 产品定位 — Check if product positioning is clear.
   */
  private checkProductPositioning(prd: PRD): PRDCheckDetail[] {
    const details: PRDCheckDetail[] = [{
      id: 'PP-001',
      category: 'product_positioning',
      dimension: 'product_positioning',
      description: 'PRD should have clear product positioning (goals + target users)',
      severity: 'P1',
      passed: prd.goals.length >= 1 && prd.target_users.length >= 1,
      suggestion: 'Define both goals and target users for clear positioning',
    }];

    details.push({
      id: 'PP-002',
      category: 'product_positioning',
      dimension: 'product_positioning',
      description: 'Target users should be specific (not just "End Users")',
      severity: 'P2',
      passed: prd.target_users.some(u => u !== 'End Users' && u.length > 3),
      suggestion: 'Specify concrete user roles (e.g., "Operations Team", "API Developers")',
    });

    return details;
  }

  /**
   * 4. 场景分析 — Check if usage scenarios are documented.
   */
  private checkScenarioAnalysis(prd: PRD): PRDCheckDetail[] {
    return [{
      id: 'SA-001',
      category: 'scenario_analysis',
      dimension: 'scenario_analysis',
      description: 'PRD should describe usage scenarios (in goals or stories)',
      severity: 'P1',
      passed: prd.stories.length >= 1 && prd.stories.some(s => s.description.length > 20),
      suggestion: 'Add detailed scenario descriptions to user stories',
    }];
  }

  /**
   * 5. 文档结构 — Check overall document structure quality.
   */
  private checkDocumentStructure(prd: PRD): PRDCheckDetail[] {
    return [{
      id: 'DS-001',
      category: 'document_structure',
      dimension: 'document_structure',
      description: 'PRD should have a descriptive title (at least 5 characters)',
      severity: 'P2',
      passed: prd.title.length >= 5,
      suggestion: prd.title.length < 5 ? 'Use a more descriptive title' : undefined,
    }];
  }

  /**
   * 6. 产品架构 — Check if architecture is well-defined.
   */
  private checkProductArchitecture(prd: PRD): PRDCheckDetail[] {
    const details: PRDCheckDetail[] = [{
      id: 'PA-001',
      category: 'product_architecture',
      dimension: 'product_architecture',
      description: 'PRD should have architecture with mermaid diagrams',
      severity: 'P1',
      passed: prd.architecture.length >= 1 && prd.architecture.some(a => a.mermaid.length > 0),
      suggestion: 'Add Mermaid architecture diagrams',
    }];

    const hasSystemArch = prd.architecture.some(a => a.type === 'system');
    details.push({
      id: 'PA-002',
      category: 'product_architecture',
      dimension: 'product_architecture',
      description: 'PRD should include a system-level architecture diagram',
      severity: 'P2',
      passed: hasSystemArch,
      suggestion: hasSystemArch ? undefined : 'Add a system-type architecture diagram',
    });

    return details;
  }

  /**
   * 7. 数据模型 — Check if data model is considered.
   */
  private checkDataModel(prd: PRD): PRDCheckDetail[] {
    const hasDataArch = prd.architecture.some(a => a.type === 'data');
    return [{
      id: 'DM-001',
      category: 'data_model',
      dimension: 'data_model',
      description: 'PRD should include a data model (ER diagram or data architecture)',
      severity: 'P2',
      passed: hasDataArch,
      suggestion: hasDataArch ? undefined : 'Add a data-type architecture diagram (ER model)',
    }];
  }

  /**
   * 8. 流程设计 — Check if process flow is documented.
   */
  private checkProcessDesign(prd: PRD): PRDCheckDetail[] {
    const hasFlow = prd.architecture.some(a => a.type === 'flow' || a.type === 'sequence');
    return [{
      id: 'PD-001',
      category: 'process_design',
      dimension: 'process_design',
      description: 'PRD should include process flow diagrams (flowchart or sequence)',
      severity: 'P2',
      passed: hasFlow,
      suggestion: hasFlow ? undefined : 'Add flow-type or sequence-type architecture diagrams',
    }];
  }

  /**
   * 9. 交互体验 — Check if UX considerations are present.
   */
  private checkInteractionExperience(prd: PRD): PRDCheckDetail[] {
    const hasUsability = prd.non_functional_requirements.some(nfr => nfr.category === 'usability');
    return [{
      id: 'IE-001',
      category: 'interaction_experience',
      dimension: 'interaction_experience',
      description: 'PRD should include usability requirements',
      severity: 'P2',
      passed: hasUsability,
      suggestion: hasUsability ? undefined : 'Add usability-related non-functional requirements',
    }];
  }

  /**
   * 10. 商业分析 — Check if business analysis is present.
   */
  private checkBusinessAnalysis(prd: PRD): PRDCheckDetail[] {
    const hasRevenueHints = /revenue|monetiz|subscription|pricing|盈利|订阅|付费|商业/i.test(prd.overview + prd.goals.join(' '));
    return [{
      id: 'BA-001',
      category: 'business_analysis',
      dimension: 'business_analysis',
      description: 'PRD should include commercial analysis (revenue model, market positioning)',
      severity: 'P3',
      passed: hasRevenueHints || prd.goals.length >= 2,
      suggestion: 'Add revenue model and market positioning to the PRD',
    }];
  }

  /**
   * 11. MVP策略 — Check MVP strategy.
   */
  private checkMVPStrategy(prd: PRD): PRDCheckDetail[] {
    const p0Stories = prd.stories.filter(s => s.priority === 'P0');
    return [{
      id: 'MS-001',
      category: 'mvp_strategy',
      dimension: 'mvp_strategy',
      description: 'MVP should have at most 3 P0 stories (constitutional rule CONST-003)',
      severity: 'P1',
      passed: p0Stories.length <= 3,
      suggestion: p0Stories.length > 3 ? `Found ${p0Stories.length} P0 stories — reduce to 3 for MVP` : undefined,
    }];
  }

  /**
   * 12. 异常处理 — Check exception handling considerations.
   */
  private checkExceptionHandling(prd: PRD): PRDCheckDetail[] {
    const hasErrorHandling = /error|fail|exception|error|异常|失败|fallback|重试/i.test(prd.overview);
    const hasReliabilityNfr = prd.non_functional_requirements.some(nfr => nfr.category === 'reliability');
    return [{
      id: 'EH-001',
      category: 'exception_handling',
      dimension: 'exception_handling',
      description: 'PRD should consider exception handling and reliability',
      severity: 'P2',
      passed: hasErrorHandling || hasReliabilityNfr,
      suggestion: 'Add exception handling scenarios and reliability requirements',
    }];
  }

  /**
   * 13. AI功能 — Check AI feature considerations.
   */
  private checkAIFeatures(prd: PRD): PRDCheckDetail[] {
    const hasAIFeatures = /ai|ml|model|llm|gpt|人工智能|模型|大模型/i.test(prd.overview + prd.goals.join(' '));
    // Only check if AI-related, otherwise pass (not all products need AI)
    return [{
      id: 'AF-001',
      category: 'ai_features',
      dimension: 'ai_features',
      description: 'If AI features are present, document model selection and data requirements',
      severity: 'P3',
      passed: !hasAIFeatures || (hasAIFeatures && prd.non_functional_requirements.length >= 1),
      suggestion: hasAIFeatures ? 'Document AI model selection, training data, and inference requirements' : undefined,
    }];
  }

  /**
   * 14. 运营计划 — Check operations plan.
   */
  private checkOperationsPlan(prd: PRD): PRDCheckDetail[] {
    const hasOpsHints = /deploy|monitor|launch|运维|上线|监控|运营|发布/i.test(prd.overview);
    return [{
      id: 'OP-001',
      category: 'operations_plan',
      dimension: 'operations_plan',
      description: 'PRD should include deployment and monitoring considerations',
      severity: 'P3',
      passed: hasOpsHints,
      suggestion: 'Add deployment plan, monitoring metrics, and launch strategy',
    }];
  }
}
