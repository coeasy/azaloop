import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PRDReviewGate,
  StateManager,
  ResumeGenerator,
} from '@azaloop/core';

describe('PRDReviewGate', () => {
  let tmpDir: string;
  let stateManager: StateManager;
  let resumeGenerator: ResumeGenerator;
  let gate: PRDReviewGate;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azaloop-test-'));
    stateManager = new StateManager(tmpDir);
    await stateManager.load();
    resumeGenerator = new ResumeGenerator(tmpDir);
    gate = new PRDReviewGate({ stateManager, resumeGenerator, timeoutMs: 60000 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('review()', () => {
    it('should generate a PRD summary with needs_user_approval=true', async () => {
      const result = await gate.review({
        title: 'Todo App',
        description: 'Build a todo application with CRUD operations for tasks',
      });

      expect(result).toBeDefined();
      expect(result.needs_user_approval).toBe(true);
      expect(result.title).toBe('Todo App');
      expect(result.prd_id).toMatch(/^PRD-/);
      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.mermaid_diagram).toBeDefined();
      expect(result.timeout_ms).toBe(60000);
      expect(result.instruction).toBeDefined();
      expect(result.complexity).toMatch(/^L[1-4]$/);
      expect(typeof result.quality_score).toBe('number');
      expect(Array.isArray(result.key_decisions)).toBe(true);
      expect(Array.isArray(result.open_questions)).toBe(true);
    });

    it('should set pending review after review() call', async () => {
      await gate.review({
        title: 'Test Project',
        description: 'A simple test project for verification',
      });

      const pending = gate.getPendingReview();
      expect(pending).not.toBeNull();
      expect(pending!.title).toBe('Test Project');
      expect(pending!.needs_user_approval).toBe(true);
    });
  });

  describe('approve()', () => {
    it('should return next_action.tool=aza_loop', async () => {
      await gate.review({
        title: 'Todo App',
        description: 'Build a todo application with CRUD operations',
      });

      const result = await gate.approve();

      expect(result.approved).toBe(true);
      expect(result.stage).toBe('open');
      expect(result.next_action.tool).toBe('aza_loop');
      expect(result.next_action.action).toBe('full');
      expect(result.next_action.reason).toMatch(/PRD approved|full auto/i);
    });

    it('should clear pending review after approve', async () => {
      await gate.review({
        title: 'Test',
        description: 'A test project',
      });

      expect(gate.getPendingReview()).not.toBeNull();
      await gate.approve();
      expect(gate.getPendingReview()).toBeNull();
    });

    it('should return not-approved when no pending review', async () => {
      const result = await gate.approve();

      expect(result.approved).toBe(false);
      expect(result.message).toContain('No pending');
    });
  });

  describe('modify()', () => {
    it('should regenerate PRD with feedback', async () => {
      const original = await gate.review({
        title: 'Original Project',
        description: 'Build a simple web application',
      });

      // Wait 10ms to ensure Date.now() generates a different PRD ID
      await new Promise(resolve => setTimeout(resolve, 10));

      const modified = await gate.modify('Add user authentication and dark mode support');

      expect(modified).toBeDefined();
      expect(modified.needs_user_approval).toBe(true);
      expect(modified.prd_id).toMatch(/^PRD-/);
      // The modified PRD should have a different ID (regenerated)
      expect(modified.prd_id).not.toBe(original.prd_id);
      expect(gate.getPendingReview()).not.toBeNull();
      expect(gate.getPendingReview()!.prd_id).toBe(modified.prd_id);
    });

    it('should use original title when modifying', async () => {
      await gate.review({
        title: 'My App',
        description: 'A description',
      });

      const modified = await gate.modify('Add more features');
      expect(modified.title).toBe('My App');
    });
  });

  describe('cancel()', () => {
    it('should return action=done', async () => {
      await gate.review({
        title: 'Test',
        description: 'A test project',
      });

      const result = await gate.cancel();

      expect(result.cancelled).toBe(true);
      expect(result.next_action.action).toBe('done');
      expect(result.next_action.tool).toBe('aza_loop');
      expect(result.next_action.reason).toContain('cancelled');
    });

    it('should clear pending review after cancel', async () => {
      await gate.review({
        title: 'Test',
        description: 'A test project',
      });

      expect(gate.getPendingReview()).not.toBeNull();
      await gate.cancel();
      expect(gate.getPendingReview()).toBeNull();
    });
  });

  describe('autoApproveOnTimeout()', () => {
    it('should auto-approve when called', async () => {
      await gate.review({
        title: 'Auto Approve Test',
        description: 'A project that will be auto-approved on timeout',
      });

      const result = await gate.autoApproveOnTimeout();

      expect(result.approved).toBe(true);
      expect(result.next_action.tool).toBe('aza_loop');
      expect(result.next_action.action).toBe('full');
    });

    it('should clear pending review after auto-approve', async () => {
      await gate.review({
        title: 'Test',
        description: 'A test project',
      });

      expect(gate.getPendingReview()).not.toBeNull();
      await gate.autoApproveOnTimeout();
      expect(gate.getPendingReview()).toBeNull();
    });
  });
});
