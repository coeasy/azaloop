import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StateMachine, StateManager } from '@azaloop/core';
import type { Stage } from '@azaloop/core';

describe('StateMachine <-> StateManager synchronization', () => {
  let tmpDir: string;
  let stateManager: StateManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azaloop-test-'));
    stateManager = new StateManager(tmpDir);
    await stateManager.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Initial state synchronization', () => {
    it('should start with matching default state', () => {
      const sm = new StateMachine();
      const fileState = stateManager.getState();

      expect(sm.getCurrentStage()).toBe(fileState.pipeline.current_stage);
      expect(sm.getCurrentStage()).toBe('open');
      expect(sm.getState().iteration).toBe(fileState.loop.iteration);
    });

    it('should create StateMachine from StateManager state (syncStateFromFile pattern)', async () => {
      // Update StateManager with a custom stage
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
          iteration: 3,
          progress: '40%',
          current_story: 'STORY-001',
          client: 'cursor',
          model: 'sonnet-4',
          max_iterations: 50,
        },
      });

      // Reload from file
      const fileState = await stateManager.load();

      // Create StateMachine from file state (mirrors LoopController.syncStateFromFile)
      const sm = new StateMachine({
        current_stage: fileState.pipeline.current_stage as Stage,
        stages: fileState.pipeline.stages as Record<Stage, any>,
        iteration: fileState.loop.iteration,
        progress: fileState.loop.progress,
        loops: fileState.loops as any,
        attestation: fileState.attestation || { verified: true },
      });

      expect(sm.getCurrentStage()).toBe('build');
      expect(sm.getState().iteration).toBe(3);
      expect(sm.getStageInfo('open').status).toBe('completed');
      expect(sm.getStageInfo('build').status).toBe('in_progress');
    });
  });

  describe('Iteration increment synchronization', () => {
    it('should reflect iteration increment from StateManager in StateMachine', async () => {
      const sm = new StateMachine();
      const iterBefore = stateManager.getIteration();
      expect(sm.getState().iteration).toBe(iterBefore);

      // Increment iteration in StateManager
      await stateManager.incrementIteration();
      expect(stateManager.getIteration()).toBe(iterBefore + 1);

      // Reload and sync to StateMachine
      const fileState = await stateManager.load();
      const syncedSm = new StateMachine({
        current_stage: fileState.pipeline.current_stage as Stage,
        stages: fileState.pipeline.stages as Record<Stage, any>,
        iteration: fileState.loop.iteration,
        progress: fileState.loop.progress,
        loops: fileState.loops as any,
        attestation: fileState.attestation || { verified: true },
      });

      expect(syncedSm.getState().iteration).toBe(iterBefore + 1);
    });

    it('should sync multiple iteration increments', async () => {
      const iterBefore = stateManager.getIteration();
      await stateManager.incrementIteration();
      await stateManager.incrementIteration();
      await stateManager.incrementIteration();

      expect(stateManager.getIteration()).toBe(iterBefore + 3);

      const fileState = await stateManager.load();
      const sm = new StateMachine({
        current_stage: fileState.pipeline.current_stage as Stage,
        stages: fileState.pipeline.stages as Record<Stage, any>,
        iteration: fileState.loop.iteration,
        progress: fileState.loop.progress,
        loops: fileState.loops as any,
        attestation: fileState.attestation || { verified: true },
      });

      expect(sm.getState().iteration).toBe(iterBefore + 3);
    });
  });

  describe('Stage transition synchronization', () => {
    it('should reflect stage advance from StateManager in StateMachine', async () => {
      // Advance stage in StateManager: open -> design
      await stateManager.setStage('open', 'completed');
      const nextStage = await stateManager.advanceStage();

      expect(nextStage).toBe('design');
      expect(stateManager.getStage()).toBe('design');

      // Sync to StateMachine
      const fileState = await stateManager.load();
      const sm = new StateMachine({
        current_stage: fileState.pipeline.current_stage as Stage,
        stages: fileState.pipeline.stages as Record<Stage, any>,
        iteration: fileState.loop.iteration,
        progress: fileState.loop.progress,
        loops: fileState.loops as any,
        attestation: fileState.attestation || { verified: true },
      });

      expect(sm.getCurrentStage()).toBe('design');
      expect(sm.getStageInfo('open').status).toBe('completed');
    });

    it('should sync StateMachine stage transitions back to StateManager', async () => {
      const sm = new StateMachine();

      // Transition in StateMachine: open -> design
      sm.setStageStatus('open', 'completed');
      sm.advance();

      expect(sm.getCurrentStage()).toBe('design');

      // Persist to StateManager (mirrors LoopController.syncStateToFile)
      const memState = sm.getState();
      const currentState = stateManager.getState();
      await stateManager.update({
        pipeline: {
          current_stage: memState.current_stage,
          stages: memState.stages as any,
        },
        loops: memState.loops as any,
        loop: {
          iteration: memState.iteration,
          progress: memState.progress,
          current_story: memState.loops.inner.current_story,
          client: currentState.loop.client,
          model: currentState.loop.model,
          max_iterations: currentState.loop.max_iterations,
        },
        attestation: memState.attestation,
        strikes: currentState.strikes,
      });

      // Reload and verify persistence
      const reloaded = await stateManager.load();
      expect(reloaded.pipeline.current_stage).toBe('design');
      expect(reloaded.pipeline.stages.open.status).toBe('completed');
      expect(reloaded.loop.iteration).toBe(1);
    });

    it('should sync full 5-stage progression', async () => {
      const sm = new StateMachine();

      // Progress through all stages in StateMachine
      const stages: Stage[] = ['open', 'design', 'build', 'verify'];
      for (const stage of stages) {
        sm.setStageStatus(stage, 'completed');
        sm.advance();
      }
      sm.setStageStatus('archive', 'completed');

      expect(sm.isCompleted()).toBe(true);

      // Persist to StateManager
      const memState = sm.getState();
      await stateManager.update({
        pipeline: {
          current_stage: memState.current_stage,
          stages: memState.stages as any,
        },
        loops: memState.loops as any,
        loop: {
          iteration: memState.iteration,
          progress: memState.progress,
          current_story: memState.loops.inner.current_story,
          client: 'test',
          model: 'test',
          max_iterations: 50,
        },
        attestation: memState.attestation,
        strikes: 0,
      });

      // Reload and verify all stages are completed
      const reloaded = await stateManager.load();
      expect(reloaded.pipeline.stages.open.status).toBe('completed');
      expect(reloaded.pipeline.stages.design.status).toBe('completed');
      expect(reloaded.pipeline.stages.build.status).toBe('completed');
      expect(reloaded.pipeline.stages.verify.status).toBe('completed');
      expect(reloaded.pipeline.stages.archive.status).toBe('completed');
    });
  });

  describe('Round-trip synchronization', () => {
    it('should preserve state through multiple save/load cycles', async () => {
      // 1. Update StateManager
      await stateManager.update({
        pipeline: {
          current_stage: 'verify',
          stages: {
            open: { status: 'completed' },
            design: { status: 'completed' },
            build: { status: 'completed' },
            verify: { status: 'in_progress' },
            archive: { status: 'pending' },
          },
        },
        loop: {
          iteration: 5,
          progress: '60%',
          current_story: 'STORY-003',
          client: 'cursor',
          model: 'sonnet-4',
          max_iterations: 50,
        },
      });

      // 2. Load into StateMachine
      const fileState1 = await stateManager.load();
      const sm = new StateMachine({
        current_stage: fileState1.pipeline.current_stage as Stage,
        stages: fileState1.pipeline.stages as Record<Stage, any>,
        iteration: fileState1.loop.iteration,
        progress: fileState1.loop.progress,
        loops: fileState1.loops as any,
        attestation: fileState1.attestation || { verified: true },
      });

      expect(sm.getCurrentStage()).toBe('verify');
      expect(sm.getState().iteration).toBe(5);

      // 3. Modify StateMachine and save back
      sm.setStageStatus('verify', 'completed');
      sm.advance();
      sm.setStageStatus('archive', 'completed');

      const memState = sm.getState();
      await stateManager.update({
        pipeline: {
          current_stage: memState.current_stage,
          stages: memState.stages as any,
        },
        loop: {
          iteration: memState.iteration,
          progress: memState.progress,
          current_story: memState.loops.inner.current_story,
          client: 'cursor',
          model: 'sonnet-4',
          max_iterations: 50,
        },
      });

      // 4. Reload and verify
      const fileState2 = await stateManager.load();
      expect(fileState2.pipeline.current_stage).toBe('archive');
      expect(fileState2.pipeline.stages.verify.status).toBe('completed');
      expect(fileState2.pipeline.stages.archive.status).toBe('completed');
      expect(fileState2.loop.iteration).toBe(6); // advance() increments iteration
    });
  });
});
