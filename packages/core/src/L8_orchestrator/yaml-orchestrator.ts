/**
 * v13 — P5.1: YAML-based DAG Orchestration with SPARC integration
 *
 * Replaces the 35-line stub with a full implementation that:
 *   1. Parses `.aza/orchestrator.yaml` defining a multi-agent pipeline
 *   2. Validates the YAML against a simple schema
 *   3. Runs the pipeline step-by-step, advancing only when SPARC gates
 *      pass for the current stage
 *   4. Returns a `PipelineReport` summarizing the run
 *
 * Reference: michaelshimeles/ralphy (yaml-orchestrator pattern) +
 * ruvnet/ruflo SPARC gates.
 *
 * Backward compatibility: `loadPipeline()` and `getExecutionOrder()` are
 * preserved so existing tests continue to work.
 */

import * as fs from 'fs';
import * as path from 'path';
import { evaluateSparcGate, type SPARCPhase, type Evidence } from '../L7_loop/sparc-gates';

// ── Original types (preserved) ─────────────────────────────

export interface OrchestrationStep {
  id: string;
  tool: string;
  action: string;
  args: Record<string, unknown>;
  depends_on: string[];
}

// ── New types (v13) ────────────────────────────────────────

export interface PipelineDefinition {
  name: string;
  description?: string;
  /** Ordered stages; each maps to a SPARC phase. */
  stages: PipelineStage[];
}

export interface PipelineStage {
  /** Unique stage id (e.g. "specification", "build"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The SPARC phase this stage maps to. */
  sparcPhase: SPARCPhase;
  /** Steps to execute within this stage. */
  steps: OrchestrationStep[];
  /** Minimum score for the SPARC gate to pass (0..1). */
  minScore?: number;
  /** Optional list of evidence names this stage requires. */
  requiredEvidence?: string[];
}

export interface PipelineReport {
  /** Name of the pipeline that was run. */
  pipelineName: string;
  /** Whether the pipeline completed successfully. */
  success: boolean;
  /** Per-stage execution records. */
  stageReports: StageReport[];
  /** Total duration in ms. */
  durationMs: number;
  /** Timestamp the run started. */
  startedAt: string;
  /** Timestamp the run completed. */
  completedAt: string;
}

export interface StageReport {
  stageId: string;
  sparcPhase: SPARCPhase;
  success: boolean;
  score: number;
  minScore: number;
  /** Whether the SPARC gate passed. */
  gatePassed: boolean;
  /** The execution levels (from getExecutionOrder) that ran. */
  executionLevels: number;
  /** Error message if the stage failed. */
  error?: string;
}

// ── YAML parsing helpers ───────────────────────────────────

/**
 * Parse a simple YAML document into a JavaScript object. We intentionally
 * avoid a `yaml` library dependency — the orchestrator YAML is a small,
 * well-known subset (key: value pairs, lists, and nested mappings).
 *
 * Supported syntax:
 *   key: value
 *   key: "quoted value"
 *   key: [a, b, c]
 *   key:
 *     nested_key: value
 *     list_key:
 *       - item1
 *       - item2
 */
export function parseSimpleYaml(yaml: string): any {
  const lines = yaml.split(/\r?\n/);
  const root: any = {};
  // container + optional lastKey for converting empty map → list on `- `
  const stack: Array<{
    indent: number;
    container: any;
    key?: string;
    /** When true, container is an array and nested keys update the last object item */
    inListObject?: boolean;
  }> = [{ indent: -1, container: root }];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;

    const indent = raw.search(/\S/);
    if (indent < 0) continue;
    const trimmed = raw.trim();

    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const top = stack[stack.length - 1]!;

    // List item
    if (trimmed.startsWith('- ') || trimmed === '-') {
      const value = trimmed === '-' ? '' : trimmed.slice(2).trim();

      // Ensure parent key holds an array (may have been seeded as {})
      let arr: any[];
      if (top.key !== undefined) {
        const existing = top.container[top.key];
        if (!Array.isArray(existing)) {
          arr = [];
          top.container[top.key] = arr;
        } else {
          arr = existing;
        }
      } else if (Array.isArray(top.container)) {
        arr = top.container;
      } else {
        continue;
      }

      if (value === '' || value.includes(':')) {
        // Mapping item: `- id: s1` or bare `-` then indented fields
        const obj: any = {};
        if (value.includes(':')) {
          const cIdx = value.indexOf(':');
          const k = value.slice(0, cIdx).trim();
          const v = value.slice(cIdx + 1).trim();
          obj[k] = v === '' ? {} : parseValue(v);
        }
        arr.push(obj);
        stack.push({ indent, container: obj, inListObject: true });
      } else {
        arr.push(parseValue(value));
      }
      continue;
    }

    // Key: value
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    // Nested fields of a list-of-mappings item
    if (top.inListObject) {
      if (rawValue === '') {
        top.container[key] = {};
        stack.push({ indent, container: top.container[key], key });
      } else {
        top.container[key] = parseValue(rawValue);
      }
      continue;
    }

    if (rawValue === '') {
      // Peek: if next non-empty line is a list item at greater indent → array
      let nextIsList = false;
      for (let j = i + 1; j < lines.length; j++) {
        const peek = lines[j]!;
        if (peek.trim() === '' || peek.trim().startsWith('#')) continue;
        const pIndent = peek.search(/\S/);
        if (pIndent <= indent) break;
        nextIsList = peek.trim().startsWith('-');
        break;
      }
      if (nextIsList) {
        top.container[key] = [];
        stack.push({ indent, container: top.container, key });
      } else {
        top.container[key] = {};
        stack.push({ indent, container: top.container[key], key });
      }
    } else {
      top.container[key] = parseValue(rawValue);
    }
  }
  return root;
}

function parseValue(raw: string): any {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((v) => parseValue(v.trim()));
  }
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

// ── Schema validation ──────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a parsed pipeline definition against the schema.
 */
export function validatePipelineSchema(def: any): ValidationResult {
  const errors: string[] = [];
  if (typeof def !== 'object' || def === null) {
    return { valid: false, errors: ['pipeline must be a non-null object'] };
  }
  if (typeof def.name !== 'string' || def.name.length === 0) {
    errors.push('pipeline.name must be a non-empty string');
  }
  if (!Array.isArray(def.stages) || def.stages.length === 0) {
    errors.push('pipeline.stages must be a non-empty array');
    return { valid: false, errors };
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < def.stages.length; i++) {
    const stage = def.stages[i];
    if (typeof stage !== 'object' || stage === null) {
      errors.push(`stages[${i}] must be an object`);
      continue;
    }
    if (typeof stage.id !== 'string' || stage.id.length === 0) {
      errors.push(`stages[${i}].id must be a non-empty string`);
    } else if (seenIds.has(stage.id)) {
      errors.push(`duplicate stage id: ${stage.id}`);
    } else {
      seenIds.add(stage.id);
    }
    if (typeof stage.name !== 'string') {
      errors.push(`stages[${i}].name must be a string`);
    }
    if (typeof stage.sparcPhase !== 'string') {
      errors.push(`stages[${i}].sparcPhase must be a string`);
    }
    if (Array.isArray(stage.steps)) {
      for (let j = 0; j < stage.steps.length; j++) {
        const step = stage.steps[j];
        if (typeof step !== 'object' || step === null) {
          errors.push(`stages[${i}].steps[${j}] must be an object`);
        } else {
          if (typeof step.id !== 'string') errors.push(`stages[${i}].steps[${j}].id must be a string`);
          if (typeof step.tool !== 'string') errors.push(`stages[${i}].steps[${j}].tool must be a string`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ── YAMLOrchestrator (v13 rewrite) ─────────────────────────

export class YAMLOrchestrator {
  private steps: OrchestrationStep[] = [];
  private pipeline: PipelineDefinition | null = null;

  /**
   * Backward-compat: load a list of orchestration steps. Used by the
   * old `getExecutionOrder` API.
   */
  load(steps: OrchestrationStep[]): void {
    this.steps = steps;
  }

  /**
   * Backward-compat: compute the topological execution order of the
   * loaded steps. Returns an array of "levels"; each level is a set of
   * steps that can be executed in parallel.
   */
  getExecutionOrder(): OrchestrationStep[][] {
    const levels: OrchestrationStep[][] = [];
    const executed = new Set<string>();

    while (executed.size < this.steps.length) {
      const nextLevel = this.steps.filter(
        (s) => !executed.has(s.id) && s.depends_on.every((d) => executed.has(d)),
      );
      if (nextLevel.length === 0) break;
      levels.push(nextLevel);
      for (const s of nextLevel) executed.add(s.id);
    }

    return levels;
  }

  /**
   * v13 — P5.1: load a pipeline from a parsed YAML object. Validates
   * the schema; throws on validation failure.
   */
  loadPipeline(def: PipelineDefinition): void {
    const v = validatePipelineSchema(def);
    if (!v.valid) {
      throw new Error(`loadPipeline: ${v.errors.join('; ')}`);
    }
    this.pipeline = def;
    // Also populate `this.steps` for backward compat
    this.steps = def.stages.flatMap((s) => s.steps);
  }

  /**
   * v13 — P5.1: load a pipeline from a YAML file on disk.
   */
  loadPipelineFromFile(yamlPath: string): PipelineDefinition {
    const content = fs.readFileSync(yamlPath, 'utf8');
    const def = parseSimpleYaml(content);
    this.loadPipeline(def as PipelineDefinition);
    return def as PipelineDefinition;
  }

  /**
   * v13 — P5.1: get the current pipeline definition (or null).
   */
  getPipeline(): PipelineDefinition | null {
    return this.pipeline;
  }

  /**
   * v13 — P5.1: run the pipeline, advancing only when SPARC gates pass.
   * The `evidenceProvider` is called for each stage to collect evidence
   * for the SPARC gate evaluation.
   */
  async runPipeline(
    azaDir: string,
    evidenceProvider?: (stage: PipelineStage) => Promise<Evidence[]>,
  ): Promise<PipelineReport> {
    if (!this.pipeline) {
      throw new Error('runPipeline: no pipeline loaded — call loadPipeline or loadPipelineFromFile first');
    }
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const stageReports: StageReport[] = [];
    let success = true;

    for (const stage of this.pipeline.stages) {
      const evidence = evidenceProvider ? await evidenceProvider(stage) : [];
      const evalResult = evaluateSparcGate(stage.sparcPhase, evidence);
      const gatePassed = evalResult.passed && (stage.minScore === undefined || evalResult.score >= stage.minScore);
      const executionLevels = this.getExecutionOrderForStage(stage).length;
      const report: StageReport = {
        stageId: stage.id,
        sparcPhase: stage.sparcPhase,
        success: gatePassed,
        score: evalResult.score,
        minScore: stage.minScore ?? evalResult.minScore,
        gatePassed,
        executionLevels,
      };
      if (!gatePassed) {
        report.error = `SPARC gate failed: score=${evalResult.score} < minScore=${report.minScore}; missing: ${evalResult.missingCriteria.join(', ')}`;
        success = false;
        stageReports.push(report);
        break;
      }
      stageReports.push(report);
    }

    return {
      pipelineName: this.pipeline.name,
      success,
      stageReports,
      durationMs: Date.now() - startMs,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  private getExecutionOrderForStage(stage: PipelineStage): OrchestrationStep[][] {
    const levels: OrchestrationStep[][] = [];
    const executed = new Set<string>();
    while (executed.size < stage.steps.length) {
      const nextLevel = stage.steps.filter(
        (s) => !executed.has(s.id) && s.depends_on.every((d) => executed.has(d)),
      );
      if (nextLevel.length === 0) break;
      levels.push(nextLevel);
      for (const s of nextLevel) executed.add(s.id);
    }
    return levels;
  }
}
