/**
 * R12 P6 Plus21 — handleAzaAuto 主循环迭代器抽离 (unified-handlers.ts 减负)
 *
 * 借鉴 agency-orchestrator「step iteration loop」+ comet「hard_continue_to_ship」+
 * gstack「response shape per step result」:
 *
 * 痛点：unified-handlers.ts 中 handleAzaAuto 单方法 110 行；主循环 50 行
 *       (driver 创建 + maxSteps 限制 + 单步执行 + L3 inline 拦截 + 4 个 response builder 路由)
 *       全部 inline 表达式，主方法冗长。
 *
 * 解法：把主循环 + 4 个 response builder 路由逻辑抽到 runAutoLoopMain 函数：
 *   1. buildDriver        — 创建 AutoLoopDriver 实例
 *   2. runAutoLoopStep    — 单步执行 + 上下文裁剪 + 异常恢复 (来自 auto-workflow.ts)
 *   3. tryL3Inline        — L3 inline 拦截 (来自 auto-workflow.ts)
 *   4. 4 个 response builder — step error / awaiting host / step completed / max steps
 *
 * 目标：unified-handlers.ts handleAzaAuto < 30 行 thin shell (核心编排 + 异常 catch)。
 */

import type { StateManager, ResumeGenerator } from '@azaloop/core';
import type { ChosenPlan } from '../../auto-plan';
import { buildDriver, runAutoLoopStep, tryL3Inline, type AutoRunContext } from './auto-workflow';
import {
  buildStepErrorResponse,
  buildAwaitingHostResponse,
  buildStepCompletedResponse,
  buildMaxStepsResponse,
} from '../../auto-response-builder';

export interface AutoLoopMainInput {
  ctx: AutoRunContext;
  stateManager: StateManager;
  resumeGenerator: ResumeGenerator;
  activePlan: ChosenPlan | undefined;
  autoPlanSelected: boolean;
  autoPlanPath: string | undefined;
}

/**
 * 主循环迭代器 — 处理 driver 创建 + maxSteps 限制 + 单步执行 + L3 inline 拦截 + response 路由。
 * 返回 4 个 response builder 之一的结果。
 */
export async function runAutoLoopMain(input: AutoLoopMainInput): Promise<unknown> {
  const { ctx, stateManager, resumeGenerator, activePlan, autoPlanSelected, autoPlanPath } = input;

  // 主循环
  const driver = buildDriver(ctx.workspace, ctx.client);
  const maxSteps = Number(process.env.AZA_AUTO_MAX_STEPS ?? ctx.maxIterations);
  let lastStage = 'open';
  let lastIteration = 0;

  for (let i = 0; i < maxSteps; i++) {
    const stepInfo = await runAutoLoopStep(driver, i, ctx.workspace, lastStage, stateManager);
    if (stepInfo.failed) {
      return buildStepErrorResponse({
        stepIndex: i,
        errMsg: stepInfo.errMsg,
        lastStage,
        lastIteration,
        taskId: ctx.taskId,
        userInputHash: ctx.userInputHash,
      });
    }
    const stepResult = stepInfo.stepResult;
    lastStage = stepInfo.lastStage;
    lastIteration = stepInfo.lastIteration;

    // L3 inline 拦截
    if (stepResult.awaitingAction) {
      const awaitTool = String(stepResult.awaitingAction.tool || '');
      const awaitAction = String(stepResult.awaitingAction.action || '');
      const inline = await tryL3Inline({
        awaitTool, awaitAction, workspace: ctx.workspace, client: ctx.client,
        ctx, activePlan, stateManager, resumeGenerator,
      });
      if (inline.handled) {
        if (inline.result) return inline.result;
        continue;
      }
      return buildAwaitingHostResponse({
        stepResult,
        stepIndex: i,
        awaitTool,
        awaitAction,
        autoPlanSelected,
        autoPlanPath,
        taskId: ctx.taskId,
        userInputHash: ctx.userInputHash,
      });
    }

    if (stepResult.done) {
      return buildStepCompletedResponse({
        stepResult,
        stepIndex: i,
        taskId: ctx.taskId,
        userInputHash: ctx.userInputHash,
      });
    }
  }
  return buildMaxStepsResponse({
    lastStage,
    lastIteration,
    maxSteps,
    autoPlanSelected,
    autoPlanPath,
    taskId: ctx.taskId,
    userInputHash: ctx.userInputHash,
  });
}

/**
 * Auto-Loop 错误响应包装器 (recoverable=true) — handleAzaAuto 异常路径统一返回。
 */
export function buildAutoLoopErrorResponse(error: unknown): unknown {
  return {
    success: false,
    recoverable: true,
    error: `aza_auto failed: ${error instanceof Error ? error.message : String(error)}`,
    data: null,
  };
}
