/**
 * Stage-tool guard — converged 8-tool matrix.
 * Unified tools are allowed by stage; action-level policy is enforced in handlers.
 */

import type { Stage } from './state-machine';

const ALWAYS = ['aza_session', 'aza_loop', 'aza_memory', 'aza_meta', 'aza_quality', 'aza_auto'] as const;

const STAGE_TOOL_MATRIX: Record<Stage, string[]> = {
  open: [...ALWAYS, 'aza_prd', 'aza_spec', 'aza_finish'],
  design: [...ALWAYS, 'aza_spec', 'aza_prd'],
  build: [...ALWAYS, 'aza_spec'],
  verify: [...ALWAYS, 'aza_spec', 'aza_finish'],
  archive: [...ALWAYS, 'aza_finish', 'aza_spec'],
};

export const WRITE_TOOLS = new Set<string>([
  'aza_spec',
  'aza_prd',
  'aza_finish',
  'aza_memory',
]);

export interface StageToolGuardResult {
  allowed: boolean;
  reason?: string;
  redirectTool?: string;
  redFlag?: { id: string; remediation: string };
}

function matchesPattern(tool: string, pattern: string): boolean {
  if (pattern.endsWith('*')) {
    return tool.startsWith(pattern.slice(0, -1));
  }
  return tool === pattern;
}

export function checkStageTool(
  toolName: string,
  stage: Stage,
  _callHistory: string[] = [],
): StageToolGuardResult {
  const patterns = STAGE_TOOL_MATRIX[stage] ?? [];
  const allowed = patterns.some((p) => matchesPattern(toolName, p));

  if (!allowed) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is not allowed in stage "${stage}". Allowed: ${patterns.join(', ')}`,
      redirectTool: 'aza_loop',
    };
  }

  return { allowed: true };
}

export function getStageToolMatrix(): Record<Stage, string[]> {
  return { ...STAGE_TOOL_MATRIX };
}

/** Return stages where a tool is allowed (used by state-machine hints). */
export function findStageForTool(toolName: string): Stage[] {
  const stages: Stage[] = [];
  for (const [stage, tools] of Object.entries(STAGE_TOOL_MATRIX) as [Stage, string[]][]) {
    if (tools.some((p) => matchesPattern(toolName, p))) {
      stages.push(stage);
    }
  }
  return stages;
}
