import { describe, it, expect } from 'vitest';
import {
  checkPreSkill,
  PreSkillInvocationGuard,
  tokenizeWhenToUse,
  tokenizeContext,
  DEFAULT_MIN_MATCH_SCORE,
} from '../../packages/core/src/hook/pre-skill-invocation';
import type { SkillMeta } from '../../packages/core/src/L5_skill/registry';

function makeSkill(overrides: Partial<SkillMeta> = {}): SkillMeta {
  return {
    name: 'test-skill',
    version: '1.0.0',
    type: 'document',
    description: 'test',
    tags: [],
    when_to_use: 'write unit tests for the calculator',
    red_flags: [],
    rationalizations: [],
    quick_reference: [],
    related_skills: [],
    evals: [],
    requires_approval: false,
    body_sections: [],
    namespaces: [],
    reserved_namespaces: [],
    smoke_test: { command: '', expected: '' },
    gate_criteria: [],
    isolation: 'none',
    boundaries_never_touch: [],
    completion_sentinel: '<promise>TASK_COMPLETE</promise>',
    task_sources: ['md'],
    language: 'en',
    author: 'test',
    registered_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('PreSkillInvocationGuard (v14-P7.1)', () => {
  it('1) tokens include content words and skip stop-words', () => {
    const tokens = tokenizeWhenToUse('Use when the user is writing unit tests for the API');
    expect(tokens).toContain('unit');
    expect(tokens).toContain('tests');
    expect(tokens).toContain('writing');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('when');
    expect(tokens).not.toContain('use');
  });

  it('2) matching context yields allowed=true with positive score', () => {
    const skill = makeSkill({ when_to_use: 'run unit tests for the API module' });
    const result = checkPreSkill(skill, {
      stage: 'verify',
      tags: ['tests', 'api', 'unit'],
      intent: 'running unit tests for the module',
    });
    expect(result.allowed).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.matched).toContain('unit');
    expect(result.matched).toContain('tests');
  });

  it('3) non-matching context yields allowed=false with strike=true', () => {
    const skill = makeSkill({ when_to_use: 'optimize database query performance' });
    const result = checkPreSkill(skill, {
      stage: 'design',
      tags: ['docs', 'readme'],
      intent: 'write the changelog',
    });
    expect(result.allowed).toBe(false);
    expect(result.strike).toBe(true);
    expect(result.reason).toMatch(/does not match/);
  });

  it('4) explicit invocation bypasses the guard (escape hatch)', () => {
    const skill = makeSkill({ when_to_use: 'optimize database query performance' });
    const result = checkPreSkill(
      skill,
      { stage: 'design', tags: ['docs'], intent: 'write the changelog', explicit: true },
    );
    expect(result.allowed).toBe(true);
    expect(result.strike).toBe(false);
    expect(result.matched).toContain('<explicit>');
  });

  it('5) empty when_to_use always allows', () => {
    const skill = makeSkill({ when_to_use: '' });
    const result = checkPreSkill(skill, { stage: 'open' });
    expect(result.allowed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('6) tokenizeContext pulls tokens from every context field', () => {
    const tokens = tokenizeContext({
      storyId: 'STORY-123',
      stage: 'verify',
      tags: ['tag-one', 'tag-two'],
      filePath: 'src/calculator.ts',
      intent: 'writing unit tests for the API module',
    });
    expect(tokens.has('story')).toBe(true);
    expect(tokens.has('verify')).toBe(true);
    expect(tokens.has('tag')).toBe(true);
    expect(tokens.has('calculator')).toBe(true);
    expect(tokens.has('unit')).toBe(true);
  });

  it('7) PreSkillInvocationGuard class uses injected minScore', () => {
    const guard = new PreSkillInvocationGuard(0.9);
    const skill = makeSkill({ when_to_use: 'optimize database query performance' });
    const result = guard.check(skill, {
      stage: 'design',
      intent: 'optimize the user table query',
    });
    // Even with one keyword match, score is below the high threshold.
    expect(result.allowed).toBe(false);
    expect(result.strike).toBe(true);
  });

  it('8) DEFAULT_MIN_MATCH_SCORE is 0.2', () => {
    expect(DEFAULT_MIN_MATCH_SCORE).toBe(0.2);
  });

  it('9) strike=false when allowed=true', () => {
    const skill = makeSkill({ when_to_use: 'run unit tests' });
    const result = checkPreSkill(skill, { tags: ['tests', 'unit'] });
    expect(result.allowed).toBe(true);
    expect(result.strike).toBe(false);
  });
});
