import { handlePRDGenerate, handlePRDValidate, handlePrdReview, handlePrdApprove, handlePrdModify, handlePrdCancel } from './tools/aza-prd';
import { handleLoopNext, handleLoopStatus, handleLoopComplete, handleLoopStop, handleLoopSetCondition, handleLoopResetConditions, handleLoopGetStageIterations, handleLoopCircuitBreaker, handleLoopCompletionGate, handleLoopAudit, handleAutoLoop } from './tools/aza-loop';
import { handleTaskDesign, handleTaskImplement, handleTaskVerify } from './tools/aza-task';
import { handleQualityCheck } from './tools/aza-quality';
import { handleMemoryQuery, handleMemoryRecord } from './tools/aza-memory';
import { handleContextCalibrate, handleContextStatus } from './tools/aza-context';
import { handleContinue } from './tools/aza-continue';
import { handleHealthCheck } from './tools/aza-health';
import { handleDocGenerate } from './tools/aza-doc';
import { handleSkillSearch, handleSkillList } from './tools/aza-skill';
import { handleSecurityScan } from './tools/aza-security';
import { handleStyleCheck, handleStyleLearn } from './tools/aza-style';
import { handleAudit } from './tools/aza-audit';
import { handleCompliance } from './tools/aza-compliance';
import { handleDag } from './tools/aza-dag';
import { handleRunstateStatus, handleRunstateUpdate, handleAuditLogRecent, handleAuditLogSearch } from './tools/aza-runstate';
import { handleConventionsList, handleConventionsWrite, handleConventionsExtract } from './tools/aza-conventions';
import { handleSessionStart } from './tools/aza-session';
import { handleInit } from './tools/aza-init';
import { handleEvalRun, handleEvalSummary } from './tools/aza-eval';
import { handleExplore } from './tools/aza-explore';
import { handleBudget } from './tools/aza-budget';
import { handleFinishWork } from './tools/aza-finish-work';
import { getFormattedToolDefinitions, validateRegistryConsistency } from './tool-registry';

// C1: MCPEventBridge integration — wraps all tool handlers with event simulation
import {
  MCPEventBridge,
  MCPEventSimulator,
  EventBus,
  StateManager,
  StrikeSystem,
  ResumeGenerator,
  registerAllHookHandlers,
  checkStageTool,
  WRITE_TOOLS,
} from '@azaloop/core';
import type { Stage } from '@azaloop/core';
import * as path from 'path';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

// ── C1: Initialize event simulation infrastructure (shared singletons) ──

const azaDir = path.join(process.cwd(), '.aza');
const eventBus = new EventBus();
const stateManager = new StateManager(azaDir);
const strikeSystem = new StrikeSystem();
const resumeGenerator = new ResumeGenerator(azaDir);
const simulator = new MCPEventSimulator(eventBus, stateManager, resumeGenerator, strikeSystem);
const bridge = new MCPEventBridge(simulator, {
  stageResolver: async () => {
    try {
      const fileState = await stateManager.load();
      return (fileState.pipeline.current_stage as Stage) || 'open';
    } catch {
      return 'open';
    }
  },
  workspaceRoot: process.cwd(),
});

// C9: Register all Hook event handlers
registerAllHookHandlers(eventBus, stateManager, resumeGenerator);

// ── Raw tool handlers (before bridge wrapping) ──

const RAW_HANDLERS: Record<string, ToolHandler> = {
  aza_prd_generate: (args) => handlePRDGenerate({ title: args.title as string, description: args.description as string } as any),
  aza_prd_validate: (args) => handlePRDValidate(args.prd as any),
  aza_prd_review: (args) => handlePrdReview({ title: args.title as string, description: args.description as string }, stateManager, resumeGenerator),
  aza_prd_approve: (args) => handlePrdApprove(args.answers as Record<string, string> | undefined, stateManager, resumeGenerator),
  aza_prd_modify: (args) => handlePrdModify(args.feedback as string, stateManager, resumeGenerator),
  aza_prd_cancel: () => handlePrdCancel(stateManager, resumeGenerator),
  aza_loop_next: (args) => handleLoopNext(args.current_stage as string, args.workspace_path as string),
  aza_loop_status: (args) => handleLoopStatus(args.workspace_path as string),
  aza_loop_complete: (args) => handleLoopComplete(args.stage as string, args.workspace_path as string),
  aza_loop_stop: (args) => handleLoopStop(args.reason as string, args.workspace_path as string),
  aza_loop_set_condition: (args) => handleLoopSetCondition(args.key as string, args.passed as boolean, args.workspace_path as string),
  aza_loop_reset_conditions: (args) => handleLoopResetConditions(args.workspace_path as string),
  aza_loop_stage_iterations: (args) => handleLoopGetStageIterations(args.stage as string, args.workspace_path as string),
  aza_loop_circuit_breaker: (args) => handleLoopCircuitBreaker(args.workspace_path as string),
  aza_loop_completion_gate: (args) => handleLoopCompletionGate(args.workspace_path as string),
  aza_loop_audit: (args) => handleLoopAudit(args.workspace_path as string),
  // ── P0-4: Auto-loop driver (programmatic next_action chain execution) ──
  aza_auto_loop: (args) => handleAutoLoop(args.action as string, args.current_stage as string, args.workspace_path as string, args.tool_name as string),
  aza_task_design: (args) => handleTaskDesign(args.story_id as string, args.title as string, args.description as string),
  aza_task_implement: (args) => handleTaskImplement(args.task_id as string),
  aza_task_verify: (args) => handleTaskVerify(args.task_id as string),
  aza_quality_check: (args) => handleQualityCheck(args.project_root as string || (args.workspace_path as string) || process.cwd()),
  aza_memory_query: (args) => handleMemoryQuery(args.query as string, args.workspace_path as string),
  aza_memory_record: (args) => handleMemoryRecord(args.type as string, args.summary as string, args.details as string, (args.tags as string[]) ?? [], args.workspace_path as string),
  aza_context_calibrate: (args) => handleContextCalibrate(args.workspace_path as string),
  aza_context_status: () => handleContextStatus(stateManager),
  aza_continue: (args) => handleContinue(args.base_dir as string || '.aza'),
  aza_health: () => handleHealthCheck(),
  aza_doc_generate: (args) => handleDocGenerate(args.type as string, args.title as string, args.content as string),
  aza_skill_search: (args) => handleSkillSearch(args.query as string),
  aza_skill_list: (args) => handleSkillList(args.type as string),
  aza_security_scan: (args) => handleSecurityScan(args.project_root as string || process.cwd()),
  aza_style_check: (args) => handleStyleCheck(args.code as string, args.file_path as string),
  aza_style_learn: (args) => handleStyleLearn(),
  aza_audit: (args) => handleAudit(args.workspace_path as string),
  aza_compliance: (args) => handleCompliance(args.workspace_path as string, args.check_type as 'full' | 'quick' | undefined),
  aza_dag: (args) => handleDag(args.action as 'build' | 'status' | 'parallel', args.tasks as any, args.dag as any),
  // ── Session initialization ──
  aza_session_start: (args) => handleSessionStart(args.workspace_path as string),
  // ── One-shot initialization ──
  aza_init: (args) => handleInit(args.workspace_path as string, args.client as string),
  // ── V12: Run state + audit log (comet pattern) ──
  aza_runstate_status: (args) => handleRunstateStatus(args.workspace_path as string),
  aza_runstate_update: (args) => handleRunstateUpdate(args as any, args.workspace_path as string),
  aza_audit_log_recent: (args) => handleAuditLogRecent(args.limit as number, args.workspace_path as string),
  aza_audit_log_search: (args) => handleAuditLogSearch(args.type as string, args.source as string, args.workspace_path as string),
  // ── V12: Learn-from-task conventions (Trellis pattern) ──
  aza_conventions_list: (args) => handleConventionsList(args.workspace_path as string),
  aza_conventions_write: (args) => handleConventionsWrite({
    tag: args.tag as string,
    description: args.description as string,
    source: args.source as string,
  } as any, args.workspace_path as string),
  aza_conventions_extract: (args) => handleConventionsExtract(args.work_summary as string, args.stage as string, args.iteration as number, args.workspace_path as string),
  // ── V12: Eval platform (comet pattern) ──
  aza_eval_run: (args) => handleEvalRun(args.test_output as string, args.expected_behavior as string),
  aza_eval_summary: (args) => handleEvalSummary(args.workspace_path as string),
  // ── V12: Explore mode (OpenSpec pattern) ──
  aza_explore: (args) => handleExplore(args.workspace_path as string, args.focus as string | undefined),
  // ── V12: Budget estimator (loop-cost pattern) ──
  aza_budget: (args) => handleBudget(args.workspace_path as string),
};

// ── C1: Wrap all handlers with MCPEventBridge ──
// This ensures every MCP tool call goes through:
//   1. simulatePreTool (discipline check)
//   2. tool execution
//   3. simulatePostTool (STATE update + RESUME pre-write)
//   4. next_action appended for LLM auto-continue

const TOOL_HANDLERS: Record<string, ToolHandler> = Object.fromEntries(
  Object.entries(RAW_HANDLERS).map(([name, handler]) => [
    name,
    bridge.wrapTool(name, handler as any) as ToolHandler,
  ]),
);

// ── v14-P8.1: Validate that every tool handler has a registry entry and
//    vice-versa. Mismatches would silently disable tools, so we fail fast. ──
const REGISTRY_ERRORS = validateRegistryConsistency(TOOL_HANDLERS);
if (REGISTRY_ERRORS.length > 0) {
  // Log a warning but do not crash — the MCP server can still start and
  // `tools/list` will simply skip missing tools. The errors are exposed via
  // `getRegistryErrors()` so tests can assert on them.
  // eslint-disable-next-line no-console
  console.warn(
    `[azaloop] tool-registry consistency issues: ${REGISTRY_ERRORS.length}`,
    REGISTRY_ERRORS.slice(0, 5),
  );
}

/**
 * Return the list of registry consistency errors detected at startup.
 * Tests can use this to assert on registry/handler drift.
 */
export function getRegistryErrors(): readonly string[] {
  return REGISTRY_ERRORS;
}

export async function handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return { success: false, error: `Unknown tool: ${toolName}`, data: null };
  }

  // ── CP-new-1: Stage-Tool Guard — block tools that don't belong to the
  //    current pipeline stage. Reads current_stage from STATE.yaml. ──
  let currentStage: Stage = 'open';
  try {
    const fileState = await stateManager.load();
    currentStage = (fileState.pipeline.current_stage as Stage) || 'open';
  } catch {
    // best-effort: if STATE.yaml can't be loaded, default to 'open' (least restrictive for bootstrapping)
  }

  const guardResult = checkStageTool(toolName, currentStage, CALL_HISTORY);
  if (!guardResult.allowed) {
    // Red Flag hit → record a strike so repeated skips escalate.
    if (guardResult.redFlag) {
      strikeSystem.record(
        'red_flag',
        `Red Flag ${guardResult.redFlag.id}: ${guardResult.reason}`,
        0,
      );
    }
    return {
      success: false,
      error: guardResult.reason,
      data: null,
      next_action: {
        tool: guardResult.redirectTool || 'aza_loop_next',
        action: 'refine',
        reason: guardResult.reason,
      },
      red_flag: guardResult.redFlag ?? undefined,
      current_stage: currentStage,
    };
  }

  // Record the call for future Red Flag detection (decision-point prerequisites).
  CALL_HISTORY.push(toolName);
  if (CALL_HISTORY.length > 200) CALL_HISTORY.shift(); // cap memory

  // Execute the handler
  const result = await handler(args);

  // ── P1-4: Force RESUME.md pre-write after every tool call ──
  // This ensures the session is always recoverable, even if the tool
  // handler is called directly without going through the MCP bridge
  // (e.g., Trae built-in tools). Best-effort: never throws.
  // The bridge already writes RESUME.md in simulatePostTool, but we
  // also write here as a defense-in-depth measure.
  try {
    await resumeGenerator.generate(stateManager, {
      next_tool: toolName,
      next_action: `tool:${toolName}`,
      last_milestone: `Called ${toolName} at stage ${currentStage}`,
    });
  } catch {
    // best-effort — RESUME.md write failure never blocks the tool response
  }

  return result;
}

/**
 * Session-scoped call history for Red Flag detection (decision-point skips).
 * Reset when a new session starts (see aza_session_start handler).
 */
const CALL_HISTORY: string[] = [];

// ── v14-P8.1: getToolDefinitions reads from the single source of truth in
//    tool-registry.ts. Each description is auto-augmented with
//    "Use when {whenToUse}. {description}" guidance. ──

export function getToolDefinitions() {
  return getFormattedToolDefinitions();
}

/**
 * Tool tier classification — borrowed from agent-skills's slash command grouping.
 *
 * - **high**: Core loop tools used in every session (PRD → loop → task → quality).
 * - **low**: Auxiliary / diagnostic tools used occasionally (audit, security, eval, etc.).
 */
const HIGH_FREQ_TOOLS = new Set([
  'aza_prd_review', 'aza_prd_approve', 'aza_prd_modify',
  'aza_loop_next', 'aza_loop_status', 'aza_loop_complete', 'aza_loop_stop',
  'aza_auto_loop',
  'aza_task_design', 'aza_task_implement', 'aza_task_verify',
  'aza_quality_check',
  'aza_continue',
  'aza_session_start', 'aza_init',
]);

export interface ToolGroup {
  tier: 'high' | 'low';
  label: string;
  tools: ReturnType<typeof getToolDefinitions>;
}

/**
 * Return tools grouped by tier (high-frequency vs low-frequency).
 * Clients can use this to show core tools prominently and hide advanced tools.
 */
export function getToolGroups(): ToolGroup[] {
  const all = getToolDefinitions();
  const high = all.filter(t => HIGH_FREQ_TOOLS.has(t.name));
  const low = all.filter(t => !HIGH_FREQ_TOOLS.has(t.name));
  return [
    { tier: 'high', label: 'Core Loop (PRD → Design → Build → Verify → Archive)', tools: high },
    { tier: 'low', label: 'Auxiliary (audit, security, eval, explore, memory, style, etc.)', tools: low },
  ];
}
