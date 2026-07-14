import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * Phase write guards — prevent unauthorized file writes during sensitive phases.
 * Inspired by spec-superflow's contract-first locking.
 *
 * During certain phases (planning, design), writes to specific files are blocked.
 * During build, only build-related files can be written.
 */
export interface WriteGuardConfig {
  /** Phase that is currently active */
  currentPhase: string;
  /** Files that are locked during this phase */
  lockedFiles: string[];
  /** Files that are allowed to be written during this phase */
  allowedWrites: string[];
}

export interface BlastRadiusResult {
  /** Number of files that would be affected */
  affectedFiles: number;
  /** List of affected file paths */
  affectedPaths: string[];
  /** Risk level: LOW / MEDIUM / HIGH / CRITICAL */
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Risk score: 0-100 */
  riskScore: number;
  /** Detailed analysis */
  details: string;
  /** Recommended actions */
  recommendations: string[];
}

/**
 * Phase-based write guards.
 */
export function getWriteGuardConfig(currentPhase: string): WriteGuardConfig {
  const guardConfigs: Record<string, WriteGuardConfig> = {
    open: {
      currentPhase: 'open',
      // STATE.yaml, STATE.HASH, prd.json are always allowed by isWriteAllowed()
      lockedFiles: [],
      allowedWrites: ['prd.json', 'prd.md'],
    },
    design: {
      currentPhase: 'design',
      lockedFiles: [],
      allowedWrites: ['design.md', 'diagrams/**', 'tasks.md'],
    },
    build: {
      currentPhase: 'build',
      lockedFiles: [],
      allowedWrites: ['src/**', 'tests/**', '*.ts', '*.js', '*.test.ts', '*.spec.ts'],
    },
    verify: {
      currentPhase: 'verify',
      lockedFiles: [],
      allowedWrites: ['*.test.ts', '*.spec.ts', 'test-results/**'],
    },
    archive: {
      currentPhase: 'archive',
      lockedFiles: [],
      allowedWrites: ['docs/**', '*.md', 'archive/**'],
    },
  };

  return guardConfigs[currentPhase] ?? {
    currentPhase,
    lockedFiles: [],
    allowedWrites: ['**/*'],
  };
}

/**
 * Check if a file write is allowed during the current phase.
 */
export function isWriteAllowed(filePath: string, currentPhase: string): boolean {
  const config = getWriteGuardConfig(currentPhase);

  // Always allow state files (StateManager handles them)
  if (filePath.endsWith('STATE.yaml') || filePath.endsWith('STATE.HASH') || filePath.endsWith('run-state.json') || filePath.endsWith('audit.jsonl') || filePath.endsWith('prd.json')) {
    return true;
  }

  // Check if file is in allowed writes
  for (const allowed of config.allowedWrites) {
    if (matchesGlob(filePath, allowed)) {
      return true;
    }
  }

  // Check if file is explicitly locked
  for (const locked of config.lockedFiles) {
    if (filePath.endsWith(locked)) {
      return false;
    }
  }

  // Default: allow if not explicitly blocked
  return true;
}

/**
 * GitNexus-style blast radius analysis.
 * Analyzes the impact of editing a file before allowing changes.
 */
export async function analyzeBlastRadius(
  filePath: string,
  workspaceRoot: string,
): Promise<BlastRadiusResult> {
  const details: string[] = [];
  const recommendations: string[] = [];
  let riskScore = 0;

  // Resolve file path
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);

  // Check if file exists
  try {
    await fs.access(fullPath);
  } catch {
    return {
      affectedFiles: 0,
      affectedPaths: [],
      riskLevel: 'LOW',
      riskScore: 0,
      details: 'File does not exist',
      recommendations: ['Create the file first'],
    };
  }

  // Analyze file size
  const stat = await fs.stat(fullPath);
  const fileSize = stat.size;
  if (fileSize > 100000) {
    riskScore += 15;
    details.push('Large file (>100KB) — high impact');
  } else if (fileSize > 10000) {
    riskScore += 5;
    details.push('Medium file (>10KB)');
  } else {
    riskScore += 0;
    details.push('Small file (<10KB)');
  }

  // Check file type
  const ext = path.extname(filePath).toLowerCase();
  const riskByExt: Record<string, number> = {
    '.ts': 10,
    '.js': 10,
    '.tsx': 15,
    '.jsx': 15,
    '.py': 10,
    '.rb': 10,
    '.go': 10,
    '.json': 5,
    '.yaml': 5,
    '.yml': 5,
    '.md': 2,
    '.txt': 1,
    '.css': 3,
    '.scss': 3,
    '.html': 3,
  };
  const extRisk = riskByExt[ext] ?? 5;
  riskScore += extRisk;
  details.push(`File type risk: ${ext} (+${extRisk})`);

  // Check import/export references (for .ts/.js files)
  if (ext === '.ts' || ext === '.js') {
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const importMatches = content.match(/import.*from\s+['"](.+)['"]/g) || [];
      const exportMatches = content.match(/export\s+(?:default\s+)?(?:class|function|const|let|var)/g) || [];
      const totalRefs = importMatches.length + exportMatches.length;
      riskScore += Math.min(totalRefs * 2, 30);
      details.push(`Import/export references: ${totalRefs} (+${Math.min(totalRefs * 2, 30)})`);
      if (totalRefs > 10) {
        recommendations.push('File has many references — consider impact on imports');
      }
    } catch {
      details.push('Could not analyze file content');
    }
  }

  // Check if file is in a critical directory
  const criticalDirs = ['src/core/', 'src/main/', 'src/api/', 'src/index.ts', 'src/app.ts'];
  for (const dir of criticalDirs) {
    if (filePath.includes(dir)) {
      riskScore += 20;
      details.push(`Critical directory: ${dir}`);
      recommendations.push('Critical file — verify thoroughly before committing');
      break;
    }
  }

  // Check if file is a config file
  const configFiles = ['package.json', 'tsconfig.json', '.eslintrc', '.prettierrc', 'webpack.config.js'];
  if (configFiles.includes(filePath)) {
    riskScore += 15;
    details.push('Configuration file — high impact');
    recommendations.push('Backup config before modifying');
  }

  // Determine risk level
  let riskLevel: BlastRadiusResult['riskLevel'];
  if (riskScore >= 60) {
    riskLevel = 'CRITICAL';
  } else if (riskScore >= 40) {
    riskLevel = 'HIGH';
  } else if (riskScore >= 20) {
    riskLevel = 'MEDIUM';
  } else {
    riskLevel = 'LOW';
  }

  // Generate recommendations
  if (riskLevel === 'CRITICAL') {
    recommendations.push('⚠️ CRITICAL: Get code review before merging');
    recommendations.push('Run full test suite after changes');
  } else if (riskLevel === 'HIGH') {
    recommendations.push('⚠️ HIGH: Verify changes with targeted tests');
    recommendations.push('Consider git blame to understand file history');
  }

  return {
    affectedFiles: 1,
    affectedPaths: [filePath],
    riskLevel,
    riskScore: Math.min(riskScore, 100),
    details: details.join('\n'),
    recommendations,
  };
}

/**
 * Simple glob pattern matching (supports * and **)
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, '___DOUBLE_STAR___')
    .replace(/\*/g, '___STAR___')
    .replace(/___DOUBLE_STAR___/g, '.*')
    .replace(/___STAR___/g, '[^/]*')
    .replace(/\./g, '\\.')
    .replace(/\?/g, '[^/]');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}
