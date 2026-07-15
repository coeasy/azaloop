import {
  ContextInjector,
  StateManager,
  ensureConstitution,
  readConstitution,
  readPlanMd,
  writePlanMd,
} from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

export async function handleContextCalibrate(workspacePath?: string): Promise<LoopResponse> {
  const root = workspacePath ?? process.cwd();
  const azaDir = path.join(root, '.aza');
  const contextInjector = new ContextInjector(azaDir);
  // Seed constitution + plan for crash-proof continuity (spec-kit / planning-with-files)
  let constitutionExcerpt = '';
  let planMd: string | null = null;
  try {
    ensureConstitution(root);
    constitutionExcerpt = readConstitution(root).split('\n').slice(0, 16).join('\n');
    planMd = readPlanMd(root);
    if (!planMd) {
      writePlanMd(root, {
        title: 'AzaLoop session',
        stage: 'open',
        next: 'aza_prd(review) → approve → aza_loop(full)',
      });
      planMd = readPlanMd(root);
    }
  } catch {
    /* best-effort */
  }
  // Load STATE.yaml if it exists for session recovery — return digest only
  let stage = 'open';
  let iteration = 0;
  let progress = '0%';
  let hasState = false;
  let client = 'unknown';
  let model = 'unknown';
  let blocked = false;
  try {
    const stateManager = new StateManager(azaDir);
    await stateManager.load();
    const stateData = stateManager.getState();
    hasState = true;
    const stages = stateData?.pipeline?.stages || {};
    const order = ['open', 'design', 'build', 'verify', 'archive'] as const;
    for (const s of order) {
      if ((stages as any)[s]?.status === 'blocked') {
        stage = s;
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      for (const s of order) {
        if ((stages as any)[s]?.status === 'in_progress') {
          stage = s;
          break;
        }
      }
      if (stage === 'open' && stateData?.pipeline?.current_stage) {
        stage = stateData.pipeline.current_stage;
      }
    }
    iteration = stateData?.loop?.iteration || 0;
    progress = stateData?.loop?.progress || '0%';
    client = stateData?.loop?.client || 'unknown';
    model = stateData?.loop?.model || 'unknown';
  } catch { /* STATE.yaml doesn't exist yet */ }

  const context = contextInjector.calibrate(stage);
  return {
    success: true,
    data: {
      client: client !== 'unknown' ? client : (context as any).client,
      model: model !== 'unknown' ? model : (context as any).model,
      workspace: root,
      stage,
      iteration,
      progress,
      has_state: hasState,
      blocked,
      session_prompt: context.session_prompt,
      artifacts: context.artifacts,
      ledger_tail: context.ledger_tail,
      stage_context_tail: context.stage_context_tail,
      constitution_excerpt: constitutionExcerpt,
      plan_md_excerpt: planMd ? planMd.split('\n').slice(0, 20).join('\n') : null,
      token_hint: 'Prefer .aza artifacts over chat history; call aza_session(continue) for slim resume',
    },
    next_action: blocked
      ? { tool: 'aza_loop', action: 'reset', reason: `Stage ${stage} blocked — reset then full` }
      : stage === 'open' && !hasState
        ? { tool: 'aza_prd', action: 'review', reason: 'Open stage — review/approve PRD first' }
        : {
            tool: 'aza_loop',
            action: 'full',
            reason: hasState ? `Resuming from ${stage}` : 'Context loaded, ready to proceed',
          },
    metadata: {
      iteration,
      progress,
      stage,
    },
  };
}

export async function handleContextStatus(stateManager?: StateManager): Promise<LoopResponse> {
  if (!stateManager) {
    return {
      success: false,
      data: null,
      error: 'StateManager required',
      metadata: { iteration: 0, progress: '', stage: '' },
    };
  }
  const state = stateManager.getState();
  // Slim status — no full STATE dump into chat context
  return {
    success: true,
    data: {
      stage: state.pipeline.current_stage,
      iteration: state.loop.iteration,
      progress: state.loop.progress,
      story: state.loop.current_story,
      client: state.loop.client,
      model: state.loop.model,
      board: state.loops?.outer?.board,
      artifacts: ['.aza/STATE.yaml', '.aza/RESUME.md'],
    },
    metadata: { iteration: state.loop.iteration, progress: state.loop.progress, stage: state.pipeline.current_stage },
  };
}
