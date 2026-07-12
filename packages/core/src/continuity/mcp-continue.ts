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

    if (existingResume) {
      const state = this.stateManager.getState();
      const resume = await this.resumeGenerator.generate(this.stateManager, {
        ...existingResume,
        ...extra,
      });
      return {
        resumed: true,
        resume,
        message: `Resuming from stage "${resume.current_stage}", iteration ${resume.iteration}, progress ${resume.progress}`,
      };
    }

    const resume = await this.resumeGenerator.generate(this.stateManager, extra);
    return {
      resumed: false,
      resume,
      message: `Starting new session at stage "${resume.current_stage}"`,
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
