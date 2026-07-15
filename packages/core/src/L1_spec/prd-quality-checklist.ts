/**
 * PRD 质量自查清单（V21 新增）
 *
 * 借鉴 check-prd-skill 的结构化检查方法，用确定性规则替代纯 LLM 判断。
 * 每个检查项都是可执行的 pass/fail 判定，不依赖 LLM 主观评估。
 *
 * 检查项分 4 大类（对应 4 维度评分）：
 * 1. 规范完整性（17 项）
 * 2. 业务清晰度（14 项）
 * 3. 风险可识别性（12 项）
 * 4. 可测试/可落地性（11 项）
 *
 * 总计 54 项检查，每项约 1.85 分，满分 100 分。
 */

import type { PRD, Story, AcceptanceCriteria } from '@azaloop/shared';

// ── Types ──

export interface ChecklistItem {
  id: string;
  category: ChecklistCategory;
  description: string;
  passed: boolean;
  severity: 'P0' | 'P1' | 'P2';
  details?: string;
}

export type ChecklistCategory =
  | 'completeness'
  | 'clarity'
  | 'risk'
  | 'testability';

export interface ChecklistResult {
  totalScore: number;
  passed: boolean;
  items: ChecklistItem[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    p0Failed: number;
    p1Failed: number;
  };
  blockers: string[];
}

// ── Checklist Runner ──

export class PrdQualityChecklist {
  /**
   * 运行完整自查清单
   */
  run(prd: PRD): ChecklistResult {
    const items: ChecklistItem[] = [
      ...this.checkCompleteness(prd),
      ...this.checkClarity(prd),
      ...this.checkRisk(prd),
      ...this.checkTestability(prd),
    ];

    const passed = items.filter((i) => i.passed).length;
    const failed = items.length - passed;
    const p0Failed = items.filter((i) => !i.passed && i.severity === 'P0').length;
    const p1Failed = items.filter((i) => !i.passed && i.severity === 'P1').length;

    const totalScore = Math.round((passed / items.length) * 100);
    const blockers = items
      .filter((i) => !i.passed && (i.severity === 'P0' || i.severity === 'P1'))
      .map((i) => `[${i.severity}] ${i.id}: ${i.description}${i.details ? ` — ${i.details}` : ''}`);

    return {
      totalScore,
      passed: p0Failed === 0 && totalScore >= 75,
      items,
      summary: { total: items.length, passed, failed, p0Failed, p1Failed },
      blockers,
    };
  }

  // ── Category 1: 规范完整性（14 项） ──

  private checkCompleteness(prd: PRD): ChecklistItem[] {
    return [
      // C-1: overview 存在且 ≥100 字
      this.makeItem('C-1', 'completeness', 'overview 存在且 ≥100 字',
        !!prd.overview && prd.overview.length >= 100,
        'P0',
        `当前长度: ${prd.overview?.length ?? 0}`),

      // C-2: overview 包含痛点描述
      this.makeItem('C-2', 'completeness', 'overview 包含痛点/问题描述',
        /痛点|问题|挑战|pain|problem|challenge/i.test(prd.overview || ''),
        'P0',
        'overview 应描述用户面临的核心痛点'),

      // C-3: overview 引用竞品（≥2 个 URL 或名称）
      this.makeItem('C-3', 'completeness', 'overview 引用竞品（≥2 个）',
        this.countCompetitorRefs(prd.overview || '') >= 2,
        'P1',
        `竞品引用数: ${this.countCompetitorRefs(prd.overview || '')}`),

      // C-4: overview 说明差异化
      this.makeItem('C-4', 'completeness', 'overview 说明差异化/独特价值',
        /差异|独特|不同|优势|differentiat|unique|advantage/i.test(prd.overview || ''),
        'P1',
        'overview 应说明与竞品的差异化'),

      // C-5: goals ≥ 2 个
      this.makeItem('C-5', 'completeness', 'goals 数量 ≥ 2',
        !!prd.goals && prd.goals.length >= 2,
        'P0',
        `当前数量: ${prd.goals?.length ?? 0}`),

      // C-6: 每个 goal 可测量（含指标或可观察结果）
      this.makeItem('C-6', 'completeness', '每个 goal 可测量',
        (prd.goals || []).every((g) => this.isMeasurableGoal(g)),
        'P1',
        'goal 应包含具体指标或可观察结果'),

      // C-7: target_users ≥ 1
      this.makeItem('C-7', 'completeness', 'target_users 数量 ≥ 1',
        !!prd.target_users && prd.target_users.length >= 1,
        'P1',
        '未定义目标用户'),

      // C-8: functional_requirements ≥ 2
      this.makeItem('C-8', 'completeness', 'functional_requirements 数量 ≥ 2',
        !!prd.functional_requirements && prd.functional_requirements.length >= 2,
        'P0',
        `当前数量: ${prd.functional_requirements?.length ?? 0}`),

      // C-9: stories 数量符合复杂度要求
      this.makeItem('C-9', 'completeness', 'stories 数量符合复杂度',
        this.checkStoryCount(prd),
        'P1',
        `当前 stories: ${prd.stories?.length ?? 0}`),

      // C-10: 每个 story 有 acceptance_criteria
      this.makeItem('C-10', 'completeness', '每个 story 有 acceptance_criteria',
        (prd.stories || []).every((s) => !!s.acceptance_criteria && s.acceptance_criteria.length >= 1),
        'P0',
        `${(prd.stories || []).filter((s) => !s.acceptance_criteria || s.acceptance_criteria.length === 0).length} 个 story 缺少 AC`),

      // C-11: architecture 有 mermaid 图
      this.makeItem('C-11', 'completeness', 'architecture 包含 mermaid 图',
        !!prd.architecture && prd.architecture.length >= 1 && !!prd.architecture[0]?.mermaid,
        'P0',
        '缺少架构图'),

      // C-12: risks ≥ 1
      this.makeItem('C-12', 'completeness', 'risks 数量 ≥ 1',
        !!prd.risks && prd.risks.length >= 1,
        'P1',
        '未识别任何风险'),

      // C-13: 每个 risk 有 mitigation
      this.makeItem('C-13', 'completeness', '每个 risk 有 mitigation',
        (prd.risks || []).every((r) => !!r.mitigation && r.mitigation.length > 5),
        'P1',
        `${(prd.risks || []).filter((r) => !r.mitigation || r.mitigation.length <= 5).length} 个风险缺少缓解措施`),

      // C-14: PRD 有 id/title/version/created_at
      this.makeItem('C-14', 'completeness', 'PRD 基础元数据完整',
        !!prd.id && !!prd.title && !!prd.version && !!prd.created_at,
        'P0',
        '缺少 id/title/version/created_at'),

      // C-15: 非功能需求有具体指标（如响应时间<500ms，可用性99.9%）
      this.makeItem('C-15', 'completeness', '非功能需求有具体指标',
        (prd.non_functional_requirements || []).every((nfr) =>
          /\d+\s*(ms|秒|分钟|小时|天|%|MB|GB|次|个|条|px)|≤|≥|<|>|\d+\.\d+/.test(nfr.description)
        ),
        'P0',
        `${(prd.non_functional_requirements || []).filter((nfr) => !/\d+\s*(ms|秒|分钟|小时|天|%|MB|GB|次|个|条|px)|≤|≥|<|>|\d+\.\d+/.test(nfr.description)).length} 个 NFR 缺少具体指标`),

      // C-16: 每个 story 有 dependencies 字段（即使为空数组）
      this.makeItem('C-16', 'completeness', '每个 story 有 dependencies 字段',
        (prd.stories || []).every((s) => 'dependencies' in s && Array.isArray(s.dependencies)),
        'P1',
        `${(prd.stories || []).filter((s) => !('dependencies' in s) || !Array.isArray(s.dependencies)).length} 个 story 缺少 dependencies 字段`),

      // C-17: PRD 有 updated_at 字段且 >= created_at
      this.makeItem('C-17', 'completeness', 'PRD 有 updated_at 且 >= created_at',
        !!prd.updated_at && !!prd.created_at && new Date(prd.updated_at) >= new Date(prd.created_at),
        'P1',
        `updated_at: ${prd.updated_at || '缺失'}, created_at: ${prd.created_at || '缺失'}`),
    ];
  }

  // ── Category 2: 业务清晰度（10 项） ──

  private checkClarity(prd: PRD): ChecklistItem[] {
    const allText = JSON.stringify(prd).toLowerCase();
    const allACs = [
      ...(prd.acceptance_criteria || []),
      ...(prd.stories || []).flatMap((s) => s.acceptance_criteria || []),
    ];

    return [
      // CL-1: 无模糊副词
      this.makeItem('CL-1', 'clarity', '无模糊副词（尽量/必要时/适当）',
        !/尽量|必要时|适当|合理(?:地)?|尽可能|as soon as possible/i.test(allText),
        'P1',
        '发现模糊副词'),

      // CL-2: 无空洞形容词
      this.makeItem('CL-2', 'clarity', '无空洞形容词（更好的/优秀的/强大的）',
        !/更好的|优秀的|强大的|卓越的|outstanding|excellent|powerful|robust/i.test(allText),
        'P1',
        '发现空洞形容词'),

      // CL-3: 无 TBD/待补充 占位符
      this.makeItem('CL-3', 'clarity', '无 TBD/待补充 占位符',
        !/TBD|待补充|待完善|TODO|FIXME|稍后完善/i.test(allText),
        'P0',
        '发现占位符'),

      // CL-4: story description 遵循 "作为X，我希望Y，以便Z" 格式
      this.makeItem('CL-4', 'clarity', 'story 遵循用户故事格式',
        (prd.stories || []).every((s) =>
          /作为|as a/i.test(s.description) && /希望|I want|I need/i.test(s.description)
        ),
        'P1',
        `${(prd.stories || []).filter((s) => !/作为|as a/i.test(s.description)).length} 个 story 不符合格式`),

      // CL-5: 无「实现功能」类废话需求
      this.makeItem('CL-5', 'clarity', '需求描述具体（非废话）',
        (prd.functional_requirements || []).every((fr) =>
          !/实现.*功能|提供.*服务|支持.*操作|implement.*feature/i.test(fr.description)
        ),
        'P1',
        '发现废话需求'),

      // CL-6: 每个 FR 有 priority
      this.makeItem('CL-6', 'clarity', '每个 FR 有 priority',
        (prd.functional_requirements || []).every((fr) => !!fr.priority),
        'P1',
        `${(prd.functional_requirements || []).filter((fr) => !fr.priority).length} 个 FR 缺少 priority`),

      // CL-7: 每个 story 有 priority
      this.makeItem('CL-7', 'clarity', '每个 story 有 priority',
        (prd.stories || []).every((s) => !!s.priority),
        'P1',
        `${(prd.stories || []).filter((s) => !s.priority).length} 个 story 缺少 priority`),

      // CL-8: P0 story 数量 ≤ 3（MVP 聚焦）
      this.makeItem('CL-8', 'clarity', 'P0 story 数量 ≤ 3（MVP 聚焦）',
        (prd.stories || []).filter((s) => s.priority === 'P0').length <= 3,
        'P1',
        `P0 story: ${(prd.stories || []).filter((s) => s.priority === 'P0').length} 个`),

      // CL-9: 无重复 story（标题相似度 < 80%）
      this.makeItem('CL-9', 'clarity', '无重复 story',
        !this.hasDuplicateStories(prd),
        'P2',
        '发现相似 story'),

      // CL-10: 术语一致性（无同义词混用）
      this.makeItem('CL-10', 'clarity', '术语一致性',
        !this.hasTerminologyInconsistency(prd),
        'P2',
        '发现术语不一致'),

      // CL-11: 每个 FR 描述 >= 20 字（非空洞）
      this.makeItem('CL-11', 'clarity', '每个 FR 描述 >= 20 字',
        (prd.functional_requirements || []).every((fr) => fr.description.length >= 20),
        'P1',
        `${(prd.functional_requirements || []).filter((fr) => fr.description.length < 20).length} 个 FR 描述过短（<20字）`),

      // CL-12: story title 不含实现细节（只描述what不描述how）
      this.makeItem('CL-12', 'clarity', 'story title 不含实现细节',
        (prd.stories || []).every((s) =>
          !/使用|用|通过|调用|implement|using|via|call|invoke/i.test(s.title)
        ),
        'P1',
        `${(prd.stories || []).filter((s) => /使用|用|通过|调用|implement|using|via|call|invoke/i.test(s.title)).length} 个 story 标题包含实现细节`),

      // CL-13: AC 不包含「系统应该」开头的表述
      this.makeItem('CL-13', 'clarity', 'AC 不以「系统应该」开头',
        !allACs.some((ac) => /^系统应该|^the system should/i.test(ac.description.trim())),
        'P1',
        `${allACs.filter((ac) => /^系统应该|^the system should/i.test(ac.description.trim())).length} 条 AC 以「系统应该」开头`),

      // CL-14: overview 不含「这是一个」「该」等空洞开头
      this.makeItem('CL-14', 'clarity', 'overview 不含空洞开头',
        !/^(?:这是一个|该|本)(?:项目|系统|产品|平台)/i.test((prd.overview || '').trim()),
        'P2',
        'overview 以空洞表述开头'),
    ];
  }

  // ── Category 3: 风险可识别性（8 项） ──

  private checkRisk(prd: PRD): ChecklistItem[] {
    return [
      // R-1: 高风险有 mitigation
      this.makeItem('R-1', 'risk', '高风险项都有 mitigation',
        (prd.risks || []).filter((r) => r.probability === 'high').every((r) => !!r.mitigation && r.mitigation.length > 10),
        'P0',
        '高风险项缺少缓解措施'),

      // R-2: 风险有 probability 标注
      this.makeItem('R-2', 'risk', '每个风险有 probability 标注',
        (prd.risks || []).every((r) => !!r.probability),
        'P1',
        `${(prd.risks || []).filter((r) => !r.probability).length} 个风险缺少概率标注`),

      // R-3: story AC 包含异常场景
      this.makeItem('R-3', 'risk', 'story AC 包含异常场景',
        (prd.stories || []).every((s) => this.hasExceptionScenario(s)),
        'P1',
        `${(prd.stories || []).filter((s) => !this.hasExceptionScenario(s)).length} 个 story 缺少异常场景`),

      // R-4: 包含网络/超时/错误处理
      this.makeItem('R-4', 'risk', '包含网络/超时/错误处理',
        this.hasNetworkErrorHandling(prd),
        'P1',
        '未覆盖网络/超时/错误场景'),

      // R-5: 包含权限/安全考虑
      this.makeItem('R-5', 'risk', '包含权限/安全考虑',
        this.hasSecurityConsideration(prd),
        'P1',
        '未考虑权限/安全'),

      // R-6: 包含数据一致性/丢失风险
      this.makeItem('R-6', 'risk', '包含数据一致性考虑',
        this.hasDataConsistencyConsideration(prd),
        'P2',
        '未考虑数据一致性'),

      // R-7: 包含性能/容量考虑
      this.makeItem('R-7', 'risk', '包含性能/容量考虑',
        this.hasPerformanceConsideration(prd),
        'P2',
        '未考虑性能/容量'),

      // R-8: NFR 包含可靠性/可用性指标
      this.makeItem('R-8', 'risk', 'NFR 包含可靠性指标',
        (prd.non_functional_requirements || []).some((nfr) =>
          /可靠|可用|availability|reliability|uptime|SLA/i.test(nfr.description)
        ),
        'P2',
        'NFR 缺少可靠性指标'),

      // R-9: 每个 story 的 AC 覆盖输入验证场景
      this.makeItem('R-9', 'risk', 'story AC 覆盖输入验证',
        (prd.stories || []).every((s) => this.hasInputValidationScenario(s)),
        'P1',
        `${(prd.stories || []).filter((s) => !this.hasInputValidationScenario(s)).length} 个 story 缺少输入验证场景`),

      // R-10: 包含并发/竞态条件考虑
      this.makeItem('R-10', 'risk', '包含并发/竞态条件考虑',
        this.hasConcurrencyConsideration(prd),
        'P1',
        '未考虑并发/竞态条件'),

      // R-11: 包含数据备份/恢复策略
      this.makeItem('R-11', 'risk', '包含数据备份/恢复策略',
        this.hasBackupRecoveryStrategy(prd),
        'P1',
        '未包含数据备份/恢复策略'),

      // R-12: 高风险项有具体的 mitigation 步骤（>=20字）
      this.makeItem('R-12', 'risk', '高风险项 mitigation >= 20字',
        (prd.risks || []).filter((r) => r.probability === 'high').every((r) => !!r.mitigation && r.mitigation.length >= 20),
        'P0',
        `${(prd.risks || []).filter((r) => r.probability === 'high' && (!r.mitigation || r.mitigation.length < 20)).length} 个高风险项 mitigation 过短`),
    ];
  }

  // ── Category 4: 可测试/可落地性（8 项） ──

  private checkTestability(prd: PRD): ChecklistItem[] {
    const allACs = [
      ...(prd.acceptance_criteria || []),
      ...(prd.stories || []).flatMap((s) => s.acceptance_criteria || []),
    ];

    return [
      // T-1: 每条 AC 可测试（有具体数值/条件/结果）
      this.makeItem('T-1', 'testability', '每条 AC 可测试',
        allACs.every((ac) => this.isTestableAC(ac)),
        'P0',
        `${allACs.filter((ac) => !this.isTestableAC(ac)).length} 条 AC 不可测试`),

      // T-2: 无空洞 AC（works as expected 等）
      this.makeItem('T-2', 'testability', '无空洞 AC',
        !allACs.some((ac) => this.isEmptyAC(ac)),
        'P0',
        '发现空洞 AC'),

      // T-3: AC 包含具体数值/阈值
      this.makeItem('T-3', 'testability', 'AC 包含具体数值/阈值',
        allACs.some((ac) => this.hasNumericThreshold(ac)),
        'P1',
        'AC 缺少具体数值'),

      // T-4: AC 覆盖正常+异常路径
      this.makeItem('T-4', 'testability', 'AC 覆盖正常+异常路径',
        this.acCoversBothPaths(allACs),
        'P1',
        'AC 只覆盖正常路径'),

      // T-5: 每个 story 至少 1 条 AC
      this.makeItem('T-5', 'testability', '每个 story 至少 1 条 AC',
        (prd.stories || []).every((s) => !!s.acceptance_criteria && s.acceptance_criteria.length >= 1),
        'P0',
        `${(prd.stories || []).filter((s) => !s.acceptance_criteria || s.acceptance_criteria.length === 0).length} 个 story 缺少 AC`),

      // T-6: AC 无歧义（不含「体验更好」等）
      this.makeItem('T-6', 'testability', 'AC 无歧义表述',
        !allACs.some((ac) => this.hasAmbiguousAC(ac)),
        'P1',
        '发现歧义 AC'),

      // T-7: 全局 AC 与 story AC 不重复
      this.makeItem('T-7', 'testability', '全局 AC 与 story AC 不重复',
        !this.hasDuplicateACs(prd),
        'P2',
        '发现重复 AC'),

      // T-8: 每个 FR 可追溯到至少 1 个 story
      this.makeItem('T-8', 'testability', 'FR 可追溯到 story',
        this.checkFRTraceability(prd),
        'P2',
        '部分 FR 无法追溯到 story'),

      // T-9: 每个 AC 有明确的 pass/fail 判定条件
      this.makeItem('T-9', 'testability', '每个 AC 有明确 pass/fail 判定',
        allACs.every((ac) => this.hasPassFailCriteria(ac)),
        'P0',
        `${allACs.filter((ac) => !this.hasPassFailCriteria(ac)).length} 条 AC 缺少明确判定条件`),

      // T-10: AC 描述包含具体的输入数据或条件
      this.makeItem('T-10', 'testability', 'AC 包含具体输入数据/条件',
        allACs.every((ac) => this.hasConcreteInputData(ac)),
        'P1',
        `${allACs.filter((ac) => !this.hasConcreteInputData(ac)).length} 条 AC 缺少具体输入数据`),

      // T-11: 全局 AC 与 story AC 无矛盾
      this.makeItem('T-11', 'testability', '全局 AC 与 story AC 无矛盾',
        !this.hasContradictoryACs(prd),
        'P1',
        '发现全局 AC 与 story AC 矛盾'),
    ];
  }

  // ── Helper Methods ──

  private makeItem(
    id: string,
    category: ChecklistCategory,
    description: string,
    passed: boolean,
    severity: 'P0' | 'P1' | 'P2',
    details?: string,
  ): ChecklistItem {
    return { id, category, description, passed, severity, details };
  }

  private countCompetitorRefs(text: string): number {
    const urlMatches = text.match(/https?:\/\/[^\s)]+/g) || [];
    const githubMatches = text.match(/github\.com\/[^\s)]+/g) || [];
    const nameMatches = text.match(/(?:竞品|competitor|similar to|like)\s+[A-Z][a-zA-Z]+/g) || [];
    return new Set([...urlMatches, ...githubMatches, ...nameMatches]).size;
  }

  private isMeasurableGoal(goal: string): boolean {
    return /%|指标|提升|降低|减少|增加|达到|≤|≥|<|>|ms|秒|天|周|月|用户|收入|转化|留存|metric|increase|decrease|reduce|achieve/i.test(goal);
  }

  private checkStoryCount(prd: PRD): boolean {
    const complexity = (prd as any)._complexity || 'L2';
    const counts: Record<string, number> = { L1: 2, L2: 3, L3: 5, L4: 6 };
    const expected = counts[complexity] || 3;
    return (prd.stories?.length || 0) >= expected;
  }

  private hasDuplicateStories(prd: PRD): boolean {
    const titles = (prd.stories || []).map((s) => s.title.toLowerCase());
    for (let i = 0; i < titles.length; i++) {
      for (let j = i + 1; j < titles.length; j++) {
        const titleI = titles[i] || '';
        const titleJ = titles[j] || '';
        if (this.similarity(titleI, titleJ) > 0.8) return true;
      }
    }
    return false;
  }

  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }

  private hasTerminologyInconsistency(prd: PRD): boolean {
    const text = JSON.stringify(prd).toLowerCase();
    // Check for mixed synonyms
    const pairs: [string, string][] = [
      ['用户', '客户'],
      ['请求', '需求'],
      ['模块', '组件'],
    ];
    return pairs.some(([a, b]) => text.includes(a) && text.includes(b));
  }

  private hasExceptionScenario(story: Story): boolean {
    const acText = (story.acceptance_criteria || [])
      .map((ac) => ac.description)
      .join(' ')
      .toLowerCase();
    return /失败|错误|异常|超时|网络|断开|无效|拒绝|overflow|fail|error|exception|timeout|invalid|reject/i.test(acText);
  }

  private hasNetworkErrorHandling(prd: PRD): boolean {
    const text = JSON.stringify(prd).toLowerCase();
    return /网络|超时|断线|重试|错误码|network|timeout|retry|error code/i.test(text);
  }

  private hasSecurityConsideration(prd: PRD): boolean {
    const text = JSON.stringify(prd).toLowerCase();
    return /权限|认证|授权|加密|安全|角色|permission|auth|encrypt|security|role/i.test(text);
  }

  private hasDataConsistencyConsideration(prd: PRD): boolean {
    const text = JSON.stringify(prd).toLowerCase();
    return /一致|回滚|事务|并发|锁|consistency|rollback|transaction|concurrent|lock/i.test(text);
  }

  private hasPerformanceConsideration(prd: PRD): boolean {
    const text = JSON.stringify(prd).toLowerCase();
    return /性能|响应|吞吐|内存|cpu|缓存|performance|response|throughput|memory|cache/i.test(text);
  }

  private isTestableAC(ac: AcceptanceCriteria): boolean {
    if (ac.testable === false) return false;
    const desc = ac.description.toLowerCase();
    // Must have concrete condition or measurable outcome
    const hasConcrete = /当|如果|given|when|then|输入|输出|返回|显示|创建|删除|更新|查询|\d|≤|≥|<|>|秒|ms|%/.test(desc);
    const isVague = /系统应该|应该保证|用户体验.*好|尽量|尽可能|system should|user experience.*good/i.test(desc);
    return hasConcrete && !isVague;
  }

  private isEmptyAC(ac: AcceptanceCriteria): boolean {
    const desc = ac.description.toLowerCase();
    return /works as expected|as described|正确运行|正常运行|功能正常|符合预期| behaves correctly/i.test(desc);
  }

  private hasNumericThreshold(ac: AcceptanceCriteria): boolean {
    return /\d+\s*(%|ms|秒|分钟|小时|天|次|个|条|MB|GB|px|em|rem)|≤|≥|<|>|\d+\.\d+/.test(ac.description);
  }

  private acCoversBothPaths(acs: AcceptanceCriteria[]): boolean {
    const text = acs.map((ac) => ac.description).join(' ').toLowerCase();
    const hasNormal = /成功|正常|正确|输入|创建|显示|success|normal|create|display/i.test(text);
    const hasAbnormal = /失败|错误|异常|超时|无效|拒绝|fail|error|exception|timeout|invalid|reject/i.test(text);
    return hasNormal && hasAbnormal;
  }

  private hasAmbiguousAC(ac: AcceptanceCriteria): boolean {
    return /体验更好|尽量|必要时|适当|合理|快速|高效|better|as soon as possible|optimize/i.test(ac.description);
  }

  private hasDuplicateACs(prd: PRD): boolean {
    const globalACs = (prd.acceptance_criteria || []).map((ac) => ac.description.toLowerCase());
    const storyACs = (prd.stories || []).flatMap((s) =>
      (s.acceptance_criteria || []).map((ac) => ac.description.toLowerCase())
    );
    return globalACs.some((gac) => storyACs.some((sac) => this.similarity(gac, sac) > 0.8));
  }

  private checkFRTraceability(prd: PRD): boolean {
    // Simple heuristic: each FR description should share keywords with at least one story
    const storyTexts = (prd.stories || []).map((s) =>
      `${s.title} ${s.description}`.toLowerCase()
    );
    return (prd.functional_requirements || []).every((fr) => {
      const frWords = fr.description.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      return storyTexts.some((st) =>
        frWords.some((w) => st.includes(w))
      );
    });
  }

  private hasInputValidationScenario(story: Story): boolean {
    const acText = (story.acceptance_criteria || [])
      .map((ac) => ac.description)
      .join(' ')
      .toLowerCase();
    return /输入|验证|校验|格式|无效|非法|空值|必填|input|valid|format|invalid|null|empty|required/i.test(acText);
  }

  private hasConcurrencyConsideration(prd: PRD): boolean {
    const text = JSON.stringify(prd).toLowerCase();
    return /并发|竞态|锁|队列|同步|异步|concurrent|race|lock|queue|sync|async/i.test(text);
  }

  private hasBackupRecoveryStrategy(prd: PRD): boolean {
    const text = JSON.stringify(prd).toLowerCase();
    return /备份|恢复|容灾|回滚|灾备|backup|recovery|disaster|rollback/i.test(text);
  }

  private hasPassFailCriteria(ac: AcceptanceCriteria): boolean {
    const desc = ac.description.toLowerCase();
    // Must have clear pass/fail indicators
    return /当|如果|given|when|then|输入|输出|返回|显示|创建|删除|更新|查询|成功|失败|错误|通过|不通过|input|output|return|display|create|delete|update|query|success|fail|error|pass|fail/i.test(desc);
  }

  private hasConcreteInputData(ac: AcceptanceCriteria): boolean {
    const desc = ac.description.toLowerCase();
    // Must have concrete input data or conditions
    return /输入|数据|参数|字段|值|条件|场景|用户|点击|选择|填写|input|data|parameter|field|value|condition|scenario|user|click|select|fill/i.test(desc);
  }

  private hasContradictoryACs(prd: PRD): boolean {
    const globalACs = (prd.acceptance_criteria || []).map((ac) => ac.description.toLowerCase());
    const storyACs = (prd.stories || []).flatMap((s) =>
      (s.acceptance_criteria || []).map((ac) => ac.description.toLowerCase())
    );
    
    // Check for obvious contradictions (e.g., one says "must" and another says "should not")
    const contradictionPairs: Array<[string, string]> = [
      ['必须', '不应该'],
      ['需要', '禁止'],
      ['应该', '不能'],
      ['must', 'should not'],
      ['required', 'forbidden'],
      ['should', 'cannot'],
    ];
    
    return globalACs.some((gac) => 
      storyACs.some((sac) => {
        // If they're very similar but contain contradictory terms
        if (this.similarity(gac, sac) > 0.6) {
          return contradictionPairs.some(([a, b]) => 
            (gac.includes(a) && sac.includes(b)) || (gac.includes(b) && sac.includes(a))
          );
        }
        return false;
      })
    );
  }
}
