import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  LoopController,
  PRDReviewGate,
  StateManager,
  ResumeGenerator,
  EventBus,
  MCPEventSimulator,
  MCPEventBridge,
  StrikeSystem,
  registerAllHookHandlers,
} from '@azaloop/core';

/**
 * Valid MCP tool names as defined by getToolDefinitions() in
 * packages/mcp-server/src/index.ts — used to verify that every
 * next_action.tool returned by the loop is a real, callable tool.
 */
const VALID_MCP_TOOL_NAMES: Set<string> = new Set([
  // Unified 8-tool surface (0.2.x)
  'aza_session',
  'aza_prd',
  'aza_loop',
  'aza_spec',
  'aza_quality',
  'aza_finish',
  'aza_memory',
  'aza_meta',
  // Legacy aliases still emitted by core in some paths (MCP remaps)
  'aza_prd_generate',
  'aza_prd_validate',
  'aza_prd_review',
  'aza_prd_approve',
  'aza_loop_next',
  'aza_task_design',
  'aza_task_implement',
  'aza_task_verify',
  'aza_quality_check',
  'aza_doc_generate',
  'aza_context_calibrate',
]);

/**
 * E2E integration tests for the complete AzaLoop V12.2 auto-loop flow.
 *
 * These tests exercise the full pipeline end-to-end:
 *   PRD 先行 (review → approve/modify/timeout) → 三级循环推进 (LoopController) →
 *   MCPEventBridge 集成 → next_action 链式验证 → 跨会话恢复
 *
 * They use real file-system-backed StateManager / ResumeGenerator instances
 * operating in a fresh temp directory per test, so that cross-session
 * persistence is verified against actual STATE.yaml / RESUME.md files.
 */
describe('AzaLoop V12.2 Auto-Loop E2E', () => {
  let tmpDir: string;
  let stateManager: StateManager;
  let resumeGenerator: ResumeGenerator;
  let eventBus: EventBus;
  let strikeSystem: StrikeSystem;
  let simulator: MCPEventSimulator;
  let bridge: MCPEventBridge;
  let gate: PRDReviewGate;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azaloop-e2e-'));
    stateManager = new StateManager(tmpDir);
    await stateManager.load();
    resumeGenerator = new ResumeGenerator(tmpDir);
    eventBus = new EventBus();
    strikeSystem = new StrikeSystem();
    simulator = new MCPEventSimulator(
      eventBus,
      stateManager,
      resumeGenerator,
      strikeSystem,
    );
    bridge = new MCPEventBridge(simulator);
    // Register the full Hook handler set so pre-tool / post-tool / on-error /
    // on-stop events are wired up just like a real MCP server bootstrap.
    registerAllHookHandlers(eventBus, stateManager, resumeGenerator);
    gate = new PRDReviewGate({
      stateManager,
      resumeGenerator,
      timeoutMs: 60000,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Scenario 1: PRD 先行流程 ──────────────────────────────────────

  it('1. PRD 先行流程: review() 生成待审批 PRD 摘要', async () => {
    const projectTitle = 'AzaLoop E2E 任务管理应用';
    const result = await gate.review({
      title: projectTitle,
      description: '构建一个支持任务 CRUD、标签分类和到期提醒的待办事项应用',
    });

    // 需要用户审批
    expect(result.needs_user_approval).toBe(true);

    // 超时时间 60s
    expect(result.timeout_ms).toBe(60000);

    // 摘要包含项目标题
    expect(result.summary).toContain(projectTitle);

    // 至少一条关键决策
    expect(Array.isArray(result.key_decisions)).toBe(true);
    expect(result.key_decisions.length).toBeGreaterThanOrEqual(1);
  });

  // ── Scenario 2: 用户确认 PRD ──────────────────────────────────────

  it('2. 用户确认 PRD: approve() 返回 aza_loop(full) 入口', async () => {
    await gate.review({
      title: '用户确认 PRD 测试项目',
      description: '一个用于验证 approve 流程的测试项目',
    });

    const result = await gate.approve();

    expect(result.approved).toBe(true);
    expect(result.next_action.tool).toBe('aza_loop');
    expect(result.next_action.action).toBe('full');
  });

  // ── Scenario 3: 三级循环推进 ──────────────────────────────────────

  it('3. 三级循环推进: 每个阶段 next() 返回有效 next_action.tool', async () => {
    const lc = new LoopController({ enableV12: true, maxIterations: 50 });

    const stages = ['open', 'design', 'build', 'verify', 'archive'] as const;
    const collectedTools: string[] = [];

    for (const stage of stages) {
      const result = await lc.next(stage);
      expect(result.next_action).toBeDefined();
      expect(typeof result.next_action!.tool).toBe('string');
      expect(VALID_MCP_TOOL_NAMES.has(result.next_action!.tool)).toBe(true);
      collectedTools.push(result.next_action!.tool);
    }

    // 至少收集到 5 个工具
    expect(collectedTools).toHaveLength(5);
  });

  // ── Scenario 4: MCPEventBridge 集成 ───────────────────────────────

  it('4. MCPEventBridge 集成: wrapTool 追加 next_action 且保留工具自带 next_action', async () => {
    const toolNextAction = {
      tool: 'aza_task_verify',
      action: 'verify',
      reason: '工具自身返回的 next_action',
    };

    const executor = async (args: Record<string, unknown>) => {
      return {
        output: `已为 ${args.task_id} 完成实现`,
        next_action: toolNextAction,
      };
    };

    const wrapped = bridge.wrapTool('aza_task_implement', executor);
    const result = await wrapped({ task_id: 'TASK-001' });

    // next_action 已追加到结果中
    expect(result.next_action).toBeDefined();

    // 工具自带的 next_action 被保留（未被模拟器覆盖）
    expect(result.next_action).toEqual(toolNextAction);
    expect(result.next_action.tool).toBe('aza_task_verify');
    expect(result.next_action.action).toBe('verify');

    // 原始返回字段仍然存在
    expect(result.output).toContain('TASK-001');
  });

  // ── Scenario 5: next_action 链式验证 ──────────────────────────────

  it('5. next_action 链式验证: 多次 next() 的 tool 均为有效工具名', async () => {
    const lc = new LoopController({ enableV12: true, maxIterations: 50 });

    for (let i = 0; i < 5; i++) {
      const result = await lc.next();
      expect(result.next_action).toBeDefined();
      expect(VALID_MCP_TOOL_NAMES.has(result.next_action!.tool)).toBe(true);
    }
  });

  // ── Scenario 6: 跨会话恢复 ────────────────────────────────────────

  it('6. 跨会话恢复: 新 StateManager 从同一目录恢复状态', async () => {
    // 第一会话: 写入状态
    await stateManager.update({
      pipeline: {
        current_stage: 'build',
        stages: {
          open: { status: 'completed' },
          design: { status: 'completed' },
          build: { status: 'in_progress' },
          verify: { status: 'pending' },
          archive: { status: 'pending' },
        },
      },
      loop: {
        iteration: 7,
        progress: '40%',
        current_story: 'STORY-E2E-001',
        client: 'trae',
        model: 'gpt-4o',
        max_iterations: 50,
      },
    });

    // 预写 RESUME
    await resumeGenerator.generate(stateManager, {
      last_milestone: 'E2E: build 阶段进行中',
    });

    // 模拟会话重启: 用同一目录创建全新 StateManager
    const restoredStateManager = new StateManager(tmpDir);
    const restoredState = await restoredStateManager.load();

    // 状态已从 STATE.yaml 恢复
    expect(restoredState.pipeline.current_stage).toBe('build');
    expect(restoredState.loop.iteration).toBe(7);
    expect(restoredState.loop.progress).toBe('40%');
    expect(restoredState.loop.current_story).toBe('STORY-E2E-001');
    expect(restoredState.pipeline.stages.open.status).toBe('completed');
    expect(restoredState.pipeline.stages.build.status).toBe('in_progress');

    // RESUME.md 同样可恢复
    const restoredResume = await resumeGenerator.read();
    expect(restoredResume).not.toBeNull();
    expect(restoredResume!.current_stage).toBe('build');
    expect(restoredResume!.current_story).toBe('STORY-E2E-001');
  });

  // ── Scenario 7: PRD 超时确认 ─────────────────────────────────────

  it('7. PRD 超时确认: autoApproveOnTimeout() 自动审批', async () => {
    await gate.review({
      title: '超时自动确认测试项目',
      description: '一个用于验证 60s 超时自动审批的测试项目',
    });

    const result = await gate.autoApproveOnTimeout();

    expect(result.approved).toBe(true);
  });

  // ── Scenario 8: PRD 修改流程 ─────────────────────────────────────

  it('8. PRD 修改流程: modify() 根据反馈重新生成待审批 PRD', async () => {
    const original = await gate.review({
      title: '原始需求项目',
      description: '构建一个简单的博客发布平台',
    });

    // PRD ID 基于 Date.now()（毫秒精度），等待一小段时间确保重新生成的 ID 不同
    await new Promise((resolve) => setTimeout(resolve, 5));

    const modified = await gate.modify('增加用户认证模块');

    // 返回新的 PRDReviewResult
    expect(modified).toBeDefined();
    expect(modified.needs_user_approval).toBe(true);
    expect(modified.prd_id).toMatch(/^PRD-/);

    // 重新生成 => 新的 PRD ID
    expect(modified.prd_id).not.toBe(original.prd_id);

    // 仍处于待审批状态
    expect(gate.getPendingReview()).not.toBeNull();
    expect(gate.getPendingReview()!.prd_id).toBe(modified.prd_id);
  });
});
