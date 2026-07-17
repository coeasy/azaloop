/**
 * R12 P6 Plus7 — AzaLoop Action Handlers 拆分
 *
 * 借鉴 spec-kit「action registry」+ planning-with-files「action router」：
 *
 * 痛点：aza-loop.ts handleAutoLoop() 函数 ~480 行，包含 10 个 action case
 *       （status/reset/full/auto/stop/pause/resume/retry/report_tool/step），
 *       每个 case 都有自己的响应构造 + 错误处理 + 调度逻辑，混在一个 switch 里。
 *
 * 解法：每个 action 拆分为独立函数（status.ts/reset.ts/full.ts/auto.ts/stop.ts/
 *       pause.ts/resume.ts/resume.ts/retry.ts/report-tool.ts/step.ts），
 *       handleAutoLoop() 退化为 thin dispatcher。
 *
 * 边界：所有依赖通过 ActionContext 注入，action handler 不持有任何状态。
 */

import type { LoopResponse } from '@azaloop/shared';
import type { AutoLoopDriver } from '@azaloop/core';
import type { AutoLoopScheduler } from '@azaloop/core';

/**
 * Action handler 上下文：从 aza-loop.ts 注入的依赖。
 */
export interface ActionContext {
  /** 项目根目录（规范化后） */
  root: string;
  /** AutoLoopDriver 单例 */
  driver: AutoLoopDriver;
  /** AutoLoopScheduler 单例 */
  scheduler: AutoLoopScheduler;
  /** 当前 stage（来自 caller） */
  currentStage?: string;
  /** 工具名（仅 report_tool 用） */
  toolName?: string;
}

/**
 * Action handler 通用签名。
 */
export type ActionHandler = (ctx: ActionContext) => Promise<LoopResponse>;

/**
 * 构造标准 metadata：iteration/progress/stage 三元组。
 */
export function buildMetadata(ctx: ActionContext): {
  iteration: number;
  progress: string;
  stage: string;
} {
  return {
    iteration: ctx.driver.getIteration(),
    progress: ctx.driver.getLoopController().stateMachine.getProgress(),
    stage: ctx.driver.getCurrentStage(),
  };
}
