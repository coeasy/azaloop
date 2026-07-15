/**
 * red-flags.ts
 *
 * Independent Red Flags table for the AzaLoop pipeline. A Red Flag is raised
 * when an agent tries to invoke a "gate" tool out of order (e.g. calling
 * aza_task_implement before aza_prd_approve). Mirrors the comet 9-blocking-
 * decision-points pattern and the inline DECISION_POINT_PREREQUISITES table
 * in stage-tool-guard.ts.
 *
 * StageToolGuard consumes this table via `checkRedFlags(toolName, callHistory)`.
 * For backward compatibility the inline `DECISION_POINT_PREREQUISITES` object
 * in stage-tool-guard.ts is now a thin alias of `RED_FLAGS_BY_TOOL` and is
 * marked deprecated — new code should import from this module.
 *
 * Reference: https://github.com/rpamis/comet (Red Flags pattern)
 */

export interface RedFlag {
  /** Stable identifier (RF-1, RF-2, …). */
  id: string;
  /** The MCP tool that triggers the Red Flag when called out of order. */
  tool: string;
  /** Tools that must have appeared in `callHistory` before this tool. */
  requiresPriorCall: string[];
  /** Severity: block = hard rejection, warn = soft hint. */
  severity: 'block' | 'warn';
  /**
   * V20 Task 7: How this rule behaves under AZA_AUTO_APPROVE_PRD=true.
   * - 'block' (default): still hard-blocks the tool call in auto mode.
   * - 'log': only console.warn the violation, does not block (used for
   *   soft form-check / warn-severity rules so the auto loop can advance).
   */
  autoMode?: 'block' | 'log';
  /** Human-readable remediation hint returned to the agent. */
  remediation: string;
}

/**
 * Master Red Flags table. The IDs deliberately match the inline table in
 * stage-tool-guard.ts so existing call sites continue to work. New flags
 * can be appended without touching the consumer code.
 */
export const RED_FLAGS: RedFlag[] = [
  {
    id: 'RF-1',
    tool: 'aza_task_implement',
    requiresPriorCall: ['aza_prd_approve'],
    severity: 'block',
    autoMode: 'block',
    remediation: 'Cannot implement before PRD is approved. Call aza_prd_review → aza_prd_approve first.',
  },
  {
    id: 'RF-1',
    tool: 'aza_task_design',
    requiresPriorCall: ['aza_prd_approve'],
    severity: 'block',
    autoMode: 'block',
    remediation: 'Cannot design tasks before PRD is approved. Call aza_prd_review → aza_prd_approve first.',
  },
  {
    id: 'RF-2',
    tool: 'aza_loop_complete',
    requiresPriorCall: ['aza_quality_check'],
    severity: 'block',
    autoMode: 'block',
    remediation: 'Cannot complete a stage before quality check passes. Call aza_quality_check first.',
  },
  {
    id: 'RF-2',
    tool: 'aza_doc_generate',
    requiresPriorCall: ['aza_quality_check'],
    severity: 'block',
    autoMode: 'block',
    remediation: 'Cannot generate final docs before quality check passes. Call aza_quality_check first.',
  },
  // ── RF-3: skipping exploration before design ──
  {
    id: 'RF-3',
    tool: 'aza_dag',
    requiresPriorCall: ['aza_explore', 'aza_prd_approve'],
    severity: 'warn',
    autoMode: 'log',
    remediation: 'Consider running aza_explore before aza_dag to surface hidden constraints.',
  },
  // ── RF-4: code change without security scan in build ──
  {
    id: 'RF-4',
    tool: 'aza_task_implement',
    requiresPriorCall: ['aza_security_scan'],
    severity: 'warn',
    autoMode: 'log',
    remediation: 'Build usually requires aza_security_scan before commit. Skipping it is allowed but flagged.',
  },
  // ── RF-5: archive without audit ──
  {
    id: 'RF-5',
    tool: 'aza_doc_generate',
    requiresPriorCall: ['aza_audit'],
    severity: 'warn',
    autoMode: 'log',
    remediation: 'Run aza_audit before aza_doc_generate to record loop-audit signals in RESUME.',
  },
  // ── RF-6: recursion into the same tool (Trellis pattern, sibling of Recursion Guard) ──
  {
    id: 'RF-6',
    tool: 'aza_task_implement',
    requiresPriorCall: ['NOT_RECURSION'],
    severity: 'block',
    autoMode: 'block',
    remediation: 'Recursion Guard: aza_task_implement cannot dispatch itself. Stop re-dispatching.',
  },
  // ── RF-7: contract drift before implementation ──
  {
    id: 'RF-7',
    tool: 'aza_task_implement',
    requiresPriorCall: ['aza_contract_ack'],
    severity: 'warn',
    autoMode: 'log',
    remediation: 'Acknowledge the execution contract (.aza/contract.md) before implementing.',
  },
  // ── RF-8: stage advance without gate check ──
  {
    id: 'RF-8',
    tool: 'aza_loop',
    requiresPriorCall: ['aza_quality_check'],
    severity: 'block',
    autoMode: 'block',
    remediation: 'Cannot advance past verify/archive without aza_quality_check passing.',
  },
  // ── RF-9: cross-stage tool call (caught by StageToolGuard, surfaced here for unified reporting) ──
  {
    id: 'RF-9',
    tool: '*',
    requiresPriorCall: [],
    severity: 'block',
    autoMode: 'block',
    remediation: 'Stage mismatch: the requested tool does not belong to the current pipeline stage.',
  },
];

/** Reverse lookup: tool → matching Red Flags (may be more than one). */
export const RED_FLAGS_BY_TOOL: Record<string, RedFlag[]> = RED_FLAGS.reduce((acc, rf) => {
  const list = acc[rf.tool] ?? [];
  list.push(rf);
  acc[rf.tool] = list;
  return acc;
}, {} as Record<string, RedFlag[]>);

/**
 * Sentinel for RF-6: a tool that the Recursion Guard checks for. It can never
 * actually appear in callHistory, so the only way to satisfy the prerequisite
 * is to not be on the call stack.
 */
export const NOT_RECURSION = 'NOT_RECURSION';

function isPrereqSatisfied(prereq: string, callHistory: readonly string[]): boolean {
  if (prereq === NOT_RECURSION) {
    // Aza_task_implement must not be on the stack more than once.
    return callHistory.filter(t => t === 'aza_task_implement').length < 2;
  }
  return callHistory.includes(prereq);
}

/**
 * Check whether the given tool call would raise a Red Flag, given the
 * session's call history. Returns the first matching flag (or null).
 *
 * V20 Task 7: When AZA_AUTO_APPROVE_PRD=true, rules with `autoMode: 'log'`
 * (warn-severity form-check rules) only emit console.warn and do NOT block,
 * so the auto loop can advance. Rules with `autoMode: 'block'` (default)
 * still hard-block regardless of mode.
 */
export function checkRedFlags(toolName: string, callHistory: readonly string[]): RedFlag | null {
  const autoMode = process.env.AZA_AUTO_APPROVE_PRD === 'true';
  const flags = RED_FLAGS_BY_TOOL[toolName] ?? [];
  for (const flag of flags) {
    if (flag.requiresPriorCall.length === 0) continue; // pure-marker flags
    const allSatisfied = flag.requiresPriorCall.every(p => isPrereqSatisfied(p, callHistory));
    if (!allSatisfied) {
      if (autoMode && flag.autoMode === 'log') {
        // eslint-disable-next-line no-console
        console.warn(`[red-flags:auto-log] ${flag.id}: ${flag.remediation}`);
        continue;
      }
      return flag;
    }
  }
  return null;
}
