/**
 * T25 — PRDReviewGate HARD-GATE + 12 Red Flags tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PRDReviewGate,
  StateManager,
  ResumeGenerator,
  BRAINSTORMING_RED_FLAGS,
  topBrainstormingRedFlags,
  getBrainstormingRedFlagByThought,
  type SkillMeta,
} from '@azaloop/core';

const PR_SKILL_META: SkillMeta = {
  name: 'prd',
  version: '1.1.0',
  type: 'document',
  description: 'Use when the user wants to turn an idea into a structured PRD',
  tags: ['prd'],
  when_to_use: 'turning an idea into a structured PRD',
  red_flags: [],
  rationalizations: [],
  quick_reference: [],
  related_skills: [],
  evals: [],
  requires_approval: true,
  body_sections: [],
  namespaces: ['aza-prd'],
  reserved_namespaces: ['pattern', 'claude-memories', 'default'],
  smoke_test: { command: 'echo test', expected: 'test' },
  gate_criteria: [],
  isolation: 'none',
  boundaries_never_touch: [],
  completion_sentinel: '<promise>TASK_COMPLETE</promise>',
  task_sources: ['md', 'aza-prd'],
  language: 'both',
  author: 'azaloop-core',
  registered_at: new Date().toISOString(),
};

const NON_HARDGATE_SKILL: SkillMeta = {
  ...PR_SKILL_META,
  name: 'arch',
  requires_approval: false,
};

const minimalInput = (extra: Record<string, unknown> = {}) => ({
  title: 'Test PRD',
  product_dimension: 'software' as const,
  product_dimension_other: '',
  product_type: 'new' as const,
  product_category: 'api' as const,
  commercialization: 'internal' as const,
  target_users: 'developers',
  core_features: ['feature 1', 'feature 2'],
  problem_statement: 'Need to test the gate',
  ...extra,
});

describe('Brainstorming Red Flags table (T25)', () => {
  it('contains 12 red flags (superpowers standard)', () => {
    expect(BRAINSTORMING_RED_FLAGS).toHaveLength(12);
  });

  it('topBrainstormingRedFlags(3) returns exactly 3', () => {
    const top = topBrainstormingRedFlags(3);
    expect(top).toHaveLength(3);
    expect(top[0]).toHaveProperty('thought');
    expect(top[0]).toHaveProperty('reality');
  });

  it('getBrainstormingRedFlagByThought does case-insensitive substring lookup', () => {
    // Use the exported function (which normalizes case) rather than raw .find
    // so the test exercises the case-insensitive contract the function documents.
    const flag = getBrainstormingRedFlagByThought('skip the test');
    expect(flag).toBeDefined();
    expect(flag!.thought.toLowerCase()).toContain('skip the test');
  });
});

describe('PRDReviewGate HARD-GATE (T25)', () => {
  let tmpDir: string;
  let stateManager: StateManager;
  let resumeGenerator: ResumeGenerator;
  let gate: PRDReviewGate;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azaloop-hardgate-'));
    stateManager = new StateManager(tmpDir);
    await stateManager.load();
    resumeGenerator = new ResumeGenerator(tmpDir);
    gate = new PRDReviewGate({ stateManager, resumeGenerator, timeoutMs: 60000 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('review() — HARD-GATE detection', () => {
    it('enters HARD-GATE when skillMeta.requires_approval=true', async () => {
      const result = await gate.review(minimalInput({ skillMeta: PR_SKILL_META }));
      expect(result.hard_gate).toBe(true);
      expect(result.red_flags).toBeDefined();
      expect(result.red_flags).toHaveLength(3);
      expect(result.instruction).toContain('HARD-GATE');
      expect(result.source).toBe('aza-prd');
    });

    it('does NOT enter HARD-GATE when requires_approval=false', async () => {
      const result = await gate.review(minimalInput({ skillMeta: NON_HARDGATE_SKILL }));
      expect(result.hard_gate).toBeUndefined();
      expect(result.red_flags).toBeUndefined();
      expect(result.instruction).not.toContain('HARD-GATE');
    });

    it('defaults to source="aza-prd" when not specified', async () => {
      const result = await gate.review(minimalInput({ skillMeta: NON_HARDGATE_SKILL }));
      expect(result.source).toBe('aza-prd');
    });

    it('honors source="openspec" when caller opts in', async () => {
      const result = await gate.review(minimalInput({ source: 'openspec' }));
      expect(result.source).toBe('openspec');
    });
  });

  describe('approve() — HARD-GATE answers', () => {
    it('rejects approve() with no answers when HARD-GATE is active', async () => {
      await gate.review(minimalInput({ skillMeta: PR_SKILL_META }));
      const result = await gate.approve();
      expect(result.approved).toBe(false);
      expect(result.message).toMatch(/HARD-GATE/);
      expect(result.message).toContain('missing answers');
    });

    it('rejects approve() with partial answers', async () => {
      await gate.review(minimalInput({ skillMeta: PR_SKILL_META }));
      const flags = topBrainstormingRedFlags(3);
      // Only answer the first flag
      const partial = { [flags[0]!.thought]: 'yes, I have considered this' };
      const result = await gate.approve(partial);
      expect(result.approved).toBe(false);
      expect(result.message).toMatch(/unanswered/);
    });

    it('rejects approve() with empty / vacuous answers', async () => {
      await gate.review(minimalInput({ skillMeta: PR_SKILL_META }));
      const flags = topBrainstormingRedFlags(3);
      const vacuous: Record<string, string> = {};
      for (const f of flags) vacuous[f.thought] = ''; // empty
      const result = await gate.approve(vacuous);
      expect(result.approved).toBe(false);
    });

    it('approves when all 3 red flags are answered with substantive text', async () => {
      await gate.review(minimalInput({ skillMeta: PR_SKILL_META }));
      const flags = topBrainstormingRedFlags(3);
      const answers: Record<string, string> = {};
      for (const f of flags) {
        answers[f.thought] = `Acknowledged: ${f.reality.slice(0, 30)}`;
      }
      const result = await gate.approve(answers);
      expect(result.approved).toBe(true);
      // answers file should be on disk
      const answersPath = path.join(tmpDir, 'red_flag_answers.json');
      expect(fs.existsSync(answersPath)).toBe(true);
      const stored = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
      expect(stored.prd_id).toBeDefined();
      expect(Object.keys(stored.answers)).toHaveLength(3);
    });

    it('approves non-HARD-GATE reviews without answers', async () => {
      await gate.review(minimalInput({ skillMeta: NON_HARDGATE_SKILL }));
      const result = await gate.approve();
      expect(result.approved).toBe(true);
    });
  });
});
