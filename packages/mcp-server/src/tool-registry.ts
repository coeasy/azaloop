/**
 * v14 — P8.1: MCP tool registry — single source of truth for tool metadata.
 *
 * Each entry bundles the tool's `name`, `whenToUse` (one-line guidance prefixed
 * "Use when ..."), `description` (multi-line), and `inputSchema` (JSON Schema).
 * `getToolDefinitions()` returns the MCP-formatted payload with the
 * description augmented to `Use when {whenToUse}. {description}` — mirroring
 * the `obra/superpowers` and `ruvnet/ruflo` ADR-112 "Use when …" guidance.
 *
 * Reference: obra/superpowers v6.0.2 — 285 tool descriptions; ruflo v3.10.33
 * ADR-112 (tool descriptions must include "Use when..." guidance).
 *
 * ## Why a registry?
 * - Avoids 22-way drift when adding a new tool.
 * - Allows linting/validation that every tool has a `whenToUse`.
 * - Enables future auto-generation of slash-command files (under
 *   `templates/clients/.../commands/`) from the same source of truth.
 *
 * ## When to update this file
 * Add a new `ToolDefinition` entry when you register a new MCP tool. The
 * `ToolRegistry` array order is the same order returned to MCP clients via
 * `tools/list`, so put high-frequency tools at the top.
 */

import type { ToolHandler } from './index';

// ── Public types ─────────────────────────────────────────────

export interface ToolDefinition {
  /** MCP tool name (snake_case, prefixed with `aza_`). */
  name: string;
  /** One-line guidance on when to use this tool. Must start with "Use when " */
  whenToUse: string;
  /** Multi-line description. Becomes the tool's `description` field. */
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// ── Tool registry ────────────────────────────────────────────

/**
 * Ordered registry of all MCP tools exposed by the azaloop server.
 * Order matters: high-frequency tools come first.
 */
export const TOOL_REGISTRY: ToolDefinition[] = [
  // ── Core loop (high-frequency) ──
  {
    name: 'aza_session_start',
    whenToUse: 'starting a session and need to bootstrap the .aza directory, STATE.yaml, and audit log',
    description: 'Initialize AzaLoop system on session start — creates .aza directory, STATE.yaml, audit.jsonl, and triggers session-start event',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_init',
    whenToUse: 'bootstrapping a project for the first time — auto-detects the client and creates .aza, STATE.yaml, RESUME.md, run-state.json',
    description: 'One-shot project initialization — detects client, creates .aza directory, STATE.yaml, RESUME.md, run-state.json. Call this once per project.',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' }, client: { type: 'string', description: 'Optional client override (auto-detected if omitted)' } } },
  },
  {
    name: 'aza_context_calibrate',
    whenToUse: 'starting a session and need the constitution + rules + role context bundle',
    description: 'Get calibrated context bundle (constitution + rules + role)',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_context_status',
    whenToUse: 'wanting a quick read of the current STATE.yaml status without loading full context',
    description: 'Get current STATE.yaml status',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_prd_review',
    whenToUse: 'starting a new feature or task that needs a PRD before coding (plan-mode UX)',
    description: '分析用户需求，生成 PRD 并展示摘要等待确认（借鉴 Cursor plan mode + Qoder Quest）',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } }, required: ['title', 'description'] },
  },
  {
    name: 'aza_prd_approve',
    whenToUse: 'the PRD looks good and you want to commit to implementation',
    description: '用户确认 PRD，进入正式执行',
    inputSchema: { type: 'object', properties: { answers: { type: 'object' } } },
  },
  {
    name: 'aza_prd_modify',
    whenToUse: 'the PRD needs adjustments before approval (provide feedback to regenerate)',
    description: '用户提出修改意见，PRD 更新后重新展示',
    inputSchema: { type: 'object', properties: { feedback: { type: 'string' } }, required: ['feedback'] },
  },
  {
    name: 'aza_prd_cancel',
    whenToUse: 'abandoning the current PRD and returning to idle',
    description: '用户取消当前 PRD',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'aza_prd_generate',
    whenToUse: 'generating a PRD document directly from a title+description without review/approval flow',
    description: 'Generate PRD from natural language requirements',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['title', 'description'] },
  },
  {
    name: 'aza_prd_validate',
    whenToUse: 'validating a PRD against the dimension scoring system before approval',
    description: 'Validate a PRD document',
    inputSchema: { type: 'object', properties: { prd: { type: 'object' } }, required: ['prd'] },
  },
  {
    name: 'aza_loop_next',
    whenToUse: 'advancing the inner development loop to the next stage or action',
    description: 'Advance the development loop to the next action',
    inputSchema: { type: 'object', properties: { current_stage: { type: 'string' }, workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_loop_status',
    whenToUse: 'wanting a snapshot of the current loop state, stages, and iterations',
    description: 'Get current loop status',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_loop_complete',
    whenToUse: 'signaling that the current stage has met its success criteria',
    description: 'Mark a stage as complete',
    inputSchema: { type: 'object', properties: { stage: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['stage'] },
  },
  {
    name: 'aza_loop_stop',
    whenToUse: 'halting the loop due to an error, user request, or completion',
    description: 'Stop the loop with a reason',
    inputSchema: { type: 'object', properties: { reason: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['reason'] },
  },
  {
    name: 'aza_loop_set_condition',
    whenToUse: 'manually setting a guard condition (key/passed) for loop control',
    description: 'Set a guard condition for loop control',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, passed: { type: 'boolean' }, workspace_path: { type: 'string' } }, required: ['key', 'passed'] },
  },
  {
    name: 'aza_loop_reset_conditions',
    whenToUse: 'clearing all guard conditions back to default state',
    description: 'Reset all guard conditions to default',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_loop_stage_iterations',
    whenToUse: 'checking how many iterations a specific stage has consumed',
    description: 'Get iteration count for a specific stage',
    inputSchema: { type: 'object', properties: { stage: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['stage'] },
  },
  {
    name: 'aza_loop_circuit_breaker',
    whenToUse: 'inspecting the circuit-breaker status (4 dimensions: iteration/token/stagnation/no-progress)',
    description: 'Get circuit breaker status (4 dimensions: iteration/token/stagnation/no-progress, 3 levels: phase/inner/outer)',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_loop_completion_gate',
    whenToUse: 'checking whether the 6 completion-gate conditions have all passed',
    description: 'Check completion gate (6 conditions must pass to allow stopping)',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_loop_audit',
    whenToUse: 'running the loop-audit scorer (18 signals, 4 levels L0–L3) to grade a session',
    description: 'Run loop audit scoring (18 signals, 4 levels L0-L3, 0-100 score)',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_auto_loop',
    whenToUse: 'driving the main chain automatically without manual agent step-by-step — executes the full loop (PRD → design → implement → verify → archive) until completion',
    description: 'Auto-loop driver — executes the next_action chain automatically. V16: Supports "auto" mode for background scheduler. Supports step-by-step (default), full-run, background schedule, and status modes.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '"step" (default, single step), "full" (run until completion), "status" (check status), "reset" (reset), "auto" (V16: start background scheduler), "stop" (V16: stop scheduler), "pause" (V16: pause scheduler), "resume" (V16: resume scheduler), "report_tool" (V16: report tool execution to scheduler), "retry" (V18: retry scheduler from error state)' },
        workspace_path: { type: 'string', description: 'Project root path' },
        current_stage: { type: 'string', description: 'Current stage to start from' },
        tool_name: { type: 'string', description: 'V16: Tool name to report when action="report_tool"' },
      },
      required: [],
    },
  },
  {
    name: 'aza_task_design',
    whenToUse: 'converting a story into a proposal + spec + design + task list before implementation',
    description: 'Design a task from a story',
    inputSchema: { type: 'object', properties: { story_id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['story_id', 'title', 'description'] },
  },
  {
    name: 'aza_task_implement',
    whenToUse: 'marking a task as implemented and recording build context',
    description: 'Mark a task as implemented',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['task_id'] },
  },
  {
    name: 'aza_task_verify',
    whenToUse: 'running the full quality pipeline (lint/test/regression/security/acceptance/loop-audit) on a task',
    description: 'Verify a task implementation',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['task_id'] },
  },
  {
    name: 'aza_quality_check',
    whenToUse: 'running the quality gate suite (lint, test, regression, security, acceptance, loop-audit) before merging',
    description: 'Run quality gates',
    inputSchema: { type: 'object', properties: { project_root: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['project_root'] },
  },
  {
    name: 'aza_continue',
    whenToUse: 'resuming a session from the last RESUME.md snapshot',
    description: 'Continue from last session',
    inputSchema: { type: 'object', properties: { base_dir: { type: 'string' }, workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_health',
    whenToUse: 'running a quick health check on the MCP server and azaloop installation',
    description: 'Health check',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_doc_generate',
    whenToUse: 'generating project documentation (PRD, ADR, journal entry, etc.) from structured input',
    description: 'Generate documentation',
    inputSchema: { type: 'object', properties: { type: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['type', 'title'] },
  },
  {
    name: 'aza_skill_search',
    whenToUse: 'searching the registered skill library for a skill matching a query',
    description: 'Search for skills',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'aza_skill_list',
    whenToUse: 'listing all available skills (optionally filtered by type)',
    description: 'List available skills',
    inputSchema: { type: 'object', properties: { type: { type: 'string' }, workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_memory_query',
    whenToUse: 'querying the project memory for previously-recorded learnings, conventions, or context',
    description: 'Query project memory',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'aza_memory_record',
    whenToUse: 'saving a learning or convention for future runs',
    description: 'Record a memory entry',
    inputSchema: { type: 'object', properties: { type: { type: 'string' }, summary: { type: 'string' }, details: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, workspace_path: { type: 'string' } }, required: ['type', 'summary', 'details'] },
  },
  {
    name: 'aza_security_scan',
    whenToUse: 'auditing the repo for secrets, injection vectors, or compliance violations',
    description: 'Run security scan',
    inputSchema: { type: 'object', properties: { project_root: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['project_root'] },
  },
  {
    name: 'aza_style_check',
    whenToUse: 'checking a code snippet against the project\'s learned style conventions',
    description: 'Check code style',
    inputSchema: { type: 'object', properties: { code: { type: 'string' }, file_path: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['code'] },
  },
  {
    name: 'aza_style_learn',
    whenToUse: 'triggering a one-time style-learning pass over the codebase to update conventions',
    description: 'Learn project style patterns',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_audit',
    whenToUse: 'running the loop-audit scorer (0–100, L0–L3 levels) and returning signals + recommendations',
    description: 'Run loop-audit scoring (0-100, L0-L3) and return signals & recommendations',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_compliance',
    whenToUse: 'running the China compliance check (网络安全法/PIPL/等保2.0/数据出境/AI标识) for a Red/Yellow/Green scorecard',
    description: 'Run China compliance check (网络安全法/PIPL/等保2.0/数据出境/AI标识) — returns Red/Yellow/Green scorecard',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' }, check_type: { type: 'string', enum: ['full', 'quick'] } } },
  },
  {
    name: 'aza_dag',
    whenToUse: 'building, querying, or fetching parallel-ready tasks from the task-dependency DAG',
    description: 'Manage task dependency DAG — build from tasks, query status, or fetch parallel-ready tasks',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['build', 'status', 'parallel'] }, tasks: { type: 'array', items: { type: 'object' } }, dag: { type: 'object' }, workspace_path: { type: 'string' } }, required: ['action'] },
  },
  // ── V12: Run state + audit log (comet pattern) ──
  {
    name: 'aza_runstate_status',
    whenToUse: 'reading the machine-owned run-state.json snapshot (current loop, budget, strikes, history)',
    description: 'Get machine-owned run state (run-state.json)',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_runstate_update',
    whenToUse: 'writing script-owned fields into run-state.json (use sparingly — scripts own writes)',
    description: 'Update run state fields (scripts own writes)',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_audit_log_recent',
    whenToUse: 'fetching the most recent audit-log entries (append-only, comet pattern)',
    description: 'Get recent audit log entries (append-only, comet pattern)',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' }, workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_audit_log_search',
    whenToUse: 'searching the audit log by event type or source',
    description: 'Search audit log by type or source',
    inputSchema: { type: 'object', properties: { type: { type: 'string' }, source: { type: 'string' }, workspace_path: { type: 'string' } } },
  },
  // ── V12: Learn-from-task conventions (Trellis pattern) ──
  {
    name: 'aza_conventions_list',
    whenToUse: 'listing all learned conventions stored in spec-conventions/conventions.jsonl',
    description: 'List learned conventions (spec-conventions/conventions.jsonl)',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  {
    name: 'aza_conventions_write',
    whenToUse: 'writing a new convention entry (tag + description) for future runs to consult',
    description: 'Write a learned convention entry',
    inputSchema: { type: 'object', properties: { tag: { type: 'string' }, description: { type: 'string' }, source: { type: 'string' }, workspace_path: { type: 'string' } }, required: ['tag', 'description'] },
  },
  {
    name: 'aza_conventions_extract',
    whenToUse: 'extracting conventions from a completed task summary and auto-writing them to conventions.jsonl',
    description: 'Extract and auto-write conventions from completed task',
    inputSchema: { type: 'object', properties: { work_summary: { type: 'string' }, stage: { type: 'string' }, iteration: { type: 'number' }, workspace_path: { type: 'string' } }, required: ['work_summary', 'stage'] },
  },
  // ── V12: Eval platform (comet pattern) ──
  {
    name: 'aza_eval_run',
    whenToUse: 'running an eval on a test case with Pass@k/Rubric scoring',
    description: 'Run eval on a test case (Pass@k/Rubric scoring)',
    inputSchema: { type: 'object', properties: { test_output: { type: 'string' }, expected_behavior: { type: 'string' } }, required: ['test_output', 'expected_behavior'] },
  },
  {
    name: 'aza_eval_summary',
    whenToUse: 'aggregating all eval results from eval-results.jsonl into a summary',
    description: 'Aggregate all eval results from eval-results.jsonl',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  // ── V12: Explore mode (OpenSpec pattern) ──
  {
    name: 'aza_explore',
    whenToUse: 'analyzing the codebase and weighing options before committing code (OpenSpec think-first pattern)',
    description: 'Explore workspace before committing — analyze codebase, weigh options, output recommendations without writing code',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' }, focus: { type: 'string', description: 'Specific area to explore (optional)' } } },
  },
  // ── V12: Budget estimator (loop-cost pattern) ──
  {
    name: 'aza_budget',
    whenToUse: 'generating a token-budget report (estimated vs actual per loop level/stage)',
    description: 'Generate token budget report — estimates consumption per loop level/stage, tracks actual usage from run-ledger',
    inputSchema: { type: 'object', properties: { workspace_path: { type: 'string' } } },
  },
  // ── V14-P8.3: aza finish-work (Trellis slash command) ──
  {
    name: 'aza_finish_work',
    whenToUse: 'wrapping up a task — archive the 3-piece task artifacts, append a workspace journal entry, update STATUS.md, and stop the loop',
    description: 'Archive the current task and finish the loop. Writes CONTEXT/REPAIR/NOTES.md, appends a workspace journal entry, updates STATUS.md, and signals stop. Mirrors `/aza:finish-work` in Trae/Cursor/Claude Code/OpenCode.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        work_summary: { type: 'string' },
        decisions: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } },
        next_steps: { type: 'array', items: { type: 'string' } },
        iteration: { type: 'number' },
        stop_loop: { type: 'boolean' },
        workspace_path: { type: 'string' },
      },
    },
  },
];

// ── Public API ───────────────────────────────────────────────

/**
 * Get a tool definition by name. Returns `undefined` if not found.
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

/**
 * Get all tool names registered in the registry.
 */
export function getToolNames(): string[] {
  return TOOL_REGISTRY.map((t) => t.name);
}

/**
 * Format the MCP tool definition for `tools/list`. The description is
 * augmented with the "Use when …" guidance so MCP clients can show a
 * one-line hint alongside each tool.
 */
export function formatToolDefinition(tool: ToolDefinition): {
  name: string;
  description: string;
  inputSchema: ToolDefinition['inputSchema'];
} {
  return {
    name: tool.name,
    description: `Use when ${tool.whenToUse}. ${tool.description}`,
    inputSchema: tool.inputSchema,
  };
}

/**
 * Return all tool definitions in MCP `tools/list` format with the
 * "Use when …" guidance prepended to each description.
 */
export function getFormattedToolDefinitions(): Array<{
  name: string;
  description: string;
  inputSchema: ToolDefinition['inputSchema'];
}> {
  return TOOL_REGISTRY.map(formatToolDefinition);
}

/**
 * Validate that every `TOOL_HANDLERS` entry has a matching `ToolDefinition`
 * and vice-versa. Returns an array of human-readable discrepancies
 * (empty array = consistent).
 */
export function validateRegistryConsistency(
  handlers: Record<string, ToolHandler>,
): string[] {
  const errors: string[] = [];
  const handlerNames = new Set(Object.keys(handlers));
  const registryNames = new Set(TOOL_REGISTRY.map((t) => t.name));

  for (const name of handlerNames) {
    if (!registryNames.has(name)) {
      errors.push(`Handler "${name}" has no entry in TOOL_REGISTRY`);
    }
  }
  for (const name of registryNames) {
    if (!handlerNames.has(name)) {
      errors.push(`TOOL_REGISTRY entry "${name}" has no matching handler`);
    }
  }
  for (const tool of TOOL_REGISTRY) {
    if (!tool.whenToUse || tool.whenToUse.trim().length === 0) {
      errors.push(`Tool "${tool.name}" has empty whenToUse`);
    }
    if (!tool.description || tool.description.trim().length === 0) {
      errors.push(`Tool "${tool.name}" has empty description`);
    }
  }
  return errors;
}
