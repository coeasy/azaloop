/**
 * PRD LLM Prompts — V20 宿主 LLM 多步交互指令
 *
 * 借鉴：
 * - agent-skills 对抗式审查：reviewer 只收 ARTIFACT+CONTRACT，不收 CLAIM
 * - karpathy Rule 12 Fail Loud：禁止静默跳过
 * - gstack 4 角色审查：CEO/QA/Eng/Design
 *
 * 每个_prompt 都含「反合理化表」（借口 vs 现实），防止 LLM 走捷径。
 */

import type { PRD } from '@azaloop/shared';
import type { PRDGenerationInput, Complexity, ProductType } from './prd-generator';

// ── Types ──

export interface CompetitiveContext {
  competitors: Array<{ full_name: string; html_url: string; description: string }>;
  differentiators: string[];
  goals: string[];
  overview_appendix: string;
  risks: Array<{ description: string; probability: string; mitigation: string }>;
}

export interface ReviewFinding {
  role: 'ceo' | 'qa' | 'eng' | 'design';
  severity: 'P0' | 'P1' | 'P2' | 'info';
  message: string;
  passed: boolean;
  actionable: boolean;
}

export interface MultiRoleReviewResponse {
  findings: ReviewFinding[];
  summary: string;
  score: number;
  passed: boolean;
}

// ── Anti-rationalization table (借口 vs 现实) ──

export const ANTI_RATIONALIZATION_TABLE = `
## 反合理化表（借口 vs 现实）

| 借口 | 现实 |
|------|------|
| 「用户没说清楚」 | 应该用追问而非假设；列出明确假设并标注 |
| 「竞品都这么做」 | 应差异化而非跟随；说明为何本方案更优 |
| 「后续迭代再补」 | P0 缺陷必须当下修；P1 缺陷在当前 PRD 内闭环 |
| 「技术实现细节」 | PRD 不写实现细节；聚焦「做什么」而非「怎么做」 |
| 「这是最佳实践」 | 应质疑是否适合当前场景；说明适配理由 |
| 「简单需求不需要详细 AC」 | 每个故事至少 1 条可测量 AC；简单不等于模糊 |
| 「MVP 范围可以大一点」 | MVP 聚焦 ≤3 个 P0 故事；多了就不是 MVP |
| 「风险可以后续评估」 | 高风险项必须有 mitigation；不评估=不负责 |
| 「架构图可以省略」 | Eng 角色需要架构图；否则无法评估可行性 |
| 「竞品分析不重要」 | CEO 角色需要竞品差异化；否则无法评估战略 |
`;

// ── Fail Loud rule (karpathy Rule 12) ──

const FAIL_LOUD_RULE = `
## Fail Loud 规则（karpathy Rule 12）

- 禁止静默跳过任何必填字段
- 禁止用「TBD」「待补充」「稍后完善」等占位符
- 禁止用「works as expected」「as described」「正确运行」等空洞 AC
- 缺失字段时必须明确报错，而非填入默认值
- 检查失败时必须返回详细原因，而非模糊「未通过」
`;

// ── Adversarial review principle (agent-skills) ──

const ADVERSARIAL_PRINCIPLE = `
## 对抗式审查原则（agent-skills）

- reviewer 只收 ARTIFACT + CONTRACT，不收 CLAIM
- reviewer 假设作者过度自信，主动寻找漏洞
- 禁止「验证/总结」类审查 — 必须是「质疑/反驳」
- 每个发现必须 actionable（可执行的修复建议）
- 3 周期上限：3 轮仍有实质问题 → 升级用户
`;

// ── PRD Draft Prompt ──

/**
 * 生成 PRD 草稿的指令（给宿主 AI）。
 * 宿主 AI 根据用户输入+竞品研究，生成符合 PRDSchema 的 JSON。
 */
export function PRD_DRAFT_PROMPT(
  input: PRDGenerationInput,
  competitive: CompetitiveContext | null,
  complexity: Complexity,
  productType: ProductType,
  use14Chapters: boolean,
): string {
  const competitorBlock = competitive
    ? `
## 竞品研究（已为你搜集）

${competitive.competitors.slice(0, 5).map((c, i) => `${i + 1}. ${c.full_name} — ${c.description?.slice(0, 200) || ''}`).join('\n')}

### 差异化要点
${competitive.differentiators.map((d) => `- ${d}`).join('\n')}

### 竞品目标参考
${competitive.goals.slice(0, 3).map((g) => `- ${g}`).join('\n')}
`
    : `
## 竞品研究

无可用竞品数据。请基于你的知识补充至少 2 个相关开源项目作为竞品参考。
`;

  const chapterBlock = use14Chapters
    ? `
## 14 章节模板（L3/L4 必须使用）

按以下 14 章节组织 PRD（每章节都要有实质内容）：

1. **项目背景**（P0）— 业务背景、技术背景、市场背景
2. **需求基本情况**（P0）— 需求来源、需求类型、优先级、时间线
3. **商业分析**（P0）— 商业模式、盈利模式、市场规模、竞争分析
4. **定位**（P0）— 产品定位、用户画像、使用场景
5. **场景分析**（P0）— 核心场景、边缘场景、异常场景
6. **文档结构**（P1）— PRD 版本、修订记录、相关文档
7. **产品架构**（P0）— 系统架构、模块划分、数据流
8. **数据模型**（P1）— 核心实体、关系、存储
9. **流程设计**（P0）— 业务流程、状态机、异常处理
10. **交互体验**（P1）— 关键交互、信息架构、导航
11. **业务分析**（P0）— 业务规则、约束、计算逻辑
12. **MVP 策略**（P0）— MVP 范围、迭代计划、验证指标
13. **异常处理**（P1）— 异常场景、错误处理、降级方案
14. **待决事项**（P2）— 开放问题、待确认事项
`
    : '';

  return `# 任务：生成高质量 PRD 草稿

## 用户输入
- **标题**：${input.title}
- **描述**：${input.description || '(无描述，基于标题生成)'}
- **约束**：${input.constraints?.join(', ') || '(无)'}
- **复杂度**：${complexity}
- **产品类型**：${productType.label}

${competitorBlock}
${chapterBlock}
## 输出要求

生成一个符合以下 JSON Schema 的 PRD 对象（直接输出 JSON，不要用 markdown 代码块包裹）：

\`\`\`json
{
  "id": "PRD-<timestamp>",
  "title": "<项目标题>",
  "version": "1.0.0",
  "created_at": "<ISO timestamp>",
  "updated_at": "<ISO timestamp>",
  "overview": "<项目概述，包含痛点、竞品、差异化>",
  "goals": ["<目标1>", "<目标2>", ...],
  "target_users": ["<用户群1>", "<用户群2>"],
  "functional_requirements": [
    { "id": "FR-1", "description": "<具体功能需求>", "priority": "P0" }
  ],
  "non_functional_requirements": [
    { "id": "NFR-1", "description": "<非功能需求>", "category": "reliability" }
  ],
  "stories": [
    {
      "id": "STORY-001",
      "title": "<故事标题>",
      "description": "<作为X，我希望Y，以便Z>",
      "priority": "P0",
      "complexity": "${complexity}",
      "acceptance_criteria": [
        { "id": "AC-1", "description": "<可测量的验收标准>", "testable": true, "status": "pending" }
      ],
      "dependencies": [],
      "status": "pending"
    }
  ],
  "architecture": [
    {
      "type": "system",
      "mermaid": "graph TD\\n  A[组件A] --> B[组件B]",
      "description": "<架构说明>"
    }
  ],
  "acceptance_criteria": [
    { "id": "AC-1", "description": "<全局验收标准>", "testable": true, "status": "pending" }
  ],
  "risks": [
    { "description": "<风险描述>", "probability": "medium", "mitigation": "<缓解措施>" }
  ]
}
\`\`\`

## 质量要求

1. **overview** ≥ 200 字，包含痛点、竞品引用（≥2 个 github URL）、差异化说明
2. **goals** ≥ 2 个，每个目标可测量（含指标或可观察结果）
3. **functional_requirements** ≥ 2 个，每个具体可实施（非「实现功能」这种废话）
4. **stories** 数量：L1=2, L2=3, L3=5, L4=6；每个 story 至少 1 条可测量 AC
5. **acceptance_criteria** 禁止「works as expected」「as described」「正确运行」
6. **architecture** 必须有 mermaid 图（Eng 角色会检查）
7. **risks** ≥ 1 个，高风险必须有 mitigation

${ANTI_RATIONALIZATION_TABLE}
${FAIL_LOUD_RULE}
`;
}

// ── CEO Review Prompt ──

export function PRD_CEO_REVIEW_PROMPT(prd: PRD): string {
  return `# 任务：CEO 战略视角对抗式审查

## 审查原则
${ADVERSARIAL_PRINCIPLE}

## 待审查 PRD（ARTIFACT）

${JSON.stringify(prd, null, 2)}

## 审查要点（只质疑，不验证）

1. **商业价值**：这个产品真的有人需要吗？痛点是否真实？
2. **MVP 范围**：P0 故事是否过多（>3）？是否聚焦核心价值？
3. **竞争差异化**：与竞品相比，差异化是否清晰？是否有壁垒？
4. **目标用户**：用户画像是否清晰？是否过于宽泛？
5. **商业可行性**：盈利模式是否合理？市场规模是否足够？
6. **战略对齐**：是否与公司战略/产品线对齐？

## 输出格式

\`\`\`json
{
  "findings": [
    {
      "role": "ceo",
      "severity": "P0|P1|P2|info",
      "message": "<具体问题描述>",
      "passed": false,
      "actionable": true
    }
  ],
  "summary": "<审查总结>",
  "score": <0-100>,
  "passed": <true|false>
}
\`\`\`

${ANTI_RATIONALIZATION_TABLE}
`;
}

// ── QA Review Prompt ──

export function PRD_QA_REVIEW_PROMPT(prd: PRD): string {
  return `# 任务：QA 可测试性视角对抗式审查

## 审查原则
${ADVERSARIAL_PRINCIPLE}

## 待审查 PRD（ARTIFACT）

${JSON.stringify(prd, null, 2)}

## 审查要点（只质疑，不验证）

1. **AC 可测量性**：每条 AC 是否可自动化验证？是否有明确的 pass/fail 标准？
2. **边界条件**：AC 是否覆盖正常/异常/边界场景？
3. **测试覆盖**：每个 story 是否至少 1 条可测试 AC？
4. **空洞 AC**：是否有「works as expected」「as described」「正确运行」等空洞表述？
5. **验收标准完整性**：全局 AC 是否覆盖核心功能？
6. **可重现性**：AC 描述是否足够具体，让任何人都能重现验证？

## 输出格式

\`\`\`json
{
  "findings": [
    {
      "role": "qa",
      "severity": "P0|P1|P2|info",
      "message": "<具体问题描述>",
      "passed": false,
      "actionable": true
    }
  ],
  "summary": "<审查总结>",
  "score": <0-100>,
  "passed": <true|false>
}
\`\`\`

${ANTI_RATIONALIZATION_TABLE}
`;
}

// ── Eng Review Prompt ──

export function PRD_ENG_REVIEW_PROMPT(prd: PRD): string {
  return `# 任务：Eng 架构可行性视角对抗式审查

## 审查原则
${ADVERSARIAL_PRINCIPLE}

## 待审查 PRD（ARTIFACT）

${JSON.stringify(prd, null, 2)}

## 审查要点（只质疑，不验证）

1. **架构可行性**：架构图是否合理？是否能支撑所有 FR？
2. **技术风险**：是否有未识别的技术风险？依赖是否过多？
3. **模块划分**：模块边界是否清晰？是否有耦合风险？
4. **数据流**：数据流是否完整？是否有数据丢失风险？
5. **可扩展性**：架构是否支持未来扩展？
6. **非功能需求**：NFR 是否可实现？是否有具体指标？
7. **依赖复杂度**：第三方依赖是否过多？是否有替代方案？

## 输出格式

\`\`\`json
{
  "findings": [
    {
      "role": "eng",
      "severity": "P0|P1|P2|info",
      "message": "<具体问题描述>",
      "passed": false,
      "actionable": true
    }
  ],
  "summary": "<审查总结>",
  "score": <0-100>,
  "passed": <true|false>
}
\`\`\`

${ANTI_RATIONALIZATION_TABLE}
`;
}

// ── Design Review Prompt ──

export function PRD_DESIGN_REVIEW_PROMPT(prd: PRD): string {
  return `# 任务：Design UX 视角对抗式审查

## 审查原则
${ADVERSARIAL_PRINCIPLE}

## 待审查 PRD（ARTIFACT）

${JSON.stringify(prd, null, 2)}

## 审查要点（只质疑，不验证）

1. **用户体验**：用户流程是否顺畅？是否有认知负担？
2. **交互流程**：关键交互是否清晰？是否有歧义？
3. **信息架构**：信息组织是否合理？是否易于导航？
4. **可访问性**：是否考虑无障碍？是否支持不同设备？
5. **错误处理**：用户出错时的体验是否友好？
6. **反馈机制**：用户操作后是否有及时反馈？
7. **视觉一致性**：是否有视觉规范？是否一致？

## 输出格式

\`\`\`json
{
  "findings": [
    {
      "role": "design",
      "severity": "P0|P1|P2|info",
      "message": "<具体问题描述>",
      "passed": false,
      "actionable": true
    }
  ],
  "summary": "<审查总结>",
  "score": <0-100>,
  "passed": <true|false>
}
\`\`\`

${ANTI_RATIONALIZATION_TABLE}
`;
}

// ── Refine Prompt ──

export function PRD_REFINE_PROMPT(prd: PRD, findings: ReviewFinding[]): string {
  const p0Findings = findings.filter((f) => f.severity === 'P0' && !f.passed);
  const p1Findings = findings.filter((f) => f.severity === 'P1' && !f.passed);

  return `# 任务：根据审查结果精炼 PRD

## 原 PRD

${JSON.stringify(prd, null, 2)}

## 审查发现（需修复）

### P0 问题（必须修复）
${p0Findings.map((f, i) => `${i + 1}. [${f.role}] ${f.message}`).join('\n') || '(无 P0 问题)'}

### P1 问题（应该修复）
${p1Findings.map((f, i) => `${i + 1}. [${f.role}] ${f.message}`).join('\n') || '(无 P1 问题)'}

## 精炼要求

1. 修复所有 P0 问题（必须）
2. 修复所有 P1 问题（应该）
3. 保持 PRD 结构不变（字段名不变）
4. 不要删除已有内容，只增不删（除非该内容被标记为问题）
5. 保持 JSON 格式有效

## 输出格式

直接输出精炼后的 PRD JSON（不要用 markdown 代码块包裹），格式与输入相同。

${ANTI_RATIONALIZATION_TABLE}
${FAIL_LOUD_RULE}
`;
}

// ── Reconcile priorities (agent-skills) ──

export const RECONCILE_PRIORITIES = {
  CONTRACT_MISREAD: 1,   // 最高：审查者误解了 PRD 的契约
  VALID_ACTIONABLE: 2,   // 有效且可执行：必须修复
  VALID_TRADEOFF: 3,     // 有效但权衡：可接受，记录决策
  NOISE: 4,              // 噪音：忽略
} as const;

export type ReconcilePriority = typeof RECONCILE_PRIORITIES[keyof typeof RECONCILE_PRIORITIES];

/**
 * 对审查发现进行分类处置（借鉴 agent-skills RECONCILE_PRIORITIES）。
 */
export function reconcileFindings(findings: ReviewFinding[]): {
  reconciled: ReviewFinding[];
  dropped: ReviewFinding[];
  summary: string;
} {
  const reconciled: ReviewFinding[] = [];
  const dropped: ReviewFinding[] = [];

  for (const f of findings) {
    // 噪音：空洞或不可执行的建议丢弃
    if (!f.actionable || f.severity === 'info') {
      dropped.push(f);
      continue;
    }
    // 有效且可执行：保留
    reconciled.push(f);
  }

  const summary = `Reconciled ${reconciled.length} actionable findings (dropped ${dropped.length} noise)`;
  return { reconciled, dropped, summary };
}

/**
 * 检测「Doubt Theater」— reviewer 出实质发现但零 actionable（借鉴 agent-skills）。
 *
 * 当 ≥2 周期 reviewer 出实质发现（P0/P1）但零 actionable 时，
 * 说明 reviewer 在「表演审查」而非真正审查。
 */
export function detectDoubtTheater(
  history: Array<{ round: number; findings: ReviewFinding[] }>,
): { detected: boolean; reason: string } {
  if (history.length < 2) return { detected: false, reason: '' };

  const lastTwoRounds = history.slice(-2);
  for (const round of lastTwoRounds) {
    const substantive = round.findings.filter(
      (f) => !f.passed && (f.severity === 'P0' || f.severity === 'P1'),
    );
    const actionable = substantive.filter((f) => f.actionable);
    if (substantive.length > 0 && actionable.length === 0) {
      return {
        detected: true,
        reason: `Round ${round.round}: ${substantive.length} substantive findings but 0 actionable — doubt theater detected`,
      };
    }
  }
  return { detected: false, reason: '' };
}
