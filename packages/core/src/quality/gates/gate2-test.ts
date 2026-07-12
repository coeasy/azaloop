import type { GateResult } from '../pipeline';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function testGate(projectRoot: string): Promise<GateResult> {
  const start = Date.now();
  const issues: string[] = [];

  try {
    const { stdout } = await execAsync('npx vitest run --reporter=verbose', {
      cwd: projectRoot,
      timeout: 120000,
    });

    if (stdout.includes('FAIL') || stdout.includes('failed')) {
      const failLines = stdout.split('\n').filter((l: string) => l.includes('FAIL') || l.includes('✗'));
      issues.push(...failLines.slice(0, 10));
    }
  } catch (err: any) {
    const output = err.stdout?.toString() || err.stderr?.toString() || err.message || '';
    const failLines = output.split('\n').filter((l: string) => l.includes('FAIL') || l.includes('✗'));
    issues.push(...failLines.slice(0, 10));
    if (issues.length === 0) {
      issues.push('Test suite failed to run');
    }
  }

  return {
    gate: 'Gate 2: Test Suite (Vitest)',
    passed: issues.length === 0,
    issues,
    duration_ms: Date.now() - start,
  };
}
