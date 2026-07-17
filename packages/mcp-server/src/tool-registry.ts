/**
 * Converged MCP tool registry — 8 tools only (legacy names via resolveToolCall).
 */

import type { ToolHandler } from './index';

export interface ToolDefinition {
  name: string;
  whenToUse: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

const actionProp = {
  type: 'string',
  description: 'Sub-command for this tool',
};

export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    name: 'aza_session',
    whenToUse: 'starting, calibrating, continuing, or health-checking an AzaLoop session',
    description:
      'Session lifecycle: init | start | calibrate | status | continue | health. Prefer calibrate at session start, continue after stop.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { ...actionProp, enum: ['init', 'start', 'calibrate', 'status', 'continue', 'health'] },
        workspace_path: { type: 'string' },
        client: { type: 'string' },
        model: { type: 'string', description: 'Optional model id for RESUME/STATE persistence' },
        base_dir: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'aza_prd',
    whenToUse: 'creating or approving a PRD before any coding (always first for new work)',
    description:
      'PRD gate: review | approve | modify | cancel | generate | validate | draft | multi_review | refine. review defaults to OpenSpec scaffold on approve. draft/multi_review/refine enable LLM multi-step interaction (V20). Set auto_approve=true or AZA_AUTO_APPROVE_PRD for unattended Cursor runs.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { ...actionProp, enum: ['review', 'approve', 'modify', 'cancel', 'generate', 'validate', 'draft', 'multi_review', 'refine', 'explore'] },
        title: { type: 'string' },
        description: { type: 'string' },
        feedback: { type: 'string' },
        answers: { type: 'object' },
        prd: { type: 'object' },
        prd_draft: { type: 'string', description: 'V20: LLM-generated PRD draft JSON string (for action=draft)' },
        review_responses: { type: 'array', items: { type: 'object' }, description: 'V20: Array of {role, response} for action=multi_review' },
        refined_prd: { type: 'string', description: 'V20: LLM-refined PRD JSON string (for action=refine)' },
        auto_approve: { type: 'boolean' },
        openspec: { type: 'boolean' },
        source: { type: 'string', enum: ['openspec', 'aza-prd'] },
        workspace_path: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'aza_loop',
    whenToUse: 'driving the development loop (full/step/auto) or reporting tool completion after awaitingAction',
    description:
      'Loop driver: next | status | complete | stop | step | full | auto | pause | resume | report_tool | circuit | gate | audit | … After approve, call action=full. When awaitingAction, execute the host tool then report_tool.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        current_stage: { type: 'string' },
        stage: { type: 'string' },
        workspace_path: { type: 'string' },
        tool_name: { type: 'string' },
        reason: { type: 'string' },
        key: { type: 'string' },
        passed: { type: 'boolean' },
      },
      required: ['action'],
    },
  },
  {
    name: 'aza_spec',
    whenToUse: 'designing, implementing, exploring, or managing OpenSpec/DAG artifacts for the current story',
    description:
      'Spec/build: design | implement | verify | explore | propose | apply | archive | dag. Host coding tools fulfill awaitingAction for design/implement.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['design', 'implement', 'verify', 'explore', 'propose', 'apply', 'archive', 'dag'],
        },
        story_id: { type: 'string' },
        task_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        workspace_path: { type: 'string' },
        focus: { type: 'string' },
        tasks: { type: 'array' },
        dag: { type: 'object' },
        dag_action: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'aza_quality',
    whenToUse: 'running quality, security, compliance, eval, or style gates during verify',
    description: 'Quality: check | security | compliance | eval | eval_summary | style | style_learn | ui_qa.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check', 'security', 'compliance', 'eval', 'eval_summary', 'style', 'style_learn', 'ui_qa'],
        },
        project_root: { type: 'string' },
        workspace_path: { type: 'string' },
        check_type: { type: 'string' },
        test_output: { type: 'string' },
        expected_behavior: { type: 'string' },
        code: { type: 'string' },
        file_path: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'aza_finish',
    whenToUse: 'archiving work, shipping after gates pass, or extracting conventions',
    description:
      'Delivery: work | archive | ship | conventions_*. Prefer ship after quality check passes to close the loop.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['work', 'archive', 'ship', 'conventions', 'conventions_list', 'conventions_write', 'conventions_extract'],
        },
        task_id: { type: 'string' },
        work_summary: { type: 'string' },
        decisions: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } },
        next_steps: { type: 'array', items: { type: 'string' } },
        iteration: { type: 'number' },
        stop_loop: { type: 'boolean' },
        workspace_path: { type: 'string' },
        type: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        tag: { type: 'string' },
        description: { type: 'string' },
        source: { type: 'string' },
        stage: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'aza_memory',
    whenToUse: 'querying or recording project memory across sessions',
    description: 'Memory: query | record.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['query', 'record'] },
        query: { type: 'string' },
        type: { type: 'string' },
        summary: { type: 'string' },
        details: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        workspace_path: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'aza_meta',
    whenToUse: 'inspecting skills, run-state, audit logs, budget, or plugins',
    description:
      'Meta/diagnostics: skills_* | runstate_* | audit_log_* | budget | cost | audit | plugin | worktree | swarm | stores | dlp_scan | presets | test_loop | constitution | federation.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        query: { type: 'string' },
        type: { type: 'string' },
        source: { type: 'string' },
        limit: { type: 'number' },
        workspace_path: { type: 'string' },
        sub_action: { type: 'string' },
        name: { type: 'string' },
        task_id: { type: 'string' },
        agent: { type: 'string' },
        id: { type: 'string' },
        body: { type: 'string' },
        kind: { type: 'string' },
        content: { type: 'string' },
        preset_id: { type: 'string' },
        peer_id: { type: 'string' },
        peer_label: { type: 'string' },
        shared_aza: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'aza_auto',
    whenToUse: 'ONE-CLICK entry point when the user wants the entire development workflow (PRD → design → build → verify → archive) completed without further user input; the host coding assistant must execute returned implementation actions automatically',
    description:
      '【一键全自动入口】调用后自动完成会话初始化、方案选择、PRD 生成与审批，并驱动 open→design→build→verify→archive。MCP 内联 design/quality/ship；宿主 AI 必须自动执行返回的 implement next_action 并立即 report_tool，全程不要再次询问用户。这是推荐入口。',
    inputSchema: {
      type: 'object',
      properties: {
        user_input: { type: 'string', description: 'User requirement description - what needs to be built' },
        max_iterations: { type: 'number', description: 'Max loop iterations (default: 50)', default: 50 },
        workspace_path: { type: 'string', description: 'Project workspace root path' },
      },
      required: ['user_input'],
    },
  },
];

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

export function getToolNames(): string[] {
  return TOOL_REGISTRY.map((t) => t.name);
}

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

export function getFormattedToolDefinitions(): Array<{
  name: string;
  description: string;
  inputSchema: ToolDefinition['inputSchema'];
}> {
  return TOOL_REGISTRY.map(formatToolDefinition);
}

/**
 * Stage-scoped tool groups — MUST stay aligned with L7 stage-tool-guard ALWAYS list.
 *
 * BUG (2026-07-16): open previously listed only session/prd/meta. Hosts that filter
 * tools/list by stage then could not call aza_loop / aza_auto after PRD approve,
 * so the full-auto spine never advanced past open.
 *
 * Spine tools (ALWAYS): session, loop, memory, meta, quality, auto — every stage.
 * Stage extras: prd @ open/design; spec @ design/build/verify; finish @ verify/archive.
 */
const SPINE_TOOLS = [
  'aza_session',
  'aza_loop',
  'aza_memory',
  'aza_meta',
  'aza_quality',
  'aza_auto',
] as const;

export const STAGE_TOOL_GROUPS: Record<string, string[]> = {
  open: [...SPINE_TOOLS, 'aza_prd', 'aza_spec', 'aza_finish'],
  design: [...SPINE_TOOLS, 'aza_prd', 'aza_spec'],
  build: [...SPINE_TOOLS, 'aza_spec'],
  verify: [...SPINE_TOOLS, 'aza_spec', 'aza_finish'],
  archive: [...SPINE_TOOLS, 'aza_finish', 'aza_spec'],
  all: TOOL_REGISTRY.map((t) => t.name),
};

export function getFormattedToolDefinitionsForStage(stage?: string): Array<{
  name: string;
  description: string;
  inputSchema: ToolDefinition['inputSchema'];
}> {
  const key = (stage || process.env.AZA_STAGE || 'all').toLowerCase();
  const names = new Set(STAGE_TOOL_GROUPS[key] || STAGE_TOOL_GROUPS.all);
  return TOOL_REGISTRY.filter((t) => names.has(t.name)).map(formatToolDefinition);
}

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
    if (!tool.whenToUse?.trim()) errors.push(`Tool "${tool.name}" has empty whenToUse`);
    if (!tool.description?.trim()) errors.push(`Tool "${tool.name}" has empty description`);
  }
  return errors;
}

/**
 * R6: 跨客户端一致性 — 输出工具面快照（JSON 字符串）
 * 客户端启动时可拉取此快照并校验本地工具面是否与之一致。
 * 若漂移则说明客户端规则文件过期，需要重新同步。
 */
export function getToolSurfaceSnapshot(): {
  version: string;
  generated_at: string;
  tool_count: number;
  tools: Array<{ name: string; whenToUse: string; description: string; actions: string[] }>;
} {
  return {
    version: '8.0',
    generated_at: new Date().toISOString(),
    tool_count: TOOL_REGISTRY.length,
    tools: TOOL_REGISTRY.map((t) => ({
      name: t.name,
      whenToUse: t.whenToUse,
      description: t.description,
      actions: Array.isArray((t.inputSchema.properties as any)?.action?.enum) ?? false
        ? ((t.inputSchema.properties as any).action.enum as string[])
        : [],
    })),
  };
}

/**
 * R6: 验证客户端规则文件包含所有 8 个工具名。
 * 用于在 azaloop install / 升级时自动检查。
 */
export function validateClientTemplate(template: string, expectedTools: string[] = TOOL_REGISTRY.map((t) => t.name)): string[] {
  const errors: string[] = [];
  for (const tool of expectedTools) {
    if (!template.includes(tool)) {
      errors.push(`Client template missing reference to tool "${tool}"`);
    }
  }
  return errors;
}
