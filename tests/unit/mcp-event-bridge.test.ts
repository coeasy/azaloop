import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MCPEventBridge,
  MCPEventSimulator,
  EventBus,
  StateManager,
  ResumeGenerator,
  StrikeSystem,
} from '@azaloop/core';

describe('MCPEventBridge wrapping', () => {
  let tmpDir: string;
  let eventBus: EventBus;
  let stateManager: StateManager;
  let resumeGenerator: ResumeGenerator;
  let strikeSystem: StrikeSystem;
  let simulator: MCPEventSimulator;
  let bridge: MCPEventBridge;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azaloop-test-'));
    eventBus = new EventBus();
    stateManager = new StateManager(tmpDir);
    await stateManager.load();
    resumeGenerator = new ResumeGenerator(tmpDir);
    strikeSystem = new StrikeSystem();
    simulator = new MCPEventSimulator(eventBus, stateManager, resumeGenerator, strikeSystem);
    bridge = new MCPEventBridge(simulator);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Full bridge flow: pre-tool -> execute -> post-tool -> next_action', () => {
    it('should append next_action to the tool result', async () => {
      let executorCalled = false;

      const executor = async (args: Record<string, unknown>) => {
        executorCalled = true;
        return { output: 'PRD generated successfully', prd_id: 'PRD-001' };
      };

      const wrapped = bridge.wrapTool('aza_prd_generate', executor);
      const result = await wrapped({ title: 'Test', description: 'A test project' });

      // Executor was called
      expect(executorCalled).toBe(true);

      // Original result data is preserved
      expect(result.output).toBe('PRD generated successfully');
      expect(result.prd_id).toBe('PRD-001');

      // next_action is appended
      expect(result.next_action).toBeDefined();
      expect(result.next_action.tool).toBeDefined();
      expect(result.next_action.action).toBeDefined();
      expect(result.next_action.reason).toBeDefined();
    });

    it('should emit pre-tool and post-tool events in order', async () => {
      const events: string[] = [];

      eventBus.on('pre-tool', () => { events.push('pre-tool'); });
      eventBus.on('post-tool', () => { events.push('post-tool'); });

      const executor = async () => {
        events.push('execute');
        return { data: 'result' };
      };

      const wrapped = bridge.wrapTool('aza_prd_generate', executor);
      await wrapped({ title: 'Test', description: 'desc' });

      // Verify the order: pre-tool -> execute -> post-tool
      expect(events).toEqual(['pre-tool', 'execute', 'post-tool']);
    });

    it('should update STATE and write RESUME during post-tool', async () => {
      const executor = async () => {
        return { data: 'work done' };
      };

      const wrapped = bridge.wrapTool('aza_task_implement', executor);
      const iterBefore = stateManager.getIteration();
      await wrapped({ task_id: 'TASK-001' });

      // STATE should have been updated (iteration incremented by 1)
      const iterAfter = stateManager.getIteration();
      expect(iterAfter).toBe(iterBefore + 1);

      // RESUME should have been written
      const resume = await resumeGenerator.read();
      expect(resume).not.toBeNull();
      expect(resume!.current_stage).toBeDefined();
    });
  });

  describe('Tool next_action preservation', () => {
    it('should preserve tool\'s own next_action (not overwritten by simulation)', async () => {
      const customNextAction = {
        tool: 'aza_task_verify',
        action: 'verify',
        reason: 'Custom next action from the tool itself',
      };

      const executor = async () => {
        return {
          output: 'Implementation complete',
          next_action: customNextAction,
        };
      };

      const wrapped = bridge.wrapTool('aza_task_implement', executor);
      const result = await wrapped({ task_id: 'TASK-001' });

      // The tool's own next_action should be preserved
      expect(result.next_action).toEqual(customNextAction);
      expect(result.next_action.tool).toBe('aza_task_verify');
      expect(result.next_action.action).toBe('verify');
      expect(result.next_action.reason).toBe('Custom next action from the tool itself');
    });

    it('should use simulation next_action when tool does not provide one', async () => {
      const executor = async () => {
        return { output: 'No next_action in this result' };
      };

      const wrapped = bridge.wrapTool('aza_prd_generate', executor);
      const result = await wrapped({ title: 'Test', description: 'desc' });

      // Simulation provides the next_action based on current stage
      expect(result.next_action).toBeDefined();
      expect(result.next_action.tool).toBe('aza_prd_generate'); // stage is 'open'
      expect(result.next_action.action).toBe('continue_open');
    });
  });

  describe('On-error event emission', () => {
    it('should emit on-error event when executor throws', async () => {
      let onErrorEmitted = false;

      eventBus.on('on-error', (payload) => {
        onErrorEmitted = true;
        expect(payload.data?.tool).toBe('aza_task_implement');
        expect(payload.data?.error).toBe('Build failed');
      });

      const executor = async () => {
        throw new Error('Build failed');
      };

      const wrapped = bridge.wrapTool('aza_task_implement', executor);

      await expect(wrapped({ task_id: 'TASK-001' })).rejects.toThrow('Build failed');
      expect(onErrorEmitted).toBe(true);
    });

    it('should re-throw the original error after emitting on-error', async () => {
      const originalError = new Error('Custom executor error');

      const executor = async () => {
        throw originalError;
      };

      const wrapped = bridge.wrapTool('aza_quality_check', executor);

      await expect(wrapped({ project_root: '/tmp' })).rejects.toThrow('Custom executor error');
    });

    it('should not update STATE or write RESUME when executor throws', async () => {
      const executor = async () => {
        throw new Error('Executor failure');
      };

      const wrapped = bridge.wrapTool('aza_prd_generate', executor);

      const stateBefore = stateManager.getState();
      await expect(wrapped({ title: 'Test', description: 'desc' })).rejects.toThrow();
      const stateAfter = stateManager.getState();

      // Iteration should not have changed
      expect(stateAfter.loop.iteration).toBe(stateBefore.loop.iteration);
    });
  });

  describe('Hard stop blocking', () => {
    it('should throw when hard stop is active (pre-tool blocks execution)', async () => {
      // Activate hard stop by recording 3 strikes
      strikeSystem.record('skipped_tests', 'No tests', 1);
      strikeSystem.record('skipped_tests', 'No tests', 2);
      strikeSystem.record('skipped_tests', 'No tests', 3);

      let executorCalled = false;
      const executor = async () => {
        executorCalled = true;
        return { data: 'should not reach' };
      };

      const wrapped = bridge.wrapTool('aza_prd_generate', executor);

      await expect(wrapped({ title: 'Test', description: 'desc' })).rejects.toThrow('Hard stop');
      expect(executorCalled).toBe(false);
    });
  });
});
