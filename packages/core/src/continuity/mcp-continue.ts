import { StateManager } from '../state/state-manager';
import { ResumeGenerator, type ResumeData } from './resume-generator';

export interface MCPContinueResult {
  resumed: boolean;
  resume?: ResumeData;
  message: string;
}

export class MCPContinueService {
  private stateManager: StateManager;
  private resumeGenerator: ResumeGenerator;

  constructor(stateManager: StateManager, resumeGenerator: ResumeGenerator) {
    this.stateManager = stateManager;
    this.resumeGenerator = resumeGenerator;
  }

  async continue(extra?: Partial<ResumeData>): Promise<MCPContinueResult> {
    const existingResume = await this.resumeGenerator.read();
    // STATE.yaml is authoritative — only carry forward client/model/errors from stale RESUME.
    const safeFromDisk: Partial<ResumeData> = {};
    if (existingResume?.client && existingResume.client !== 'unknown') {
      safeFromDisk.client = existingResume.client;
    }
    if (existingResume?.model && existingResume.model !== 'unknown') {
      safeFromDisk.model = existingResume.model;
    }
    if (existingResume?.errors_to_avoid?.length) {
      safeFromDisk.errors_to_avoid = existingResume.errors_to_avoid;
    }

    const resume = await this.resumeGenerator.generate(this.stateManager, {
      ...safeFromDisk,
      ...extra,
    });

    // Heal pipeline.current_stage + progress when they drifted from blocked/in_progress stages
    const state = this.stateManager.getState();
    const patch: Record<string, unknown> = {};
    if (resume.current_stage && resume.current_stage !== state.pipeline.current_stage) {
      patch.pipeline = {
        ...state.pipeline,
        current_stage: resume.current_stage as any,
      };
    }
    if (resume.progress && resume.progress !== state.loop.progress) {
      patch.loop = {
        ...state.loop,
        ...(patch.loop as object || {}),
        progress: resume.progress,
        client: resume.client || state.loop.client,
        model: resume.model || state.loop.model,
      };
    } else if (extra?.client || extra?.model) {
      patch.loop = {
        ...state.loop,
        client: resume.client || state.loop.client,
        model: resume.model || state.loop.model,
      };
    }
    if (Object.keys(patch).length > 0) {
      await this.stateManager.update(patch as any);
    }

    return {
      resumed: !!existingResume,
      resume,
      message: `Resuming from stage "${resume.current_stage}", iteration ${resume.iteration}, progress ${resume.progress}`,
    };
  }

  async checkpoint(story?: string): Promise<void> {
    const state = this.stateManager.getState();
    await this.stateManager.update({
      loop: {
        ...state.loop,
        current_story: story || state.loop.current_story,
      },
    });
    await this.resumeGenerator.generate(this.stateManager, {
      current_story: story || state.loop.current_story,
    });
  }

  async complete(): Promise<void> {
    await this.resumeGenerator.clear();
  }
}
