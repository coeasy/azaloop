import type { GateResult } from '../pipeline';

export interface RegressionBaseline {
  test_count: number;
  pass_count: number;
  fail_count: number;
  duration_ms: number;
}

export async function regressionGate(baseline: RegressionBaseline, current: RegressionBaseline): Promise<GateResult> {
  const start = Date.now();
  const issues: string[] = [];

  if (current.pass_count < baseline.pass_count) {
    issues.push(`Regression detected: ${baseline.pass_count} passing → ${current.pass_count} passing`);
  }

  if (current.fail_count > baseline.fail_count) {
    issues.push(`New failures: ${baseline.fail_count} → ${current.fail_count}`);
  }

  return {
    gate: 'Gate 3: Regression Check',
    passed: issues.length === 0,
    issues,
    duration_ms: Date.now() - start,
  };
}
