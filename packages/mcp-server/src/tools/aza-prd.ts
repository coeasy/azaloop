import { PRDGenerator, PRDReviewGate, runCompetitiveResearch, writePrdMarkdown } from '@azaloop/core';
import type { PRDGenerationInput, StateManager, ResumeGenerator } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

const prdGenerator = new PRDGenerator();

// ── C5: PRD Review Gate singleton ──
let prdReviewGate: PRDReviewGate | null = null;

function getPRDReviewGate(stateManager: StateManager, resumeGenerator: ResumeGenerator): PRDReviewGate {
  if (!prdReviewGate) {
    prdReviewGate = new PRDReviewGate({ stateManager, resumeGenerator });
  }
  return prdReviewGate;
}

export async function handlePRDGenerate(input: PRDGenerationInput, workspacePath?: string): Promise<LoopResponse> {
  try {
    const prd = prdGenerator.generate(input);
    const validated = prdGenerator.validate(prd);
    // DEFAULT + VISIBLE competitive research — the `generate` action must not
    // bypass the live GitHub search that `review` performs. Persist the PRD
    // (with the dedicated Competitive Research section) into the project .aza/.
    const azaDir = path.join(workspacePath || process.cwd(), '.aza');
    try {
      const comp = await runCompetitiveResearch(azaDir, input.title, input.description || input.title, {
        complexity: (validated as any)._complexity,
      });
      if (comp.research) {
        writePrdMarkdown(azaDir, validated, comp.research);
      } else {
        writePrdMarkdown(azaDir, validated);
      }
    } catch {
      /* best-effort — PRD still returns even if artifact write fails */
    }
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
      next_action: { tool: 'aza_loop', action: 'next', reason: 'PRD validated, proceed to design stage' },
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
  userInput: {
    title: string;
    description: string;
    source?: 'openspec' | 'aza-prd';
    openspec?: boolean;
    workspace_path?: string;
  },
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  try {
    const gate = getPRDReviewGate(stateManager, resumeGenerator);
    // Default OpenSpec scaffold on approve (spine S2). Pass source:'openspec' unless explicitly disabled.
    const useOpenspec = userInput.openspec !== false && userInput.source !== 'aza-prd';
    const result = await gate.review({
      title: userInput.title,
      description: userInput.description,
      source: useOpenspec ? 'openspec' : 'aza-prd',
      workspace_path: userInput.workspace_path,
    });
    // Compact payload for hosts — full PRD already on disk under .aza/
    const compact = {
      prd_id: result.prd_id,
      title: result.title,
      complexity: result.complexity,
      quality_score: result.quality_score,
      needs_user_approval: result.needs_user_approval,
      instruction: result.instruction,
      open_questions: (result.open_questions || []).slice(0, 5),
      key_decisions: (result.key_decisions || []).slice(0, 5),
      artifacts: ['.aza/prd.md', '.aza/prd.json', '.aza/competitive-research.md'],
      summary_digest: String(result.summary || '').slice(0, 800),
      competitive: result.competitive,
    };
    return {
      success: true,
      data: compact,
      next_action: {
        tool: 'aza_prd',
        action: 'wait',
        reason: 'PRD generated, waiting for user approval (set auto_approve=true for unattended Cursor runs)',
      },
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

// ── V20 Task 1.5: multi-step LLM interaction handlers ──

/**
 * aza_prd_draft — V20 多步生成第 1 步：生成草稿 prompt 给宿主 LLM
 */
export async function handlePrdDraft(
  args: {
    title: string;
    description?: string;
    user_input?: string;
    workspace_path?: string;
    complexity?: string;
  },
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  try {
    const gate = getPRDReviewGate(stateManager, resumeGenerator);
    const result = await gate.draft({
      title: args.title,
      description: args.description || args.user_input || args.title,
      workspace_path: args.workspace_path,
      complexity: args.complexity as any,
    });
    return {
      success: true,
      data: result,
      next_action: result.next_action,
      metadata: { iteration: 0, progress: '3%', stage: 'open' },
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
 * aza_prd_multi_review — V20 多步生成第 2 步：生成 4 角色对抗式审查 prompts
 */
export async function handlePrdMultiReview(
  prdDraft: string,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  try {
    const gate = getPRDReviewGate(stateManager, resumeGenerator);
    const result = await gate.multiReview(prdDraft);
    return {
      success: result.prd_parsed,
      data: result,
      next_action: result.next_action,
      metadata: { iteration: 0, progress: '6%', stage: 'open' },
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
 * aza_prd_refine — V20 多步生成第 3 步：解析精炼后 PRD + 检查 + 路由
 */
export async function handlePrdRefine(
  refinedPrd: string,
  reviewResponses: Array<{ role: string; response: string }> | undefined,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  try {
    const gate = getPRDReviewGate(stateManager, resumeGenerator);
    const result = await gate.refine(refinedPrd, reviewResponses);
    return {
      success: result.refined,
      data: result,
      next_action: result.next_action,
      metadata: { iteration: 0, progress: '8%', stage: 'open' },
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
