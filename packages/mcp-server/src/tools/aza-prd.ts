import { PRDGenerator, PRDReviewGate } from '@azaloop/core';
import type { PRDGenerationInput, StateManager, ResumeGenerator } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';

const prdGenerator = new PRDGenerator();

// ── C5: PRD Review Gate singleton ──
let prdReviewGate: PRDReviewGate | null = null;

function getPRDReviewGate(stateManager: StateManager, resumeGenerator: ResumeGenerator): PRDReviewGate {
  if (!prdReviewGate) {
    prdReviewGate = new PRDReviewGate({ stateManager, resumeGenerator });
  }
  return prdReviewGate;
}

export async function handlePRDGenerate(input: PRDGenerationInput): Promise<LoopResponse> {
  try {
    const prd = prdGenerator.generate(input);
    const validated = prdGenerator.validate(prd);
    return {
      success: true,
      data: validated,
      next_action: { tool: 'aza_prd_validate', action: 'validate', reason: 'PRD generated, ready to validate' },
      metadata: { iteration: 0, progress: '10%', stage: 'open' },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: '0%', stage: 'open' },
    };
  }
}

export async function handlePRDValidate(prd: unknown): Promise<LoopResponse> {
  try {
    const validated = prdGenerator.validate(prd);
    return {
      success: true,
      data: validated,
      next_action: { tool: 'aza_loop_next', action: 'next', reason: 'PRD validated, proceed to design stage' },
      metadata: { iteration: 0, progress: '15%', stage: 'open' },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: '10%', stage: 'open' },
    };
  }
}

// ── C5: PRD 先行展示工作流 ──────────────────────────────────────────

/**
 * aza_prd_review — 用户提交需求后的第一步
 * 借鉴 Cursor plan mode + Qoder Quest：先生成 PRD 展示给用户，确认后再执行
 */
export async function handlePrdReview(
  userInput: { title: string; description: string },
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  try {
    const gate = getPRDReviewGate(stateManager, resumeGenerator);
    const result = await gate.review(userInput);
    return {
      success: true,
      data: result,
      next_action: { tool: 'aza_prd_approve', action: 'wait', reason: 'PRD generated, waiting for user approval (60s timeout auto-approve)' },
      metadata: { iteration: 0, progress: '5%', stage: 'open' },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: '0%', stage: 'open' },
    };
  }
}

/**
 * aza_prd_approve — 用户确认 PRD，进入正式执行
 */
export async function handlePrdApprove(
  answers: Record<string, string> | undefined,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  try {
    const gate = getPRDReviewGate(stateManager, resumeGenerator);
    const result = await gate.approve(answers);
    return {
      success: result.approved,
      data: result,
      next_action: result.next_action,
      metadata: { iteration: 0, progress: '10%', stage: 'open' },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: '5%', stage: 'open' },
    };
  }
}

/**
 * aza_prd_modify — 用户提出修改意见，PRD 更新后重新展示
 */
export async function handlePrdModify(
  feedback: string,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  try {
    const gate = getPRDReviewGate(stateManager, resumeGenerator);
    const result = await gate.modify(feedback);
    return {
      success: true,
      data: result,
      next_action: { tool: 'aza_prd_approve', action: 'wait', reason: 'PRD modified, waiting for user approval' },
      metadata: { iteration: 0, progress: '5%', stage: 'open' },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: '0%', stage: 'open' },
    };
  }
}

/**
 * aza_prd_cancel — 用户取消当前 PRD
 */
export async function handlePrdCancel(
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  try {
    const gate = getPRDReviewGate(stateManager, resumeGenerator);
    const result = await gate.cancel();
    return {
      success: true,
      data: { cancelled: result.cancelled },
      next_action: result.next_action,
      metadata: { iteration: 0, progress: '0%', stage: 'open' },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: '0%', stage: 'open' },
    };
  }
}
