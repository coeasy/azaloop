/**
 * R12 P6 Plus18 (P1 主链路拆分第18轮) — Auto-Loop 响应构造器。
 *
 * 借鉴 gstack「response shape registry」+ agency-orchestrator「step result router」+ comet「hard_continue_to_ship」：
 * 把 unified-handlers.ts 中 handleAzaAuto 内部的 4 个 inline 响应构造抽到独立模块。
 *
 * 4 个 response builder：
 * 1. **buildStepErrorResponse** — 步骤执行失败（recoverable=true，host 续跑）
 * 2. **buildAwaitingHostResponse** — 等待 host 执行 L3 inline（host_protocol=hard_continue_to_ship_no_user_ask）
 * 3. **buildStepCompletedResponse** — 步骤完成（done=true，准备 ship）
 * 4. **buildMaxStepsResponse** — 达到 maxSteps（未完成，继续 full loop）
 *
 * 设计要点：
 * - 4 个 builder 都返回 typed response shape（unknown → LoopResponse-like）
 * - 复用 autonomousHostAction 工厂统一 next_action 格式
 * - host_protocol 字段强制 hard_continue_to_ship_no_user_ask
 * - 共享 ctx（taskId/userInputHash）减少参数传递
 */
import { autonomousHostAction } from './tools/unified-handlers-helpers';

// ── 1. Step error response (recoverable) ──

export interface StepErrorContext {
  stepIndex: number;
  errMsg?: string;
  lastStage: string;
  lastIteration: number;
  taskId: string;
  userInputHash: string;
}

export function buildStepErrorResponse(ctx: StepErrorContext): unknown {
  return {
    success: false,
    recoverable: true,
    error: `step_${ctx.stepIndex + 1}_failed: ${ctx.errMsg ?? 'unknown'}`,
    data: {
      stage: ctx.lastStage,
      iteration: ctx.lastIteration,
      status: 'step_error',
      task_fingerprint: ctx.userInputHash,
      stepsExecuted: ctx.stepIndex,
    },
    next_action: autonomousHostAction(
      'aza_auto',
      'continue',
      '上一步异常已保存状态，重新调用 aza_auto 同一 user_input 可恢复',
      { reportAfter: false },
    ),
    metadata: {
      task_id: ctx.taskId,
      user_input_hash: ctx.userInputHash,
      failed_step: ctx.stepIndex + 1,
      error: ctx.errMsg,
    },
  };
}

// ── 2. Awaiting host response (L3 inline) ──

export interface AwaitingHostContext {
  stepResult: {
    stage: string;
    iteration: number;
    awaitingAction?: { tool?: string; action?: string; reason?: string; instruction?: string } | null;
  };
  stepIndex: number;
  awaitTool: string;
  awaitAction: string;
  autoPlanSelected: boolean;
  autoPlanPath: string | undefined;
  taskId: string;
  userInputHash: string;
}

export function buildAwaitingHostResponse(ctx: AwaitingHostContext): unknown {
  const awaitingAction = ctx.stepResult.awaitingAction || { tool: ctx.awaitTool, action: ctx.awaitAction };
  return {
    success: true,
    data: {
      stage: ctx.stepResult.stage,
      iteration: ctx.stepResult.iteration,
      status: 'paused',
      awaitingAction,
      instruction:
        `HOST_MUST_EXECUTE: 立即写码/改文件，然后调用 ${ctx.awaitTool}(action=${ctx.awaitAction})，` +
        `完成后立刻 aza_loop(action=report_tool, tool_name=${ctx.awaitTool})。禁止询问用户是否继续。` +
        (ctx.autoPlanSelected
          ? `方案已自动选定（见 ${ctx.autoPlanPath || '.aza/chosen-plan.md'}），按该方案执行，不要再让用户选方案。`
          : '自动选案未启用或不可用；按当前 PRD 的安全默认路径执行，不要让用户补选方案。'),
      host_protocol: 'hard_continue_to_ship_no_user_ask',
      forbid_user_ask: true,
      auto_plan_selected: ctx.autoPlanSelected,
      auto_plan_path: ctx.autoPlanPath,
      task_fingerprint: ctx.userInputHash,
      stepsExecuted: ctx.stepIndex + 1,
    },
    next_action: autonomousHostAction(
      ctx.awaitTool,
      ctx.awaitAction,
      awaitingAction.reason ||
        `执行全自动循环的下一步：${ctx.awaitTool}(${ctx.awaitAction})`,
    ),
    metadata: {
      iteration: ctx.stepResult.iteration,
      stage: ctx.stepResult.stage,
      loop_level: 'inner',
      stepsExecuted: ctx.stepIndex + 1,
      task_id: ctx.taskId,
      user_input_hash: ctx.userInputHash,
    },
  };
}

// ── 3. Step completed response (done) ──

export interface StepCompletedContext {
  stepResult: {
    stage: string;
    iteration: number;
    nextAction?: { tool: string; action: string; reason?: string } | null;
  };
  stepIndex: number;
  taskId: string;
  userInputHash: string;
}

export function buildStepCompletedResponse(ctx: StepCompletedContext): unknown {
  return {
    success: true,
    data: {
      stage: ctx.stepResult.stage,
      iteration: ctx.stepResult.iteration,
      status: 'completed',
      reason: ctx.stepResult.nextAction?.reason || '全自动循环完成',
      task_fingerprint: ctx.userInputHash,
      stepsExecuted: ctx.stepIndex + 1,
    },
    next_action: ctx.stepResult.nextAction || {
      tool: 'aza_finish',
      action: 'ship',
      reason: '全自动循环完成，执行交付',
    },
    metadata: {
      iteration: ctx.stepResult.iteration,
      stage: ctx.stepResult.stage,
      loop_level: 'inner',
      stepsExecuted: ctx.stepIndex + 1,
      task_id: ctx.taskId,
    },
  };
}

// ── 4. Max steps reached response ──

export interface MaxStepsContext {
  lastStage: string;
  lastIteration: number;
  maxSteps: number;
  autoPlanSelected: boolean;
  autoPlanPath: string | undefined;
  taskId: string;
  userInputHash: string;
}

export function buildMaxStepsResponse(ctx: MaxStepsContext): unknown {
  return {
    success: true,
    data: {
      stage: ctx.lastStage,
      iteration: ctx.lastIteration,
      status: 'max_steps_reached',
      reason: `达到最大步数 ${ctx.maxSteps}，循环未完成`,
      stepsExecuted: ctx.maxSteps,
      auto_plan_selected: ctx.autoPlanSelected,
      auto_plan_path: ctx.autoPlanPath,
      task_fingerprint: ctx.userInputHash,
    },
    next_action: autonomousHostAction('aza_loop', 'full', '继续全自动循环', { reportAfter: false }),
    metadata: {
      iteration: ctx.lastIteration,
      stage: ctx.lastStage,
      loop_level: 'inner',
      stepsExecuted: ctx.maxSteps,
      task_id: ctx.taskId,
    },
  };
}

// ── 5. 工厂：buildAllAutoLoopResponses ──

/** 全 4 个 response builder 集合 */
export const AUTO_LOOP_RESPONSE_BUILDERS = {
  stepError: buildStepErrorResponse,
  awaitingHost: buildAwaitingHostResponse,
  stepCompleted: buildStepCompletedResponse,
  maxSteps: buildMaxStepsResponse,
};
