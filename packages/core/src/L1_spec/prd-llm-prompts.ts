/**
 * PRD LLM Prompts — V20 宿主 LLM 多步交互指令
 *
 * 借鉴：
 * - agent-skills 对抗式审查：reviewer 只收 ARTIFACT+CONTRACT，不收 CLAIM
 * - karpathy Rule 12 Fail Loud：禁止静默跳过
 * - gstack 4 角色审查：CEO/QA/Eng/Design
 *
 * 每个_prompt 都含「反合理化表」（借口 vs 现实），防止 LLM 走捷径。
 *
 * R10 第10轮 (D9) 增强：
 * - PRD_DRAFT_PROMPT 新增「反面示例」段（展示常见错误）
 * - PRD_DRAFT_PROMPT 新增「竞品研究文件注入」（从 .aza/competitive-research.md）
 * - readCompetitiveResearchFile 同步读取辅助函数
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PRD } from '@azaloop/shared';
import type { PRDGenerationInput, Complexity, ProductType } from './prd-generator';

/**
 * R10 第10轮 (D9)：同步读取 .aza/competitive-research.md 文件内容。
 *
 * 若文件存在则返回其内容（用于注入 PRD_DRAFT_PROMPT），
 * 否则返回 null。调用方按 null 回退到内置 competitive context。
 *
 * 借鉴 pm-claude-skills「contextual injection」：把外部研究产物
 * 显式注入 prompt，让 LLM 看到真实竞品数据而非自行脑补。
 */
export function readCompetitiveResearchFile(baseDir: string): string | null {
  const filePath = path.join(baseDir, 'competitive-research.md');
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    // 截断超长内容（避免 prompt 膨胀），保留前 4000 字符
    return content.length > 4000 ? content.slice(0, 4000) + '\n…（已截断）' : content;
  } catch {
    return null;
  }
}

// ── Types ──

export interface CompetitiveContext {
  competitors: Array<{ full_name: string; html_url: string; description?: string }>;
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

export const ADVERSARIAL_PRINCIPLE = `
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
 *
 * V21 改进：
 * - 添加具体示例（正面+反面）
 * - 产品类型差异化（B端/C端/工具型）
 * - 增强 AC 硬规则（可测试+无歧义+覆盖异常+可追溯）
 * - 问题陈述三段式（现状与证据、影响与代价、时机与约束）
 *
 * R10 第10轮 (D9) 增强：
 * - 新增「反面示例」段（展示 PRD 生成常见错误，让 LLM 主动规避）
 * - 新增「竞品研究文件注入」段（从 .aza/competitive-research.md 读取真实研究产物）
 * - 新增 competitiveResearchFile 可选参数
 */
export function PRD_DRAFT_PROMPT(
  input: PRDGenerationInput,
  competitive: CompetitiveContext | null,
  complexity: Complexity,
  productType: ProductType,
  use14Chapters: boolean,
  /**
   * R10 第10轮 (D9)：从 .aza/competitive-research.md 读取的竞品研究文件内容。
   * 若提供则注入 prompt，让 LLM 看到真实研究数据而非脑补。
   */
  competitiveResearchFile: string | null = null,
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

  // R10 第10轮 (D9)：注入 .aza/competitive-research.md 文件内容
  const researchFileBlock = competitiveResearchFile
    ? `
## 竞品研究文件（来自 .aza/competitive-research.md，优先级高于上方内置研究）

以下是项目方提供的竞品研究产物，请优先参考其结论：

\`\`\`markdown
${competitiveResearchFile}
\`\`\`

**要求**：
1. 若文件中已列出竞品 URL，overview 中必须引用至少 2 个
2. 若文件中已给出差异化要点，overview 的「差异化」段必须呼应
3. 若文件与内置 competitive context 冲突，以文件为准（更接近项目真实意图）
`
    : '';

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

  // V21: 产品类型差异化指导
  const productTypeGuidance = getProductTypeGuidance(productType);

  // V21: 具体示例（正面+反面）
  const examplesBlock = getPrdExamples(complexity);

  // R10 第10轮 (D9)：反面示例段——展示 PRD 生成常见错误，让 LLM 主动规避
  const antiPatternsBlock = getPrdAntiPatterns();

  return `# 任务：生成高质量 PRD 草稿

## 用户输入
- **标题**：${input.title}
- **描述**：${input.description || '(无描述，基于标题生成)'}
- **约束**：${input.constraints?.join(', ') || '(无)'}
- **复杂度**：${complexity}
- **产品类型**：${productType.label}

${competitorBlock}
${researchFileBlock}
${chapterBlock}
${productTypeGuidance}
${examplesBlock}
${antiPatternsBlock}

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
5. **acceptance_criteria** 必须满足 AC 硬规则（见下方）
6. **architecture** 必须有 mermaid 图（Eng 角色会检查）
7. **risks** ≥ 1 个，高风险必须有 mitigation

## AC 硬规则（V21 新增）

每条 AC 必须满足以下 4 条规则，否则视为不合格：

1. **可测试**：测试人员能直接写出测试用例
   - ✅ 正确：「当用户输入错误的密码 3 次后，账户锁定 15 分钟，并发送邮件通知」
   - ❌ 错误：「系统应该安全」（无法测试）

2. **无歧义**：避免「尽量」「必要时」「体验更好」等模糊表述
   - ✅ 正确：「页面加载时间 < 2 秒（P95）」
   - ❌ 错误：「页面加载要快」（多快算快？）

3. **覆盖异常**：必须包含失败场景的处理
   - ✅ 正确：「当网络断开时，显示「网络错误」提示，并提供重试按钮」
   - ❌ 错误：只描述正常流程，不提异常处理

4. **可追溯**：能对应到目标/范围/规则
   - ✅ 正确：AC 明确关联到某个 FR 或 Goal
   - ❌ 错误：AC 与 PRD 目标无关

${ANTI_RATIONALIZATION_TABLE}
${FAIL_LOUD_RULE}
`;
}

/**
 * V21: 根据产品类型提供差异化指导
 */
function getProductTypeGuidance(productType: ProductType): string {
  const { commercialization, category } = productType;
  
  if (category === 'business' && commercialization === 'commercial') {
    return `
## B端产品特殊要求

- 必须明确「用户角色」和「权限模型」（如：管理员、普通用户、访客）
- 必须描述「业务流程」和「审批链路」（如：提交→审核→批准）
- 必须考虑「数据权限」（如：部门隔离、字段级权限）
- 必须包含「集成需求」（如：与现有系统的对接）
- 必须定义「SLA 要求」（如：可用性 99.9%、响应时间 < 500ms）
`;
  }
  
  if (category === 'business' && commercialization === 'internal') {
    return `
## C端产品特殊要求

- 必须明确「用户画像」和「使用场景」（如：年龄、职业、痛点）
- 必须描述「用户旅程」（如：首次使用→核心功能→留存）
- 必须考虑「增长指标」（如：DAU、留存率、转化率）
- 必须包含「病毒传播机制」（如：分享、邀请奖励）
- 必须定义「用户体验指标」（如：NPS、CSAT）
`;
  }
  
  if (category === 'tool') {
    return `
## 工具型产品特殊要求

- 必须明确「核心功能」和「使用频率」（如：日常使用 vs 偶尔使用）
- 必须描述「效率提升」（如：节省多少时间、减少多少步骤）
- 必须考虑「兼容性」（如：支持的操作系统、浏览器）
- 必须包含「离线能力」（如：是否支持离线使用）
- 必须定义「性能指标」（如：启动时间、内存占用）
`;
  }
  
  return '';
}

/**
 * V21: 提供具体示例（正面+反面）
 */
function getPrdExamples(complexity: Complexity): string {
  if (complexity === 'L1' || complexity === 'L2') {
    return `
## 高质量 PRD 示例（L2 复杂度）

### 正面示例：好的 overview

✅ **好的 overview**（≥200字，包含痛点、竞品、差异化）：
\`\`\`
当前远程团队协作面临三大痛点：1）跨时区沟通延迟导致决策缓慢（平均延迟 8 小时）；2）信息分散在 Slack、Email、Jira 等多个工具中，难以追踪（每人每天切换 15+ 次工具）；3）异步工作缺乏透明度，团队成员不清楚彼此进度（导致重复工作或遗漏）。

现有解决方案如 Slack、Microsoft Teams 主要聚焦实时沟通，无法解决异步协作的核心问题；Notion、Confluence 提供文档协作，但缺乏任务管理和进度追踪。

我们的差异化在于：1）「异步优先」设计，所有功能都支持跨时区协作；2）「单一工作空间」，整合文档、任务、沟通于一体；3）「智能进度追踪」，自动汇总团队成员的工作状态，减少信息不对称。
\`\`\`

❌ **差的 overview**（空洞、无数据、无竞品）：
\`\`\`
这是一个团队协作工具，帮助用户更好地协作。我们将提供优秀的用户体验和强大的功能。
\`\`\`

### 正面示例：好的 AC

✅ **好的 AC**（可测试、无歧义、覆盖异常、可追溯）：
\`\`\`json
{
  "id": "AC-1",
  "description": "当用户输入错误的密码 3 次后，账户锁定 15 分钟，并发送邮件通知到用户注册邮箱。锁定期内用户无法登录，15 分钟后自动解锁。",
  "testable": true,
  "status": "pending"
}
\`\`\`

❌ **差的 AC**（模糊、不可测试）：
\`\`\`json
{
  "id": "AC-1",
  "description": "系统应该保证安全性",
  "testable": false,
  "status": "pending"
}
\`\`\`
`;
  }
  
  return `
## 高质量 PRD 示例（L3/L4 复杂度）

### 正面示例：好的问题陈述（三段式）

✅ **好的问题陈述**（现状与证据、影响与代价、时机与约束）：
\`\`\`
**现状与证据**：
根据 2026 Q1 用户调研（n=500），78% 的企业用户反馈「跨部门协作效率低下」是最大痛点。具体表现为：
- 平均每个项目涉及 5 个部门，沟通链路长达 8 层
- 每次跨部门审批平均耗时 3.5 天（行业标杆为 1 天）
- 40% 的项目延期源于跨部门沟通不畅

**影响与代价**：
- 直接成本：每年因审批延迟导致的工时损失约 120 万元
- 间接成本：客户满意度下降 15%，流失率上升 8%
- 机会成本：新产品上线周期比竞争对手慢 2 个月

**时机与约束**：
- 窗口期：竞争对手 A 公司计划 2026 Q4 推出类似功能，我们必须在此之前上线
- 合规要求：必须符合 GDPR 和数据安全法
- 预算约束：研发预算 200 万元，运营预算 50 万元
\`\`\`

❌ **差的问题陈述**（无证据、无数据、无时机）：
\`\`\`
跨部门协作效率低，需要改进。
\`\`\`
`;
}

/**
 * R10 第10轮 (D9)：PRD 反面示例段——展示 PRD 生成常见错误。
 *
 * 借鉴 check-prd-skill「anti-pattern detection」：
 * 把常见错误显式列出来，让 LLM 在生成时主动规避而非事后审查。
 * 与现有 ANTI_RATIONALIZATION_TABLE 互补——前者是「借口表」（生成时），
 * 本段是「错误集」（生成前预览）。
 */
function getPrdAntiPatterns(): string {
  return `
## PRD 反面示例（必须规避的常见错误）

以下错误在实际 PRD 生成中高频出现，生成时必须主动规避：

### 1. 空洞 overview（无痛点、无竞品、无差异化）

❌ **错误**：
\`\`\`
这是一个协作工具，帮助用户更好地协作。我们将提供优秀的用户体验和强大的功能。
\`\`\`

✅ **正确**：overview ≥ 200 字，必须包含「痛点（含数据）+ 竞品引用（≥2 个 URL）+ 差异化说明」三段。

### 2. 模糊 AC（不可测试、无阈值）

❌ **错误**：
\`\`\`json
{ "id": "AC-1", "description": "系统应该保证安全性", "testable": true }
\`\`\`

✅ **正确**：AC 必须含具体数值/条件/结果，如「当用户输入错误密码 3 次后，账户锁定 15 分钟」。

### 3. 占位符填充（TBD/待补充/稍后完善）

❌ **错误**：
\`\`\`
"overview": "待补充",
"risks": [{ "description": "后续评估", "mitigation": "TBD" }]
\`\`\`

✅ **正确**：所有字段必须有实质内容，缺失时宁可省略字段也不填占位符。

### 4. MVP 范围膨胀（P0 故事过多）

❌ **错误**：MVP 阶段定义 6 个 P0 故事，声称「都是必须的」。

✅ **正确**：MVP 聚焦 ≤3 个 P0 故事，其余降级为 P1/P2。

### 5. 风险无缓解措施

❌ **错误**：
\`\`\`json
{ "description": "技术风险", "probability": "high", "mitigation": "" }
\`\`\`

✅ **正确**：高风险项必须有具体 mitigation（≥20 字），如「引入熔断器，失败率 > 5% 时降级」。

### 6. 故事无异常路径

❌ **错误**：story AC 只描述「用户提交表单 → 成功」，不提网络断开/输入无效/超时。

✅ **正确**：每个 story 至少 1 条 AC 覆盖异常场景（如「网络断开时显示错误提示并提供重试按钮」）。

### 7. 竞品引用无 URL

❌ **错误**：「参考了竞品 A 和竞品 B」—— 无 URL，无法验证。

✅ **正确**：竞品引用必须含 GitHub URL（≥2 个），如 \`https://github.com/xxx/xxx\`。

### 8. 架构图缺失或空洞

❌ **错误**：\`"architecture": []\` 或 mermaid 图只有 1 个节点。

✅ **正确**：architecture 必须有 mermaid 图，至少 3 个组件 + 数据流箭头。
`;
}

// ── CEO Review Prompt ──

export function PRD_CEO_REVIEW_PROMPT(prd: PRD): string {
  return `# 任务：CEO 战略视角对抗式审查

## 审查原则
${ADVERSARIAL_PRINCIPLE}

## 待审查 PRD（ARTIFACT）

${JSON.stringify(prd, null, 2)}

## 审查要点（只质疑，不验证，每项 0-10 分）

1. **商业价值**（0-10分）：这个产品真的有人需要吗？痛点是否真实？
   - ✅ 好的发现：「痛点描述仅依赖假设，未引用用户调研数据或竞品用户反馈，建议补充 n≥50 的调研数据」
   - ❌ 差的发现：「商业价值不够」（无具体证据，不可执行）

2. **MVP 范围**（0-10分）：P0 故事是否过多（>3）？是否聚焦核心价值？
   - ✅ 好的发现：「P0 story 有 5 个，超出 MVP 聚焦原则（≤3），建议将 STORY-4 和 STORY-5 降级为 P1」
   - ❌ 差的发现：「MVP 范围太大」（无具体建议）

3. **竞争差异化**（0-10分）：与竞品相比，差异化是否清晰？是否有壁垒？
   - ✅ 好的发现：「overview 引用了竞品 A 和 B，但未说明差异化优势，建议补充「我们的独特价值在于 X，竞品 Y 无法提供」」
   - ❌ 差的发现：「差异化不够清晰」（无改进方向）

4. **目标用户**（0-10分）：用户画像是否清晰？是否过于宽泛？
   - ✅ 好的发现：「target_users 定义为「所有企业用户」，过于宽泛，建议细分为「50-200 人的中型企业研发团队」」
   - ❌ 差的发现：「用户画像不清晰」（无具体建议）

5. **商业可行性**（0-10分）：盈利模式是否合理？市场规模是否足够？
   - ✅ 好的发现：「未定义盈利模式，建议补充定价策略（如：按席位收费 $10/月/用户）」
   - ❌ 差的发现：「商业模式不清楚」（不可执行）

6. **战略对齐**（0-10分）：是否与公司战略/产品线对齐？
   - ✅ 好的发现：「该产品与公司 Q3 战略「AI 优先」对齐，但缺少 AI 功能的具体规划」
   - ❌ 差的发现：「战略对齐不足」（无证据）

## 量化评分标准

- 每项 0-10 分，总分 60 分
- ≥54 分：通过（minor 修改）
- 42-53 分：需重大调整
- <42 分：不通过，打回重写

## 输出格式

\`\`\`json
{
  "findings": [
    {
      "role": "ceo",
      "severity": "P0|P1|P2|info",
      "message": "<具体问题描述，必须包含具体证据和可执行建议>",
      "passed": false,
      "actionable": true,
      "score": <0-10>
    }
  ],
  "summary": "<审查总结，包含各维度得分>",
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

## 审查要点（只质疑，不验证，每项 0-10 分）

1. **AC 可测量性**（0-10分）：每条 AC 是否可自动化验证？是否有明确的 pass/fail 标准？
   - ✅ 好的发现：「AC-1 描述「系统应该安全」不可测试，建议改为「当用户输入错误密码 3 次后，账户锁定 15 分钟，并发送邮件通知」」
   - ❌ 差的发现：「AC 不够具体」（无改进示例）

2. **边界条件**（0-10分）：AC 是否覆盖正常/异常/边界场景？
   - ✅ 好的发现：「STORY-1 的 AC 只覆盖正常流程，缺少异常场景（如：网络断开、输入无效数据、超时），建议补充「当网络断开时，显示错误提示并提供重试按钮」」
   - ❌ 差的发现：「边界条件不足」（无具体缺失项）

3. **测试覆盖**（0-10分）：每个 story 是否至少 1 条可测试 AC？
   - ✅ 好的发现：「STORY-3 和 STORY-5 缺少 acceptance_criteria，无法验证是否完成，建议为每个 story 添加至少 1 条 AC」
   - ❌ 差的发现：「测试覆盖不完整」（无具体 story 编号）

4. **空洞 AC**（0-10分）：是否有「works as expected」「as described」「正确运行」等空洞表述？
   - ✅ 好的发现：「AC-2 使用「功能正常」表述，无法验证，建议改为「当用户点击提交按钮后，表单数据保存到数据库并返回成功消息」」
   - ❌ 差的发现：「有 AC 不够好」（无具体 AC 编号和改进）

5. **验收标准完整性**（0-10分）：全局 AC 是否覆盖核心功能？
   - ✅ 好的发现：「全局 acceptance_criteria 只有 2 条，但 functional_requirements 有 5 个，建议补充 FR-3、FR-4、FR-5 的全局验收标准」
   - ❌ 差的发现：「全局 AC 不完整」（无具体缺失项）

6. **可重现性**（0-10分）：AC 描述是否足够具体，让任何人都能重现验证？
   - ✅ 好的发现：「AC-5 描述「页面加载要快」不可重现，建议改为「页面加载时间 < 2 秒（P95），在 4G 网络下测试」」
   - ❌ 差的发现：「AC 不够具体」（无改进示例）

## 量化评分标准

- 每项 0-10 分，总分 60 分
- ≥54 分：通过（minor 修改）
- 42-53 分：需重大调整
- <42 分：不通过，打回重写

## 输出格式

\`\`\`json
{
  "findings": [
    {
      "role": "qa",
      "severity": "P0|P1|P2|info",
      "message": "<具体问题描述，必须包含 AC/Story 编号和可执行建议>",
      "passed": false,
      "actionable": true,
      "score": <0-10>
    }
  ],
  "summary": "<审查总结，包含各维度得分>",
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

## 审查要点（只质疑，不验证，每项 0-10 分）

1. **架构可行性**（0-10分）：架构图是否合理？是否能支撑所有 FR？
   - ✅ 好的发现：「架构图只有 3 个组件，但 FR 有 8 个功能需求，建议补充数据层和缓存层，并说明组件间的数据流」
   - ❌ 差的发现：「架构不够完善」（无具体缺失组件）

2. **技术风险**（0-10分）：是否有未识别的技术风险？依赖是否过多？
   - ✅ 好的发现：「PRD 依赖 3 个第三方 API（GitHub API、Slack API、Jira API），但未定义降级方案，建议补充「当 API 不可用时的 fallback 策略」」
   - ❌ 差的发现：「技术风险识别不足」（无具体依赖项）

3. **模块划分**（0-10分）：模块边界是否清晰？是否有耦合风险？
   - ✅ 好的发现：「架构图中「业务逻辑层」和「数据访问层」耦合，建议引入 Repository 模式解耦」
   - ❌ 差的发现：「模块划分不清晰」（无具体耦合点）

4. **数据流**（0-10分）：数据流是否完整？是否有数据丢失风险？
   - ✅ 好的发现：「数据流图缺少错误处理路径，建议补充「当数据库写入失败时，事务回滚并记录错误日志」」
   - ❌ 差的发现：「数据流不完整」（无具体缺失路径）

5. **可扩展性**（0-10分）：架构是否支持未来扩展？
   - ✅ 好的发现：「当前架构使用单体设计，但 FR-7 提到「支持多租户」，建议改为微服务架构或模块化单体」
   - ❌ 差的发现：「可扩展性不足」（无具体扩展需求）

6. **非功能需求**（0-10分）：NFR 是否可实现？是否有具体指标？
   - ✅ 好的发现：「NFR 定义「高性能」但无具体指标，建议改为「API 响应时间 P95 < 500ms，QPS > 1000」」
   - ❌ 差的发现：「NFR 不够具体」（无改进指标）

7. **依赖复杂度**（0-10分）：第三方依赖是否过多？是否有替代方案？
   - ✅ 好的发现：「依赖 5 个第三方库（lodash、moment、axios、react、redux），建议评估是否可以用原生 API 替代 moment（改用 Date 或 dayjs）」
   - ❌ 差的发现：「依赖过多」（无具体替代方案）

## 量化评分标准

- 每项 0-10 分，总分 70 分
- ≥63 分：通过（minor 修改）
- 49-62 分：需重大调整
- <49 分：不通过，打回重写

## 输出格式

\`\`\`json
{
  "findings": [
    {
      "role": "eng",
      "severity": "P0|P1|P2|info",
      "message": "<具体问题描述，必须包含架构图组件/依赖项/数据流节点和可执行建议>",
      "passed": false,
      "actionable": true,
      "score": <0-10>
    }
  ],
  "summary": "<审查总结，包含各维度得分>",
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

## 审查要点（只质疑，不验证，每项 0-10 分）

1. **用户体验**（0-10分）：用户流程是否顺畅？是否有认知负担？
   - ✅ 好的发现：「STORY-2 的用户流程需要 5 步才能完成任务，建议优化为 3 步（减少 40% 操作步骤）」
   - ❌ 差的发现：「用户体验不够好」（无具体流程步骤）

2. **交互流程**（0-10分）：关键交互是否清晰？是否有歧义？
   - ✅ 好的发现：「STORY-1 描述「用户提交表单」但未说明提交后的反馈（成功/失败提示、加载状态），建议补充「提交后显示 loading 动画，成功后跳转到详情页，失败后显示错误原因」」
   - ❌ 差的发现：「交互流程不清晰」（无具体缺失交互）

3. **信息架构**（0-10分）：信息组织是否合理？是否易于导航？
   - ✅ 好的发现：「PRD 未定义信息层级，建议补充「主要导航：顶部菜单（首页/项目/设置）；次要导航：侧边栏（项目列表/任务列表）」」
   - ❌ 差的发现：「信息架构不合理」（无具体导航结构）

4. **可访问性**（0-10分）：是否考虑无障碍？是否支持不同设备？
   - ✅ 好的发现：「未提及响应式设计，建议补充「支持桌面端（≥1024px）、平板（≥768px）、移动端（≥375px）」」
   - ❌ 差的发现：「可访问性不足」（无具体设备尺寸）

5. **错误处理**（0-10分）：用户出错时的体验是否友好？
   - ✅ 好的发现：「STORY-3 的 AC 未定义表单验证错误提示，建议补充「输入无效邮箱时，在输入框下方显示红色错误提示「请输入有效的邮箱地址」」」
   - ❌ 差的发现：「错误处理不友好」（无具体错误场景）

6. **反馈机制**（0-10分）：用户操作后是否有及时反馈？
   - ✅ 好的发现：「STORY-4 未定义操作反馈，建议补充「删除操作前显示确认对话框，删除后显示「已成功删除」toast 提示（3 秒后消失）」」
   - ❌ 差的发现：「反馈机制不足」（无具体反馈类型）

7. **视觉一致性**（0-10分）：是否有视觉规范？是否一致？
   - ✅ 好的发现：「未定义视觉规范，建议补充「主色调：#1890FF；字体：14px/16px/20px；间距：8px/16px/24px」」
   - ❌ 差的发现：「视觉规范不统一」（无具体规范值）

## 量化评分标准

- 每项 0-10 分，总分 70 分
- ≥63 分：通过（minor 修改）
- 49-62 分：需重大调整
- <49 分：不通过，打回重写

## 输出格式

\`\`\`json
{
  "findings": [
    {
      "role": "design",
      "severity": "P0|P1|P2|info",
      "message": "<具体问题描述，必须包含 Story 编号/交互步骤/视觉规范和可执行建议>",
      "passed": false,
      "actionable": true,
      "score": <0-10>
    }
  ],
  "summary": "<审查总结，包含各维度得分>",
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

/**
 * V21: Refine 阶段 prompt — 自检与缺口分析
 * 
 * 在 PRD 草稿经过多角色审查后，引导宿主 LLM 进行自检和缺口分析，
 * 然后基于审查反馈精炼 PRD。
 */
export function PRD_REFINE_SELF_CHECK_PROMPT(
  prdDraft: string,
  reviewFindings: Array<{ role: string; response: string; score?: number }>,
  qualityIssues: Array<{ dimension: string; severity: string; description: string; suggestion: string }>,
): string {
  return `# 任务：PRD 自检与缺口分析 → 精炼

## 原始 PRD 草稿
${prdDraft}

## 多角色审查反馈

${reviewFindings.map((f, i) => `### ${i + 1}. ${f.role} 角色（${f.score ? f.score + '/100分' : '未评分'}）
${f.response}`).join('\n\n')}

## 质量检查发现的问题

${qualityIssues.length > 0 
  ? qualityIssues.map((q, i) => `${i + 1}. [${q.severity}] ${q.dimension}: ${q.description}
   建议：${q.suggestion}`).join('\n')
  : '✓ 未发现质量问题'}

## 自检清单（逐项检查并修复）

### 1. 完整性自检
- [ ] overview ≥ 200 字，包含痛点、竞品引用（≥2个）、差异化说明
- [ ] goals ≥ 2 个，每个可测量（含指标或可观察结果）
- [ ] functional_requirements ≥ 2 个，每个具体可实施
- [ ] stories 数量符合复杂度要求（L1=2, L2=3, L3=5, L4=6）
- [ ] 每个 story 至少 1 条可测量 AC
- [ ] architecture 有 mermaid 图
- [ ] risks ≥ 1 个，高风险有 mitigation

### 2. 清晰度自检
- [ ] 无模糊副词（尽量、必要时、适当）
- [ ] 无空洞形容词（更好的、优秀的、强大的）
- [ ] 无 TBD/待补充/TODO 占位符
- [ ] story 遵循「作为X，我希望Y，以便Z」格式
- [ ] AC 不含「系统应该」「works as expected」等空洞表述

### 3. 风险自检
- [ ] 高风险项都有具体 mitigation（≥20字）
- [ ] story AC 包含异常场景（网络失败、输入无效、超时）
- [ ] 包含权限/安全考虑
- [ ] 包含数据一致性考虑

### 4. 可测试性自检
- [ ] 每条 AC 可测试（有具体数值/条件/结果）
- [ ] AC 包含具体数值/阈值（如 <500ms、≥99.9%）
- [ ] AC 覆盖正常+异常路径
- [ ] 每个 FR 可追溯到至少 1 个 story

## 缺口分析

基于以上自检，列出所有缺口（即未通过的检查项），并说明修复计划：

| 缺口编号 | 检查项 | 当前状态 | 修复计划 |
|---------|--------|---------|---------|
| GAP-1 | {检查项ID} | {当前问题} | {如何修复} |

## 精炼要求

1. **优先修复 P0 问题**：所有 P0 问题必须全部修复
2. **尽量修复 P1 问题**：P1 问题修复率 ≥ 80%
3. **保持 PRD 结构不变**：不要改变 JSON schema 结构
4. **保留原有优点**：不要为了修复问题而删除已有的好内容
5. **输出完整 JSON**：输出完整的 PRD JSON，不要用 ... 省略

## 输出格式

直接输出精炼后的 PRD JSON（不要用 markdown 代码块包裹）：

{
  "id": "...",
  "title": "...",
  "version": "1.0.1",
  ...
}
`;
}
