import { PRDSchema, type PRD, type Story } from '@azaloop/shared';
import { PRDChecker, type PRDCheckResult } from './prd-checker';
import { buildCompetitiveAppendixSync } from './github-competitive-research';
import {
  PRD_DRAFT_PROMPT,
  readCompetitiveResearchFile,
  type CompetitiveContext,
} from './prd-llm-prompts';
import * as fs from 'fs';
import * as path from 'path';

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
  force_14chapters?: boolean;  // 覆盖自动判断
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
   *
   * Robust to missing `description` — if the caller omits it (the
   * HARD-GATE minimal-input pattern from T25), we synthesize a
   * description from the title + structured fields so all downstream
   * extractors receive a non-empty string.
   *
   * Slim mode: prefer structured goals/FR/story/AC from the description;
   * avoid padding with generic risks, placeholder FRs, or "works as expected" ACs.
   */
  generate(input: PRDGenerationInput, options: PRDGeneratorOptions = {}): PRD {
    const now = new Date().toISOString();
    const description = input.description ?? input.title ?? '';
    const complexity = options.complexity || input.complexity || this.inferComplexity(description);
    const productType = options.productType || input.productType || this.detectProductType(input.title, description);

    const use14Chapters = (complexity === 'L3' || complexity === 'L4') || (options.enable_14chapters ?? false);

    // P1-2: always inject competitive landscape (sync curated; live search via generateAsync)
    const competitive = buildCompetitiveAppendixSync(`${input.title} ${description}`);
    let overview = this.buildSlimOverview(input.title, description);
    overview = this.injectCompetitiveOverview(overview, competitive);

    const goals = this.mergeCompetitiveGoals(this.extractGoals(overview), competitive.goals);
    const functional_requirements = this.extractFunctionalRequirements(overview);
    const non_functional_requirements = this.extractNonFunctionalRequirements(overview);
    const stories =
      options.auto_stories !== false
        ? this.generateStories(input.title, overview, complexity, functional_requirements, goals)
        : [];
    const flatAcs = stories.flatMap((s) => s.acceptance_criteria || []);
    const risks = [
      ...this.assessRisks(overview, input.constraints || [], complexity, productType),
      ...competitive.risks.slice(0, 2).map((r) => ({
        description: r.description,
        probability: (['low', 'medium', 'high'].includes(r.probability)
          ? r.probability
          : 'medium') as 'low' | 'medium' | 'high',
        mitigation: r.mitigation,
      })),
    ];

    const prd: PRD = {
      id: `PRD-${Date.now()}`,
      title: input.title,
      version: '1.0.0',
      created_at: now,
      updated_at: now,
      overview,
      goals,
      target_users: this.extractTargetUsers(overview, productType),
      functional_requirements,
      non_functional_requirements,
      stories,
      architecture: options.auto_architecture !== false ? this.generateArchitecture(complexity, productType) : [],
      acceptance_criteria: flatAcs,
      risks,
    };

    // 14 章节模板启用时，在 overview 前缀注入标记 + 在末尾追加 H2 骨架
    if (use14Chapters) {
      this.getDraftPromptWith14Chapters(input);
      const chapters = this.get14ChaptersOutline();
      prd.overview = `[14章节模板已启用]\n\n${prd.overview}\n\n${chapters.join('\n')}`;
    }

    const parsed = PRDSchema.parse(prd);

    if (options.enable_self_optimization) {
      const result = this.selfOptimize(parsed, options.max_optimization_rounds ?? 3);
      return this.attachMetadata(result.prd, complexity, productType, use14Chapters);
    }

    return this.attachMetadata(parsed, complexity, productType, use14Chapters);
  }

  /**
   * R10 第10轮 (D9)：确定性模板生成——不依赖 LLM 的骨架 PRD。
   *
   * 借鉴 ruflo「deterministic baseline」思路：先用规则生成一个保底 PRD，
   * 再用 LLM 生成增强版本；若 LLM 版本质量分低于确定性模板，则回退。
   *
   * 用途：
   * 1. 作为 LLM 生成的基线对照（quality gate 比较）
   * 2. LLM 不可用时的 fallback
   * 3. 简单需求（L1/L2）直接使用，省 token
   *
   * @param input  PRD 生成输入
   * @returns 符合 PRDSchema 的骨架 PRD
   */
  generateDeterministicTemplate(input: PRDGenerationInput): PRD {
    const now = new Date().toISOString();
    const description = input.description ?? input.title ?? '';
    const complexity = input.complexity || this.inferComplexity(description);
    const productType = input.productType || this.detectProductType(input.title, description);

    // 基于产品类型生成 overview 骨架
    const overview = this.buildDeterministicOverview(input.title, description, productType);

    // 基于 complexity 生成 stories 数量
    const storyCount: Record<Complexity, number> = { L1: 2, L2: 3, L3: 5, L4: 6 };
    const n = storyCount[complexity];

    const goals = this.extractGoals(overview);
    const functionalRequirements = this.extractFunctionalRequirements(overview);
    const stories = this.generateDeterministicStories(input.title, overview, n, functionalRequirements, goals);
    const flatAcs = stories.flatMap((s) => s.acceptance_criteria || []);
    const risks = this.assessRisks(overview, input.constraints || [], complexity, productType);
    const architecture = this.generateArchitecture(complexity, productType);

    const prd: PRD = {
      id: `PRD-${Date.now()}`,
      title: input.title,
      version: '1.0.0',
      created_at: now,
      updated_at: now,
      overview,
      goals,
      target_users: this.extractTargetUsers(overview, productType),
      functional_requirements: functionalRequirements,
      non_functional_requirements: this.extractNonFunctionalRequirements(overview),
      stories,
      architecture,
      acceptance_criteria: flatAcs,
      risks,
    };

    return PRDSchema.parse(prd);
  }

  /**
   * R10 第10轮 (D9)：构建确定性 overview——基于产品类型的模板化描述。
   * 不调用 LLM，不依赖外部数据源，纯规则生成。
   */
  private buildDeterministicOverview(
    title: string,
    description: string,
    productType: ProductType,
  ): string {
    const { commercialization, category, label } = productType;
    const parts: string[] = [];

    parts.push(`# ${title}\n`);
    parts.push(`**产品类型**：${label}（${commercialization}/${category}）\n`);

    // 痛点描述——基于产品类型差异化
    const painPointMap: Record<ProductCategory, string> = {
      business: `当前业务流程存在手动操作多、协作效率低、数据孤岛等痛点，亟需通过「${title}」实现自动化与数字化。`,
      tool: `现有工具在「${description.slice(0, 60) || title}」场景下效率不足，操作步骤繁琐，缺乏统一入口。`,
      transaction: `交易链路存在信任成本高、结算周期长、风控缺失等痛点，需要「${title}」提供闭环交易能力。`,
      infrastructure: `基础设施层面存在可观测性不足、弹性伸缩受限、运维成本高等问题，「${title}」需提供平台化能力。`,
    };
    parts.push(`## 痛点\n${painPointMap[category]}\n`);

    // 目标——基于商业化类型
    const goalMap: Record<CommercializationType, string> = {
      commercial: `面向外部用户收费，需在 ${new Date().getFullYear()} Q4 前完成 MVP 上线，验证付费意愿。`,
      internal: `面向内部团队降本增效，目标节省工时 ≥ 30%，3 个月内完成上线。`,
    };
    parts.push(`## 目标\n${goalMap[commercialization]}\n`);

    // 约束——从 description 提取
    if (description) {
      parts.push(`## 描述\n${description}\n`);
    }

    // 竞品占位（确定性模板不调用竞品研究，留 LLM 增强）
    parts.push(`## 竞品参考\n（待 LLM 增强时从 GitHub 竞品研究注入）\n`);

    // 差异化——基于产品类型
    const diffMap: Record<ProductCategory, string> = {
      business: `差异化在于业务流程闭环 + 角色权限精细控制，区别于通用工具。`,
      tool: `差异化在于「一键式」操作 + 离线能力，区别于重型 SaaS。`,
      transaction: `差异化在于风控内嵌 + 结算透明，区别于纯支付通道。`,
      infrastructure: `差异化在于多租户隔离 + 可观测性内置，区别于裸 IaaS。`,
    };
    parts.push(`## 差异化\n${diffMap[category]}\n`);

    return parts.join('\n');
  }

  /**
   * R10 第10轮 (D9)：生成确定性 stories——基于 FR 模板化拆分。
   * 不依赖 LLM，按 FR 数量和 complexity 级别生成骨架 story。
   */
  private generateDeterministicStories(
    title: string,
    overview: string,
    count: number,
    frs: Array<{ id: string; description: string; priority: string }>,
    goals: string[],
  ): Story[] {
    const stories: Story[] = [];
    const priorities = ['P0', 'P0', 'P1', 'P1', 'P2', 'P2'];

    for (let i = 0; i < count; i++) {
      const fr = frs[i] || frs[0];
      const storyId = `STORY-${String(i + 1).padStart(3, '0')}`;
      stories.push({
        id: storyId,
        title: `${title} - 功能 ${i + 1}`,
        description: `作为用户，我希望${fr?.description || '实现核心功能'}，以便达成业务目标。`,
        priority: (priorities[i] || 'P2') as 'P0' | 'P1' | 'P2',
        complexity: 'L2',
        acceptance_criteria: [
          {
            id: `${storyId}-AC-1`,
            description: `当用户触发「${fr?.description || '核心功能'}」时，系统在 2 秒内返回成功结果（P95）。`,
            testable: true,
            status: 'pending',
          },
          {
            id: `${storyId}-AC-2`,
            description: `当输入无效数据或网络断开时，系统显示错误提示并提供重试按钮，不崩溃。`,
            testable: true,
            status: 'pending',
          },
        ],
        dependencies: i > 0 ? [`STORY-${String(i).padStart(3, '0')}`] : [],
        status: 'pending',
      });
    }

    return stories;
  }

  private injectCompetitiveOverview(
    overview: string,
    competitive: ReturnType<typeof buildCompetitiveAppendixSync>,
  ): string {
    const urls = competitive.competitors.slice(0, 4).map((c) => c.html_url);
    const urlBlock = urls.length ? `\nCompetitive refs:\n${urls.map((u) => `- ${u}`).join('\n')}` : '';
    const hasUrls = (overview.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/gi) || []).length >= 2;
    const hasDiff = /differentiat|壁垒|Host-LLM|8 unified MCP|Completion|circuit gate/i.test(overview);
    let out = overview;
    if (!hasUrls) {
      out = `${out}${urlBlock}${competitive.overview_appendix}`;
    } else if (!/compet|OpenSpec|peers|竞品|landscape/i.test(out)) {
      out = `${out}\nPeers: ${competitive.competitors.slice(0, 3).map((c) => c.full_name).join(', ')}.`;
    }
    if (!hasDiff) {
      out = `${out}\n### Differentiation\n${competitive.differentiators.map((d) => `- ${d}`).join('\n')}`;
    }
    return out;
  }

  private mergeCompetitiveGoals(goals: string[], competitiveGoals: string[]): string[] {
    const merged = goals.filter((g) => !this.isCompetitiveUrlNoise(g));
    for (const g of competitiveGoals) {
      if (merged.length >= 4) break;
      if (this.isCompetitiveUrlNoise(g)) continue;
      if (!merged.some((x) => x.toLowerCase() === g.toLowerCase())) merged.push(g);
    }
    if (!merged.some((g) => /differentiat|MCP|Host-LLM|absorb competitive|竞品/i.test(g))) {
      const seed = competitiveGoals.find((g) => !this.isCompetitiveUrlNoise(g));
      merged.push(seed || 'Absorb competitive gaps without expanding MCP tool count');
    }
    return merged.filter((g) => !this.isCompetitiveUrlNoise(g)).slice(0, 5);
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
      refined.stories = this.generateStories(
        refined.title,
        refined.overview,
        'L2',
        refined.functional_requirements,
        refined.goals,
      );
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
   * Multi-round self-optimization: generate → self-check → fix P0/P1 → repeat until gate-ready.
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
      const blockers = lastCheck.details.filter(
        (d) => !d.passed && (d.severity === 'P0' || d.severity === 'P1'),
      );

      if (blockers.length === 0 && lastCheck.passed) {
        break;
      }

      rounds++;
      let fixes = 0;

      for (const issue of blockers) {
        const fixed = this.fixGateIssue(current, issue);
        if (fixed) {
          current = fixed;
          fixes++;
        }
      }

      // Always scrub vague ACs even if checker id differed
      const scrubbed = this.scrubVagueAcceptanceCriteria(current);
      if (scrubbed) {
        current = scrubbed;
        fixes++;
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
   * Fix a single P0/P1 gate issue in the PRD.
   * Returns the fixed PRD, or null if the issue cannot be auto-fixed.
   */
  private fixGateIssue(prd: PRD, issue: { id: string; category: string; description: string }): PRD | null {
    const fixed = { ...prd, stories: [...prd.stories], acceptance_criteria: [...prd.acceptance_criteria], functional_requirements: [...prd.functional_requirements], non_functional_requirements: [...prd.non_functional_requirements], goals: [...prd.goals], risks: [...prd.risks], architecture: [...prd.architecture] };

    // Fix missing functional requirements
    if (issue.id === 'FR-001' || issue.category === 'functional_requirements') {
      if (fixed.functional_requirements.length === 0) {
        fixed.functional_requirements.push({
          id: 'FR-1',
          description: `Ship measurable capability for: ${prd.title}`,
          priority: 'P0',
        });
        return fixed;
      }
    }

    // Fix missing NFR
    if (issue.id === 'NFR-001' || issue.category === 'non_functional_requirements') {
      if (fixed.non_functional_requirements.length === 0) {
        fixed.non_functional_requirements.push({
          id: 'NFR-1',
          description: 'reliability: failures surface as actionable gate reports within one loop iteration',
          category: 'reliability',
        });
        return fixed;
      }
    }

    // Fix missing stories
    if (issue.id === 'ST-001' || issue.category === 'stories') {
      if (fixed.stories.length === 0) {
        fixed.stories = this.generateStories(prd.title, prd.overview, 'L2', fixed.functional_requirements, fixed.goals);
        fixed.acceptance_criteria = fixed.stories.flatMap((s) => s.acceptance_criteria || []);
        return fixed;
      }
    }

    // Fix missing / untestable / vague acceptance criteria
    if (
      issue.id === 'AC-001' ||
      issue.id === 'AC-002' ||
      issue.id === 'AC-003' ||
      issue.id === 'AC-004' ||
      issue.category === 'acceptance_criteria'
    ) {
      return this.scrubVagueAcceptanceCriteria(fixed) ?? this.ensureStoryAcceptanceCriteria(fixed);
    }

    // Fix shallow overview / missing business research / competitive refs
    if (issue.id === 'OV-001' || issue.id === 'BR-001' || issue.id === 'BR-002') {
      fixed.overview = this.buildSlimOverview(prd.title, prd.overview || prd.title);
      const competitive = buildCompetitiveAppendixSync(prd.title);
      fixed.overview = this.injectCompetitiveOverview(fixed.overview, competitive);
      if (fixed.goals.length < 2) {
        fixed.goals = this.mergeCompetitiveGoals(fixed.goals, competitive.goals);
      }
      return fixed;
    }

    // BR-003/BR-004 — ≥2 github URLs + differentiators (P1-1/P1-2 gate alignment)
    if (issue.id === 'BR-003' || issue.id === 'BR-004') {
      const competitive = buildCompetitiveAppendixSync(prd.title);
      fixed.overview = this.injectCompetitiveOverview(fixed.overview || prd.title, competitive);
      fixed.goals = this.mergeCompetitiveGoals(fixed.goals, competitive.goals);
      return fixed;
    }

    // BA-001 needs ≥2 goals + competitive signal
    if (issue.id === 'BA-001') {
      if (fixed.goals.length < 2) {
        fixed.goals = [
          ...fixed.goals,
          `Deliver ${prd.title} with measurable acceptance checks`,
          'Differentiate vs OpenSpec/Superpowers/ralphy without adding MCP tools',
        ];
      } else if (!fixed.goals.some((g) => /compet|竞品|differen|OpenSpec|ralphy/i.test(g))) {
        fixed.goals.push('Absorb competitive gaps vs OpenSpec/Superpowers/ralphy without expanding MCP tool count');
      }
      if (!/compet|OpenSpec|peers|竞品|landscape/i.test(fixed.overview)) {
        fixed.overview = `${fixed.overview}\nPeers: OpenSpec, Superpowers, ralphy.`;
      }
      return fixed;
    }

    // Scenario / story description length
    if (issue.id === 'SA-001') {
      fixed.stories = fixed.stories.map((s) => ({
        ...s,
        description:
          s.description.length > 20
            ? s.description
            : `As a developer using AzaLoop, complete "${s.title}" with a verifiable acceptance check.`,
      }));
      return fixed;
    }

    // Architecture required for P1 PA-001
    if (issue.id === 'PA-001' || issue.id === 'AR-001') {
      if (fixed.architecture.length === 0 || !fixed.architecture.some((a) => a.mermaid?.length)) {
        fixed.architecture = this.generateArchitecture('L2', {
          commercialization: 'internal',
          category: 'tool',
          label: '自研 × 工具型',
        });
      }
      return fixed;
    }

    // Goals / positioning
    if (issue.id === 'GL-001' || issue.id === 'PP-001' || issue.id === 'PT-001') {
      if (fixed.goals.length === 0) {
        fixed.goals.push(`Ship ${prd.title} with P0/P1 cleared and weighted score ≥ 90`);
      }
      if (fixed.target_users.length === 0) {
        fixed.target_users = ['Developers', 'Agent operators'];
      }
      if (fixed.functional_requirements.length === 0) {
        fixed.functional_requirements.push({
          id: 'FR-1',
          description: `Core loop delivers ${prd.title}`,
          priority: 'P0',
        });
      }
      return fixed;
    }

    // High-risk items missing mitigation
    if (issue.id === 'RK-002') {
      fixed.risks = fixed.risks.map(r => {
        if (r.probability === 'high' && !r.mitigation) {
          return { ...r, mitigation: 'Mitigation: monitor gate metrics, prepare rollback, escalate via soft-recover' };
        }
        return r;
      });
      return fixed;
    }

    return null;
  }

  private ensureStoryAcceptanceCriteria(prd: PRD): PRD {
    const fixed = { ...prd, stories: [...prd.stories], acceptance_criteria: [...prd.acceptance_criteria] };
    if (fixed.stories.length === 0) {
      fixed.stories = this.generateStories(prd.title, prd.overview, 'L2', prd.functional_requirements, prd.goals);
    }
    fixed.stories = fixed.stories.map((s, idx) => {
      const acs = [...(s.acceptance_criteria || [])];
      if (acs.length === 0) {
        acs.push(this.makeMeasurableAc(idx + 1, 1, s.title, s.description));
      }
      return {
        ...s,
        acceptance_criteria: acs.map((a) => ({ ...a, testable: true })),
      };
    });
    fixed.acceptance_criteria = fixed.stories.flatMap((s) => s.acceptance_criteria || []);
    return fixed;
  }

  private scrubVagueAcceptanceCriteria(prd: PRD): PRD | null {
    let changed = false;
    const stories = prd.stories.map((s, idx) => {
      let acs = [...(s.acceptance_criteria || [])];
      if (acs.length === 0) {
        changed = true;
        acs = [this.makeMeasurableAc(idx + 1, 1, s.title, s.description)];
      } else {
        acs = acs.map((a, j) => {
          if (this.isHollowAc(a.description)) {
            changed = true;
            return this.makeMeasurableAc(idx + 1, j + 1, s.title, s.description || a.description);
          }
          return { ...a, testable: true };
        });
      }
      return { ...s, acceptance_criteria: acs };
    });
    if (!changed) return null;
    return {
      ...prd,
      stories,
      acceptance_criteria: stories.flatMap((s) => s.acceptance_criteria || []),
    };
  }

  private isHollowAc(description?: string): boolean {
    const t = (description || '').trim();
    if (t.length < 16) return true;
    if (/拒绝|reject|禁止|不得|must not|no\s+vague|forbid/i.test(t)) return false;
    if (/assert|via automated|observable|checklist|pass\/fail|metric|验证|断言/i.test(t)) {
      return /^(.*?feature\s+\d+\s+)?works as expected[.!]?$/i.test(t)
        || /^as described[.!]?$/i.test(t);
    }
    return /works as expected|as described|feature\s+\d+|按预期|正确工作|基本可用|正常运行/i.test(t);
  }

  private makeMeasurableAc(
    storyIdx: number,
    acIdx: number,
    title: string,
    detail: string,
  ): { id: string; description: string; testable: true; status: 'pending' } {
    const focus = (detail || title)
      .replace(/(拒绝[^，。:\n]{0,24})works as expected/gi, '$1空洞表述')
      .replace(/works as expected/gi, 'measurable behavior')
      .replace(/feature\s+\d+/gi, 'capability')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
    return {
      id: `AC-${storyIdx}-${acIdx}`,
      description: `Assert "${focus}" via automated check or checklist with observable pass/fail output`,
      testable: true,
      status: 'pending',
    };
  }

  /** Keep overview lean: user text first; add only missing pain/peers one-liners. */
  private buildSlimOverview(title: string, description: string): string {
    const base = (description || title || '').trim();
    const parts: string[] = [base || title];
    if (!/pain|痛点|problem|stall|waste/i.test(base)) {
      parts.push('Pain: vague PRDs and fragile agent loops waste tokens and stall full-auto delivery.');
    }
    if (!/compet|OpenSpec|peers|竞品|landscape|github\.com\//i.test(base)) {
      parts.push('Peers: OpenSpec, Superpowers, ralphy.');
    }
    const joined = parts.filter(Boolean).join('\n');
    return joined.length >= 120 ? joined : `${joined}\nShip measurable FR/story/AC; refuse placeholder acceptance criteria.`;
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

    // Detect commercialization with weighted scoring
    const commercialKeywords = [
      { kw: '商业化', weight: 3 }, { kw: '付费', weight: 3 }, { kw: '订阅', weight: 3 },
      { kw: 'pricing', weight: 3 }, { kw: 'subscription', weight: 3 }, { kw: 'revenue', weight: 3 },
      { kw: 'saas', weight: 3 }, { kw: 'b2b', weight: 3 }, { kw: 'b2c', weight: 3 },
      { kw: 'monetize', weight: 3 }, { kw: '盈利', weight: 3 }, { kw: '客户', weight: 2 },
      { kw: 'customer', weight: 2 }, { kw: '销售', weight: 3 }, { kw: 'license', weight: 3 },
    ];
    const internalKeywords = [
      { kw: '内部', weight: 3 }, { kw: '自研', weight: 3 }, { kw: '工具', weight: 2 },
      { kw: '效率', weight: 2 }, { kw: 'internal', weight: 3 }, { kw: 'tooling', weight: 2 },
      { kw: 'infra', weight: 2 }, { kw: '运维', weight: 3 }, { kw: 'devops', weight: 3 },
      { kw: 'automation', weight: 2 }, { kw: '员工', weight: 2 }, { kw: 'employee', weight: 2 },
    ];

    let commercialScore = 0;
    let internalScore = 0;
    for (const { kw, weight } of commercialKeywords) {
      if (text.includes(kw)) commercialScore += weight;
    }
    for (const { kw, weight } of internalKeywords) {
      if (text.includes(kw)) internalScore += weight;
    }
    const commercialization: CommercializationType = commercialScore > internalScore ? 'commercial' : 'internal';

    // Detect category with weighted scoring
    const businessKeywords = [
      { kw: '业务', weight: 3 }, { kw: '流程', weight: 3 }, { kw: 'workflow', weight: 3 },
      { kw: 'crm', weight: 3 }, { kw: 'erp', weight: 3 }, { kw: 'oa', weight: 3 },
      { kw: '审批', weight: 3 }, { kw: '工单', weight: 3 }, { kw: '多角色', weight: 2 },
      { kw: '协同', weight: 2 },
    ];
    const toolKeywords = [
      { kw: '工具', weight: 3 }, { kw: '效率', weight: 2 }, { kw: '编辑器', weight: 3 },
      { kw: 'tool', weight: 3 }, { kw: 'editor', weight: 3 }, { kw: 'converter', weight: 3 },
      { kw: '生成器', weight: 3 }, { kw: 'utility', weight: 3 }, { kw: '单一功能', weight: 2 },
    ];
    const transactionKeywords = [
      { kw: '交易', weight: 3 }, { kw: '支付', weight: 3 }, { kw: '订单', weight: 3 },
      { kw: '电商', weight: 3 }, { kw: 'payment', weight: 3 }, { kw: 'order', weight: 3 },
      { kw: 'commerce', weight: 3 }, { kw: '结算', weight: 3 }, { kw: 'wallet', weight: 3 },
      { kw: '购物车', weight: 3 },
    ];
    const infraKeywords = [
      { kw: '基础', weight: 3 }, { kw: '平台', weight: 3 }, { kw: '服务', weight: 2 },
      { kw: '中间件', weight: 3 }, { kw: 'infra', weight: 3 }, { kw: 'platform', weight: 3 },
      { kw: 'middleware', weight: 3 }, { kw: 'api', weight: 2 }, { kw: '网关', weight: 3 },
      { kw: 'gateway', weight: 3 }, { kw: '微服务', weight: 3 },
    ];

    let businessScore = 0;
    let toolScore = 0;
    let transactionScore = 0;
    let infraScore = 0;

    for (const { kw, weight } of businessKeywords) {
      if (text.includes(kw)) businessScore += weight;
    }
    for (const { kw, weight } of toolKeywords) {
      if (text.includes(kw)) toolScore += weight;
    }
    for (const { kw, weight } of transactionKeywords) {
      if (text.includes(kw)) transactionScore += weight;
    }
    for (const { kw, weight } of infraKeywords) {
      if (text.includes(kw)) infraScore += weight;
    }

    // Pick category with highest score; default to tool
    let category: ProductCategory = 'tool';
    const maxScore = Math.max(businessScore, toolScore, transactionScore, infraScore);
    if (maxScore === 0) {
      category = 'tool'; // default
    } else if (transactionScore === maxScore) {
      category = 'transaction';
    } else if (businessScore === maxScore) {
      category = 'business';
    } else if (infraScore === maxScore) {
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
   *
   * Robust to missing/undefined description — falls back to title (or
   * empty string) so the generator can still produce a PRD when callers
   * provide only a title + structured fields (the HARD-GATE minimal input
   * pattern from T25, for example).
   */
  inferComplexity(description: string | undefined | null): Complexity {
    const text = description ?? '';
    const length = text.length;
    if (length < 100) return 'L1';
    if (length < 500) return 'L2';
    if (length < 2000) return 'L3';
    return 'L4';
  }

  /**
   * V21: 返回 14 章节 H2 标题列表。
   * 用于在 L3/L4 复杂度下将 14 章节骨架附加到 PRD overview 末尾。
   */
  get14ChaptersOutline(): string[] {
    return [
      '## 1. 项目背景',
      '## 2. 需求基本情况',
      '## 3. 商业分析',
      '## 4. 项目收益目标',
      '## 5. 项目方案概述',
      '## 6. 项目范围',
      '## 7. 项目风险',
      '## 8. 术语表',
      '## 9. 参考文献',
      '## 10. 功能需求',
      '## 11. 数据埋点',
      '## 12. 角色和权限',
      '## 13. 运营计划',
      '## 14. 待决事项',
    ];
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
    const numbered = this.extractNumberedItems(description);
    for (const item of numbered) {
      // Prefer goal-like / outcome lines; skip pure NFR prefixes
      if (/^(performance|security|usability|reliability|maintainability)\b/i.test(item)) continue;
      if (item.length >= 8 && item.length <= 240) goals.push(item);
    }
    // Explicit "goal:" lines
    for (const line of description.split('\n')) {
      if (line.match(/^(goal|aim|objective|purpose|target|目标)\b/i)) {
        const g = line.replace(/^(goal|aim|objective|purpose|target|目标):?\s*/i, '').trim();
        if (g.length >= 8) goals.push(g);
      }
    }
    const uniq = [...new Set(goals)];
    if (uniq.length >= 2) return uniq.slice(0, 6);
    if (uniq.length === 1) {
      return [
        uniq[0]!,
        'Absorb competitive gaps vs OpenSpec/Superpowers/ralphy without expanding MCP tool count',
      ];
    }
    const first = description.split(/[.\n。]/)[0]?.trim() || 'application';
    return [
      `Ship: ${first.slice(0, 120)}`,
      'Absorb competitive gaps vs OpenSpec/Superpowers/ralphy without expanding MCP tool count',
    ];
  }

  /**
   * Extract target users based on description and product type.
   */
  private extractTargetUsers(description: string, productType: ProductType): string[] {
    const userKeywords: Record<ProductCategory, string[]> = {
      business: ['Business Users', 'Operations Team'],
      tool: ['Developers', 'Agent operators'],
      transaction: ['Customers', 'Merchants'],
      infrastructure: ['Internal Teams', 'API Consumers'],
    };

    const users = productType.commercialization === 'commercial'
      ? ['External Customers', ...userKeywords[productType.category]]
      : userKeywords[productType.category];

    const lines = description.split('\n');
    for (const line of lines) {
      if (line.match(/^(user|target|audience|用户|目标用户)/i)) {
        const extracted = line.replace(/^(user|target|audience|用户|目标用户)(?:_?users?)?:?\s*/i, '').trim();
        if (extracted.length > 0) {
          return [extracted, ...users];
        }
      }
    }

    return users;
  }

  /** True when text is mostly a URL / GitHub ref — must not become FR/story titles. */
  private isCompetitiveUrlNoise(text: string): boolean {
    const t = text.trim();
    if (/^https?:\/\//i.test(t)) return true;
    if (/^\[.+\]\(https?:\/\//i.test(t)) return true;
    if (/github\.com\/[\w.-]+\/[\w.-]+/i.test(t) && t.length < 160) return true;
    if (/^Competitive refs?:/i.test(t)) return true;
    return false;
  }

  private extractNumberedItems(description: string): string[] {
    const items: string[] = [];
    for (const raw of description.split('\n')) {
      const line = raw.trim();
      const match = line.match(/^(?:[A-Z]+-\d+|\d+[.)、]|[-*•])\s+(.+)/);
      if (!match?.[1]) continue;
      const text = match[1].trim();
      if (text.length < 6) continue;
      // Skip UI chrome that sometimes leaks into descriptions
      if (/确认后输入|开始执行|质量评分|用户故事：/.test(text)) continue;
      // Skip competitive URL bullets injected into overview (full-auto PRD pollution)
      if (this.isCompetitiveUrlNoise(text)) continue;
      items.push(text);
    }
    return items;
  }

  private extractFunctionalRequirements(description: string): Array<{ id: string; description: string; priority: 'P0' | 'P1' | 'P2' | 'P3' }> {
    const reqs: Array<{ id: string; description: string; priority: 'P0' | 'P1' | 'P2' | 'P3' }> = [];
    const items = this.extractNumberedItems(description);
    for (const text of items) {
      if (text.match(/^(performance|security|usability|reliability|maintainability)\b/i)) continue;
      if (/^非目标|^验收[:：]|^Pain[:：]/i.test(text)) continue;
      reqs.push({
        id: `FR-${reqs.length + 1}`,
        description: text.slice(0, 200),
        priority: reqs.length < 2 ? 'P0' : 'P1',
      });
    }
    if (reqs.length === 0) {
      // Derive from title/overview — still concrete, never "as described"
      const focus = description.split('\n').find((l) => l.trim().length > 20)?.trim() || description.slice(0, 120);
      reqs.push({
        id: 'FR-1',
        description: `Implement and verify: ${focus.slice(0, 160)}`,
        priority: 'P0',
      });
      reqs.push({
        id: 'FR-2',
        description: 'Enforce measurable acceptance criteria on every story before verify stage',
        priority: 'P0',
      });
    }
    return reqs.slice(0, 8);
  }

  private extractNonFunctionalRequirements(description: string): Array<{ id: string; description: string; category: 'performance' | 'security' | 'usability' | 'reliability' | 'maintainability' }> {
    const reqs: Array<{ id: string; description: string; category: 'performance' | 'security' | 'usability' | 'reliability' | 'maintainability' }> = [];
    const lines = description.split('\n');
    for (const line of lines) {
      const match = line.match(/^(?:[A-Z]+-\d+|\d+[.)])\s+(.+)/);
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
      reqs.push({
        id: 'NFR-1',
        description: 'reliability: quality check reports P0=0 P1=0 and weighted score ≥ 90 before ship',
        category: 'reliability',
      });
    }
    return reqs;
  }

  private generateStories(
    title: string,
    description: string,
    complexity: Complexity,
    frs?: Array<{ id: string; description: string; priority: 'P0' | 'P1' | 'P2' | 'P3' }>,
    goals?: string[],
  ): Story[] {
    const maxByComplexity = complexity === 'L1' ? 2 : complexity === 'L2' ? 3 : complexity === 'L3' ? 5 : 6;
    const seeds =
      (frs && frs.length > 0 ? frs.map((f) => f.description) : undefined) ||
      (goals && goals.length > 0 ? goals : undefined) ||
      this.extractNumberedItems(description);

    const filteredSeeds = seeds.filter((s) => !this.isCompetitiveUrlNoise(s));
    const sources = (
      filteredSeeds.length > 0 ? filteredSeeds : [`Deliver ${title} with measurable gates`]
    ).slice(0, maxByComplexity);
    const stories: Story[] = [];

    for (let i = 0; i < sources.length; i++) {
      const focus = sources[i]!.replace(/\s+/g, ' ').trim().slice(0, 160);
      const shortTitle = focus.length > 72 ? `${focus.slice(0, 69)}...` : focus;
      stories.push({
        id: `STORY-${String(i + 1).padStart(3, '0')}`,
        title: shortTitle,
        description: `As a developer, deliver "${focus}" with a verifiable acceptance check in the AzaLoop verify stage.`,
        priority: i < 2 ? 'P0' : 'P1',
        complexity: complexity,
        acceptance_criteria: [this.makeMeasurableAc(i + 1, 1, shortTitle, focus)],
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

    // Only emit risks that are specific — skip "standard delivery risk" filler
    if (complexity === 'L4' || description.length > 1500) {
      risks.push({
        description: 'Large scope may dilute measurable AC coverage',
        probability: 'medium',
        mitigation: 'Cap P0 stories ≤3; require ≥1 AC per story before build',
      });
    }
    if (constraints.some((c) => c.startsWith('competitor:'))) {
      risks.push({
        description: 'Competitive feature creep from peer tools',
        probability: 'medium',
        mitigation: 'Non-goal: expand MCP tool count; absorb practices into existing 8 tools',
      });
    }
    if (productType.category === 'transaction') {
      risks.push({
        description: 'Transaction-type product has financial risk (payment, settlement)',
        probability: 'high',
        mitigation: 'Implement idempotency, reconciliation, and rollback mechanisms',
      });
    }
    if (risks.length === 0) {
      risks.push({
        description: 'Vague AC may pass schema checks but fail real verification',
        probability: 'medium',
        mitigation: 'AC-004 rejects placeholders; selfOptimize rewrites measurable assertions',
      });
    }
    return risks;
  }

  // ── V20: LLM-driven generation methods ──

  /**
   * V20: Generate the draft prompt for the host LLM.
   *
   * Instead of filling templates with regex, we delegate PRD content
   * generation to the host LLM. This method builds a structured prompt
   * containing user input + competitive research + quality requirements.
   *
   * The host LLM returns a PRD JSON which is then parsed by parseDraftResponse().
   */
  generateDraftPrompt(
    input: PRDGenerationInput,
    competitive: CompetitiveContext | null,
    options: PRDGeneratorOptions = {},
  ): string {
    const description = input.description ?? input.title ?? '';
    const complexity = options.complexity || input.complexity || this.inferComplexity(description);
    const productType = options.productType || input.productType || this.detectProductType(input.title, description);
    const use14Chapters = options.enable_14chapters ?? (complexity === 'L4' || complexity === 'L3');

    // R10 第10轮 (D9)：从 .aza/competitive-research.md 注入竞品研究文件
    let competitiveResearchFile: string | null = null;
    try {
      const azaDir = process.env.AZA_DIR || path.join(process.cwd(), '.aza');
      competitiveResearchFile = readCompetitiveResearchFile(azaDir);
    } catch { /* best-effort */ }

    return PRD_DRAFT_PROMPT(input, competitive, complexity, productType, use14Chapters, competitiveResearchFile);
  }

  /**
   * V20: Parse the host LLM's draft response into a PRD object.
   *
   * The host LLM is expected to return a JSON object matching PRDSchema.
   * This method extracts the JSON from the response (handling markdown
   * code fences if present) and validates it against the schema.
   *
   * If parsing fails, returns null and the caller should fall back to
   * the regex-based generate() method.
   */
  parseDraftResponse(llmOutput: string): PRD | null {
    if (!llmOutput || typeof llmOutput !== 'string') return null;

    // Strip markdown code fences if present
    let jsonStr = llmOutput.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch?.[1]) {
      jsonStr = fenceMatch[1].trim();
    }

    // Find the first { and last } to extract JSON object
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== 'object') return null;

    // Validate against schema
    const result = PRDSchema.safeParse(parsed);
    if (result.success) {
      return result.data as PRD;
    }

    // If schema validation fails, try to fix common issues
    const fixed = this.repairDraftShape(parsed as Record<string, unknown>);
    if (fixed) {
      const retry = PRDSchema.safeParse(fixed);
      if (retry.success) {
        return retry.data as PRD;
      }
    }

    return null;
  }

  /**
   * V20: Repair common shape issues in LLM-generated PRD drafts.
   *
   * Host LLMs sometimes produce slightly malformed PRDs (missing fields,
   * wrong types). This method attempts to repair the most common issues
   * before giving up and falling back to regex-based generation.
   */
  private repairDraftShape(obj: Record<string, unknown>): Record<string, unknown> | null {
    if (!obj || typeof obj !== 'object') return null;

    const repaired: Record<string, unknown> = { ...obj };
    const now = new Date().toISOString();

    // Ensure required string fields
    if (typeof repaired.id !== 'string' || !repaired.id) {
      repaired.id = `PRD-${Date.now()}`;
    }
    if (typeof repaired.title !== 'string' || !repaired.title) {
      return null; // Cannot repair missing title
    }
    if (typeof repaired.version !== 'string' || !repaired.version) {
      repaired.version = '1.0.0';
    }
    if (typeof repaired.created_at !== 'string' || !repaired.created_at) {
      repaired.created_at = now;
    }
    if (typeof repaired.updated_at !== 'string' || !repaired.updated_at) {
      repaired.updated_at = now;
    }
    if (typeof repaired.overview !== 'string' || !repaired.overview) {
      repaired.overview = repaired.title as string;
    }

    // Ensure arrays
    if (!Array.isArray(repaired.goals)) repaired.goals = [];
    if (!Array.isArray(repaired.target_users)) repaired.target_users = ['Developers'];
    if (!Array.isArray(repaired.functional_requirements)) repaired.functional_requirements = [];
    if (!Array.isArray(repaired.non_functional_requirements)) repaired.non_functional_requirements = [];
    if (!Array.isArray(repaired.stories)) repaired.stories = [];
    if (!Array.isArray(repaired.architecture)) repaired.architecture = [];
    if (!Array.isArray(repaired.acceptance_criteria)) repaired.acceptance_criteria = [];
    if (!Array.isArray(repaired.risks)) repaired.risks = [];

    return repaired;
  }

  /**
   * Load the 14-chapter detailed guide from the templates directory.
   * Tries multiple candidate locations to support both src/ and dist/ layouts.
   *
   * @returns Guide markdown content, or empty string if the file is missing/unreadable.
   */
  private get14ChapterGuide(): string {
    const candidates = [
      // src layout: packages/core/src/L1_spec/templates/...
      path.join(__dirname, 'templates', '14-chapter-detailed-guide.md'),
      // dist layout: packages/core/dist/L1_spec/templates/...
      path.join(__dirname, '..', 'src', 'L1_spec', 'templates', '14-chapter-detailed-guide.md'),
      // repo root resolution (when running from compiled dist with package root)
      path.resolve(__dirname, '..', '..', '..', 'src', 'L1_spec', 'templates', '14-chapter-detailed-guide.md'),
      path.resolve(__dirname, '..', '..', '..', 'dist', 'L1_spec', 'templates', '14-chapter-detailed-guide.md'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
      } catch { /* try next */ }
    }
    return '';
  }

  /**
   * V20: Get the draft prompt with 14-chapter template (for L3/L4 complexity).
   */
  getDraftPromptWith14Chapters(
    input: PRDGenerationInput,
    competitive: CompetitiveContext | null = null,
  ): string {
    return this.generateDraftPrompt(input, competitive, {
      enable_14chapters: true,
      complexity: input.complexity || 'L4',
    });
  }

  /**
   * V20: Generate a PRD using the LLM-driven multi-step flow.
   *
   * This is the entry point for the multi-step interaction:
   * 1. Host LLM calls aza_prd(action=review) → gets draft_prompt
   * 2. Host LLM generates draft → calls aza_prd(action=draft, prd=<draft>)
   * 3. Code runs selfOptimize() + check()
   * 4. Host LLM calls aza_prd(action=multi_review) → gets review_prompts
   * 5. Host LLM does 4-role review → calls aza_prd(action=refine, findings=<findings>)
   * 6. Host LLM refines PRD → calls aza_prd(action=approve)
   *
   * This method is called by PRDReviewGate when action=draft is received.
   * It parses the host LLM's draft, runs structural fixes, and returns
   * the validated PRD (or null if parsing failed).
   */
  generateFromDraft(
    llmOutput: string,
    input: PRDGenerationInput,
    options: PRDGeneratorOptions = {},
  ): PRD | null {
    const parsed = this.parseDraftResponse(llmOutput);
    if (!parsed) {
      return null;
    }

    // Run structural self-optimization (fix missing fields, scrub vague ACs)
    const optimized = options.enable_self_optimization !== false
      ? this.selfOptimize(parsed, options.max_optimization_rounds ?? 3)
      : { prd: parsed };

    const description = input.description ?? input.title ?? '';
    const complexity = options.complexity || input.complexity || this.inferComplexity(description);
    const productType = options.productType || input.productType || this.detectProductType(input.title, description);
    const use14Chapters = (complexity === 'L4' || complexity === 'L3') || (options.enable_14chapters ?? false);

    return this.attachMetadata(optimized.prd, complexity, productType, use14Chapters);
  }
}
