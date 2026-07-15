import { checkCompliance, getDomesticLLMAlternatives } from '@azaloop/core';
import type { ComplianceResult } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Collect the textual content of relevant workspace files for compliance
 * scanning. In `quick` mode only configuration files are read; in `full`
 * mode source files are included as well.
 */
function collectWorkspaceContent(workspacePath: string, checkType: 'full' | 'quick'): string {
  const root = workspacePath || '.';
  const chunks: string[] = [];

  const readSafe = (filePath: string, label?: string): void => {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        chunks.push(`\n--- ${label ?? filePath} ---\n${content}`);
      }
    } catch {
      // ignore unreadable files
    }
  };

  // Always scan configuration & manifest files.
  const configFiles = [
    'package.json',
    'mcp.json',
    '.env',
    '.env.local',
    'config.json',
    'claude_desktop_config.json',
    'clawhub.json',
    path.join('.aza', 'STATE.yaml'),
    path.join('.aza', 'mcp.json'),
  ];
  for (const file of configFiles) {
    readSafe(path.join(root, file), file);
  }

  // In full mode, also scan source files for PII / overseas endpoints.
  if (checkType === 'full') {
    const sourceExts = ['.ts', '.js', '.tsx', '.jsx', '.py', '.json', '.yaml', '.yml'];
    const scanDir = (dir: string, depth: number): void => {
      if (depth > 2) return; // limit traversal depth
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
        const full = path.join(dir, entry);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            scanDir(full, depth + 1);
          } else if (sourceExts.some((ext) => entry.endsWith(ext))) {
            readSafe(full, path.relative(root, full));
          }
        } catch {
          // skip
        }
      }
    };
    scanDir(root, 0);
  }

  return chunks.join('\n');
}

/**
 * `aza_compliance` — run a China regulatory compliance check
 * (网络安全法 / PIPL / 等保2.0 / 数据出境 / AI标识) against the workspace.
 *
 * Produces a Red/Yellow/Green scorecard with violations and suggestions.
 */
export async function handleCompliance(
  workspacePath?: string,
  checkType: 'full' | 'quick' = 'full',
): Promise<LoopResponse> {
  try {
    const root = workspacePath || '.';
    const content = collectWorkspaceContent(root, checkType);
    const result: ComplianceResult = checkCompliance(content, root);

    return {
      success: result.passed,
      data: {
        score: result.score,
        level: result.level,
        violations: result.violations,
        suggestions: result.suggestions,
        framework_breakdown: result.frameworkBreakdown,
        domestic_alternatives: getDomesticLLMAlternatives(),
      },
      next_action: result.passed
        ? { tool: 'aza_loop', action: 'next', reason: `Compliance ${result.level} — safe to proceed` }
        : { tool: 'aza_compliance', action: 'fix', reason: `Compliance ${result.level} (score ${result.score}) — ${result.violations.length} violation(s) found` },
      metadata: { iteration: 0, progress: result.passed ? '90%' : '50%', stage: 'verify' },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: '0%', stage: 'verify' },
    };
  }
}
