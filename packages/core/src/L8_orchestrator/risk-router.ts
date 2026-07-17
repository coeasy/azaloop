/**
 * R10 第11轮 (P2 风险路由) — RiskRouter。
 *
 * 借鉴 gstack「CEO/Eng/QA/Security/Release 角色化」+ agent-skills「risk-driven」+ superpowers「spec compliance + code quality」双轨。
 *
 * 核心原则：
 * - 不复制固定 20+ 角色；按任务风险等级动态路由
 * - 风险等级 = file_risk × change_risk × data_risk
 * - 输出 role 序列而非固定命令，让 executor 自由组合
 *
 * 风险分类：
 *   trivial: docs/comments → 0 reviewers
 *   low:    isolated change in known file → 1 reviewer (qa)
 *   medium: multi-file or new module → 2 reviewers (qa + eng)
 *   high:   auth/payment/data/external API → 3+ reviewers (qa + eng + security)
 *   critical: production-affecting or new dependency → all 5 roles
 */

export type RiskLevel = 'trivial' | 'low' | 'medium' | 'high' | 'critical';

export type ReviewerRole =
  | 'spec_compliance'   // superpowers: 先审规格合规
  | 'code_quality'      // superpowers: 再审代码质量
  | 'qa'                // gstack: QA / 测试覆盖
  | 'eng'               // gstack: 工程 / 架构
  | 'security'          // gstack: 安全 / 注入 / DLP
  | 'data_migration'    // OpenSpec: 数据迁移
  | 'ui_browser'        // gstack: 浏览器/UI 验证
  | 'release'           // gstack: 发布 / 兼容性
  | 'migration';        // agency-orchestrator: 框架/依赖迁移

export interface RiskSignals {
  /** 修改的文件路径列表 */
  files: string[];
  /** 是否新增依赖 */
  newDependencies?: string[];
  /** 是否触碰敏感路径（auth/payment/db/secret） */
  touchesSensitive?: boolean;
  /** 是否新增数据库 schema 变更 */
  dbSchemaChange?: boolean;
  /** 是否新增 UI 改动 */
  uiChange?: boolean;
  /** 是否新增对外 API/SDK */
  externalApi?: boolean;
  /** 是否新增浏览器/UI 自动化 */
  browserChange?: boolean;
  /** 是否触碰 production 部署配置 */
  productionConfig?: boolean;
  /** 变更行数（粗略估） */
  linesChanged?: number;
}

export interface ReviewPlan {
  riskLevel: RiskLevel;
  reviewers: ReviewerRole[];
  /** 是否需要 worktree 隔离（写集冲突风险） */
  requireWorktree: boolean;
  /** 是否需要 fresh-context（高风险任务） */
  requireFreshContext: boolean;
  /** 理由（人类可读） */
  rationale: string[];
}

const SENSITIVE_PATTERNS = [
  /auth/i, /login/i, /session/i, /token/i, /password/i, /credential/i,
  /payment/i, /billing/i, /invoice/i, /wallet/i, /charge/i,
  /secret/i, /\.env/i, /credential/i,
  /migration/i, /schema/i, /database/i, /sql/i, /prisma/i,
  /api[\/_-]?key/i,
];

const FRAMEWORK_MIGRATION_PATTERNS = [
  /upgrade.*next/i, /next.*\d+\.\d+/, /upgrade.*react/i, /upgrade.*vue/i,
  /package\.json/, /requirements\.txt/, /pyproject\.toml/,
  /breaking[\s_-]?change/i,
];

function isSensitiveFile(file: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(file));
}

function isFrameworkMigration(s: RiskSignals): boolean {
  if (s.newDependencies && s.newDependencies.length > 0) return true;
  if (s.files.some((f) => FRAMEWORK_MIGRATION_PATTERNS.some((p) => p.test(f)))) return true;
  return false;
}

function computeRiskLevel(s: RiskSignals): { level: RiskLevel; rationale: string[] } {
  const rationale: string[] = [];
  let score = 0;

  if (s.touchesSensitive) { score += 3; rationale.push('touches sensitive paths (auth/payment/secret/db)'); }
  if (s.dbSchemaChange) { score += 3; rationale.push('db schema change'); }
  if (s.productionConfig) { score += 3; rationale.push('production config change'); }
  if (s.externalApi) { score += 2; rationale.push('new external API/SDK'); }
  if (s.newDependencies && s.newDependencies.length > 0) {
    score += 1; rationale.push(`new dependencies: ${s.newDependencies.length}`);
  }
  if (s.uiChange) { score += 1; rationale.push('UI change'); }
  if (s.browserChange) { score += 1; rationale.push('browser/UI automation change'); }
  if ((s.linesChanged ?? 0) > 500) { score += 1; rationale.push(`large change (${s.linesChanged} lines)`); }
  if ((s.files?.length ?? 0) > 5) { score += 1; rationale.push(`multi-file (${s.files.length} files)`); }
  if (s.files?.some(isSensitiveFile)) { score += 2; rationale.push('sensitive filename in changeset'); }

  if (isFrameworkMigration(s)) { score += 2; rationale.push('framework/dependency migration'); }

  if (score <= 0) return { level: 'trivial', rationale: ['no risk signals detected'] };
  if (score <= 2) return { level: 'low', rationale };
  if (score <= 4) return { level: 'medium', rationale };
  if (score <= 6) return { level: 'high', rationale };
  return { level: 'critical', rationale };
}

const REVIEWER_MATRIX: Record<RiskLevel, ReviewerRole[]> = {
  trivial: [],
  low: ['spec_compliance', 'qa'],
  medium: ['spec_compliance', 'code_quality', 'qa', 'eng'],
  high: ['spec_compliance', 'code_quality', 'qa', 'eng', 'security'],
  critical: ['spec_compliance', 'code_quality', 'qa', 'eng', 'security', 'data_migration', 'release'],
};

const FRESH_CONTEXT_THRESHOLDS: Record<RiskLevel, boolean> = {
  trivial: false,
  low: false,
  medium: false,
  high: true,
  critical: true,
};

const WORKTREE_REQUIRED: Record<RiskLevel, boolean> = {
  trivial: false,
  low: false,
  medium: true,
  high: true,
  critical: true,
};

/**
 * R10 第11轮 (P2 风险路由) 核心：纯函数 risk → review plan。
 */
export function routeByRisk(signals: RiskSignals): ReviewPlan {
  const { level, rationale } = computeRiskLevel(signals);
  return {
    riskLevel: level,
    reviewers: REVIEWER_MATRIX[level],
    requireWorktree: WORKTREE_REQUIRED[level],
    requireFreshContext: FRESH_CONTEXT_THRESHOLDS[level],
    rationale,
  };
}

/**
 * 注入领域 reviewer（按需扩展）。
 * 例如 UI change → 加 ui_browser；migration → 加 migration。
 */
export function extendReviewers(plan: ReviewPlan, signals: RiskSignals): ReviewPlan {
  const extra: ReviewerRole[] = [];
  if (signals.uiChange) extra.push('ui_browser');
  if (isFrameworkMigration(signals)) extra.push('migration');
  if (extra.length === 0) return plan;
  return {
    ...plan,
    reviewers: [...new Set([...plan.reviewers, ...extra])],
    rationale: [...plan.rationale, `extended: ${extra.join(', ')}`],
  };
}

/**
 * 与 worktree 共享写集分析联动（ralphy/agency-orchestrator 借鉴）。
 *
 * 并行要求：
 * - worktree 必检（除非 risk==trivial/low 且单文件）
 * - 写集冲突由 review plan 的 requireWorktree 标志驱动
 */
export function shouldUseWorktree(signals: RiskSignals, plan?: ReviewPlan): boolean {
  if (plan) return plan.requireWorktree;
  const p = routeByRisk(signals);
  return p.requireWorktree;
}
