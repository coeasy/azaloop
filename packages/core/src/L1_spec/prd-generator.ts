import { PRDSchema, type PRD, type Story } from '@azaloop/shared';
import { PRDChecker, type PRDCheckResult } from './prd-checker';

/**
 * PRD complexity levels matching the complexity matrix.
 * - L1: 配置级 (configuration-level)
 * - L2: 规则级 (rule-level)
 * - L3: 模块级 (module-level)
 * - L4: 系统级 (system-level)
 */
export type Complexity = 'L1' | 'L2' | 'L3' | 'L4';

/**
 * Product commercialization type.
 * - commercial: 商业化产品 (external-facing, revenue-generating)
 * - internal: 自研产品 (internal tooling, cost-optimizing)
 */
export type CommercializationType = 'commercial' | 'internal';

/**
 * Product category type.
 * - business: 业务型 (domain-driven, user-facing workflows)
 * - tool: 工具型 (productivity, utility-focused)
 * - transaction: 交易型 (payment, e-commerce, financial)
 * - infrastructure: 基础服务型 (platform, middleware, API services)
 */
export type ProductCategory = 'business' | 'tool' | 'transaction' | 'infrastructure';

/**
 * Full product type combining commercialization and category.
 */
export interface ProductType {
  commercialization: CommercializationType;
  category: ProductCategory;
  label: string;
}

/**
 * PRD generation input with extended metadata.
 */
export interface PRDGenerationInput {
  title: string;
  description: string;
  constraints?: string[];
  complexity?: Complexity;
  productType?: ProductType;
}

/**
 * PRD generator options with 14-chapter and self-optimization support.
 */
export interface PRDGeneratorOptions {
  auto_stories?: boolean;
  auto_architecture?: boolean;
  complexity?: Complexity;
  /** Enable 14-chapter template generation (L4 only by default). */
  enable_14chapters?: boolean;
  /** Enable multi-round self-optimization (generate → check → fix P0 → repeat). */
  enable_self_optimization?: boolean;
  /** Maximum optimization rounds (default: 3). */
  max_optimization_rounds?: number;
  /** Product type override (auto-detected if not provided). */
  productType?: ProductType;
}

/**
 * Result of multi-round self-optimization.
 */
export interface SelfOptimizationResult {
  /** Final PRD after optimization. */
  prd: PRD;
  /** Number of rounds executed. */
  rounds: number;
  /** Issues fixed per round. */
  fixesPerRound: number[];
  /** Final check result. */
  finalCheck: PRDCheckResult;
  /** Whether P0 issues reached zero. */
  p0Cleared: boolean;
}

/**
 * Extended PRD with 14-chapter metadata.
 */
export interface PRDWithMetadata extends PRD {
  /** Detected or specified complexity level. */
  _complexity?: Complexity;
  /** Detected or specified product type. */
  _productType?: ProductType;
  /** Whether 14-chapter template was used. */
  _uses14Chapters?: boolean;
}

/**
 * PRD Generator with 14-chapter template support, complexity grading,
 * product type detection, and multi-round self-optimization.
 */
export class PRDGenerator {
  private checker: PRDChecker;

  constructor() {
    this.checker = new PRDChecker();
  }

  /**
   * Generate a PRD from natural language input.
   */
  generate(input: PRDGenerationInput, options: PRDGeneratorOptions = {}): PRD {
    const now = new Date().toISOString();
    const complexity = options.complexity || input.complexity || this.inferComplexity(input.description);
    const productType = options.productType || input.productType || this.detectProductType(input.title, input.description);
    const use14Chapters = options.enable_14chapters ?? (complexity === 'L4');

    const prd: PRD = {
      id: `PRD-${Date.now()}`,
      title: input.title,
      version: '1.0.0',
      created_at: now,
      updated_at: now,
      overview: input.description,
      goals: this.extractGoals(input.description),
      target_users: this.extractTargetUsers(input.description, productType),
      functional_requirements: this.extractFunctionalRequirements(input.description),
      non_functional_requirements: this.extractNonFunctionalRequirements(input.description),
      stories: options.auto_stories !== false ? this.generateStories(input.title, input.description, complexity) : [],
      architecture: options.auto_architecture !== false ? this.generateArchitecture(complexity, productType) : [],
      acceptance_criteria: [],
      risks: this.assessRisks(input.description, input.constraints || [], complexity, productType),
    };

    const parsed = PRDSchema.parse(prd);

    // If self-optimization is enabled, run multi-round optimization
    if (options.enable_self_optimization) {
      const result = this.selfOptimize(parsed, options.max_optimization_rounds ?? 3);
      return this.attachMetadata(result.prd, complexity, productType, use14Chapters);
    }

    return this.attachMetadata(parsed, complexity, productType, use14Chapters);
  }

  /**
   * Validate a PRD object against the schema.
   */
  validate(prd: unknown): PRD {
    return PRDSchema.parse(prd);
  }

  /**
   * Reflect and refine a PRD (existing functionality — kept for backward compatibility).
   */
  async reflectRefine(prd: PRD): Promise<{ prd: PRD; improvements: string[] }> {
    const improvements: string[] = [];
    const refined = { ...prd };

    if (refined.stories.length === 0) {
      improvements.push('No stories defined — auto-generating');
      refined.stories = this.generateStories(refined.title, refined.overview, 'L2');
    }

    if (refined.acceptance_criteria.length === 0) {
      improvements.push('No acceptance criteria defined');
    }

    const untestable = refined.acceptance_criteria.filter(a => !a.testable);
    if (untestable.length > 0) {
      improvements.push(`Found ${untestable.length} acceptance criteria that are not testable`);
    }

    refined.updated_at = new Date().toISOString();
    return { prd: PRDSchema.parse(refined), improvements };
  }

  /**
   * Multi-round self-optimization: generate → self-check → fix P0 issues → repeat until P0=0.
   *
   * @param prd - Initial PRD to optimize.
   * @param maxRounds - Maximum optimization rounds (default: 3).
   * @returns Optimization result with round-by-round fix counts.
   */
  selfOptimize(prd: PRD, maxRounds: number = 3): SelfOptimizationResult {
    let current = { ...prd };
    const fixesPerRound: number[] = [];
    let lastCheck = this.checker.check(current);
    let rounds = 0;

    for (let round = 0; round < maxRounds; round++) {
      const p0Issues = lastCheck.details.filter(d => d.severity === 'P0' && !d.passed);

      if (p0Issues.length === 0) {
        break; // P0 cleared
      }

      rounds++;
      let fixes = 0;

      // Fix each P0 issue
      for (const issue of p0Issues) {
        const fixed = this.fixP0Issue(current, issue);
        if (fixed) {
          current = fixed;
          fixes++;
        }
      }

      fixesPerRound.push(fixes);
      lastCheck = this.checker.check(current);
    }

    const p0Cleared = lastCheck.details.filter(d => d.severity === 'P0' && !d.passed).length === 0;

    return {
      prd: current,
      rounds,
      fixesPerRound,
      finalCheck: lastCheck,
      p0Cleared,
    };
  }

  /**
   * Fix a single P0 issue in the PRD.
   * Returns the fixed PRD, or null if the issue cannot be auto-fixed.
   */
  private fixP0Issue(prd: PRD, issue: { id: string; category: string; description: string }): PRD | null {
    const fixed = { ...prd, stories: [...prd.stories], acceptance_criteria: [...prd.acceptance_criteria], functional_requirements: [...prd.functional_requirements], non_functional_requirements: [...prd.non_functional_requirements] };

    // Fix missing functional requirements
    if (issue.id === 'FR-001' || issue.category === 'functional_requirements') {
      if (fixed.functional_requirements.length === 0) {
        fixed.functional_requirements.push({
          id: 'FR-1',
          description: `Core functionality: ${prd.title}`,
          priority: 'P0',
        });
        return fixed;
      }
    }

    // Fix missing stories
    if (issue.id === 'ST-001' || issue.category === 'stories') {
      if (fixed.stories.length === 0) {
        fixed.stories = this.generateStories(prd.title, prd.overview, 'L2');
        return fixed;
      }
    }

    // Fix missing acceptance criteria
    if (issue.id === 'AC-001' || issue.category === 'acceptance_criteria') {
      if (fixed.acceptance_criteria.length === 0 && fixed.stories.length > 0) {
        const firstStory = fixed.stories[0];
        if (firstStory) {
          fixed.acceptance_criteria.push({
            id: 'AC-1',
            description: `${firstStory.title} works as expected`,
            testable: true,
            status: 'pending',
          });
        }
        return fixed;
      }
    }

    // Fix high-risk items missing mitigation
    if (issue.id === 'RK-002') {
      fixed.risks = fixed.risks.map(r => {
        if (r.probability === 'high' && !r.mitigation) {
          return { ...r, mitigation: 'Mitigation plan: monitor closely, prepare rollback, escalate to tech lead' };
        }
        return r;
      });
      return fixed;
    }

    return null;
  }

  /**
   * Detect product type from title and description.
   * Determines commercialization (commercial/internal) and category (business/tool/transaction/infrastructure).
   *
   * @param title - PRD title.
   * @param description - PRD description.
   * @returns Detected product type.
   */
  detectProductType(title: string, description: string): ProductType {
    const text = `${title} ${description}`.toLowerCase();

    // Detect commercialization
    const commercialKeywords = ['商业化', '付费', '订阅', 'pricing', 'subscription', 'revenue', 'saas', 'b2b', 'b2c', 'monetize', '盈利', '客户', 'customer'];
    const internalKeywords = ['内部', '自研', '工具', '效率', 'internal', 'tooling', 'infra', '运维', 'devops', 'automation'];
    const isCommercial = commercialKeywords.some(kw => text.includes(kw));
    const isInternal = internalKeywords.some(kw => text.includes(kw));
    const commercialization: CommercializationType = isCommercial && !isInternal ? 'commercial' : 'internal';

    // Detect category
    const businessKeywords = ['业务', '流程', 'workflow', 'crm', 'erp', 'oa', '审批', '工单'];
    const toolKeywords = ['工具', '效率', '编辑器', 'tool', 'editor', 'converter', '生成器', 'utility'];
    const transactionKeywords = ['交易', '支付', '订单', '电商', 'payment', 'order', 'commerce', '交易', '结算', '支付', 'wallet'];
    const infraKeywords = ['基础', '平台', '服务', '中间件', 'infra', 'platform', 'middleware', 'api', '网关', 'gateway', '微服务'];

    let category: ProductCategory = 'tool';
    if (transactionKeywords.some(kw => text.includes(kw))) {
      category = 'transaction';
    } else if (businessKeywords.some(kw => text.includes(kw))) {
      category = 'business';
    } else if (infraKeywords.some(kw => text.includes(kw))) {
      category = 'infrastructure';
    } else {
      category = 'tool';
    }

    const categoryLabels: Record<ProductCategory, string> = {
      business: '业务型',
      tool: '工具型',
      transaction: '交易型',
      infrastructure: '基础服务型',
    };

    const commercializationLabel = commercialization === 'commercial' ? '商业化' : '自研';

    return {
      commercialization,
      category,
      label: `${commercializationLabel} × ${categoryLabels[category]}`,
    };
  }

  /**
   * Infer complexity level from description length and signal keywords.
   */
  private inferComplexity(description: string): Complexity {
    const length = description.length;
    if (length < 100) return 'L1';
    if (length < 500) return 'L2';
    if (length < 2000) return 'L3';
    return 'L4';
  }

  /**
   * Attach metadata to PRD (complexity, productType, 14-chapter flag).
   */
  private attachMetadata(prd: PRD, complexity: Complexity, productType: ProductType, use14Chapters: boolean): PRDWithMetadata {
    return {
      ...prd,
      _complexity: complexity,
      _productType: productType,
      _uses14Chapters: use14Chapters,
    };
  }

  private extractGoals(description: string): string[] {
    const goals: string[] = [];
    const lines = description.split('\n');
    for (const line of lines) {
      if (line.match(/^(goal|aim|objective|purpose|target)/i)) {
        goals.push(line.replace(/^(goal|aim|objective|purpose|target):?\s*/i, '').trim());
      }
    }
    if (goals.length === 0) {
      goals.push(`Build a ${description.split('.')[0]?.trim() || 'application'}`);
    }
    return goals;
  }

  /**
   * Extract target users based on description and product type.
   */
  private extractTargetUsers(description: string, productType: ProductType): string[] {
    const userKeywords: Record<ProductCategory, string[]> = {
      business: ['Business Users', 'Operations Team'],
      tool: ['Developers', 'End Users'],
      transaction: ['Customers', 'Merchants'],
      infrastructure: ['Internal Teams', 'API Consumers'],
    };

    const users = productType.commercialization === 'commercial'
      ? ['External Customers', ...userKeywords[productType.category]]
      : userKeywords[productType.category];

    // Try to extract from description
    const lines = description.split('\n');
    for (const line of lines) {
      if (line.match(/^(user|target|audience|用户|目标)/i)) {
        const extracted = line.replace(/^(user|target|audience|用户|目标)(?:_?users?)?:?\s*/i, '').trim();
        if (extracted.length > 0) {
          return [extracted, ...users];
        }
      }
    }

    return users;
  }

  private extractFunctionalRequirements(description: string): Array<{ id: string; description: string; priority: 'P0' | 'P1' | 'P2' | 'P3' }> {
    const reqs: Array<{ id: string; description: string; priority: 'P0' | 'P1' | 'P2' | 'P3' }> = [];
    const lines = description.split('\n');
    for (const line of lines) {
      const match = line.match(/^(?:[A-Z]+-\d+|\d+[.\)])\s+(.+)/);
      if (match) {
        const text = (match[1] || '').trim();
        if (!text.match(/^(performance|security|usability|reliability)/i)) {
          reqs.push({ id: `FR-${reqs.length + 1}`, description: text, priority: 'P1' });
        }
      }
    }
    if (reqs.length === 0) {
      reqs.push({ id: 'FR-1', description: 'Core functionality as described', priority: 'P1' });
    }
    return reqs;
  }

  private extractNonFunctionalRequirements(description: string): Array<{ id: string; description: string; category: 'performance' | 'security' | 'usability' | 'reliability' | 'maintainability' }> {
    const reqs: Array<{ id: string; description: string; category: 'performance' | 'security' | 'usability' | 'reliability' | 'maintainability' }> = [];
    const lines = description.split('\n');
    for (const line of lines) {
      const match = line.match(/^(?:[A-Z]+-\d+|\d+[.\)])\s+(.+)/);
      if (match) {
        const text = (match[1] || '').trim();
        const catMatch = text.match(/^(performance|security|usability|reliability|maintainability)/i);
        if (catMatch) {
          const category = catMatch[1]?.toLowerCase() as 'performance' | 'security' | 'usability' | 'reliability' | 'maintainability' || 'performance';
          reqs.push({ id: `NFR-${reqs.length + 1}`, description: text, category });
        }
      }
    }
    if (reqs.length === 0) {
      reqs.push({ id: 'NFR-1', description: 'Standard performance and security requirements', category: 'performance' });
    }
    return reqs;
  }

  private generateStories(title: string, description: string, complexity: Complexity): Story[] {
    const storyCount = complexity === 'L1' ? 1 : complexity === 'L2' ? 3 : complexity === 'L3' ? 5 : 8;
    const stories: Story[] = [];

    for (let i = 0; i < storyCount; i++) {
      stories.push({
        id: `STORY-${String(i + 1).padStart(3, '0')}`,
        title: i === 0 ? `Basic ${title} scaffold` : `${title} feature ${i}`,
        description: i === 0 ? `Set up the basic project structure for ${title}` : `Implement feature ${i} for ${title}`,
        priority: i < 2 ? 'P0' : 'P1' as 'P0' | 'P1' | 'P2' | 'P3',
        complexity: complexity,
        acceptance_criteria: [
          { id: `AC-${i + 1}-1`, description: `${title} feature ${i} works as expected`, testable: true, status: 'pending' },
        ],
        dependencies: i > 0 ? [`STORY-${String(i).padStart(3, '0')}`] : [],
        status: 'pending',
      });
    }

    return stories;
  }

  private generateArchitecture(complexity: Complexity, productType: ProductType) {
    const archType = productType.category === 'infrastructure' ? 'system' : 'component';
    const extraLayers = complexity === 'L4' ? '\n    Cache[(Redis)] --> Queue[(MQ)]\n    Queue --> Worker[Worker]' : '';

    return [{
      type: archType as 'system',
      mermaid: `graph TD\n    User[User] --> App[Application]\n    App --> Storage[(Storage)]${extraLayers}`,
      description: `${complexity} complexity ${productType.label} system architecture`,
    }];
  }

  private assessRisks(description: string, constraints: string[], complexity: Complexity, productType: ProductType): PRD['risks'] {
    const risks: PRD['risks'] = [];

    if (description.length > 1000) {
      risks.push({ description: 'Complex project scope may lead to scope creep', probability: 'medium', mitigation: 'Strict P0 scoping and iterative delivery' });
    }
    if (constraints.length > 0) {
      risks.push({ description: `Technical constraints: ${constraints.join(', ')}`, probability: 'medium', mitigation: 'Validate constraints early in design phase' });
    }
    if (complexity === 'L4') {
      risks.push({ description: 'System-level complexity requires cross-team coordination', probability: 'high', mitigation: 'Establish cross-team sync cadence and shared roadmap' });
    }
    if (productType.category === 'transaction') {
      risks.push({ description: 'Transaction-type product has financial risk (payment, settlement)', probability: 'high', mitigation: 'Implement idempotency, reconciliation, and rollback mechanisms' });
    }
    if (risks.length === 0) {
      risks.push({ description: 'Standard project delivery risk', probability: 'low', mitigation: 'Iterative delivery with continuous validation' });
    }
    return risks;
  }
}
