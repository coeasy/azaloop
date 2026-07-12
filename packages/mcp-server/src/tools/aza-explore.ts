import * as fs from 'fs';
import * as path from 'path';
import type { LoopResponse } from '@azaloop/shared';

/**
 * Explore mode — think before you commit.
 *
 * Borrows from OpenSpec's "explore → propose" pattern:
 * the agent reads the codebase, weighs options, and outputs
 * recommendations WITHOUT writing any code.
 *
 * This tool is called BEFORE `aza_prd_generate` to form an
 * `explore → propose` chain.
 */

export interface ExploreResult {
  /** What was analyzed */
  target: string;
  /** Current state summary */
  current_state: string;
  /** Discovered files and their roles */
  files_analyzed: string[];
  /** Weighed options with pros/cons */
  options: ExploreOption[];
  /** Recommended approach */
  recommendation: string;
  /** Risks identified */
  risks: string[];
  /** Estimated effort (low/medium/high) */
  effort: 'low' | 'medium' | 'high';
}

export interface ExploreOption {
  name: string;
  description: string;
  pros: string[];
  cons: string[];
  score: number; // 0-100
}

/**
 * Analyze a workspace to understand current architecture and recommend approaches.
 */
export function exploreWorkspace(
  workspacePath: string,
  focus?: string,
): ExploreResult {
  const root = workspacePath || process.cwd();
  const filesAnalyzed: string[] = [];
  const risks: string[] = [];

  // 1. Detect project type from manifest files
  const projectType = detectProjectType(root, filesAnalyzed);

  // 2. Analyze directory structure
  const structure = analyzeStructure(root, filesAnalyzed);

  // 3. Check for existing tests, CI, docs
  const hasTests = checkForPattern(root, /\.(test|spec)\.(ts|js|tsx|jsx)$/, filesAnalyzed);
  const hasCI = fs.existsSync(path.join(root, '.github', 'workflows')) ||
    fs.existsSync(path.join(root, '.gitlab-ci.yml'));
  const hasDocs = fs.existsSync(path.join(root, 'README.md')) ||
    fs.existsSync(path.join(root, 'docs'));

  // 4. Build options based on findings
  const options = buildOptions(projectType, structure, hasTests, hasCI, hasDocs, focus);

  // 5. Identify risks
  if (!hasTests) risks.push('No test infrastructure detected — changes may introduce regressions');
  if (!hasCI) risks.push('No CI/CD pipeline detected — manual deployment risk');
  if (!hasDocs) risks.push('No documentation detected — onboarding and maintenance risk');
  if (structure.fileCount > 100) risks.push(`Large codebase (${structure.fileCount} files) — blast radius is high`);

  // 6. Generate recommendation
  const bestOption = options.reduce((best, opt) => opt.score > best.score ? opt : best, options[0]!);

  return {
    target: focus || 'full workspace',
    current_state: `${projectType} project with ${structure.fileCount} files, ${structure.dirCount} directories. Tests: ${hasTests ? 'yes' : 'no'}, CI: ${hasCI ? 'yes' : 'no'}, Docs: ${hasDocs ? 'yes' : 'no'}.`,
    files_analyzed: filesAnalyzed.slice(0, 50),
    options,
    recommendation: bestOption.name + ': ' + bestOption.description,
    risks,
    effort: structure.fileCount > 100 ? 'high' : structure.fileCount > 20 ? 'medium' : 'low',
  };
}

function detectProjectType(root: string, filesAnalyzed: string[]): string {
  const checks: [string, string][] = [
    ['package.json', 'Node.js/TypeScript'],
    ['Cargo.toml', 'Rust'],
    ['go.mod', 'Go'],
    ['pyproject.toml', 'Python'],
    ['pom.xml', 'Java (Maven)'],
    ['build.gradle', 'Java (Gradle)'],
    ['Gemfile', 'Ruby'],
  ];
  for (const [file, type] of checks) {
    const p = path.join(root, file);
    if (fs.existsSync(p)) {
      filesAnalyzed.push(file);
      return type;
    }
  }
  return 'Unknown';
}

function analyzeStructure(root: string, filesAnalyzed: string[]): { fileCount: number; dirCount: number; topLevelDirs: string[] } {
  let fileCount = 0;
  let dirCount = 0;
  const topLevelDirs: string[] = [];

  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        dirCount++;
        topLevelDirs.push(entry.name);
        fileCount += countFiles(path.join(root, entry.name));
      } else {
        fileCount++;
        filesAnalyzed.push(entry.name);
      }
    }
  } catch { /* ignore */ }

  return { fileCount, dirCount, topLevelDirs };
}

function countFiles(dir: string): number {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        count += countFiles(path.join(dir, entry.name));
      } else {
        count++;
      }
    }
  } catch { /* ignore */ }
  return count;
}

function checkForPattern(root: string, pattern: RegExp, filesAnalyzed: string[]): boolean {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isFile() && pattern.test(entry.name)) {
        filesAnalyzed.push(entry.name);
        return true;
      }
      if (entry.isDirectory()) {
        if (checkForPattern(path.join(root, entry.name), pattern, filesAnalyzed)) return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

function buildOptions(
  projectType: string,
  structure: { fileCount: number; topLevelDirs: string[] },
  hasTests: boolean,
  hasCI: boolean,
  hasDocs: boolean,
  focus?: string,
): ExploreOption[] {
  const options: ExploreOption[] = [];

  // Option 1: Incremental improvement
  const incrementalScore = 70 +
    (hasTests ? 10 : -10) +
    (hasCI ? 5 : -5) +
    (structure.fileCount < 50 ? 10 : -10);

  options.push({
    name: 'Incremental Improvement',
    description: `Make targeted improvements to the ${focus || 'project'} without restructuring. Best for stable codebases.`,
    pros: ['Low risk', 'Fast delivery', 'Minimal disruption'],
    cons: ['May accumulate tech debt', 'Limited scope'],
    score: Math.max(0, Math.min(100, incrementalScore)),
  });

  // Option 2: Architecture refactor
  const refactorScore = 50 +
    (structure.fileCount > 50 ? 20 : -10) +
    (hasTests ? 15 : -20) +
    (!hasDocs ? 10 : 0);

  options.push({
    name: 'Architecture Refactor',
    description: `Restructure the ${projectType} project for better maintainability. Recommended for codebases >50 files.`,
    pros: ['Reduces tech debt', 'Improves maintainability', 'Better testability'],
    cons: ['Higher risk', 'Longer timeline', 'Requires comprehensive tests'],
    score: Math.max(0, Math.min(100, refactorScore)),
  });

  // Option 3: Full rewrite
  const rewriteScore = 30 +
    (structure.fileCount > 200 ? 30 : -20) +
    (hasTests ? 10 : -15) +
    (hasCI ? 10 : -10);

  options.push({
    name: 'Greenfield Rewrite',
    description: `Rewrite the ${focus || 'project'} from scratch with modern patterns. Only for severely legacy codebases.`,
    pros: ['Clean slate', 'Modern patterns', 'No legacy constraints'],
    cons: ['Highest risk', 'Longest timeline', 'Feature regression risk'],
    score: Math.max(0, Math.min(100, rewriteScore)),
  });

  return options;
}

/**
 * MCP tool handler: Explore workspace before committing to a plan.
 */
export async function handleExplore(
  workspacePath?: string,
  focus?: string,
): Promise<LoopResponse> {
  const result = exploreWorkspace(workspacePath || process.cwd(), focus);

  const summary = [
    `## Explore: ${result.target}`,
    '',
    `**Current State:** ${result.current_state}`,
    '',
    '### Options',
    ...result.options.map(opt =>
      `**${opt.name}** (score: ${opt.score}/100)\n  ${opt.description}\n  ✅ ${opt.pros.join(', ')}\n  ❌ ${opt.cons.join(', ')}`
    ),
    '',
    `### Recommendation: ${result.recommendation}`,
    '',
    `### Risks`,
    ...result.risks.map(r => `- ${r}`),
    '',
    `**Effort Estimate:** ${result.effort}`,
    '',
    `Files analyzed: ${result.files_analyzed.length}`,
  ].join('\n');

  return {
    success: true,
    data: {
      explore: result,
      summary,
    },
    metadata: {
      iteration: 0,
      progress: 'explore_complete',
      stage: 'open',
    },
  };
}
