/**
 * Skill Registry — Phase 3 T22
 *
 * Skill schema (18 fields) synthesizes the frontmatter standards from:
 *   - obra/superpowers      (when_to_use, red_flags, rationalizations, quick_reference, related_skills, evals, requires_approval)
 *   - ruvnet/ruflo          (namespaces, reserved_namespaces, smoke_test, gate_criteria)
 *   - michaelshimeles/ralphy (parallel_group, isolation, boundaries_never_touch, task_sources)
 *   - wenqingyu/ralphy-openspec (completion_sentinel)
 *
 * All existing 4-field callers keep working — new fields are added with
 * sensible defaults by `normalizeSkillMeta()`.
 */

// ── Field types ──

export type SkillType = 'document' | 'workflow' | 'analysis' | 'utility' | 'agent';
export type SkillLanguage = 'zh' | 'en' | 'both';
export type SkillIsolation = 'worktree' | 'sandbox' | 'none';
export type SkillTaskSource = 'md' | 'yaml' | 'json' | 'folder' | 'github' | 'ralphy-spec' | 'openspec-change' | 'aza-prd';

export interface RedFlag { thought: string; reality: string; }
export interface Rationalization { excuse: string; counter: string; }
export interface QuickRef { key: string; value: string; }
export interface GateCriterion { phase: string; criteria: string[]; }
export interface SmokeTest { command: string; expected: string; }

export interface SkillMeta {
  // ── 基础 4 字段（保留）──
  name: string;
  version: string;
  type: SkillType;
  description: string;
  tags: string[];

  // ── superpowers 字段 ──
  /** 触发谓词 — "description" 应以 "Use when..." 开头；此字段是 "Use when" 之后的内容。 */
  when_to_use: string;
  /** 12+ 行 "借口 vs 现实" 表。 */
  red_flags: RedFlag[];
  /** 8+ 行反理性化表。 */
  rationalizations: Rationalization[];
  /** 速查表。 */
  quick_reference: QuickRef[];
  /** 关联 skill 名称。 */
  related_skills: string[];
  /** 压力测试场景（RED 测试列表）。 */
  evals: string[];
  /** HARD-GATE 标志 — true 时调用前必须显式 approve。 */
  requires_approval: boolean;
  /** 强制 body 段落顺序。 */
  body_sections: string[];

  // ── ruflo plugin contract 字段 ──
  /** 该 skill 拥有的命名空间（kebab-case）。 */
  namespaces: string[];
  /** 不可覆盖的保留命名空间。 */
  reserved_namespaces: string[];
  /** 验收测试。 */
  smoke_test: SmokeTest;
  /** SPARC 风格多阶段门。 */
  gate_criteria: GateCriterion[];

  // ── ralphy 并行与隔离字段 ──
  /** 同 group 并行；不同 group 串行。 */
  parallel_group?: number;
  /** 执行隔离模式。 */
  isolation: SkillIsolation;
  /** 不能修改的 glob 列表。 */
  boundaries_never_touch: string[];

  // ── ralphy-openspec 字段 ──
  /** 完成哨兵 — 默认 "<promise>TASK_COMPLETE</promise>"。 */
  completion_sentinel: string;
  /** 支持的任务源类型列表。 */
  task_sources: SkillTaskSource[];

  // ── 通用元数据 ──
  language: SkillLanguage;
  author: string;
  registered_at: string;
}

// ── Defaults ──

export const DEFAULT_COMPLETION_SENTINEL = '<promise>TASK_COMPLETE</promise>';
export const DEFAULT_RESERVED_NAMESPACES = ['pattern', 'claude-memories', 'default'] as const;

/**
 * Normalize a partial SkillMeta into a complete one with sensible defaults.
 * This keeps the existing 4-field callers working unchanged.
 */
export function normalizeSkillMeta(partial: Partial<SkillMeta> & { name: string; description: string }): SkillMeta {
  const now = new Date().toISOString();
  const description = partial.description ?? '';
  const usesWhen = description.toLowerCase().startsWith('use when');
  return {
    name: partial.name,
    version: partial.version ?? '1.0.0',
    type: partial.type ?? 'document',
    description,
    tags: partial.tags ?? [],
    when_to_use: partial.when_to_use ?? (usesWhen ? description.replace(/^use when\s*/i, '') : description),
    red_flags: partial.red_flags ?? [],
    rationalizations: partial.rationalizations ?? [],
    quick_reference: partial.quick_reference ?? [],
    related_skills: partial.related_skills ?? [],
    evals: partial.evals ?? [],
    requires_approval: partial.requires_approval ?? false,
    body_sections: partial.body_sections ?? ['Overview', 'When to Use', 'Process', 'Examples', 'Red Flags', 'Verification'],
    namespaces: partial.namespaces ?? [],
    reserved_namespaces: partial.reserved_namespaces ?? [...DEFAULT_RESERVED_NAMESPACES],
    smoke_test: partial.smoke_test ?? { command: 'echo "no smoke test"', expected: 'no smoke test' },
    gate_criteria: partial.gate_criteria ?? [],
    parallel_group: partial.parallel_group,
    isolation: partial.isolation ?? 'none',
    boundaries_never_touch: partial.boundaries_never_touch ?? [],
    completion_sentinel: partial.completion_sentinel ?? DEFAULT_COMPLETION_SENTINEL,
    task_sources: partial.task_sources ?? ['md'],
    language: partial.language ?? 'both',
    author: partial.author ?? 'azaloop-core',
    registered_at: partial.registered_at ?? now,
  };
}

// ── Validation ──

export interface ValidationResult { valid: boolean; errors: string[]; }

/**
 * Validate a SkillMeta against the superpowers / ruflo standards.
 * Returns a list of human-readable errors.
 */
export function validateSkillMeta(meta: SkillMeta): ValidationResult {
  const errors: string[] = [];

  if (!meta.name || !/^[a-z][a-z0-9-]*$/.test(meta.name)) {
    errors.push('name must be kebab-case (lowercase, digits, hyphens)');
  }
  if (!meta.description) {
    errors.push('description is required');
  } else if (!/^use when\s/i.test(meta.description)) {
    errors.push('description must start with "Use when ..." (superpowers standard)');
  }
  if (meta.type && !['document', 'workflow', 'analysis', 'utility', 'agent'].includes(meta.type)) {
    errors.push(`type must be one of document|workflow|analysis|utility|agent (got ${meta.type})`);
  }
  if (meta.requires_approval && !meta.red_flags?.length) {
    errors.push('requires_approval=true skills MUST include red_flags (superpowers HARD-GATE)');
  }
  for (const ns of meta.namespaces ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(ns)) {
      errors.push(`namespace "${ns}" must be kebab-case`);
    }
    if (DEFAULT_RESERVED_NAMESPACES.includes(ns as any)) {
      errors.push(`namespace "${ns}" is reserved (cannot be owned by a skill)`);
    }
  }
  for (const ns of meta.reserved_namespaces ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(ns)) {
      errors.push(`reserved_namespace "${ns}" must be kebab-case`);
    }
  }
  if (meta.completion_sentinel && !meta.completion_sentinel.includes('<promise>')) {
    errors.push('completion_sentinel should contain the <promise>...</promise> wrapper');
  }
  if (meta.isolation && !['worktree', 'sandbox', 'none'].includes(meta.isolation)) {
    errors.push(`isolation must be worktree|sandbox|none (got ${meta.isolation})`);
  }
  if (meta.gate_criteria && meta.gate_criteria.length > 0) {
    for (const gc of meta.gate_criteria) {
      if (!gc.phase) errors.push('gate_criteria[].phase is required');
      if (!gc.criteria?.length) errors.push(`gate_criteria[${gc.phase}] must have at least one criterion`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Registry ──

export class SkillRegistry {
  private skills: Map<string, SkillMeta> = new Map();

  constructor() {
    this.registerCoreSkills();
  }

  register(skill: SkillMeta | Partial<SkillMeta>): void {
    const normalized = normalizeSkillMeta(skill as any);
    this.skills.set(normalized.name, normalized);
  }

  registerRaw(skill: SkillMeta): void {
    // Skip normalization — caller is responsible for the full schema.
    this.skills.set(skill.name, skill);
  }

  get(name: string): SkillMeta | undefined {
    return this.skills.get(name);
  }

  search(query: string): SkillMeta[] {
    const q = query.toLowerCase();
    return Array.from(this.skills.values()).filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q)) ||
      s.when_to_use.toLowerCase().includes(q)
    );
  }

  listByType(type: SkillType): SkillMeta[] {
    return Array.from(this.skills.values()).filter(s => s.type === type);
  }

  getAll(): SkillMeta[] {
    return Array.from(this.skills.values());
  }

  // ── Phase 3 T22 — new lookup helpers ──

  /** ruflo: find skills that own a given namespace. */
  findByNamespace(ns: string): SkillMeta[] {
    return Array.from(this.skills.values()).filter(s => s.namespaces.includes(ns));
  }

  /** superpowers: find skills whose red flags contain the given keyword. */
  findByRedFlag(keyword: string): SkillMeta[] {
    const k = keyword.toLowerCase();
    return Array.from(this.skills.values()).filter(s =>
      s.red_flags.some(rf =>
        rf.thought.toLowerCase().includes(k) || rf.reality.toLowerCase().includes(k)
      )
    );
  }

  /** ralphy: group skills by parallel_group. Returns map: group → skills. */
  groupByParallelGroup(): Map<number, SkillMeta[]> {
    const out = new Map<number, SkillMeta[]>();
    for (const s of this.skills.values()) {
      if (s.parallel_group === undefined) continue;
      const list = out.get(s.parallel_group) ?? [];
      list.push(s);
      out.set(s.parallel_group, list);
    }
    return out;
  }

  /** Find skills that have a non-trivial gate_criteria list (multi-phase). */
  findMultiPhase(): SkillMeta[] {
    return Array.from(this.skills.values()).filter(s => s.gate_criteria.length > 0);
  }

  /** ruflo: verify all registered skills pass validation. */
  validateAll(): { ok: SkillMeta[]; broken: Array<{ skill: string; errors: string[] }> } {
    const ok: SkillMeta[] = [];
    const broken: Array<{ skill: string; errors: string[] }> = [];
    for (const s of this.skills.values()) {
      const v = validateSkillMeta(s);
      if (v.valid) ok.push(s);
      else broken.push({ skill: s.name, errors: v.errors });
    }
    return { ok, broken };
  }

  // ── Core skills (8) — upgraded to 18-field schema ──

  private registerCoreSkills(): void {
    const now = new Date().toISOString();
    const core: SkillMeta[] = [
      {
        name: 'prd', version: '1.1.0', type: 'document',
        description: 'Use when the user wants to turn an idea into a structured PRD before any code is written — drives a HARD-GATE that blocks all build-stage tools until approval.',
        tags: ['prd', 'spec', 'requirements'],
        when_to_use: 'the user wants to turn an idea into a structured PRD before any code is written',
        red_flags: [
          { thought: 'This is too simple to need a design.', reality: 'Simple features ship as 5-step builds; skipping the spec ships 3 of them wrong.' },
          { thought: 'I already know what to build, let me start.', reality: 'You are projecting; the user has not committed to a plan.' },
          { thought: 'The user said "just code it".', reality: 'That is a request for speed, not a waiver of the contract.' },
        ],
        requires_approval: true,
        namespaces: ['aza-prd', 'aza-spec'],
        smoke_test: { command: 'pnpm vitest run tests/unit/prd-review-gate.test.ts', expected: 'passed' },
        task_sources: ['md', 'aza-prd', 'openspec-change'],
        language: 'both', author: 'azaloop-core', registered_at: now,
      } as any,
      {
        name: 'arch', version: '1.1.0', type: 'document',
        description: 'Use when the team needs architecture diagrams (Mermaid) and design decisions before any code is written — surfaces constraints, alternatives, and rejected options.',
        tags: ['architecture', 'design', 'mermaid'],
        when_to_use: 'the team needs architecture diagrams and design decisions before any code is written',
        red_flags: [
          { thought: 'I will design as I build.', reality: 'Rework after build is 10x more expensive than design before build.' },
        ],
        namespaces: ['aza-arch'],
        smoke_test: { command: 'pnpm vitest run tests/unit/arch-skill.test.ts', expected: 'passed' },
        task_sources: ['md'],
        language: 'both', author: 'azaloop-core', registered_at: now,
      } as any,
      {
        name: 'db', version: '1.1.0', type: 'document',
        description: 'Use when the project needs a database schema, migration plan, and indexing strategy before any data is written.',
        tags: ['database', 'schema', 'migration'],
        when_to_use: 'the project needs a database schema, migration plan, and indexing strategy',
        red_flags: [
          { thought: 'We can add indexes later when slow.', reality: 'Late indexes corrupt the production data shape.' },
        ],
        namespaces: ['aza-db'],
        smoke_test: { command: 'pnpm vitest run tests/unit/db-skill.test.ts', expected: 'passed' },
        task_sources: ['md'],
        language: 'both', author: 'azaloop-core', registered_at: now,
      } as any,
      {
        name: 'api', version: '1.1.0', type: 'document',
        description: 'Use when designing or auditing HTTP/RPC API contracts — request/response shapes, error codes, and typed boundaries.',
        tags: ['api', 'endpoints', 'rest'],
        when_to_use: 'designing or auditing HTTP/RPC API contracts',
        red_flags: [
          { thought: 'We will document the API after the first consumer works.', reality: 'Untyped APIs cause 3+ consumer rewrites per endpoint.' },
        ],
        namespaces: ['aza-api'],
        smoke_test: { command: 'pnpm vitest run tests/unit/api-skill.test.ts', expected: 'passed' },
        task_sources: ['md'],
        language: 'both', author: 'azaloop-core', registered_at: now,
      } as any,
      {
        name: 'test', version: '1.1.0', type: 'workflow',
        description: 'Use when implementing any production code — enforces TDD Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST (RED → GREEN → REFACTOR).',
        tags: ['test', 'tdd', 'quality'],
        when_to_use: 'implementing any production code',
        red_flags: [
          { thought: 'Skip the test, verify manually.', reality: 'Manual verification is not a test; it is a prayer.' },
          { thought: 'Trust me it works.', reality: 'Trust is not in the test pyramid.' },
          { thought: 'It works on my machine.', reality: 'Then put your machine in CI.' },
          { thought: 'We will add tests later.', reality: 'Later is the 4th strike in TDD Iron Law.' },
          { thought: 'Tests are slow, skip for now.', reality: 'The cost of slow tests is 5x cheaper than the cost of a regression.' },
          { thought: 'Just deploy, we can fix in prod.', reality: 'You cannot TDD in production.' },
        ],
        rationalizations: [
          { excuse: 'This is a tiny change, surely TDD is overkill.', counter: 'Tiny changes are 70% of regressions. TDD takes 30s for a 1-line change.' },
          { excuse: 'The framework tests this already.', counter: 'Framework tests test the framework, not your contract.' },
        ],
        namespaces: ['aza-test'],
        smoke_test: { command: 'pnpm vitest run', expected: 'passed' },
        task_sources: ['md'],
        isolation: 'worktree',
        language: 'both', author: 'azaloop-core', registered_at: now,
      } as any,
      {
        name: 'deploy', version: '1.1.0', type: 'workflow',
        description: 'Use when shipping to staging or production — runs the deploy checklist and confirms health checks before merging.',
        tags: ['deploy', 'release', 'ci-cd'],
        when_to_use: 'shipping to staging or production',
        red_flags: [
          { thought: 'Just push, it has worked before.', reality: 'It worked because of the checks you are about to skip.' },
        ],
        namespaces: ['aza-deploy'],
        smoke_test: { command: 'pnpm vitest run tests/integration/deploy.test.ts', expected: 'passed' },
        task_sources: ['md'],
        language: 'both', author: 'azaloop-core', registered_at: now,
      } as any,
      {
        name: 'security', version: '1.1.0', type: 'analysis',
        description: 'Use when auditing the codebase for OWASP-top-10, secrets, prompt injection, MCP poisoning, or data exfiltration — runs all 8 scanners.',
        tags: ['security', 'audit', 'owasp'],
        when_to_use: 'auditing the codebase for security issues',
        red_flags: [
          { thought: 'We are internal-only, security scan is overkill.', reality: 'Internal-only repos leak secrets via git history.' },
        ],
        namespaces: ['aza-sec'],
        smoke_test: { command: 'pnpm vitest run tests/integration/security.test.ts', expected: 'passed' },
        task_sources: ['md'],
        language: 'both', author: 'azaloop-core', registered_at: now,
      } as any,
      {
        name: 'review', version: '1.1.0', type: 'workflow',
        description: 'Use when reviewing code changes — runs the two-stage subagent review (spec compliance → code quality) and produces a severity-tagged verdict.',
        tags: ['review', 'code-quality', 'best-practices'],
        when_to_use: 'reviewing code changes',
        red_flags: [
          { thought: 'LGTM in 5s, the diff is small.', reality: 'Small diffs are where the most catastrophic bugs hide.' },
        ],
        namespaces: ['aza-review'],
        smoke_test: { command: 'pnpm vitest run tests/integration/review.test.ts', expected: 'passed' },
        task_sources: ['md'],
        language: 'both', author: 'azaloop-core', registered_at: now,
      } as any,
    ];
    for (const skill of core) {
      this.register(skill);
    }
  }
}
