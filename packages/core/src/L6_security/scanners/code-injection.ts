import type { SecurityFinding } from './secret';

const CI_PATTERNS: Array<{ pattern: RegExp; description: string; severity: 'critical' | 'high' }> = [
  { pattern: /Function\s*\(/, description: 'Function constructor (code injection risk)', severity: 'high' },
  { pattern: /child_process\.(?:exec|execSync|spawn|spawnSync|fork)/, description: 'Child process execution', severity: 'critical' },
  { pattern: /require\(['"`][^'"`]*\$/, description: 'Dynamic require with variable', severity: 'high' },
  { pattern: /import\(['"`][^'"`]*\$/, description: 'Dynamic import with variable', severity: 'high' },
  { pattern: /new\s+Function\s*\(/, description: 'new Function() (eval-like)', severity: 'high' },
  { pattern: /prototype\s*=\s*/, description: 'Prototype pollution risk', severity: 'high' },
  { pattern: /__proto__/, description: 'Prototype pollution via __proto__', severity: 'critical' },
];

export function scanCodeInjection(content: string, file: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    for (const { pattern, description, severity } of CI_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          type: 'code_injection',
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

export function securityScan(content: string, file: string): SecurityFinding[] {
  return [
    ...scanCodeInjection(content, file),
  ];
}
