import type { LoopResponse } from '@azaloop/shared';

interface StyleRule {
  pattern: RegExp;
  suggestion: string;
  category: 'naming' | 'formatting' | 'pattern' | 'convention';
}

const STYLE_RULES: StyleRule[] = [
  { pattern: /function\s+\w+\s*\(/, suggestion: 'Use arrow functions for callbacks, named functions for exports', category: 'pattern' },
  { pattern: /var\s+/, suggestion: 'Use const/let instead of var', category: 'pattern' },
  { pattern: /any\b/, suggestion: 'Avoid `any` — use `unknown` if type is truly not known', category: 'naming' },
  { pattern: /==\s*(?!==)/, suggestion: 'Use === instead of ==', category: 'pattern' },
  { pattern: /!\s*=\s*(?!=)/, suggestion: 'Use !== instead of !=', category: 'pattern' },
  { pattern: /console\.log/, suggestion: 'Remove console.log before committing or use structured logger', category: 'convention' },
  { pattern: /TODO|FIXME|HACK|XXX/, suggestion: 'Address TODO/FIXME comments before committing', category: 'convention' },
  { pattern: /\.\.\./, suggestion: 'Consider if spread is necessary — avoid deep copying large objects', category: 'pattern' },
];

export async function handleStyleCheck(code: string, filePath?: string): Promise<LoopResponse> {
  const findings: Array<{ line: number; category: string; suggestion: string; match: string }> = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    for (const rule of STYLE_RULES) {
      const match = line.match(rule.pattern);
      if (match) {
        findings.push({
          line: i + 1,
          category: rule.category,
          suggestion: rule.suggestion,
          match: match[0] || '',
        });
      }
    }
  }

  return {
    success: true,
    data: {
      file: filePath || 'unknown',
      total_lines: lines.length,
      style_issues: findings.length,
      findings,
    },
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}

export async function handleStyleLearn(): Promise<LoopResponse> {
  return {
    success: true,
    data: {
      message: 'Style learning records project-specific patterns for future style checks.',
      monitored: ['naming conventions', 'import ordering', 'file structure', 'error handling patterns'],
    },
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}
