import * as fs from 'fs/promises';
import * as path from 'path';
import type { Stage } from '../L7_loop/state-machine';

/**
 * Turn classification — AI classifies request complexity before entering full task mode.
 * Inspired by Trellis's consent gate.
 */
export type TurnType = 'inline' | 'research' | 'task' | 'complex' | 'critical';

export interface TurnClassification {
  turnType: TurnType;
  complexity: 'low' | 'medium' | 'high' | 'critical';
  requiresConsent: boolean;
  recommendedTools: string[];
  estimatedTokens: number;
  description: string;
}

/**
 * Classify a user request to determine the appropriate workflow.
 */
export function classifyTurn(
  request: string,
  currentStage: Stage,
  context: string = '',
): TurnClassification {
  const lower = request.toLowerCase();

  // Critical: security concerns, production issues
  if (/\bsecurity|vulnerability|breach|leak|exploit|critical|emergency\b/i.test(request)) {
    return {
      turnType: 'critical',
      complexity: 'critical',
      requiresConsent: true,
      recommendedTools: ['aza_security_scan', 'aza_quality_check', 'aza_loop_stop'],
      estimatedTokens: 5000,
      description: 'Critical request detected — security or production issue. Full workflow with human gate.',
    };
  }

  // Complex: multi-file changes, architecture changes
  if (/\barchitecture|refactor|migrate|restructure|multiple.*file|several.*component\b/i.test(request)) {
    return {
      turnType: 'complex',
      complexity: 'high',
      requiresConsent: true,
      recommendedTools: ['aza_task_design', 'aza_dag', 'aza_loop_next'],
      estimatedTokens: 10000,
      description: 'Complex request detected — multi-file or architectural change. Full workflow with consent gate.',
    };
  }

  // Task: new feature, bug fix, implementation
  if (/\bimplement|fix|add.*feature|create.*function|write.*code|develop|build\b/i.test(request)) {
    return {
      turnType: 'task',
      complexity: 'medium',
      requiresConsent: currentStage === 'open' || currentStage === 'design',
      recommendedTools: ['aza_task_implement', 'aza_quality_check', 'aza_loop_next'],
      estimatedTokens: 3000,
      description: 'Task request — implementation or fix. Standard workflow.',
    };
  }

  // Research: investigation, analysis, documentation
  if (/\bresearch|analyze|document|explain|understand|investigate|review\b/i.test(request)) {
    return {
      turnType: 'research',
      complexity: 'low',
      requiresConsent: false,
      recommendedTools: ['aza_memory_query', 'aza_prd_validate', 'aza_security_scan'],
      estimatedTokens: 1000,
      description: 'Research request — investigation or analysis. Inline workflow.',
    };
  }

  // Inline: quick question, status check, simple command
  return {
    turnType: 'inline',
    complexity: 'low',
    requiresConsent: false,
    recommendedTools: ['aza_context_status', 'aza_loop_status', 'aza_health'],
    estimatedTokens: 500,
    description: 'Simple request — status check or quick question. Inline workflow.',
  };
}

/**
 * Generate a curated context manifest for a stage.
 * Inspired by Trellis's implement.jsonl / check.jsonl pattern.
 * References spec + research paths, never source paths.
 */
export interface ContextManifestEntry {
  type: 'spec' | 'research' | 'convention' | 'journal' | 'memory';
  path: string;
  priority: number; // 0-1
  description: string;
  tokenEstimate: number;
}

export interface ContextManifest {
  stage: Stage;
  entries: ContextManifestEntry[];
  totalTokens: number;
  curated: boolean;
}

/**
 * Generate a curated context manifest for a stage.
 * Only references spec + research paths, not source paths.
 */
export function generateCuratedManifest(
  stage: Stage,
  azaDir: string,
  projectRoot: string,
): ContextManifest {
  const entries: ContextManifestEntry[] = [];

  // Always include spec documents
  entries.push({
    type: 'spec',
    path: path.join(azaDir, 'prd.json'),
    priority: 0.9,
    description: 'PRD specification',
    tokenEstimate: 2000,
  });

  // Include design documents
  entries.push({
    type: 'spec',
    path: path.join(azaDir, 'design.md'),
    priority: 0.8,
    description: 'Design document',
    tokenEstimate: 1500,
  });

  // Include conventions
  entries.push({
    type: 'convention',
    path: path.join(azaDir, 'spec-conventions', 'conventions.jsonl'),
    priority: 0.7,
    description: 'Learned conventions',
    tokenEstimate: 500,
  });

  // Include developer journal for session recall
  entries.push({
    type: 'journal',
    path: path.join(azaDir, 'workspace', 'default', 'journal.md'),
    priority: 0.6,
    description: 'Developer journal',
    tokenEstimate: 300,
  });

  // Stage-specific entries
  if (stage === 'build' || stage === 'verify') {
    entries.push({
      type: 'research',
      path: path.join(azaDir, 'implement.jsonl'),
      priority: 0.8,
      description: 'Implementation context',
      tokenEstimate: 1000,
    });
    entries.push({
      type: 'research',
      path: path.join(azaDir, 'check.jsonl'),
      priority: 0.8,
      description: 'Verification context',
      tokenEstimate: 1000,
    });
  }

  // Memory entries
  entries.push({
    type: 'memory',
    path: path.join(azaDir, 'memory.jsonl'),
    priority: 0.5,
    description: 'Project memory',
    tokenEstimate: 500,
  });

  return {
    stage,
    entries,
    totalTokens: entries.reduce((s, e) => s + e.tokenEstimate, 0),
    curated: true,
  };
}

/**
 * Save the curated manifest to a JSONL file.
 */
export async function saveCuratedManifest(
  azaDir: string,
  stage: Stage,
  manifest: ContextManifest,
): Promise<void> {
  const manifestDir = path.join(azaDir, 'manifests');
  await fs.mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `${stage}.jsonl`);
  const lines = manifest.entries.map(e => JSON.stringify(e));
  await fs.writeFile(manifestPath, lines.join('\n') + '\n', 'utf8');
}

/**
 * Load a curated manifest for a stage.
 */
export async function loadCuratedManifest(
  azaDir: string,
  stage: Stage,
): Promise<ContextManifest | null> {
  const manifestPath = path.join(azaDir, 'manifests', `${stage}.jsonl`);
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    const entries: ContextManifestEntry[] = [];
    for (const line of content.split('\n')) {
      if (line.trim()) {
        entries.push(JSON.parse(line) as ContextManifestEntry);
      }
    }
    return {
      stage,
      entries,
      totalTokens: entries.reduce((s, e) => s + e.tokenEstimate, 0),
      curated: true,
    };
  } catch {
    return null;
  }
}
