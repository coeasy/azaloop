import type { SecurityFinding } from './secret';

const DEP_PATTERNS: Array<{ pattern: RegExp; description: string; severity: 'high' | 'medium' }> = [
  { pattern: /https?:\/\/.*(?:\.ru|\.cn|\.su)\/.*\.(?:js|ts|wasm)/, description: 'External dependency from restricted region', severity: 'high' },
  { pattern: /(?:npm install|yarn add|pnpm add)\s+-g/, description: 'Global package installation', severity: 'medium' },
  { pattern: /curl.*\||wget.*\|/, description: 'Remote code execution via pipe', severity: 'high' },
  { pattern: /chmod\s+777/, description: 'Overly permissive file permissions', severity: 'high' },
  { pattern: /(?:eval|exec|execSync|spawn)\s*\(\s*['"`][^'"`]*['"`]\s*\)/, description: 'Dynamic code execution', severity: 'high' },
];

export function scanDependencies(content: string, file: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    for (const { pattern, description, severity } of DEP_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          type: 'dependency',
          severity,
          file,
          line: i + 1,
          description,
        });
      }
    }
  }

  return findings;
}
