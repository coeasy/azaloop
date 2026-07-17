/**
 * R12 P6 Plus10 (P1 主链路拆分第10轮) — PRD Review Gate 统一工厂。
 *
 * 借鉴 gstack「command pattern」+ spec-kit「executable specification」+ claude-code「thin dispatcher」：
 * 把 aza-prd.ts 中 9 个 handler 的重复 try/catch + metadata 模板
 * 抽到 withPRDGate() 包装器，主文件每个 handler 退化为 1 行委托。
 *
 * 9 个 handler：
 *   1. handlePrdReview
 *   2. handlePrdApprove
 *   3. handlePrdModify
 *   4. handlePrdCancel
 *   5. handlePrdDraft
 *   6. handlePrdMultiReview
 *   7. handlePrdRefine
 *   8. handlePRDGenerate
 *   9. handlePRDValidate
 */
import type { LoopResponse } from '@azaloop/shared';
import type { PRDReviewGate, StateManager, ResumeGenerator } from '@azaloop/core';

export interface PRDGateMetadata {
  /** 成功时 metadata.progress（如 "10%"） */
  successProgress: string;
  /** 失败时 metadata.progress（如 "5%"） */
  failureProgress: string;
  /** metadata.stage（一般固定 "open"） */
  stage: 'open' | 'design' | 'build' | 'verify' | 'archive';
}

export interface PRDGateOptions {
  /** 调用 gate 的方法名 */
  gateMethod: keyof PRDReviewGate;
  /** 调用方法的参数 */
  gateArgs: any[];
  /** metadata 配置 */
  metadata: PRDGateMetadata;
  /** 成功判定函数（默认检查 result.success） */
  isSuccess?: (result: any) => boolean;
  /** next_action 重写（默认使用 result.next_action） */
  nextAction?: (result: any) => { tool: string; action: string; reason: string };
  /** 成功时 data 转换（默认 result 本身） */
  dataTransform?: (result: any) => unknown;
}

/**
 * withPRDGate — 统一 gate handler 包装器。
 *
 * 设计目标：
 * 1. 统一 try/catch 错误处理
 * 2. 统一 metadata 字段
 * 3. 统一 next_action 路由
 * 4. 让 handler 主体只关心业务逻辑
 */
export async function withPRDGate(
  stateManager: StateManager,
  resumeGenerator: ResumeGenerator,
  getGate: (sm: StateManager, rg: ResumeGenerator) => PRDReviewGate,
  options: PRDGateOptions,
): Promise<LoopResponse> {
  const { gateMethod, gateArgs, metadata, isSuccess, nextAction, dataTransform } = options;
  try {
    const gate = getGate(stateManager, resumeGenerator);
    const fn = gate[gateMethod] as unknown as (...a: any[]) => Promise<any>;
    const result = await fn.apply(gate, gateArgs);
    const success = isSuccess ? isSuccess(result) : result?.success !== false;
    return {
      success,
      data: dataTransform ? dataTransform(result) : result,
      next_action: nextAction
        ? nextAction(result)
        : result?.next_action ?? { tool: 'aza_loop', action: 'next', reason: 'Continue loop' },
      metadata: {
        iteration: 0,
        progress: success ? metadata.successProgress : metadata.failureProgress,
        stage: metadata.stage,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: metadata.failureProgress, stage: metadata.stage },
    };
  }
}
