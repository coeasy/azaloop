/**
 * testgaps worker — scans for test files + coverage reports.
 * Honest about heuristics; no silent "all good".
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WorkerContext, WorkerReport, WorkerFinding } from './scheduler';

function walkTests(root: string, maxFiles = 200): string[] {
  const hits: string[] = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'coverage', '.aza']);

  function walk(dir: string, depth: number): void {
    if (hits.length >= maxFiles || depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= maxFiles) break;
      if (e.name.startsWith('.') && e.name !== '.aza') continue;
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(e.name)) {
        hits.push(path.relative(root, full));
      }
    }
  }

  const workRoot = path.dirname(root); // ctx.azaDir is .aza — parent is project
  walk(workRoot, 0);
  return hits;
}

export async function runTestGaps(ctx: WorkerContext): Promise<WorkerReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: WorkerFinding[] = [];
  const workRoot = path.dirname(ctx.azaDir);

  const candidates = [
    'coverage/coverage-summary.json',
    'coverage/lcov.info',
    '.nyc_output/coverage.json',
  ];
  let coveragePath: string | null = null;
  for (const c of candidates) {
    const p = path.join(workRoot, c);
    if (fs.existsSync(p)) {
      coveragePath = p;
      break;
    }
  }

  const tests = walkTests(ctx.azaDir);
  if (tests.length === 0) {
    findings.push({
      severity: 'warn',
      message: 'No *.test.* / *.spec.* files found under project root (heuristic walk).',
      refs: ['worker:testgaps'],
    });
  } else {
    findings.push({
      severity: 'info',
      message: `Found ${tests.length} test file(s). Sample: ${tests.slice(0, 5).join(', ')}`,
      refs: tests.slice(0, 10),
    });
  }

  if (coveragePath) {
    findings.push({
      severity: 'info',
      message: `Coverage artifact present at ${path.relative(workRoot, coveragePath)}.`,
      refs: [coveragePath],
    });
  } else {
    findings.push({
      severity: 'warn',
      message:
        'No coverage report found (looked for coverage-summary.json / lcov.info / .nyc_output). Heuristic worker — does not run tests.',
      refs: ['worker:testgaps:no-coverage'],
    });
  }

  return {
    name: 'testgaps',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    findings,
  };
}
