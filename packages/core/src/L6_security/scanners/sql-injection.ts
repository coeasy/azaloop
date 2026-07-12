import type { SecurityFinding } from './secret';

const SQLI_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /execute\s*\(\s*['"](?:SELECT|INSERT|UPDATE|DELETE).*?['"]\s*\+/, description: 'String concatenation in SQL query' },
  { pattern: /query\s*\(\s*`[^`]*\$\{/, description: 'Template literal in SQL query' },
  { pattern: /raw\s*\(\s*['"`]/, description: 'Raw SQL query execution' },
  { pattern: /\$where:\s*['"`]/, description: 'MongoDB $where with string' },
  { pattern: /pg\.Client.*\.query\s*\(\s*['"`][^'"`]*['"`]\s*\+/, description: 'PostgreSQL string concatenation query' },
];

export function scanSQLInjection(content: string, file: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    for (const { pattern, description } of SQLI_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          type: 'sql_injection',
          severity: 'critical',
          file,
          line: i + 1,
          description,
        });
      }
    }
  }

  return findings;
}
