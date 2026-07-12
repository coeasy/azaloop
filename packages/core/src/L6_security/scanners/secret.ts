export interface SecurityFinding {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  file: string;
  line: number;
  description: string;
}

const SECRET_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"][^'"]{8,}['"]/i, description: 'API key or secret exposed' },
  { pattern: /(?:sk-[a-zA-Z0-9]{20,}|pk-[a-zA-Z0-9]{20,})/, description: 'Stripe key detected' },
  { pattern: /(?:ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]{36}/, description: 'GitHub token detected' },
  { pattern: /(?:AKIA[0-9A-Z]{16})/, description: 'AWS access key detected' },
  { pattern: /(?:-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/, description: 'Private key detected' },
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{3,}['"]/i, description: 'Password in code' },
  { pattern: /(?:token|secret|credential)\s*[:=]\s*['"][^'"]{8,}['"]/i, description: 'Token, secret, or credential in code' },
];

export function scanSecrets(content: string, file: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    for (const { pattern, description } of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          type: 'secret',
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
