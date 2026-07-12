import type { SecurityFinding } from './secret';

const XSS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /innerHTML\s*=/, description: 'Setting innerHTML directly (XSS risk)' },
  { pattern: /dangerouslySetInnerHTML/, description: 'React dangerouslySetInnerHTML' },
  { pattern: /v-html\s*=/, description: 'Vue v-html directive (XSS risk)' },
  { pattern: /document\.write\s*\(/, description: 'document.write usage' },
  { pattern: /eval\s*\(/, description: 'eval() usage (XSS + code injection)' },
  { pattern: /setTimeout\s*\(\s*['"`]/, description: 'setTimeout with string (eval-like)' },
  { pattern: /setInterval\s*\(\s*['"`]/, description: 'setInterval with string (eval-like)' },
];

export function scanXSS(content: string, file: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    for (const { pattern, description } of XSS_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          type: 'xss',
          severity: 'high',
          file,
          line: i + 1,
          description,
        });
      }
    }
  }

  return findings;
}
