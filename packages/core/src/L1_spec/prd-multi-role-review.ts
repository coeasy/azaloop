/**
 * Multi-role PRD review (P3-2 / gstack inspired).
 * CEO (strategy) · QA (testability) · Eng (feasibility) · Design (UX) perspectives.
 *
 * V20: 支持两种模式
 *   1. 正则预检（L1 快速模式）— reviewCeo/reviewQa/reviewEng/reviewDesign
 *   2. LLM 对抗式审查（L2+ 深度模式）— getMultiRoleReviewPrompts + parseMultiRoleReviewResponses
 *
 * 借鉴 agent-skills 对抗式审查：
 *   - reviewer 只收 ARTIFACT+CONTRACT，不收 CLAIM
 *   - 每个发现必须 actionable
 *   - 3 周期上限 + Doubt theater 检测
 */

import type { PRD } from '@azaloop/shared';
import {
  PRD_CEO_REVIEW_PROMPT,
  PRD_QA_REVIEW_PROMPT,
  PRD_ENG_REVIEW_PROMPT,
  PRD_DESIGN_REVIEW_PROMPT,
  reconcileFindings,
  detectDoubtTheater,
  type ReviewFinding,
  type MultiRoleReviewResponse,
} from './prd-llm-prompts';
import {
  getAdversarialReviewPrompts,
  reconcileAdversarialFindings,
  shouldEscalate,
  type AdversarialFinding,
} from './adversarial-review-prompts';
import { writeHandoff } from '../L2_memory/file-handoff';

export type ReviewRole = 'ceo' | 'qa' | 'eng' | 'design';

/**
 * V20: Optional options for {@link runMultiRolePrdReview}.
 *
 * `azaDir` enables best-effort file handoff: each role's findings are
 * written to `<azaDir>/handoffs/<role>_to_integration_<ts>.json` so
 * downstream integration roles can pick up the structured review output
 * without re-deriving it from the LLM response.
 */
export interface RunMultiRolePrdReviewOptions {
  azaDir?: string;
}

export interface RoleFinding {
  role: ReviewRole;
  severity: 'P0' | 'P1' | 'P2' | 'info';
  message: string;
  passed: boolean;
}

export interface MultiRoleReviewResult {
  roles: ReviewRole[];
  findings: RoleFinding[];
  passed: boolean;
  summary: string;
  score: number;
}

// ── V20: LLM-driven adversarial review ──

/**
 * V20: Get the 4-role adversarial review prompts for the host LLM.
 *
 * For L1 complexity: returns single-round prompts (fast pre-check).
 * For L2+ complexity: returns 3-round adversarial prompts per role.
 *
 * Returns prompts for CEO/QA/Eng/Design perspectives. The host LLM
 * executes each prompt and returns findings which are then parsed by
 * parseMultiRoleReviewResponses() or runAdversarialReview().
 */
export function getMultiRoleReviewPrompts(
  prd: PRD,
  complexity?: string,
): {
  ceo_prompt: string;
  qa_prompt: string;
  eng_prompt: string;
  design_prompt: string;
  /** Present only for L2+ complexity. Contains 3 rounds per role. */
  adversarialRounds?: Record<ReviewRole, Array<{ round: 1 | 2 | 3; prompt: string }>>;
} {
  const roles: ReviewRole[] = ['ceo', 'qa', 'eng', 'design'];

  if (complexity && complexity !== 'L1') {
    // L2+ complexity: 3-round adversarial review
    const adversarialRounds = {} as Record<ReviewRole, Array<{ round: 1 | 2 | 3; prompt: string }>>;
    for (const role of roles) {
      const result = getAdversarialReviewPrompts(prd, role);
      adversarialRounds[role] = result.rounds;
    }

    // Use round 1 prompts as the top-level role prompts for backward compat
    return {
      ceo_prompt: adversarialRounds.ceo[0]?.prompt ?? '',
      qa_prompt: adversarialRounds.qa[0]?.prompt ?? '',
      eng_prompt: adversarialRounds.eng[0]?.prompt ?? '',
      design_prompt: adversarialRounds.design[0]?.prompt ?? '',
      adversarialRounds,
    };
  }

  // L1 complexity (default): single-round fast pre-check
  return {
    ceo_prompt: PRD_CEO_REVIEW_PROMPT(prd),
    qa_prompt: PRD_QA_REVIEW_PROMPT(prd),
    eng_prompt: PRD_ENG_REVIEW_PROMPT(prd),
    design_prompt: PRD_DESIGN_REVIEW_PROMPT(prd),
  };
}

/**
 * V20: Parse the host LLM's multi-role review responses.
 *
 * Accepts an array of responses (one per role) and reconciles them
 * using RECONCILE_PRIORITIES from agent-skills.
 */
export function parseMultiRoleReviewResponses(
  responses: Array<{ role: ReviewRole; response: string }>,
): MultiRoleReviewResult {
  const allFindings: RoleFinding[] = [];

  for (const { role, response } of responses) {
    const parsed = parseSingleRoleResponse(response, role);
    allFindings.push(...parsed);
  }

  // Reconcile findings (drop noise, keep actionable)
  const reviewFindings: ReviewFinding[] = allFindings.map((f) => ({
    ...f,
    actionable: f.severity !== 'info',
  }));
  const { reconciled } = reconcileFindings(reviewFindings);

  // Convert back to RoleFinding
  const reconciledRoleFindings: RoleFinding[] = reconciled.map((f) => ({
    role: f.role,
    severity: f.severity,
    message: f.message,
    passed: f.passed,
  }));

  const p0Fail = reconciledRoleFindings.filter((f) => !f.passed && f.severity === 'P0').length;
  const p1Fail = reconciledRoleFindings.filter((f) => !f.passed && f.severity === 'P1').length;
  const total = reconciledRoleFindings.length || 1;
  const passedCount = reconciledRoleFindings.filter((f) => f.passed).length;
  const score = Math.max(0, Math.round((passedCount / total) * 100) - p0Fail * 15 - p1Fail * 5);
  const passed = p0Fail === 0;

  return {
    roles: ['ceo', 'qa', 'eng', 'design'],
    findings: reconciledRoleFindings,
    passed,
    score,
    summary: passed
      ? `Multi-role review PASS (score ${score}) — CEO/QA/Eng/Design aligned`
      : `Multi-role review FAIL — ${p0Fail} P0 / ${p1Fail} P1 findings`,
  };
}

/**
 * Parse a single role's review response from the host LLM.
 */
function parseSingleRoleResponse(response: string, role: ReviewRole): RoleFinding[] {
  if (!response || typeof response !== 'string') return [];

  // Strip markdown code fences
  let jsonStr = response.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    jsonStr = fenceMatch[1].trim();
  }

  // Find JSON object
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) return [];
  jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== 'object') return [];

  const obj = parsed as { findings?: unknown };
  if (!Array.isArray(obj.findings)) return [];

  const findings: RoleFinding[] = [];
  for (const f of obj.findings) {
    if (!f || typeof f !== 'object') continue;
    const finding = f as {
      role?: string;
      severity?: string;
      message?: string;
      passed?: boolean;
    };
    findings.push({
      role,
      severity: (['P0', 'P1', 'P2', 'info'].includes(finding.severity || '')
        ? finding.severity as 'P0' | 'P1' | 'P2' | 'info'
        : 'info'),
      message: typeof finding.message === 'string' ? finding.message : '',
      passed: finding.passed === true,
    });
  }

  return findings;
}

/**
 * V20: Detect doubt theater across review rounds.
 *
 * When ≥2 rounds have substantive findings but 0 actionable,
 * the reviewer is "performing" rather than truly reviewing.
 */
export function checkDoubtTheater(
  history: Array<{ round: number; findings: RoleFinding[] }>,
): { detected: boolean; reason: string } {
  const adapted = history.map((h) => ({
    round: h.round,
    findings: h.findings.map((f) => ({
      ...f,
      actionable: f.severity !== 'info',
    })) as ReviewFinding[],
  }));
  return detectDoubtTheater(adapted);
}

/**
 * V20: Run adversarial review across 3 rounds for L2+ complexity.
 *
 * Parses host LLM multi-round responses, reconciles findings across rounds,
 * and determines whether to escalate based on unresolved P0/P1 issues.
 */
export function runAdversarialReview(
  prd: PRD,
  hostLlmResponses: Array<{ round: number; role: ReviewRole; response: string }>,
): MultiRoleReviewResult & { escalate?: boolean } {
  const allAdversarialFindings: AdversarialFinding[] = [];

  // Parse responses from all rounds
  for (const { round, role, response } of hostLlmResponses) {
    const parsed = parseSingleRoleResponse(response, role);
    const adversarialFindings: AdversarialFinding[] = parsed.map((f) => ({
      round: round as 1 | 2 | 3,
      role: f.role,
      severity: f.severity,
      message: f.message,
      passed: f.passed,
      actionable: f.severity !== 'info',
    }));
    allAdversarialFindings.push(...adversarialFindings);
  }

  // Reconcile findings across rounds (only round 3 P0/P1 count)
  const { reconciled, dropped, escalate } = reconcileAdversarialFindings(allAdversarialFindings);

  // Convert reconciled findings to RoleFinding format
  const reconciledRoleFindings: RoleFinding[] = reconciled.map((f) => ({
    role: f.role,
    severity: f.severity,
    message: f.message,
    passed: f.passed,
  }));

  // Calculate score and pass status
  const p0Fail = reconciledRoleFindings.filter((f) => !f.passed && f.severity === 'P0').length;
  const p1Fail = reconciledRoleFindings.filter((f) => !f.passed && f.severity === 'P1').length;
  const total = reconciledRoleFindings.length || 1;
  const passedCount = reconciledRoleFindings.filter((f) => f.passed).length;
  const score = Math.max(0, Math.round((passedCount / total) * 100) - p0Fail * 15 - p1Fail * 5);
  const passed = p0Fail === 0;

  // Build history for shouldEscalate check
  const roundHistory = [1, 2, 3].map((round) => ({
    round,
    findings: allAdversarialFindings
      .filter((f) => f.round === round)
      .map((f) => ({
        ...f,
      })) as AdversarialFinding[],
  }));

  const needsEscalation = escalate || shouldEscalate(roundHistory);

  return {
    roles: ['ceo', 'qa', 'eng', 'design'],
    findings: reconciledRoleFindings,
    passed,
    score,
    summary: passed
      ? `Adversarial review PASS (score ${score}) — CEO/QA/Eng/Design aligned after 3 rounds`
      : `Adversarial review FAIL — ${p0Fail} P0 / ${p1Fail} P1 findings remain after 3 rounds`,
    escalate: needsEscalation,
  };
}

// ── Legacy regex-based review (L1 fast mode) ──

function reviewCeo(prd: PRD): RoleFinding[] {
  const out: RoleFinding[] = [];
  const hasPositioning =
    prd.goals.length >= 2 &&
    /compet|differen|壁垒|OpenSpec|peers|Host-LLM|MCP/i.test(prd.overview + prd.goals.join(' '));
  out.push({
    role: 'ceo',
    severity: hasPositioning ? 'info' : 'P0',
    message: hasPositioning
      ? 'Strategic positioning and competitive differentiation present'
      : 'Missing strategic goals / competitive differentiation',
    passed: hasPositioning,
  });
  const mvpOk = prd.stories.filter((s) => s.priority === 'P0').length <= 3;
  out.push({
    role: 'ceo',
    severity: mvpOk ? 'info' : 'P1',
    message: mvpOk ? 'MVP scope looks focused (≤3 P0 stories)' : 'Too many P0 stories — shrink MVP',
    passed: mvpOk,
  });
  return out;
}

function reviewQa(prd: PRD): RoleFinding[] {
  const out: RoleFinding[] = [];
  const stories = prd.stories || [];
  const allHaveAc = stories.length > 0 && stories.every((s) => (s.acceptance_criteria?.length || 0) >= 1);
  out.push({
    role: 'qa',
    severity: allHaveAc ? 'info' : 'P0',
    message: allHaveAc ? 'Every story has ≥1 acceptance criterion' : 'Stories missing acceptance criteria',
    passed: allHaveAc,
  });
  const hollow = stories
    .flatMap((s) => s.acceptance_criteria || [])
    .filter((a) => /works as expected|as described|正确运行/i.test(a.description));
  out.push({
    role: 'qa',
    severity: hollow.length === 0 ? 'info' : 'P0',
    message:
      hollow.length === 0
        ? 'No hollow/placeholder ACs detected'
        : `${hollow.length} hollow AC(s) — require measurable checks`,
    passed: hollow.length === 0,
  });
  return out;
}

function reviewEng(prd: PRD): RoleFinding[] {
  const out: RoleFinding[] = [];
  const hasArch = (prd.architecture || []).some((a) => (a.mermaid || '').length > 10);
  out.push({
    role: 'eng',
    severity: hasArch ? 'info' : 'P1',
    message: hasArch ? 'Architecture diagram present' : 'Missing mermaid architecture for implementation',
    passed: hasArch,
  });
  const hasFr = (prd.functional_requirements || []).length >= 1;
  out.push({
    role: 'eng',
    severity: hasFr ? 'info' : 'P0',
    message: hasFr ? 'Functional requirements present' : 'No functional requirements — not implementable',
    passed: hasFr,
  });
  const risks = prd.risks || [];
  out.push({
    role: 'eng',
    severity: risks.length >= 1 ? 'info' : 'P2',
    message: risks.length >= 1 ? 'Technical/product risks documented' : 'Add at least one risk + mitigation',
    passed: risks.length >= 1,
  });
  return out;
}

function reviewDesign(prd: PRD): RoleFinding[] {
  const out: RoleFinding[] = [];
  const hasTargetUsers = (prd.target_users || []).length >= 1;
  out.push({
    role: 'design',
    severity: hasTargetUsers ? 'info' : 'P1',
    message: hasTargetUsers ? 'Target users identified' : 'Missing target users — UX cannot be evaluated',
    passed: hasTargetUsers,
  });
  const hasScenarios = /scenario|场景|流程|flow|user journey/i.test(prd.overview);
  out.push({
    role: 'design',
    severity: hasScenarios ? 'info' : 'P2',
    message: hasScenarios ? 'Usage scenarios mentioned' : 'Add usage scenarios for UX evaluation',
    passed: hasScenarios,
  });
  return out;
}

/** Run CEO/QA/Eng/Design review; all P0 must pass. (L1 fast mode — regex-based) */
export function runMultiRolePrdReview(
  prd: PRD,
  options?: RunMultiRolePrdReviewOptions,
): MultiRoleReviewResult {
  const findings = [...reviewCeo(prd), ...reviewQa(prd), ...reviewEng(prd), ...reviewDesign(prd)];
  const p0Fail = findings.filter((f) => !f.passed && f.severity === 'P0').length;
  const p1Fail = findings.filter((f) => !f.passed && f.severity === 'P1').length;
  const total = findings.length || 1;
  const passedCount = findings.filter((f) => f.passed).length;
  const score = Math.max(0, Math.round((passedCount / total) * 100) - p0Fail * 15 - p1Fail * 5);
  const passed = p0Fail === 0;
  const result: MultiRoleReviewResult = {
    roles: ['ceo', 'qa', 'eng', 'design'],
    findings,
    passed,
    score,
    summary: passed
      ? `Multi-role review PASS (score ${score}) — CEO/QA/Eng/Design aligned`
      : `Multi-role review FAIL — ${p0Fail} P0 / ${p1Fail} P1 findings`,
  };

  // G2: best-effort file handoff — when an `azaDir` is provided,
  // write one handoff per role so the integration step can pick up
  // the structured findings without re-parsing the LLM response.
  if (options?.azaDir) {
    try {
      for (const role of result.roles) {
        const roleFindings = result.findings.filter((f) => f.role === role);
        if (roleFindings.length === 0) continue;
        try {
          // writeHandoff is async; fire-and-forget with .catch so a
          // sync function can still trigger the write without
          // awaiting on the hot path.
          void writeHandoff(options.azaDir!, {
            from_role: role,
            to_role: 'integration',
            artifact: 'findings',
            data: roleFindings,
            timestamp: new Date().toISOString(),
          }).catch(() => {
            // best-effort: handoff failure is non-fatal
          });
        } catch {
          // best-effort: handoff failure is non-fatal
        }
      }
    } catch {
      // best-effort: outer guard so a single bad role never breaks the review
    }
  }

  return result;
}
