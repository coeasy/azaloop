/**
 * v13 — P5.1: YAML orchestrator with SPARC integration tests
 *
 * Covers:
 *   1) Backward-compat: load(steps) + getExecutionOrder still works
 *   2) parseSimpleYaml parses flat key-value pairs
 *   3) parseSimpleYaml parses nested mappings
 *   4) parseSimpleYaml parses lists
 *   5) validatePipelineSchema accepts a valid pipeline
 *   6) validatePipelineSchema rejects invalid pipelines
 *   7) loadPipeline + getPipeline roundtrip
 *   8) runPipeline advances when SPARC gates pass
 *   9) runPipeline halts on first failing SPARC gate
 *  10) loadPipelineFromFile reads from disk
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  YAMLOrchestrator,
  parseSimpleYaml,
  validatePipelineSchema,
  evidenceFromMap,
} from '@azaloop/core';
import type { PipelineDefinition } from '@azaloop/core';

describe('v13 P5.1 — parseSimpleYaml', () => {
  it('1) parses flat key-value pairs', () => {
    const obj = parseSimpleYaml('name: test\nversion: 1.0');
    expect(obj.name).toBe('test');
    expect(obj.version).toBe(1.0);
  });

  it('2) parses quoted strings', () => {
    const obj = parseSimpleYaml('title: "Hello World"');
    expect(obj.title).toBe('Hello World');
  });

  it('3) parses nested mappings', () => {
    const obj = parseSimpleYaml('outer:\n  inner: value\n  other: 42');
    expect(obj.outer.inner).toBe('value');
    expect(obj.outer.other).toBe(42);
  });

  it('4) parses inline lists', () => {
    const obj = parseSimpleYaml('tags: [a, b, c]');
    expect(obj.tags).toEqual(['a', 'b', 'c']);
  });

  it('5) parses list items under a key', () => {
    const obj = parseSimpleYaml('items:\n  - alpha\n  - beta\n  - gamma');
    expect(obj.items).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('6) skips comments and blank lines', () => {
    const obj = parseSimpleYaml('# comment\n\nname: test\n# another\nversion: 2.0');
    expect(obj.name).toBe('test');
    expect(obj.version).toBe(2.0);
  });

  it('7) handles booleans and nulls', () => {
    const obj = parseSimpleYaml('enabled: true\ndisabled: false\nempty: null');
    expect(obj.enabled).toBe(true);
    expect(obj.disabled).toBe(false);
    expect(obj.empty).toBeNull();
  });
});

describe('v13 P5.1 — validatePipelineSchema', () => {
  it('1) accepts a valid pipeline', () => {
    const def: PipelineDefinition = {
      name: 'test',
      stages: [
        {
          id: 'spec',
          name: 'Specification',
          sparcPhase: 'specification',
          steps: [{ id: '1.1', tool: 'aza_prd_review', action: 'review', args: {}, depends_on: [] }],
        },
      ],
    };
    const v = validatePipelineSchema(def);
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('2) rejects pipeline without name', () => {
    const v = validatePipelineSchema({ stages: [] });
    expect(v.valid).toBe(false);
  });

  it('3) rejects pipeline with empty stages', () => {
    const v = validatePipelineSchema({ name: 'test', stages: [] });
    expect(v.valid).toBe(false);
  });

  it('4) rejects duplicate stage ids', () => {
    const def = {
      name: 'test',
      stages: [
        { id: 'a', name: 'A', sparcPhase: 'specification', steps: [] },
        { id: 'a', name: 'B', sparcPhase: 'pseudocode', steps: [] },
      ],
    };
    const v = validatePipelineSchema(def);
    expect(v.valid).toBe(false);
  });

  it('5) rejects stage without sparcPhase', () => {
    const def = {
      name: 'test',
      stages: [{ id: 'a', name: 'A', steps: [] }],
    };
    const v = validatePipelineSchema(def);
    expect(v.valid).toBe(false);
  });
});

describe('v13 P5.1 — YAMLOrchestrator (backward compat)', () => {
  it('1) load(steps) + getExecutionOrder returns topological levels', () => {
    const o = new YAMLOrchestrator();
    o.load([
      { id: 'a', tool: 't', action: 'a', args: {}, depends_on: [] },
      { id: 'b', tool: 't', action: 'b', args: {}, depends_on: ['a'] },
      { id: 'c', tool: 't', action: 'c', args: {}, depends_on: ['a'] },
      { id: 'd', tool: 't', action: 'd', args: {}, depends_on: ['b', 'c'] },
    ]);
    const levels = o.getExecutionOrder();
    expect(levels).toHaveLength(3);
    expect(levels[0]!.map((s) => s.id)).toEqual(['a']);
    expect(levels[1]!.map((s) => s.id).sort()).toEqual(['b', 'c']);
    expect(levels[2]!.map((s) => s.id)).toEqual(['d']);
  });
});

describe('v13 P5.1 — YAMLOrchestrator (pipeline)', () => {
  let azaDir: string;

  beforeEach(() => {
    azaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-yaml-'));
  });

  afterEach(() => {
    fs.rmSync(azaDir, { recursive: true, force: true });
  });

  it('1) loadPipeline + getPipeline roundtrips', () => {
    const o = new YAMLOrchestrator();
    const def: PipelineDefinition = {
      name: 'p1',
      stages: [
        { id: 's1', name: 'S1', sparcPhase: 'specification', steps: [] },
      ],
    };
    o.loadPipeline(def);
    expect(o.getPipeline()?.name).toBe('p1');
  });

  it('2) loadPipeline throws on invalid schema', () => {
    const o = new YAMLOrchestrator();
    expect(() => o.loadPipeline({ stages: [] } as any)).toThrow();
  });

  it('3) runPipeline advances when SPARC gates pass', async () => {
    const o = new YAMLOrchestrator();
    o.loadPipeline({
      name: 'all-pass',
      stages: [
        {
          id: 's1',
          name: 'S1',
          sparcPhase: 'specification',
          steps: [{ id: '1.1', tool: 't', action: 'a', args: {}, depends_on: [] }],
          minScore: 0.5,
        },
      ],
    });
    const report = await o.runPipeline(azaDir, async () => [
      { name: 'Acceptance criteria', passed: true, weight: 1 },
      { name: 'Constraints', passed: true, weight: 1 },
      { name: 'Edge cases', passed: true, weight: 1 },
      { name: 'Out-of-scope', passed: true, weight: 1 },
    ]);
    expect(report.success).toBe(true);
    expect(report.stageReports).toHaveLength(1);
    expect(report.stageReports[0]!.gatePassed).toBe(true);
  });

  it('4) runPipeline halts on first failing SPARC gate', async () => {
    const o = new YAMLOrchestrator();
    o.loadPipeline({
      name: 'fail-mid',
      stages: [
        {
          id: 's1',
          name: 'S1',
          sparcPhase: 'specification',
          steps: [],
          minScore: 0.5,
        },
        {
          id: 's2',
          name: 'S2',
          sparcPhase: 'refinement',
          steps: [],
          minScore: 0.5,
        },
      ],
    });
    const report = await o.runPipeline(azaDir, async () => [
      // S1 passes
      { name: 'Acceptance criteria', passed: true, weight: 1 },
      { name: 'Constraints', passed: true, weight: 1 },
      { name: 'Edge cases', passed: true, weight: 1 },
      { name: 'Out-of-scope', passed: true, weight: 1 },
      // S2 fails (no evidence)
    ]);
    expect(report.success).toBe(false);
    expect(report.stageReports).toHaveLength(2);
    expect(report.stageReports[0]!.gatePassed).toBe(true);
    expect(report.stageReports[1]!.gatePassed).toBe(false);
  });

  it('5) runPipeline throws when no pipeline loaded', async () => {
    const o = new YAMLOrchestrator();
    await expect(o.runPipeline(azaDir)).rejects.toThrow();
  });

  it('6) loadPipelineFromFile reads from disk', async () => {
    const yamlPath = path.join(azaDir, 'orch.yaml');
    fs.writeFileSync(
      yamlPath,
      [
        'name: file-pipeline',
        'stages:',
        '  - id: s1',
        '    name: S1',
        '    sparcPhase: specification',
        '    steps: []',
      ].join('\n'),
      'utf8',
    );
    const o = new YAMLOrchestrator();
    const def = o.loadPipelineFromFile(yamlPath);
    expect(def.name).toBe('file-pipeline');
    expect(o.getPipeline()?.name).toBe('file-pipeline');
  });
});
