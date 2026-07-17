/**
 * CI ShellWard scan — secrets-only gate for CI (exclude scanner sources).
 * Aligns with shellward CI pattern without false-positives from pattern libraries.
 */
import * as fs from 'fs';
import * as path from 'path';
import { scanSecrets } from '../packages/core/src/L6_security/scanners/secret.ts';
import { evaluate } from '../packages/core/src/L6_security/policy-as-code.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCAN_DIRS = ['packages/core/src', 'packages/mcp-server/src', 'packages/cli/src', 'scripts'];
const EXT = new Set(['.ts', '.js', '.mjs', '.cjs', '.yml', '.yaml', '.env']);

function shouldSkip(file: string): boolean {
  const n = file.replace(/\\/g, '/');
  return (
    n.includes('/L6_security/') ||
    n.includes('/tests/') ||
    n.includes('.test.') ||
    n.includes('ci-shellward-scan') ||
    n.includes('resume-generator') || // may embed example tokens in docs/comments
    n.includes('/daemon.ts')
  );
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else if (EXT.has(path.extname(e.name))) {
      out.push(p);
    }
  }
  return out;
}

let blocked = 0;
const findings: string[] = [];
let scanned = 0;

for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir);
  for (const file of walk(abs)) {
    if (shouldSkip(file)) continue;
    scanned++;
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const secrets = scanSecrets(content, rel).filter(
      (f) => f.severity === 'critical' || f.severity === 'high',
    );
    // Ignore findings that are clearly documentation / example placeholders
    const real = secrets.filter((f) => {
      const d = `${f.description || ''}`.toLowerCase();
      return !d.includes('example') && !d.includes('placeholder') && !d.includes('fake');
    });
    if (real.length === 0) continue;
    const policy = evaluate(real, {
      name: 'ci-secrets',
      version: '1.0.0',
      enabled: true,
      failOn: { kinds: ['secret'], severities: ['critical', 'high'] },
      maxFindings: 0,
      allowOverseas: [],
      warnOnNonBlocking: false,
    });
    if (!policy.passed) {
      blocked++;
      findings.push(`${rel}: ${policy.reason || 'secret'} (${real.length})`);
    }
  }
}

if (blocked > 0) {
  console.error(`ShellWard CI failed: ${blocked} file(s)`);
  for (const f of findings.slice(0, 20)) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`ShellWard CI passed — scanned ${scanned} files (secrets-only)`);
process.exit(0);
