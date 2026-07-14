import type { Stage } from './state-machine';

/**
 * Stage-Tool Guard — prevents agents from calling tools that don't belong to
 * the current pipeline stage. Inspired by comet's hook-guard (hard block of
 * Write/Edit during wrong phases) and spec-superflow's guard.mjs (programmatic
 * interception of illegal state transitions).
 *
 * Before this module existed, `MCPEventBridge.wrapTool` and
 * `handleToolCall` dispatched any tool regardless of the current stage —
 * letting an agent skip PRD approval and jump straight to implementation.
 * This is the MCP-layer enforcement point (CP-new-1).
 *
 * Patterns: tool names may use `*` suffix as a wildcard
 * (e.g. `aza_loop_*` matches `aza_loop_next`, `aza_loop_status`, ...).
 */

/**
 * Result of a stage-tool guard check.
 */
export interface StageToolGuardResult {
  /** Whether the tool is allowed in the given stage. */
  allowed: boolean;
  /** Human-readable reason when blocked. */
  reason?: string;
  /** When blocked, the tool the agent should call instead to get back on track. */
  redirectTool?: string;
  /** Red Flag hit (set when the call pattern indicates skipping a decision point). */
  redFlag?: { id: string; severity: 'low' | 'medium' | 'high'; remediation: string };
}

/**
 * Stage → allowed tool patterns matrix.
 *
 * Design principles:
 * - Each stage lists tools that advance THAT stage's work or are stage-agnostic.
 * - State/loop control tools (`aza_loop_*`, `aza_context_calibrate`) are allowed
 *   in every stage because the loop must always be drivable.
 * - Tools not listed AND not matched by any wildcard are denied by default
 *   (deny-by-default would be too strict for the 35+ tool surface; instead
 *   unknown tools get a soft allow with a warning, see `check`).
 */
const STAGE_TOOL_MATRIX: Record<Stage, string[]> = {
  open: [
    // PRD generation & review (the core of "open")
    'aza_prd_generate',
    'aza_prd_validate',
    'aza_prd_review',
    'aza_prd_approve',
    'aza_prd_modify',
    'aza_prd_cancel',
    // Exploration before committing to a spec
    'aza_explore',
    // Stage-agnostic — always allowed
    'aza_context_calibrate',
    'aza_context_status',
    'aza_loop_next',
    'aza_loop_status',
    'aza_loop_stop',
    'aza_loop_set_condition',
    'aza_loop_reset_conditions',
    'aza_loop_stage_iterations',
    'aza_loop_circuit_breaker',
    'aza_loop_completion_gate',
    'aza_loop_audit',
    'aza_session_start',
    'aza_init',
    'aza_health',
    'aza_continue',
    'aza_memory_*',
    'aza_skill_*',
    'aza_runstate_*',
    'aza_audit_log_*',
  ],
  design: [
    'aza_task_design',
    'aza_dag',
    'aza_conventions_list',
    'aza_conventions_write',
    // Stage-agnostic
    'aza_context_calibrate',
    'aza_context_status',
    'aza_loop_next',
    'aza_loop_status',
    'aza_loop_stop',
    'aza_loop_set_condition',
    'aza_loop_reset_conditions',
    'aza_loop_stage_iterations',
    'aza_loop_circuit_breaker',
    'aza_loop_completion_gate',
    'aza_loop_audit',
    'aza_continue',
    'aza_health',
    'aza_memory_*',
    'aza_skill_*',
    'aza_runstate_*',
    'aza_audit_log_*',
  ],
  build: [
    'aza_task_implement',
    'aza_task_verify',
    'aza_security_scan',
    'aza_style_check',
    'aza_style_learn',
    'aza_quality_check',
    'aza_break_loop',
    // Stage-agnostic
    'aza_context_calibrate',
    'aza_context_status',
    'aza_loop_next',
    'aza_loop_status',
    'aza_loop_stop',
    'aza_loop_set_condition',
    'aza_loop_reset_conditions',
    'aza_loop_stage_iterations',
    'aza_loop_circuit_breaker',
    'aza_loop_completion_gate',
    'aza_loop_audit',
    'aza_continue',
    'aza_health',
    'aza_memory_*',
    'aza_skill_*',
    'aza_runstate_*',
    'aza_audit_log_*',
    'aza_budget',
  ],
  verify: [
    'aza_quality_check',
    'aza_security_scan',
    'aza_compliance',
    'aza_eval_run',
    'aza_eval_summary',
    'aza_style_check',
    'aza_break_loop',
    // Stage-agnostic
    'aza_context_calibrate',
    'aza_context_status',
    'aza_loop_next',
    'aza_loop_status',
    'aza_loop_stop',
    'aza_loop_set_condition',
    'aza_loop_reset_conditions',
    'aza_loop_stage_iterations',
    'aza_loop_circuit_breaker',
    'aza_loop_completion_gate',
    'aza_loop_audit',
    'aza_continue',
    'aza_health',
    'aza_memory_*',
    'aza_skill_*',
    'aza_runstate_*',
    'aza_audit_log_*',
    'aza_budget',
  ],
  archive: [
    'aza_doc_generate',
    'aza_conventions_extract',
    'aza_conventions_list',
    'aza_conventions_write',
    'aza_audit',
    'aza_loop_complete',
    // Stage-agnostic
    'aza_context_calibrate',
    'aza_context_status',
    'aza_loop_next',
    'aza_loop_status',
    'aza_loop_stop',
    'aza_loop_set_condition',
    'aza_loop_reset_conditions',
    'aza_loop_stage_iterations',
    'aza_loop_circuit_breaker',
    'aza_loop_completion_gate',
    'aza_loop_audit',
    'aza_continue',
    'aza_health',
    'aza_memory_*',
    'aza_skill_*',
    'aza_runstate_*',
    'aza_audit_log_*',
  ],
};

/**
 * Tools that write files (subject to the write-guard in mcp-event-bridge).
 * Used to decide whether to invoke `isWriteAllowed` + `analyzeBlastRadius`.
 */
export const WRITE_TOOLS = new Set<string>([
  'aza_task_implement',
  'aza_task_design',
  'aza_task_verify',
  'aza_doc_generate',
  'aza_prd_generate',
  'aza_conventions_write',
  'aza_conventions_extract',
  'aza_style_learn',
]);

/**
 * Critical decision-point tools — calling these out of order is a Red Flag.
 * Maps each "gate" tool to the tool that MUST have been called first.
 */
const DECISION_POINT_PREREQUISITES: Record<string, { required: string; redFlagId: string; remediation: string }> = {
  aza_task_implement: {
    required: 'aza_prd_approve',
    redFlagId: 'RF-1',
    remediation: 'Cannot implement before PRD is approved. Call aza_prd_review → aza_prd_approve first.',
  },
  aza_task_design: {
    required: 'aza_prd_approve',
    redFlagId: 'RF-1',
    remediation: 'Cannot design tasks before PRD is approved. Call aza_prd_review → aza_prd_approve first.',
  },
  aza_loop_complete: {
    required: 'aza_quality_check',
    redFlagId: 'RF-2',
    remediation: 'Cannot complete a stage before quality check passes. Call aza_quality_check first.',
  },
  aza_doc_generate: {
    required: 'aza_quality_check',
    redFlagId: 'RF-2',
    remediation: 'Cannot generate final docs before quality check passes. Call aza_quality_check first.',
  },
};

/**
 * Match a tool name against a pattern that may end with `*` (wildcard suffix).
 */
function matchesPattern(toolName: string, pattern: string): boolean {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return toolName.startsWith(prefix);
  }
  return toolName === pattern;
}

/**
 * Check whether a tool is allowed in the given stage.
 *
 * @param toolName - The MCP tool name (e.g. `aza_task_implement`).
 * @param stage - The current pipeline stage.
 * @param callHistory - Optional: ordered list of tool names already called in
 *   this session, used to detect Red Flags (skipped decision points).
 * @returns Guard result with `allowed`, optional `reason`, `redirectTool`,
 *   and `redFlag` when a decision-point skip is detected.
 */
export function checkStageTool(
  toolName: string,
  stage: Stage,
  callHistory?: string[],
): StageToolGuardResult {
  const patterns = STAGE_TOOL_MATRIX[stage] ?? [];
  const matched = patterns.some((p) => matchesPattern(toolName, p));

  if (!matched) {
    // Find the stage where this tool IS allowed, to redirect the agent.
    const redirectStage = findStageForTool(toolName);
    const reason = `stage-guard: tool "${toolName}" is not allowed in stage "${stage}"`;
    if (redirectStage) {
      return {
        allowed: false,
        reason: `${reason}. It belongs to stage "${redirectStage}". Use aza_loop_next to advance.`,
        redirectTool: 'aza_loop_next',
      };
    }
    // Unknown tool — soft deny with reason (don't break auxiliary tools not yet mapped).
    return {
      allowed: false,
      reason: `${reason}. If this is a new tool, add it to STAGE_TOOL_MATRIX in stage-tool-guard.ts.`,
      redirectTool: 'aza_loop_next',
    };
  }

  // Tool is allowed by stage matrix — now check Red Flags (decision-point skips).
  if (callHistory && callHistory.length > 0) {
    const prereq = DECISION_POINT_PREREQUISITES[toolName];
    if (prereq && !callHistory.includes(prereq.required)) {
      return {
        allowed: false,
        reason: `red-flag: "${toolName}" requires "${prereq.required}" to be called first.`,
        redirectTool: prereq.required,
        redFlag: {
          id: prereq.redFlagId,
          severity: 'high',
          remediation: prereq.remediation,
        },
      };
    }
  }

  return { allowed: true };
}

/**
 * Find the stage where a tool is allowed (for redirect messages).
 */
export function findStageForTool(toolName: string): Stage | null {
  for (const stage of ['open', 'design', 'build', 'verify', 'archive'] as Stage[]) {
    const patterns = STAGE_TOOL_MATRIX[stage];
    if (patterns.some((p) => matchesPattern(toolName, p))) {
      return stage;
    }
  }
  return null;
}

/**
 * Convenience: the full matrix (read-only view), for inspection/tests.
 */
export function getStageToolMatrix(): Readonly<Record<Stage, readonly string[]>> {
  return STAGE_TOOL_MATRIX;
}
