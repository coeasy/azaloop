/**
 * aza_prd — PRD generate / validate / review / approve / modify / cancel / draft / multi-review / refine.
 *
 * R12 P6 Plus10 (P1 主链路拆分第10轮) — 把 7 个 gate-based handler 的重复
 * try/catch + metadata 模板抽到 withPRDGate() 包装器（prd-gate-factory.ts）。
 * 主文件每个 handler 退化为 1-2 行委托，减少约 80% 模板代码。
 */
import { PRDGenerator, type StateManager, type ResumeGenerator } from '@azaloop/core';
import type { PRDGenerationInput } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';
import { withPRDGate } from './prd-gate-factory';
import { PRDReviewGate, runCompetitiveResearch, writePrdMarkdown } from '@azaloop/core';

// ── C5: PRD Generator + Review Gate singletons ──
const prdGenerator = new PRDGenerator();

let prdReviewGate: PRDReviewGate | null = null;

function getPRDReviewGate(stateManager: StateManager, resumeGenerator: ResumeGenerator): PRDReviewGate {
  if (!prdReviewGate) {
    prdReviewGate = new PRDReviewGate({ stateManager, resumeGenerator });
  }
  return prdReviewGate;
}

// ── Standalone handlers (no gate) ──

/**
 * aza_prd(generate) — 生成 PRD 并落盘。
 */
export async function handlePRDGenerate(input: PRDGenerationInput, workspacePath?: string): Promise<LoopResponse> {
  try {
    const prd = prdGenerator.generate(input);
    const validated = prdGenerator.validate(prd);
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
      /* best-effort */
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

/**
 * aza_prd(validate) — 校验已有 PRD。
 */
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

// ── Gate-based handlers (use withPRDGate factory) ──

/**
 * aza_prd(review) — 用户提交需求后的第一步，生成 PRD 展示给用户。
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
  const useOpenspec = userInput.openspec !== false && userInput.source !== 'aza-prd';
  return withPRDGate(stateManager, resumeGenerator, getPRDReviewGate, {
    gateMethod: 'review',
    gateArgs: [{
      title: userInput.title,
      description: userInput.description,
      source: useOpenspec ? 'openspec' : 'aza-prd',
      workspace_path: userInput.workspace_path,
    }],
    metadata: { successProgress: '5%', failureProgress: '0%', stage: 'open' },
    isSuccess: () => true,
    nextAction: () => ({ tool: 'aza_prd', action: 'wait', reason: 'PRD generated, waiting for user approval (set auto_approve=true for unattended Cursor runs)' }),
    dataTransform: (result) => ({
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
    }),
  });
}

/**
 * aza_prd(approve) — 用户确认 PRD，进入正式执行。
 */
export async function handlePrdApprove(
  answers: Record<string, string> | undefined,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  return withPRDGate(stateManager, resumeGenerator, getPRDReviewGate, {
    gateMethod: 'approve',
    gateArgs: [answers],
    metadata: { successProgress: '10%', failureProgress: '5%', stage: 'open' },
  });
}

/**
 * aza_prd(modify) — 用户提出修改意见，PRD 更新后重新展示。
 */
export async function handlePrdModify(
  feedback: string,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  return withPRDGate(stateManager, resumeGenerator, getPRDReviewGate, {
    gateMethod: 'modify',
    gateArgs: [feedback],
    metadata: { successProgress: '5%', failureProgress: '0%', stage: 'open' },
    nextAction: () => ({ tool: 'aza_prd_approve', action: 'wait', reason: 'PRD modified, waiting for user approval' }),
  });
}

/**
 * aza_prd(cancel) — 用户取消当前 PRD。
 */
export async function handlePrdCancel(
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  return withPRDGate(stateManager, resumeGenerator, getPRDReviewGate, {
    gateMethod: 'cancel',
    gateArgs: [],
    metadata: { successProgress: '0%', failureProgress: '0%', stage: 'open' },
    dataTransform: (result) => ({ cancelled: result.cancelled }),
  });
}

/**
 * aza_prd_draft — V20 多步生成第 1 步：生成草稿 prompt 给宿主 LLM。
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
  return withPRDGate(stateManager, resumeGenerator, getPRDReviewGate, {
    gateMethod: 'draft',
    gateArgs: [{
      title: args.title,
      description: args.description || args.user_input || args.title,
      workspace_path: args.workspace_path,
      complexity: args.complexity as any,
    }],
    metadata: { successProgress: '3%', failureProgress: '0%', stage: 'open' },
    isSuccess: () => true,
  });
}

/**
 * aza_prd_multi_review — V20 多步生成第 2 步：生成 4 角色对抗式审查 prompts。
 */
export async function handlePrdMultiReview(
  prdDraft: string,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  return withPRDGate(stateManager, resumeGenerator, getPRDReviewGate, {
    gateMethod: 'multiReview',
    gateArgs: [prdDraft],
    metadata: { successProgress: '6%', failureProgress: '0%', stage: 'open' },
    isSuccess: (result) => result.prd_parsed === true,
  });
}

/**
 * aza_prd_refine — V20 多步生成第 3 步：解析精炼后 PRD + 检查 + 路由。
 */
export async function handlePrdRefine(
  refinedPrd: string,
  reviewResponses: Array<{ role: string; response: string }> | undefined,
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
): Promise<LoopResponse> {
  return withPRDGate(stateManager, resumeGenerator, getPRDReviewGate, {
    gateMethod: 'refine',
    gateArgs: [refinedPrd, reviewResponses],
    metadata: { successProgress: '8%', failureProgress: '0%', stage: 'open' },
    isSuccess: (result) => result.refined === true,
  });
}
