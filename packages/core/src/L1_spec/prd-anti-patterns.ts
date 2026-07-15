/**
 * PRD 反模式检测（V21 新增）
 *
 * 借鉴 pm-claude-skills 的反模式检测思路，识别 PRD 中常见的低质量模式。
 * 每个反模式都有明确的检测规则和修复建议。
 *
 * 反模式分类：
 * 1. 结构反模式（5 项）：孤儿 Story、孤岛 FR、缺失架构图等
 * 2. 内容反模式（8 项）：空洞目标、模糊需求、空洞 AC 等
 * 3. 逻辑反模式（5 项）：循环依赖、P0 过多、缺失优先级等
 * 4. 表述反模式（6 项）：模糊副词、空洞形容词、占位符等
 *
 * 总计 24 项反模式检测。
 */

import type { PRD } from '@azaloop/shared';

// ── Types ──

export interface AntiPattern {
  id: string;
  category: AntiPatternCategory;
  name: string;
  description: string;
  severity: 'P0' | 'P1' | 'P2';
  location: string;
  suggestion: string;
}

export type AntiPatternCategory =
  | 'structural'
  | 'content'
  | 'logical'
  | 'wording';

export interface AntiPatternResult {
  detected: boolean;
  patterns: AntiPattern[];
  summary: {
    total: number;
    p0: number;
    p1: number;
    p2: number;
  };
  recommendations: string[];
}

// ── Anti-Pattern Detector ──

export class PrdAntiPatternDetector {
  /**
   * 检测 PRD 中的反模式
   */
  detect(prd: PRD): AntiPatternResult {
    const patterns: AntiPattern[] = [
      ...this.detectStructuralPatterns(prd),
      ...this.detectContentPatterns(prd),
      ...this.detectLogicalPatterns(prd),
      ...this.detectWordingPatterns(prd),
    ];

    const p0 = patterns.filter((p) => p.severity === 'P0').length;
    const p1 = patterns.filter((p) => p.severity === 'P1').length;
    const p2 = patterns.filter((p) => p.severity === 'P2').length;

    const recommendations = this.generateRecommendations(patterns);

    return {
      detected: patterns.length > 0,
      patterns,
      summary: { total: patterns.length, p0, p1, p2 },
      recommendations,
    };
  }

  // ── Category 1: 结构反模式（5 项） ──

  private detectStructuralPatterns(prd: PRD): AntiPattern[] {
    const patterns: AntiPattern[] = [];

    // S-1: 孤儿 Story（无 FR 支撑）
    const frKeywords = (prd.functional_requirements || []).flatMap((fr) =>
      fr.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    );
    for (const story of prd.stories || []) {
      const storyText = `${story.title} ${story.description}`.toLowerCase();
      const hasFRSupport = frKeywords.some((kw) => storyText.includes(kw));
      if (!hasFRSupport && frKeywords.length > 0) {
        patterns.push({
          id: 'S-1',
          category: 'structural',
          name: '孤儿 Story',
          description: `Story "${story.title}" 无功能需求支撑`,
          severity: 'P1',
          location: `stories[${story.id}]`,
          suggestion: '为每个 story 关联至少一个 functional_requirement',
        });
      }
    }

    // S-2: 孤岛 FR（无 Story 实现）
    for (const fr of prd.functional_requirements || []) {
      const frText = fr.description.toLowerCase();
      const hasStoryImpl = (prd.stories || []).some((s) => {
        const storyText = `${s.title} ${s.description}`.toLowerCase();
        const frWords = frText.split(/\s+/).filter((w) => w.length > 3);
        return frWords.some((w) => storyText.includes(w));
      });
      if (!hasStoryImpl) {
        patterns.push({
          id: 'S-2',
          category: 'structural',
          name: '孤岛 FR',
          description: `FR "${fr.id}" 无 story 实现`,
          severity: 'P1',
          location: `functional_requirements[${fr.id}]`,
          suggestion: '为每个 FR 创建至少一个 story 来实现',
        });
      }
    }

    // S-3: 缺失架构图（有 story 但无 architecture）
    if (prd.stories.length > 0 && (!prd.architecture || prd.architecture.length === 0)) {
      patterns.push({
        id: 'S-3',
        category: 'structural',
        name: '缺失架构图',
        description: '有 user story 但无架构图',
        severity: 'P0',
        location: 'architecture',
        suggestion: '添加 system architecture 图（mermaid 格式）',
      });
    }

    // S-4: 缺失风险识别（有 story 但无 risks）
    if (prd.stories.length > 0 && (!prd.risks || prd.risks.length === 0)) {
      patterns.push({
        id: 'S-4',
        category: 'structural',
        name: '缺失风险识别',
        description: '有 user story 但无风险识别',
        severity: 'P1',
        location: 'risks',
        suggestion: '识别至少 1 个风险并给出 mitigation',
      });
    }

    // S-5: Overview 过短（<100 字）
    if (!prd.overview || prd.overview.length < 100) {
      patterns.push({
        id: 'S-5',
        category: 'structural',
        name: 'Overview 过短',
        description: `overview 仅 ${prd.overview?.length || 0} 字，应 ≥100 字`,
        severity: 'P0',
        location: 'overview',
        suggestion: '扩展 overview，包含痛点、竞品、差异化',
      });
    }

    return patterns;
  }

  // ── Category 2: 内容反模式（8 项） ──

  private detectContentPatterns(prd: PRD): AntiPattern[] {
    const patterns: AntiPattern[] = [];
    const allText = JSON.stringify(prd).toLowerCase();

    // C-1: 空洞目标（无量化指标）
    for (const goal of prd.goals || []) {
      if (!/\d+%|\d+ms|\d+秒|\d+用户|\d+收入|提升|降低|增加|减少|达到|≤|≥|<|>/.test(goal)) {
        patterns.push({
          id: 'C-1',
          category: 'content',
          name: '空洞目标',
          description: `Goal "${goal.slice(0, 50)}..." 无量化指标`,
          severity: 'P1',
          location: `goals[${prd.goals.indexOf(goal)}]`,
          suggestion: '添加具体指标（如：提升 20%、降低 50ms、达到 1000 用户）',
        });
      }
    }

    // C-2: 模糊需求（「实现功能」「提供服务」）
    for (const fr of prd.functional_requirements || []) {
      if (/实现.*功能|提供.*服务|支持.*操作|implement.*feature|provide.*service/i.test(fr.description)) {
        patterns.push({
          id: 'C-2',
          category: 'content',
          name: '模糊需求',
          description: `FR "${fr.id}" 描述模糊`,
          severity: 'P1',
          location: `functional_requirements[${fr.id}]`,
          suggestion: '具体描述「做什么」而非「实现功能」',
        });
      }
    }

    // C-3: 空洞 AC（「works as expected」）
    const allACs = [
      ...(prd.acceptance_criteria || []),
      ...(prd.stories || []).flatMap((s) => s.acceptance_criteria || []),
    ];
    for (const ac of allACs) {
      if (/works as expected|as described|正确运行|正常运行|功能正常|符合预期/i.test(ac.description)) {
        patterns.push({
          id: 'C-3',
          category: 'content',
          name: '空洞 AC',
          description: `AC "${ac.id}" 表述空洞`,
          severity: 'P0',
          location: `acceptance_criteria[${ac.id}]`,
          suggestion: '用具体条件+结果替代「works as expected」',
        });
      }
    }

    // C-4: 缺失异常处理（story AC 只描述正常流程）
    for (const story of prd.stories || []) {
      const acText = (story.acceptance_criteria || [])
        .map((ac) => ac.description)
        .join(' ')
        .toLowerCase();
      const hasNormal = /成功|正常|正确|输入|创建|显示|success|normal|create|display/i.test(acText);
      const hasAbnormal = /失败|错误|异常|超时|无效|拒绝|fail|error|exception|timeout|invalid|reject/i.test(acText);
      if (hasNormal && !hasAbnormal) {
        patterns.push({
          id: 'C-4',
          category: 'content',
          name: '缺失异常处理',
          description: `Story "${story.title}" 只描述正常流程`,
          severity: 'P1',
          location: `stories[${story.id}].acceptance_criteria`,
          suggestion: '补充异常场景（如：网络失败、输入无效、超时）',
        });
      }
    }

    // C-5: 缺失竞品引用（overview 无 github URL 或竞品名称）
    const overviewText = prd.overview || '';
    const hasCompetitorRef = /github\.com\/|竞品|competitor|similar to|like\s+[A-Z]/i.test(overviewText);
    if (!hasCompetitorRef && overviewText.length > 50) {
      patterns.push({
        id: 'C-5',
        category: 'content',
        name: '缺失竞品引用',
        description: 'overview 未引用竞品',
        severity: 'P1',
        location: 'overview',
        suggestion: '引用至少 2 个竞品（github URL 或名称）',
      });
    }

    // C-6: 缺失差异化说明
    if (!/差异|独特|不同|优势|differentiat|unique|advantage/i.test(overviewText)) {
      patterns.push({
        id: 'C-6',
        category: 'content',
        name: '缺失差异化说明',
        description: 'overview 未说明差异化',
        severity: 'P1',
        location: 'overview',
        suggestion: '说明与竞品的差异化优势',
      });
    }

    // C-7: 高风险无 mitigation
    for (const risk of prd.risks || []) {
      if (risk.probability === 'high' && (!risk.mitigation || risk.mitigation.length < 10)) {
        patterns.push({
          id: 'C-7',
          category: 'content',
          name: '高风险无 mitigation',
          description: `风险 "${risk.description.slice(0, 50)}..." 无缓解措施`,
          severity: 'P0',
          location: `risks[${prd.risks.indexOf(risk)}]`,
          suggestion: '为高风险项添加具体 mitigation（≥10 字）',
        });
      }
    }

    // C-8: 缺失非功能需求（无 NFR）
    if (!prd.non_functional_requirements || prd.non_functional_requirements.length === 0) {
      patterns.push({
        id: 'C-8',
        category: 'content',
        name: '缺失非功能需求',
        description: '未定义非功能需求（性能、安全、可靠性等）',
        severity: 'P2',
        location: 'non_functional_requirements',
        suggestion: '添加 NFR（如：响应时间 < 500ms、可用性 99.9%）',
      });
    }

    return patterns;
  }

  // ── Category 3: 逻辑反模式（5 项） ──

  private detectLogicalPatterns(prd: PRD): AntiPattern[] {
    const patterns: AntiPattern[] = [];

    // L-1: 循环依赖（story A 依赖 B，B 依赖 A）
    const storyDeps = new Map<string, Set<string>>();
    for (const story of prd.stories || []) {
      const deps = new Set(story.dependencies || []);
      storyDeps.set(story.id, deps);
    }
    for (const [storyId, deps] of storyDeps) {
      for (const depId of deps) {
        if (storyDeps.get(depId)?.has(storyId)) {
          patterns.push({
            id: 'L-1',
            category: 'logical',
            name: '循环依赖',
            description: `Story ${storyId} 和 ${depId} 循环依赖`,
            severity: 'P0',
            location: `stories[${storyId}].dependencies`,
            suggestion: '打破循环依赖，引入中间 story 或重构依赖关系',
          });
        }
      }
    }

    // L-2: P0 Story 过多（>3 个，违反 MVP 聚焦）
    const p0Stories = (prd.stories || []).filter((s) => s.priority === 'P0');
    if (p0Stories.length > 3) {
      patterns.push({
        id: 'L-2',
        category: 'logical',
        name: 'P0 Story 过多',
        description: `${p0Stories.length} 个 P0 story，违反 MVP 聚焦原则`,
        severity: 'P1',
        location: 'stories',
        suggestion: '将 P0 story 控制在 ≤3 个，其余降级为 P1',
      });
    }

    // L-3: 缺失优先级（story 或 FR 无 priority）
    const missingPriorityStories = (prd.stories || []).filter((s) => !s.priority);
    const missingPriorityFRs = (prd.functional_requirements || []).filter((fr) => !fr.priority);
    if (missingPriorityStories.length > 0 || missingPriorityFRs.length > 0) {
      patterns.push({
        id: 'L-3',
        category: 'logical',
        name: '缺失优先级',
        description: `${missingPriorityStories.length} 个 story 和 ${missingPriorityFRs.length} 个 FR 缺少优先级`,
        severity: 'P1',
        location: 'stories/functional_requirements',
        suggestion: '为每个 story 和 FR 标注 priority（P0/P1/P2）',
      });
    }

    // L-4: 重复 Story（标题相似度 >80%）
    const stories = prd.stories || [];
    for (let i = 0; i < stories.length; i++) {
      for (let j = i + 1; j < stories.length; j++) {
        const titleI = stories[i]?.title || '';
        const titleJ = stories[j]?.title || '';
        const idI = stories[i]?.id || '';
        const sim = this.similarity(titleI.toLowerCase(), titleJ.toLowerCase());
        if (sim > 0.8) {
          patterns.push({
            id: 'L-4',
            category: 'logical',
            name: '重复 Story',
            description: `Story "${titleI}" 和 "${titleJ}" 相似度过高（${Math.round(sim * 100)}%）`,
            severity: 'P2',
            location: `stories[${idI}]`,
            suggestion: '合并相似 story 或明确区分',
          });
        }
      }
    }

    // L-5: 缺失验收标准（story 无 AC）
    const storiesWithoutAC = (prd.stories || []).filter(
      (s) => !s.acceptance_criteria || s.acceptance_criteria.length === 0
    );
    if (storiesWithoutAC.length > 0) {
      patterns.push({
        id: 'L-5',
        category: 'logical',
        name: '缺失验收标准',
        description: `${storiesWithoutAC.length} 个 story 无验收标准`,
        severity: 'P0',
        location: 'stories',
        suggestion: '为每个 story 添加至少 1 条可测试的 AC',
      });
    }

    return patterns;
  }

  // ── Category 4: 表述反模式（6 项） ──

  private detectWordingPatterns(prd: PRD): AntiPattern[] {
    const patterns: AntiPattern[] = [];
    const allText = JSON.stringify(prd);

    // W-1: 模糊副词（尽量、必要时、适当）
    if (/尽量|必要时|适当|合理(?:地)?|尽可能|as soon as possible/i.test(allText)) {
      patterns.push({
        id: 'W-1',
        category: 'wording',
        name: '模糊副词',
        description: '使用模糊副词（尽量、必要时、适当等）',
        severity: 'P1',
        location: '全文',
        suggestion: '用具体数值或条件替代模糊副词',
      });
    }

    // W-2: 空洞形容词（更好的、优秀的、强大的）
    if (/更好的|优秀的|强大的|卓越的|outstanding|excellent|powerful|robust/i.test(allText)) {
      patterns.push({
        id: 'W-2',
        category: 'wording',
        name: '空洞形容词',
        description: '使用空洞形容词（更好的、优秀的、强大的等）',
        severity: 'P2',
        location: '全文',
        suggestion: '用具体指标或对比替代空洞形容词',
      });
    }

    // W-3: 占位符（TBD、待补充、TODO）
    if (/TBD|待补充|待完善|TODO|FIXME|稍后完善/i.test(allText)) {
      patterns.push({
        id: 'W-3',
        category: 'wording',
        name: '占位符',
        description: '使用占位符（TBD、待补充、TODO等）',
        severity: 'P0',
        location: '全文',
        suggestion: '填充所有占位符，PRD 不应有未完成内容',
      });
    }

    // W-4: 术语不一致（混用同义词）
    const text = allText.toLowerCase();
    const synonymPairs: Array<[string, string]> = [
      ['用户', '客户'],
      ['请求', '需求'],
      ['模块', '组件'],
    ];
    for (const [a, b] of synonymPairs) {
      if (text.includes(a) && text.includes(b)) {
        patterns.push({
          id: 'W-4',
          category: 'wording',
          name: '术语不一致',
          description: `混用术语「${a}」和「${b}」`,
          severity: 'P2',
          location: '全文',
          suggestion: `统一使用「${a}」或「${b}」`,
        });
        break;
      }
    }

    // W-5: 未定义缩写（API、SDK、UI 等未解释）
    const abbreviations = ['API', 'SDK', 'UI', 'UX', 'SLA', 'KPI'];
    for (const abbr of abbreviations) {
      if (allText.includes(abbr) && !allText.includes(`${abbr}（`) && !allText.includes(`${abbr}(`)) {
        patterns.push({
          id: 'W-5',
          category: 'wording',
          name: '未定义缩写',
          description: `缩写 "${abbr}" 未定义`,
          severity: 'P2',
          location: '全文',
          suggestion: `首次使用 "${abbr}" 时给出全称（如：API（Application Programming Interface））`,
        });
      }
    }

    // W-6: 被动语态过多（「被」「由」使用过多）
    const passiveCount = (allText.match(/被|由/g) || []).length;
    if (passiveCount > 10) {
      patterns.push({
        id: 'W-6',
        category: 'wording',
        name: '被动语态过多',
        description: `被动语态使用过多（${passiveCount} 次）`,
        severity: 'P2',
        location: '全文',
        suggestion: '改用主动语态，提升可读性',
      });
    }

    return patterns;
  }

  // ── Helper Methods ──

  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }

  private generateRecommendations(patterns: AntiPattern[]): string[] {
    const recommendations: string[] = [];

    const p0Patterns = patterns.filter((p) => p.severity === 'P0');
    const p1Patterns = patterns.filter((p) => p.severity === 'P1');

    if (p0Patterns.length > 0) {
      recommendations.push(`【紧急】发现 ${p0Patterns.length} 个 P0 反模式，必须立即修复：`);
      p0Patterns.forEach((p, idx) => {
        recommendations.push(`  ${idx + 1}. ${p.name}：${p.suggestion}`);
      });
    }

    if (p1Patterns.length > 0) {
      recommendations.push(`【重要】发现 ${p1Patterns.length} 个 P1 反模式，建议修复：`);
      p1Patterns.forEach((p, idx) => {
        recommendations.push(`  ${idx + 1}. ${p.name}：${p.suggestion}`);
      });
    }

    if (patterns.length === 0) {
      recommendations.push('✓ 未检测到反模式，PRD 质量优秀');
    }

    return recommendations;
  }
}
