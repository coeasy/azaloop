import type { GateResult } from '../pipeline';
import type { SecurityFinding } from '../../L6_security/scanners/secret';
import { scanSecrets } from '../../L6_security/scanners/secret';
import { scanSQLInjection } from '../../L6_security/scanners/sql-injection';
import { scanXSS } from '../../L6_security/scanners/xss';
import { scanDependencies } from '../../L6_security/scanners/dependency';
import { scanCodeInjection } from '../../L6_security/scanners/code-injection';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function securityGate(projectRoot: string): Promise<GateResult> {
  const start = Date.now();
  const allFindings: SecurityFinding[] = [];

  async function scanFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      allFindings.push(
        ...scanSecrets(content, filePath),
        ...scanSQLInjection(content, filePath),
        ...scanXSS(content, filePath),
        ...scanDependencies(content, filePath),
        ...scanCodeInjection(content, filePath),
      );
    } catch {
      // Skip unreadable files
    }
  }

  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          await walkDir(fullPath);
        } else if (entry.isFile() && /\.(ts|js|tsx|jsx|py|rb|php|go)$/i.test(entry.name)) {
          await scanFile(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  const srcDir = path.join(projectRoot, 'src');
  try {
    await fs.access(srcDir);
    await walkDir(srcDir);
  } catch {
    // No src directory
  }

  const criticalFindings = allFindings.filter(f => f.severity === 'critical');
  const highFindings = allFindings.filter(f => f.severity === 'high');

  return {
    gate: 'Gate 4: Security Scan',
    passed: criticalFindings.length === 0,
    issues: criticalFindings.map(f => `${f.type.toUpperCase()}: ${f.description} at ${f.file}:${f.line}`),
    duration_ms: Date.now() - start,
  };
}
