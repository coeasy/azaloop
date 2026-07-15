/**
 * Maps the legacy 50-tool surface onto the converged 8-tool surface.
 * Legacy names remain callable for one minor version; tools/list only exposes 8.
 */

export interface ResolvedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

const LEGACY_TO_UNIFIED: Record<string, { tool: string; action: string }> = {
  aza_session_start: { tool: 'aza_session', action: 'start' },
  aza_init: { tool: 'aza_session', action: 'init' },
  aza_context_calibrate: { tool: 'aza_session', action: 'calibrate' },
  aza_context_status: { tool: 'aza_session', action: 'status' },
  aza_continue: { tool: 'aza_session', action: 'continue' },
  aza_health: { tool: 'aza_session', action: 'health' },

  aza_prd_review: { tool: 'aza_prd', action: 'review' },
  aza_prd_approve: { tool: 'aza_prd', action: 'approve' },
  aza_prd_modify: { tool: 'aza_prd', action: 'modify' },
  aza_prd_cancel: { tool: 'aza_prd', action: 'cancel' },
  aza_prd_generate: { tool: 'aza_prd', action: 'generate' },
  aza_prd_validate: { tool: 'aza_prd', action: 'validate' },

  aza_loop_next: { tool: 'aza_loop', action: 'next' },
  aza_loop_status: { tool: 'aza_loop', action: 'status' },
  aza_loop_complete: { tool: 'aza_loop', action: 'complete' },
  aza_loop_stop: { tool: 'aza_loop', action: 'stop' },
  aza_loop_set_condition: { tool: 'aza_loop', action: 'set_condition' },
  aza_loop_reset_conditions: { tool: 'aza_loop', action: 'reset_conditions' },
  aza_loop_stage_iterations: { tool: 'aza_loop', action: 'stage_iterations' },
  aza_loop_circuit_breaker: { tool: 'aza_loop', action: 'circuit' },
  aza_loop_completion_gate: { tool: 'aza_loop', action: 'gate' },
  aza_loop_audit: { tool: 'aza_loop', action: 'audit' },
  aza_auto_loop: { tool: 'aza_loop', action: '' }, // action comes from args

  aza_task_design: { tool: 'aza_spec', action: 'design' },
  aza_task_implement: { tool: 'aza_spec', action: 'implement' },
  aza_task_verify: { tool: 'aza_spec', action: 'verify' },
  aza_explore: { tool: 'aza_spec', action: 'explore' },
  aza_dag: { tool: 'aza_spec', action: 'dag' },

  aza_quality_check: { tool: 'aza_quality', action: 'check' },
  aza_security_scan: { tool: 'aza_quality', action: 'security' },
  aza_compliance: { tool: 'aza_quality', action: 'compliance' },
  aza_eval_run: { tool: 'aza_quality', action: 'eval' },
  aza_eval_summary: { tool: 'aza_quality', action: 'eval_summary' },
  aza_style_check: { tool: 'aza_quality', action: 'style' },
  aza_style_learn: { tool: 'aza_quality', action: 'style_learn' },

  aza_finish_work: { tool: 'aza_finish', action: 'work' },
  aza_doc_generate: { tool: 'aza_finish', action: 'archive' },
  aza_ship: { tool: 'aza_finish', action: 'ship' },
  aza_conventions_list: { tool: 'aza_finish', action: 'conventions_list' },
  aza_conventions_write: { tool: 'aza_finish', action: 'conventions_write' },
  aza_conventions_extract: { tool: 'aza_finish', action: 'conventions_extract' },

  aza_memory_query: { tool: 'aza_memory', action: 'query' },
  aza_memory_record: { tool: 'aza_memory', action: 'record' },

  aza_skill_search: { tool: 'aza_meta', action: 'skills_search' },
  aza_skill_list: { tool: 'aza_meta', action: 'skills_list' },
  aza_runstate_status: { tool: 'aza_meta', action: 'runstate_status' },
  aza_runstate_update: { tool: 'aza_meta', action: 'runstate_update' },
  aza_audit_log_recent: { tool: 'aza_meta', action: 'audit_log_recent' },
  aza_audit_log_search: { tool: 'aza_meta', action: 'audit_log_search' },
  aza_budget: { tool: 'aza_meta', action: 'budget' },
  aza_audit: { tool: 'aza_meta', action: 'audit' },
  aza_cost: { tool: 'aza_meta', action: 'budget' },
  aza_plugin: { tool: 'aza_meta', action: 'plugin' },
  aza_test_loop: { tool: 'aza_loop', action: 'full' },
};

export const UNIFIED_TOOLS = [
  'aza_session',
  'aza_prd',
  'aza_loop',
  'aza_spec',
  'aza_quality',
  'aza_finish',
  'aza_memory',
  'aza_meta',
] as const;

export type UnifiedToolName = (typeof UNIFIED_TOOLS)[number];

export function isUnifiedTool(name: string): name is UnifiedToolName {
  return (UNIFIED_TOOLS as readonly string[]).includes(name);
}

/**
 * Resolve a tool call (unified or legacy) into a unified tool + args.
 */
export function resolveToolCall(
  toolName: string,
  args: Record<string, unknown>,
): ResolvedToolCall {
  if (isUnifiedTool(toolName)) {
    return { tool: toolName, args: { ...args } };
  }

  const mapped = LEGACY_TO_UNIFIED[toolName];
  if (!mapped) {
    return { tool: toolName, args };
  }

  const nextArgs = { ...args };
  if (mapped.action) {
    // Preserve explicit action on aza_auto_loop / aza_dag etc.
    if (toolName === 'aza_auto_loop' && typeof args.action === 'string') {
      // keep args.action
    } else if (toolName === 'aza_dag' && typeof args.action === 'string') {
      nextArgs.dag_action = args.action;
      nextArgs.action = 'dag';
    } else if (!nextArgs.action) {
      nextArgs.action = mapped.action;
    }
  } else if (toolName === 'aza_auto_loop' && !nextArgs.action) {
    nextArgs.action = 'step';
  }

  return { tool: mapped.tool, args: nextArgs };
}

/** Tools that mutate the workspace (write-guard). */
export const UNIFIED_WRITE_TOOLS = new Set<string>([
  'aza_spec',
  'aza_prd',
  'aza_finish',
  'aza_memory',
]);
