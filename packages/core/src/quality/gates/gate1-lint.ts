import type { GateResult } from '../pipeline';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

function hasEslintConfig(projectRoot: string): boolean {
  const names = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
  ];
  return names.some((n) => fs.existsSync(path.join(projectRoot, n)));
}

function packageHasScript(projectRoot: string, script: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return Boolean(pkg?.scripts?.[script]);
  } catch {
    return false;
  }
}

async function runTypecheck(projectRoot: string): Promise<string | null> {
  // Prefer workspace typecheck script (pnpm monorepos); avoid naked `npx tsc`
  // which resolves to the wrong shim when typescript is not a root dependency.
  const attempts: string[] = [];
  if (packageHasScript(projectRoot, 'typecheck')) {
    attempts.push('pnpm typecheck');
    attempts.push('npm run typecheck');
  }
  attempts.push('npx -y -p typescript tsc --noEmit -p tsconfig.base.json');
  attempts.push('npx -y -p typescript tsc --noEmit');

  let lastErr = 'TypeScript compilation failed';
  for (const cmd of attempts) {
    try {
      await execAsync(cmd, { cwd: projectRoot, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
      return null;
    } catch (err: any) {
      lastErr = err.stderr?.toString() || err.stdout?.toString() || err.message || lastErr;
      // Only continue to next attempt when the command itself is missing / wrong shim
      const hint = lastErr.toLowerCase();
      if (
        hint.includes('not the tsc command') ||
        hint.includes('not found') ||
        hint.includes('enoent') ||
        hint.includes('missing script')
      ) {
        continue;
      }
      return lastErr;
    }
  }
  return lastErr;
}

export async function lintGate(projectRoot: string): Promise<GateResult> {
  const start = Date.now();
  const issues: string[] = [];

  const tscErr = await runTypecheck(projectRoot);
  if (tscErr) issues.push(tscErr);

  if (hasEslintConfig(projectRoot)) {
    try {
      await execAsync('npx eslint . --max-warnings=0', {
        cwd: projectRoot,
        timeout: 180000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (err: any) {
      issues.push(err.stderr?.toString() || err.stdout?.toString() || 'ESLint found issues');
    }
  }
  // No ESLint config → skip (common for typecheck-first monorepos)

  return {
    gate: 'Gate 1: Static Analysis (tsc + ESLint)',
    passed: issues.length === 0,
    issues,
    duration_ms: Date.now() - start,
  };
}
