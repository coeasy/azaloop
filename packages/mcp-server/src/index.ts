import { handlePRDGenerate, handlePRDValidate, handlePrdReview, handlePrdApprove, handlePrdModify, handlePrdCancel } from './tools/aza-prd';
import { handleLoopNext, handleLoopStatus, handleLoopComplete, handleLoopStop, handleLoopSetCondition, handleLoopResetConditions, handleLoopGetStageIterations, handleLoopCircuitBreaker, handleLoopCompletionGate, handleLoopAudit } from './tools/aza-loop';
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

// C1: MCPEventBridge integration — wraps all tool handlers with event simulation
import {
  MCPEventBridge,
  MCPEventSimulator,
  EventBus,
  StateManager,
  StrikeSystem,
  ResumeGenerator,
  registerAllHookHandlers,
} from '@azaloop/core';
import * as path from 'path';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

// ── C1: Initialize event simulation infrastructure (shared singletons) ──

const azaDir = path.join(process.cwd(), '.aza');
const eventBus = new EventBus();
const stateManager = new StateManager(azaDir);
const strikeSystem = new StrikeSystem();
const resumeGenerator = new ResumeGenerator(azaDir);
const simulator = new MCPEventSimulator(eventBus, stateManager, resumeGenerator, strikeSystem);
const bridge = new MCPEventBridge(simulator);

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

export async function handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return { success: false, error: `Unknown tool: ${toolName}`, data: null };
  }
  return handler(args);
}

export function getToolDefinitions() {
  return [
    { name: 'aza_prd_generate', description: 'Generate PRD from natural language requirements', inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['title', 'description'] } },
    { name: 'aza_prd_validate', description: 'Validate a PRD document', inputSchema: { type: 'object', properties: { prd: { type: 'object' } }, required: ['prd'] } },
    { name: 'aza_prd_review', description: '分析用户需求，生成 PRD 并展示摘要等待确认（借鉴 Cursor plan mode + Qoder Quest）', inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } }, required: ['title', 'description'] } },
    { name: 'aza_prd_approve', description: '用户确认 PRD，进入正式执行', inputSchema: { type: 'object', properties: { answers: { type: 'object' } } } },
    { name: 'aza_prd_modify', description: '用户提出修改意见，PRD 更新后重新展示', inputSchema: { type: 'object', properties: { feedback: { type: 'string' } }, required: ['feedback'] } },
    { name: 'aza_prd_cancel', description: '用户取消当前 PRD', inputSchema: { type: 'object', properties: {} } },
    { name: 'aza_loop_next', description: 'Advance the development loop to the next action', inputSchema: { type: 'object', properties: { current_stage: { type: 'string' }, workspace_path: { type: 'string' } } } },
    { name: 'aza_loop_status', description: 'Get current loop status', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_loop_complete', description: 'Mark a stage as complete', inputSchema: { type: 'object', properties: { stage: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['stage'] } },
    { name: 'aza_loop_stop', description: 'Stop the loop with a reason', inputSchema: { type: 'object', properties: { reason: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['reason'] } },
    { name: 'aza_task_design', description: 'Design a task from a story', inputSchema: { type: 'object', properties: { story_id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['story_id', 'title', 'description'] } },
    { name: 'aza_task_implement', description: 'Mark a task as implemented', inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['task_id'] } },
    { name: 'aza_task_verify', description: 'Verify a task implementation', inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['task_id'] } },
    { name: 'aza_quality_check', description: 'Run quality gates', inputSchema: { type: 'object', properties: { project_root: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['project_root'] } },
    { name: 'aza_memory_query', description: 'Query project memory', inputSchema: { type: 'object', properties: { query: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['query'] } },
    { name: 'aza_memory_record', description: 'Record a memory entry', inputSchema: { type: 'object', properties: { type: { type: 'string' }, summary: { type: 'string' }, details: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, workspace_path: { type: 'string' } }, required: ['type', 'summary', 'details'] } },
    { name: 'aza_context_calibrate', description: 'Get calibrated context bundle (constitution + rules + role)', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_context_status', description: 'Get current STATE.yaml status', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_continue', description: 'Continue from last session', inputSchema: { type: 'object', properties: { base_dir: { type: 'string' }, workspace_path: { type: 'string' } } } },
    { name: 'aza_health', description: 'Health check', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_doc_generate', description: 'Generate documentation', inputSchema: { type: 'object', properties: { type: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['type', 'title'] } },
    { name: 'aza_skill_search', description: 'Search for skills', inputSchema: { type: 'object', properties: { query: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['query'] } },
    { name: 'aza_skill_list', description: 'List available skills', inputSchema: { type: 'object', properties: { type: { type: 'string' }, workspace_path: { type: 'string' } } } },
    { name: 'aza_security_scan', description: 'Run security scan', inputSchema: { type: 'object', properties: { project_root: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['project_root'] } },
    { name: 'aza_style_check', description: 'Check code style', inputSchema: { type: 'object', properties: { code: { type: 'string' }, file_path: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['code'] } },
    { name: 'aza_style_learn', description: 'Learn project style patterns', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_audit', description: 'Run loop-audit scoring (0-100, L0-L3) and return signals & recommendations', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_compliance', description: 'Run China compliance check (网络安全法/PIPL/等保2.0/数据出境/AI标识) — returns Red/Yellow/Green scorecard', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' }, check_type: { type: 'string', enum: ['full', 'quick'] } } } },
    { name: 'aza_dag', description: 'Manage task dependency DAG — build from tasks, query status, or fetch parallel-ready tasks', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['build', 'status', 'parallel'] }, tasks: { type: 'array', items: { type: 'object' } }, dag: { type: 'object' }, workspace_path: { type: 'string' } }, required: ['action'] } },
    { name: 'aza_loop_circuit_breaker', description: 'Get circuit breaker status (4 dimensions: iteration/token/stagnation/no-progress, 3 levels: phase/inner/outer)', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_loop_completion_gate', description: 'Check completion gate (6 conditions must pass to allow stopping)', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_loop_audit', description: 'Run loop audit scoring (18 signals, 4 levels L0-L3, 0-100 score)', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_loop_set_condition', description: 'Set a guard condition for loop control', inputSchema: { type: 'object', properties: { key: { type: 'string' }, passed: { type: 'boolean' }, workspace_path: { type: 'string' } }, required: ['key', 'passed'] } },
    { name: 'aza_loop_reset_conditions', description: 'Reset all guard conditions to default', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_loop_stage_iterations', description: 'Get iteration count for a specific stage', inputSchema: { type: 'object', properties: { stage: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['stage'] } },
    // ── Session initialization ──
    { name: 'aza_session_start', description: 'Initialize AzaLoop system on session start — creates .aza directory, STATE.yaml, audit.jsonl, and triggers session-start event', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_init', description: 'One-shot project initialization — detects client, creates .aza directory, STATE.yaml, RESUME.md, run-state.json. Call this once per project.', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' }, client: { type: 'string', description: 'Optional client override (auto-detected if omitted)' } } } },
    // ── V12: Run state + audit log (comet pattern) ──
    { name: 'aza_runstate_status', description: 'Get machine-owned run state (run-state.json)', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_runstate_update', description: 'Update run state fields (scripts own writes)', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_audit_log_recent', description: 'Get recent audit log entries (append-only, comet pattern)', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, workspace_path: { type: 'string' } } } },
    { name: 'aza_audit_log_search', description: 'Search audit log by type or source', inputSchema: { type: 'object', properties: { type: { type: 'string' }, source: { type: 'string' }, workspace_path: { type: 'string' } } } },
    // ── V12: Learn-from-task conventions (Trellis pattern) ──
    { name: 'aza_conventions_list', description: 'List learned conventions (spec-conventions/conventions.jsonl)', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    { name: 'aza_conventions_write', description: 'Write a learned convention entry', inputSchema: { type: 'object', properties: { tag: { type: 'string' }, description: { type: 'string' }, source: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['tag', 'description'] } },
    { name: 'aza_conventions_extract', description: 'Extract and auto-write conventions from completed task', inputSchema: { type: 'object', properties: { work_summary: { type: 'string' }, stage: { type: 'string' }, iteration: { type: 'number' }, workspace_path: { type: 'string' } }, required: ['work_summary', 'stage'] } },
    // ── V12: Eval platform (comet pattern) ──
    { name: 'aza_eval_run', description: 'Run eval on a test case (Pass@k/Rubric scoring)', inputSchema: { type: 'object', properties: { test_output: { type: 'string' }, expected_behavior: { type: 'string' } }, required: ['test_output', 'expected_behavior'] } },
    { name: 'aza_eval_summary', description: 'Aggregate all eval results from eval-results.jsonl', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
    // ── V12: Explore mode (OpenSpec pattern — think before commit) ──
    { name: 'aza_explore', description: 'Explore workspace before committing — analyze codebase, weigh options, output recommendations without writing code', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' }, focus: { type: 'string', description: 'Specific area to explore (optional)' } } } },
    // ── V12: Budget estimator (loop-cost pattern) ──
    { name: 'aza_budget', description: 'Generate token budget report — estimates consumption per loop level/stage, tracks actual usage from run-ledger', inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } } },
  ];
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
