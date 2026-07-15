/**
 * Adversarial Review Prompts — 3 轮渐进式对抗审查
 *
 * 借鉴 agent-skills 对抗式审查：
 *   - Round 1：初评，按角色审查要点质疑
 *   - Round 2：反驳辩解，假设作者会辩解，主动寻找「辩解不成立」的证据
 *   - Round 3：终评，只保留 Round 2 后仍未被作者合理解释的 P0/P1 findings
 *
 * 每个 prompt 复用 ANTI_RATIONALIZATION_TABLE 和 ADVERSARIAL_PRINCIPLE。
 */

import type { PRD } from '@azaloop/shared';
import type { ReviewRole } from './prd-multi-role-review';
import { ANTI_RATIONALIZATION_TABLE, ADVERSARIAL_PRINCIPLE } from './prd-llm-prompts';

// ── Shared constants ──

/**
 * V21: 证据字段要求 — 每个 finding 必须包含的具体证据和量化信息
 */
export const EVIDENCE_FIELD_REQUIREMENT = `
## 证据字段要求（V21 新增）

每个 finding 必须包含以下字段（缺一不可）：
- **evidence**: 引用 PRD 的具体章节/行号/字段名（如："overview 第 2 段"、"FR-3 description"）
- **root_cause**: 问题产生的根本原因（不要只说"不够好"）
- **fix_suggestion**: 具体可执行的修复建议（包含代码片段或重写示例）
- **impact**: 不修复的后果（量化：影响多少 story/AC/用户）
- **confidence**: 信心度 0-1（避免误报）
`;

// ── Types ──

export interface AdversarialRound {
  round: 1 | 2 | 3;
  prompt: string;
}

export interface AdversarialResult {
  role: ReviewRole;
  rounds: AdversarialRound[];
}

export interface AdversarialFinding {
  round: 1 | 2 | 3;
  role: ReviewRole;
  severity: 'P0' | 'P1' | 'P2' | 'info';
  message: string;
  passed: boolean;
  actionable: boolean;
}

export interface ReconcileResult {
  reconciled: AdversarialFinding[];
  dropped: AdversarialFinding[];
  escalate: boolean;
}

// ── Role-specific review points ──

const ROLE_REVIEW_POINTS: Record<ReviewRole, string[]> = {
  ceo: [
    '商业价值：这个产品真的有人需要吗？痛点是否真实？',
    'MVP 范围：P0 故事是否过多（>3）？是否聚焦核心价值？',
    '竞争差异化：与竞品相比，差异化是否清晰？是否有壁垒？',
    '目标用户：用户画像是否清晰？是否过于宽泛？',
    '商业可行性：盈利模式是否合理？市场规模是否足够？',
    '战略对齐：是否与公司战略/产品线对齐？',
  ],
  qa: [
    'AC 可测量性：每条 AC 是否可自动化验证？是否有明确的 pass/fail 标准？',
    '边界条件：AC 是否覆盖正常/异常/边界场景？',
    '测试覆盖：每个 story 是否至少 1 条可测试 AC？',
    '空洞 AC：是否有「works as expected」「as described」「正确运行」等空洞表述？',
    '验收标准完整性：全局 AC 是否覆盖核心功能？',
    '可重现性：AC 描述是否足够具体，让任何人都能重现验证？',
  ],
  eng: [
    '架构可行性：架构图是否合理？是否能支撑所有 FR？',
    '技术风险：是否有未识别的技术风险？依赖是否过多？',
    '模块划分：模块边界是否清晰？是否有耦合风险？',
    '数据流：数据流是否完整？是否有数据丢失风险？',
    '可扩展性：架构是否支持未来扩展？',
    '非功能需求：NFR 是否可实现？是否有具体指标？',
    '依赖复杂度：第三方依赖是否过多？是否有替代方案？',
  ],
  design: [
    '用户体验：用户流程是否顺畅？是否有认知负担？',
    '交互流程：关键交互是否清晰？是否有歧义？',
    '信息架构：信息组织是否合理？是否易于导航？',
    '可访问性：是否考虑无障碍？是否支持不同设备？',
    '错误处理：用户出错时的体验是否友好？',
    '反馈机制：用户操作后是否有及时反馈？',
    '视觉一致性：是否有视觉规范？是否一致？',
  ],
};

// ── Round 1: Initial Review ──

function buildRound1Prompt(prd: PRD, role: ReviewRole): string {
  const reviewPoints = ROLE_REVIEW_POINTS[role];
  return `# 任务：${role.toUpperCase()} 角色 Round 1 初评

## 审查原则
${ADVERSARIAL_PRINCIPLE}

## 待审查 PRD（ARTIFACT）

${JSON.stringify(prd, null, 2)}

## 审查要点（只质疑，不验证）

${reviewPoints.map((p, i) => `${i + 1}. **${p}**`).join('\n')}

## 输出格式

\`\`\`json
{
  "findings": [
    {
      "role": "${role}",
      "severity": "P0|P1|P2|info",
      "message": "<具体问题描述>",
      "passed": false,
      "actionable": true,
      "evidence": "<具体证据引用>",
      "root_cause": "<根本原因>",
      "fix_suggestion": "<具体修复建议>",
      "impact": "<量化影响>",
      "confidence": <0-1>
    }
  ],
  "summary": "<审查总结>",
  "score": <0-100>,
  "passed": <true|false>
}
\`\`\`

${ANTI_RATIONALIZATION_TABLE}
${EVIDENCE_FIELD_REQUIREMENT}
`;
}

// ── Round 2: Counter-Argument ──

function buildRound2Prompt(prd: PRD, role: ReviewRole, round1Findings: string): string {
  return `# 任务：${role.toUpperCase()} 角色 Round 2 反驳辩解

## 审查原则
${ADVERSARIAL_PRINCIPLE}

## 待审查 PRD（ARTIFACT）

${JSON.stringify(prd, null, 2)}

## Round 1 发现（假设作者会辩解）

${round1Findings}

## 任务要求

假设 PRD 作者会对 Round 1 的每个发现提出辩解。你的任务是：

1. **主动寻找「辩解不成立」的证据**
   - 对于每个 P0/P1 发现，思考作者可能的辩解理由
   - 然后找出为什么这些辩解不成立的证据
   - 例如：作者说「后续迭代再补」→ 反驳：P0 缺陷必须当下修

2. **强化质疑**
   - 不要接受表面解释
   - 要求具体数据、可验证的证据
   - 禁止「works as expected」类空洞回应

3. **输出格式**

\`\`\`json
{
  "findings": [
    {
      "round": 2,
      "role": "${role}",
      "severity": "P0|P1|P2|info",
      "message": "<具体问题描述，包含对辩解的反驳>",
      "passed": false,
      "actionable": true,
      "evidence": "<具体证据引用>",
      "root_cause": "<根本原因>",
      "fix_suggestion": "<具体修复建议>",
      "impact": "<量化影响>",
      "confidence": <0-1>
    }
  ],
  "summary": "<审查总结，说明哪些辩解不成立>",
  "score": <0-100>,
  "passed": <true|false>
}
\`\`\`

${ANTI_RATIONALIZATION_TABLE}
${EVIDENCE_FIELD_REQUIREMENT}
`;
}

// ── Round 3: Final Review ──

function buildRound3Prompt(prd: PRD, role: ReviewRole, round2Findings: string): string {
  return `# 任务：${role.toUpperCase()} 角色 Round 3 终评

## 审查原则
${ADVERSARIAL_PRINCIPLE}

## 待审查 PRD（ARTIFACT）

${JSON.stringify(prd, null, 2)}

## Round 2 发现（只保留未被合理解释的 P0/P1）

${round2Findings}

## 任务要求

只保留 Round 2 后仍未被作者合理解释的 P0/P1 findings。

1. **过滤噪音**
   - 如果作者在 Round 2 提供了合理解释，可以移除该 finding
   - 但如果解释空洞（如「后续迭代」「最佳实践」），必须保留

2. **最终确认**
   - 只输出 P0/P1 findings（P2/info 丢弃）
   - 每个 finding 必须是 actionable 的

3. **输出格式**

\`\`\`json
{
  "findings": [
    {
      "round": 3,
      "role": "${role}",
      "severity": "P0|P1",
      "message": "<具体问题描述>",
      "passed": false,
      "actionable": true,
      "evidence": "<具体证据引用>",
      "root_cause": "<根本原因>",
      "fix_suggestion": "<具体修复建议>",
      "impact": "<量化影响>",
      "confidence": <0-1>
    }
  ],
  "summary": "<最终审查总结>",
  "score": <0-100>,
  "passed": <true|false>
}
\`\`\`

${ANTI_RATIONALIZATION_TABLE}
${EVIDENCE_FIELD_REQUIREMENT}
`;
}

// ── Main Function ──

/**
 * 获取 3 轮渐进式对抗审查 prompts
 */
export function getAdversarialReviewPrompts(prd: PRD, role: ReviewRole): AdversarialResult {
  const round1Prompt = buildRound1Prompt(prd, role);
  
  // Round 2 和 Round 3 的 prompt 需要基于前一轮的 findings
  // 这里返回模板，实际使用时需要注入前一轮的 findings
  const round2Prompt = buildRound2Prompt(prd, role, '{{ROUND_1_FINDINGS}}');
  const round3Prompt = buildRound3Prompt(prd, role, '{{ROUND_2_FINDINGS}}');

  return {
    role,
    rounds: [
      { round: 1, prompt: round1Prompt },
      { round: 2, prompt: round2Prompt },
      { round: 3, prompt: round3Prompt },
    ],
  };
}

/**
 * 跨轮 reconcile：round 3 的 P0/P1 才计入，round 1 的噪音丢弃
 */
export function reconcileAdversarialFindings(
  allRoundFindings: AdversarialFinding[],
): ReconcileResult {
  const reconciled: AdversarialFinding[] = [];
  const dropped: AdversarialFinding[] = [];

  // Round 3 的 P0/P1 才计入
  const round3Findings = allRoundFindings.filter(
    (f) => f.round === 3 && (f.severity === 'P0' || f.severity === 'P1') && f.actionable,
  );
  reconciled.push(...round3Findings);

  // 其他轮次的 findings 丢弃
  const otherFindings = allRoundFindings.filter(
    (f) => f.round !== 3 || f.severity === 'P2' || f.severity === 'info' || !f.actionable,
  );
  dropped.push(...otherFindings);

  // 判断是否需要 escalate
  const escalate = shouldEscalateFromFindings(reconciled);

  return { reconciled, dropped, escalate };
}

/**
 * 3 周期上限：3 轮仍有 P0/P1 实质问题 → return true
 */
export function shouldEscalate(history: Array<{ round: number; findings: AdversarialFinding[] }>): boolean {
  if (history.length < 3) return false;

  // 检查最近 3 轮是否都有 P0/P1 实质问题
  const lastThreeRounds = history.slice(-3);
  for (const round of lastThreeRounds) {
    const substantive = round.findings.filter(
      (f) => !f.passed && (f.severity === 'P0' || f.severity === 'P1') && f.actionable,
    );
    if (substantive.length === 0) {
      return false; // 有一轮没有实质问题，不需要 escalate
    }
  }

  return true; // 3 轮都有实质问题，需要 escalate
}

/**
 * 从 reconciled findings 判断是否需要 escalate
 */
function shouldEscalateFromFindings(findings: AdversarialFinding[]): boolean {
  // 如果 round 3 还有 P0/P1 findings，说明问题未解决
  return findings.length > 0;
}
