import type { GateResult } from '../pipeline';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function lintGate(projectRoot: string): Promise<GateResult> {
  const start = Date.now();
  const issues: string[] = [];

  try {
    await execAsync('npx tsc --noEmit', { cwd: projectRoot });
  } catch (err: any) {
    issues.push(err.stderr?.toString() || err.stdout?.toString() || 'TypeScript compilation failed');
  }

  try {
    await execAsync('npx eslint . --max-warnings=0', { cwd: projectRoot });
  } catch (err: any) {
    issues.push(err.stderr?.toString() || err.stdout?.toString() || 'ESLint found issues');
  }

  return {
    gate: 'Gate 1: Static Analysis (tsc + ESLint)',
    passed: issues.length === 0,
    issues,
    duration_ms: Date.now() - start,
  };
}
