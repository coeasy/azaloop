import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoopController } from '@azaloop/core';

// Valid MCP tool names as defined by getToolDefinitions() in
// packages/mcp-server/src/index.ts
const VALID_MCP_TOOL_NAMES: Set<string> = new Set([
  'aza_prd_generate',
  'aza_prd_validate',
  'aza_prd_review',
  'aza_prd_approve',
  'aza_prd_modify',
  'aza_prd_cancel',
  'aza_loop_next',
  'aza_loop_status',
  'aza_loop_complete',
  'aza_loop_stop',
  'aza_loop_set_condition',
  'aza_loop_reset_conditions',
  'aza_loop_stage_iterations',
  'aza_task_design',
  'aza_task_implement',
  'aza_task_verify',
  'aza_quality_check',
  'aza_memory_query',
  'aza_memory_record',
  'aza_context_calibrate',
  'aza_context_status',
  'aza_continue',
  'aza_health',
  'aza_doc_generate',
  'aza_skill_search',
  'aza_skill_list',
  'aza_security_scan',
  'aza_style_check',
  'aza_style_learn',
  'aza_audit',
  'aza_compliance',
  'aza_dag',
  'aza_loop_circuit_breaker',
  'aza_loop_completion_gate',
  'aza_loop_audit',
]);

describe('LoopController tool name validation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azaloop-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('V11 path: stage-by-stage tool names', () => {
    it('should return valid tool names for each stage progression', async () => {
      const lc = new LoopController({
        maxIterations: 50,
        enableV12: false,
      });

      const collectedTools: string[] = [];

      // Stage: open -> set condition, advance to design
      lc.setCondition('prd_valid', true);
      let result = await lc.next();
      collectedTools.push(result.next_action!.tool);
      expect(result.next_action!.tool).toBe('aza_task_design');

      // Stage: design -> set condition, advance to build
      lc.setCondition('stories_designed', true);
      result = await lc.next();
      collectedTools.push(result.next_action!.tool);
      expect(result.next_action!.tool).toBe('aza_task_implement');

      // Stage: build -> set condition, advance to verify
      lc.setCondition('build_tested', true);
      result = await lc.next();
      collectedTools.push(result.next_action!.tool);
      expect(result.next_action!.tool).toBe('aza_quality_check');

      // Stage: verify -> set condition, advance to archive
      lc.setCondition('quality_passed', true);
      result = await lc.next();
      collectedTools.push(result.next_action!.tool);
      expect(result.next_action!.tool).toBe('aza_doc_generate');

      // Stage: archive -> set condition, completes
      lc.setCondition('archive_ready', true);
      result = await lc.next();
      collectedTools.push(result.next_action!.tool);
      expect(result.next_action!.tool).toBe('aza_loop_next');
      expect(result.next_action!.action).toBe('done');

      // Assert every collected tool is a valid MCP tool name
      for (const tool of collectedTools) {
        expect(VALID_MCP_TOOL_NAMES.has(tool)).toBe(true);
      }
    });
  });

  describe('V12 path: default handler progression', () => {
    it('should return valid tool name when all stages complete', async () => {
      const lc = new LoopController({
        maxIterations: 50,
        enableV12: true,
      });

      const result = await lc.next();

      expect(result.next_action).toBeDefined();
      expect(VALID_MCP_TOOL_NAMES.has(result.next_action!.tool)).toBe(true);
    });
  });

  describe('Hard stop path', () => {
    it('should return valid tool name when hard stop is active (V11)', async () => {
      const lc = new LoopController({
        maxIterations: 50,
        enableV12: false,
      });

      lc.stop('max_iterations_exceeded', 'Test hard stop');

      const result = await lc.next();

      expect(result.success).toBe(false);
      expect(result.next_action).toBeDefined();
      expect(VALID_MCP_TOOL_NAMES.has(result.next_action!.tool)).toBe(true);
      expect(result.next_action!.tool).toBe('aza_loop_next');
      expect(result.next_action!.action).toBe('report');
    });

    it('should return valid tool name when hard stop is active (V12)', async () => {
      const lc = new LoopController({
        maxIterations: 50,
        enableV12: true,
      });

      lc.stop('user_requested', 'User requested stop');

      const result = await lc.next();

      expect(result.success).toBe(false);
      expect(result.next_action).toBeDefined();
      expect(VALID_MCP_TOOL_NAMES.has(result.next_action!.tool)).toBe(true);
      expect(result.next_action!.tool).toBe('aza_loop_next');
    });
  });

  describe('Circuit breaker path', () => {
    it('should return valid tool name when circuit breaker trips (V12)', async () => {
      const lc = new LoopController({
        maxIterations: 50,
        enableV12: true,
      });

      // Trip the circuit breaker by exceeding iteration limit
      // maxIterations in CircuitBreaker config = options.maxIterations
      const breaker = lc.circuitBreaker;
      // Record enough successes to trip the iteration_count dimension
      for (let i = 0; i < 50; i++) {
        breaker.recordSuccess('phase', 0);
      }

      const result = await lc.next();

      expect(result.next_action).toBeDefined();
      expect(VALID_MCP_TOOL_NAMES.has(result.next_action!.tool)).toBe(true);
      expect(result.next_action!.tool).toBe('aza_loop_next');
      expect(result.next_action!.action).toBe('escalate');
    });

    it('should return valid tool name when circuit breaker trips via no-progress (V12)', async () => {
      const lc = new LoopController({
        maxIterations: 50,
        enableV12: true,
      });

      // Trip via no_progress dimension: 5 consecutive failures
      const breaker = lc.circuitBreaker;
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure('phase', `Failure ${i}`);
      }

      const result = await lc.next();

      expect(result.next_action).toBeDefined();
      expect(VALID_MCP_TOOL_NAMES.has(result.next_action!.tool)).toBe(true);
      expect(result.next_action!.tool).toBe('aza_loop_next');
      expect(result.next_action!.action).toBe('escalate');
    });
  });

  describe('Max iterations exceeded path', () => {
    it('should return valid tool name when max iterations exceeded (V11)', async () => {
      const lc = new LoopController({
        maxIterations: 1,
        enableV12: false,
      });

      // Advance the state machine iteration to exceed max
      lc.stateMachine.setStageStatus('open', 'completed');
      lc.stateMachine.advance();
      // Now iteration is 1, which equals maxIterations (1)

      const result = await lc.next();

      expect(result.success).toBe(false);
      expect(result.next_action).toBeDefined();
      expect(VALID_MCP_TOOL_NAMES.has(result.next_action!.tool)).toBe(true);
      expect(result.next_action!.tool).toBe('aza_loop_next');
      expect(result.next_action!.action).toBe('stop');
    });
  });
});
