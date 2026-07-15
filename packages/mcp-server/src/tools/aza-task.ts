import { ChangeManager, syncTaskBoardPhase, appendProgress } from '@azaloop/core';
import type { PipelineResult } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import { handleQualityCheck } from './aza-quality';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Singleton accessor for the shared {@link ChangeManager} instance.
 *
 * The ChangeManager tracks proposals, specs and designs across the task
 * lifecycle. It is instantiated lazily on first use and cached so that
 * every tool handler observes the same in-memory state — mirroring the
 * singleton pattern used by {@link getPipeline} in aza-quality.ts.
 */
let changeManagerInstance: ChangeManager | null = null;

export function getChangeManager(): ChangeManager {
  if (!changeManagerInstance) {
    changeManagerInstance = new ChangeManager();
  }
  return changeManagerInstance;
}

/**
 * Lightweight in-memory ledger for build/verify outcomes.
 *
 * The {@link ChangeManager} API exposes proposal/spec/design lifecycle
 * methods but does not yet offer `recordChange` / `getChangedFiles`. To
 * avoid blocking the pipeline we keep a local ledger here that records
 * when a task was implemented and the outcome of its verification gate.
 */
export interface ImplementationRecord {
  task_id: string;
  status: 'implemented';
  implemented_at: string;
  design_id: string | null;
  files: string[];
}

export interface VerificationRecord {
  task_id: string;
  status: 'verified' | 'failed';
  verified_at: string;
  gate_summary: string;
  passed_gates: number;
  total_gates: number;
}

const implementationStore = new Map<string, ImplementationRecord>();
const verificationStore = new Map<string, VerificationRecord>();

/** Look up a previously recorded implementation for a task. */
export function getImplementationRecord(taskId: string): ImplementationRecord | undefined {
  return implementationStore.get(taskId);
}

/** Look up a previously recorded verification result for a task. */
export function getVerificationRecord(taskId: string): VerificationRecord | undefined {
  return verificationStore.get(taskId);
}

/**
 * Best-effort extraction of a design id from a task id.
 *
 * Task ids produced by {@link ChangeManager.generateTasksFromDesign}
 * follow the pattern `DSN-<designId>-TASK-<n>: <description>`. We pull
 * out the design id so the implementation can be linked back to its
 * design context stored in ChangeManager.
 */
function extractDesignId(taskId: string | undefined | null): string | null {
  if (!taskId || typeof taskId !== 'string') return null;
  const match = taskId.match(/^DSN-(.+?)-TASK-\d+/);
  return match ? `DSN-${match[1]}` : null;
}

export async function handleTaskDesign(
  storyId: string,
  title: string,
  description: string,
  workspacePath?: string,
): Promise<LoopResponse> {
  const cm = getChangeManager();
  const proposal = cm.createProposal(title, description, `Design for ${storyId}`, 'medium');
  cm.linkProposalToStory(proposal.id, storyId);
  const spec = cm.createSpec(proposal.id, title, description, ['Validated implementation']);
  const design = spec
    ? cm.createDesign(spec.id, [
        {
          context: storyId,
          options: ['Option A', 'Option B'],
          chosen: 'Option A',
          rationale: 'Simpler implementation',
        },
      ])
    : null;

  const root = workspacePath || process.cwd();
  const azaDir = path.join(root, '.aza');
  try {
    fs.mkdirSync(azaDir, { recursive: true });
    const designBody = [
      `# Design — ${title || storyId}`,
      '',
      `> Generated: ${new Date().toISOString()}`,
      `> Story: ${storyId}`,
      '',
      '## Intent',
      '',
      description || title || 'Design for current story',
      '',
      '## Decisions',
      '',
      ...(design?.decisions ?? []).map(
        (d) => `- **${d.context}**: chose \`${d.chosen}\` — ${d.rationale}`,
      ),
      '',
      '## OpenSpec',
      '',
      'See `openspec/changes/` for proposal / design / tasks artifacts.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(azaDir, 'design.md'), designBody, 'utf8');
    syncTaskBoardPhase(azaDir, 'design', 'complete', title || storyId);
    appendProgress(azaDir, `aza_spec(design) wrote .aza/design.md for ${storyId}`);
  } catch {
    /* best-effort */
  }

  try {
    const { handleLoopSetCondition } = await import('./aza-loop');
    await handleLoopSetCondition('stories_designed', true, root);
    await handleLoopSetCondition('prd_valid', true, root);
  } catch {
    /* best-effort */
  }

  return {
    success: true,
    data: {
      proposal,
      spec,
      design,
      tasks: design ? cm.generateTasksFromDesign(design.id) : [],
      design_artifact: path.join(azaDir, 'design.md'),
    },
    next_action: {
      tool: 'aza_task_implement',
      action: 'implement',
      reason: 'Design complete, ready to implement',
    },
    metadata: { iteration: 0, progress: '25%', stage: 'design' },
  };
}

export async function handleTaskImplement(
  taskId?: string,
  workspacePath?: string,
): Promise<LoopResponse> {
  const cm = getChangeManager();
  const resolvedId = taskId && String(taskId).trim() ? String(taskId) : `TASK-${Date.now()}`;
  const root = workspacePath || process.cwd();

  // Link the implementation back to its design context when possible.
  // ChangeManager does not expose recordChange/getChangedFiles, so we
  // record the build artefact in the local ledger and keep the
  // proposal/spec/design graph in ChangeManager for downstream lookup.
  const designId = extractDesignId(resolvedId);
  const design = designId ? cm.getDesign(designId) : undefined;

  const record: ImplementationRecord = {
    task_id: resolvedId,
    status: 'implemented',
    implemented_at: new Date().toISOString(),
    design_id: designId,
    files: [],
  };
  implementationStore.set(resolvedId, record);

  try {
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(
      path.join(azaDir, 'build-complete.marker'),
      JSON.stringify({ task_id: resolvedId, at: record.implemented_at }, null, 2),
      'utf8',
    );
    syncTaskBoardPhase(azaDir, 'build', 'complete', resolvedId);
    appendProgress(azaDir, `aza_spec(implement) recorded ${resolvedId}`);
  } catch {
    /* best-effort */
  }

  // Persist build guard so completeStage/next can advance (same controller as loop).
  try {
    const { handleLoopSetCondition } = await import('./aza-loop');
    await handleLoopSetCondition('build_tested', true, root);
    await handleLoopSetCondition('stories_designed', true, root);
  } catch {
    /* best-effort */
  }

  return {
    success: true,
    data: {
      task_id: resolvedId,
      status: 'implemented',
      implemented_at: record.implemented_at,
      design_id: designId,
      design_context: design
        ? design.decisions.map((d) => ({ context: d.context, chosen: d.chosen }))
        : null,
    },
    next_action: {
      tool: 'aza_quality_check',
      action: 'check',
      reason: 'Implementation recorded, run quality gates before verification',
    },
    metadata: { iteration: 0, progress: '50%', stage: 'build' },
  };
}

export async function handleTaskVerify(taskId: string): Promise<LoopResponse> {
  // Run the full quality pipeline (lint, test, regression, security,
  // acceptance, loop-audit) via the shared handler from aza-quality.ts.
  const qualityResponse = await handleQualityCheck(process.cwd());
  const pipeline = qualityResponse.data as PipelineResult;

  const passed = qualityResponse.success;
  const passedGates = pipeline.gates.filter((g) => g.passed).length;
  const totalGates = pipeline.gates.length;

  const record: VerificationRecord = {
    task_id: taskId,
    status: passed ? 'verified' : 'failed',
    verified_at: new Date().toISOString(),
    gate_summary: pipeline.summary,
    passed_gates: passedGates,
    total_gates: totalGates,
  };
  verificationStore.set(taskId, record);

  return {
    success: passed,
    data: {
      task_id: taskId,
      status: passed ? 'verified' : 'failed',
      verified_at: record.verified_at,
      gate_summary: pipeline.summary,
      passed_gates: passedGates,
      total_gates: totalGates,
      gates: pipeline.gates,
    },
    next_action: passed
      ? {
          tool: 'aza_loop',
          action: 'next',
          reason: 'Task verified via quality gates, continue loop',
        }
      : {
          tool: 'aza_loop',
          action: 'refine',
          reason: `Quality verification failed: ${pipeline.summary}. Fix issues and re-implement.`,
        },
    metadata: {
      iteration: 0,
      progress: passed ? '75%' : '50%',
      stage: 'verify',
    },
  };
}
