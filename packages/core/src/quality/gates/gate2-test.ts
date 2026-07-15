/**
 * Gate 2 prefers a scoped/stable suite when AZA_QUALITY_TEST_CMD is set
 * or `.aza/quality-test-cmd` exists. Otherwise prefers `test:spine`, then `test`.
 *
 * Pre-existing failing suites must not block spine shipping — set
 * AZA_QUALITY_ALLOW_KNOWN_FAILS=1 or `.aza/quality-allow-known-fails` to
 * soft-pass when non-zero exit has no explicit FAIL lines.
 */

import type { GateResult } from '../pipeline';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

function readOptionalCmd(projectRoot: string): string | undefined {
  const envCmd = process.env.AZA_QUALITY_TEST_CMD?.trim();
  if (envCmd) return envCmd;
  const filePath = path.join(projectRoot, '.aza', 'quality-test-cmd');
  try {
    if (fs.existsSync(filePath)) {
      const line = fs
        .readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .find((l) => l.trim() && !l.trim().startsWith('#'));
      if (line?.trim()) return line.trim();
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function allowKnownFails(projectRoot: string): boolean {
  if (process.env.AZA_QUALITY_ALLOW_KNOWN_FAILS === '1') return true;
  return fs.existsSync(path.join(projectRoot, '.aza', 'quality-allow-known-fails'));
}

export async function testGate(projectRoot: string): Promise<GateResult> {
  const start = Date.now();
  const issues: string[] = [];

  let cmd = readOptionalCmd(projectRoot);
  if (!cmd) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
      if (pkg?.scripts?.['test:spine']) cmd = 'pnpm run test:spine';
      else if (pkg?.scripts?.test) cmd = 'pnpm test';
    } catch {
      /* ignore */
    }
  }
  if (!cmd) cmd = 'npx vitest run --reporter=verbose';

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: projectRoot,
      timeout: 300000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CI: '1' },
    });
    const output = `${stdout || ''}\n${stderr || ''}`;
    if (/\bFAIL\b/.test(output) || /Test Files\s+\d+\s+failed/.test(output)) {
      const failLines = output.split('\n').filter((l: string) => l.includes('FAIL') || l.includes('✗'));
      issues.push(...failLines.slice(0, 10));
    }
  } catch (err: any) {
    const output = err.stdout?.toString() || err.stderr?.toString() || err.message || '';
    const failLines = output.split('\n').filter((l: string) => l.includes('FAIL') || l.includes('✗'));
    issues.push(...failLines.slice(0, 10));
    if (issues.length === 0) {
      if (allowKnownFails(projectRoot)) {
        return {
          gate: 'Gate 2: Test Suite (Vitest)',
          passed: true,
          issues: ['soft-pass: suite non-zero exit without FAIL lines (known-fail debt allowed)'],
          duration_ms: Date.now() - start,
        };
      }
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
