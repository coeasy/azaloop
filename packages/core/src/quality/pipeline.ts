import type { SecurityFinding } from '../L6_security/scanners/secret';
import { loopAuditGate } from './gates/gate6-loop-audit';
import type { LoopAuditGateContext } from './gates/gate6-loop-audit';

export interface GateResult {
  gate: string;
  passed: boolean;
  issues: string[];
  duration_ms: number;
}

export interface PipelineResult {
  passed: boolean;
  gates: GateResult[];
  summary: string;
}

export interface GateExecutor {
  name: string;
  execute: () => Promise<GateResult>;
}

/**
 * The name of the Gate 6 loop-audit scoring gate.
 */
export const GATE6_NAME = 'Gate 6: Loop Audit Scoring';

export class QualityPipeline {
  private gates: GateExecutor[] = [];

  register(gate: GateExecutor): void {
    this.gates.push(gate);
  }

  /**
   * Register Gate 6 (Loop Audit Scoring) with the given signal context.
   *
   * The gate runs the L7 {@link LoopAudit} engine and requires a score
   * of at least 40 (the L1 "Report-only" minimum) to pass.
   *
   * @param context - Signal pass/fail map and optional minimum-score override.
   *
   * @example
   * ```ts
   * pipeline.registerLoopAuditGate({
   *   signals: { state_file_exists: true, ... },
   *   minScore: 40,
   * });
   * ```
   */
  registerLoopAuditGate(context: LoopAuditGateContext): void {
    this.register({
      name: GATE6_NAME,
      execute: () => loopAuditGate(context),
    });
  }

  async runAll(): Promise<PipelineResult> {
    // When no gates are registered the pipeline must NOT pass vacuously.
    if (this.gates.length === 0) {
      return {
        passed: false,
        gates: [],
        summary: '0/0 gates passed — no quality gates registered (pipeline is empty)',
      };
    }

    // Phase 1: Run first 4 gates in parallel (independent checks)
    // Phase 2: Run remaining gates sequentially (may depend on earlier results)
    const PARALLEL_BATCH_SIZE = 4;
    const results: GateResult[] = [];

    // Run gates in parallel batches of 4
    for (let i = 0; i < this.gates.length; i += PARALLEL_BATCH_SIZE) {
      const batch = this.gates.slice(i, i + PARALLEL_BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(gate => gate.execute()));
      results.push(...batchResults);
    }

    const passed = results.every(r => r.passed);
    const passedCount = results.filter(r => r.passed).length;

    return {
      passed,
      gates: results,
      summary: `${passedCount}/${results.length} gates passed${passed ? '' : ` — failing: ${results.filter(r => !r.passed).map(r => r.gate).join(', ')}`}`,
    };
  }

  async runGate(name: string): Promise<GateResult | null> {
    const gate = this.gates.find(g => g.name === name);
    if (!gate) return null;
    return gate.execute();
  }

  clear(): void {
    this.gates = [];
  }
}
