import { StateManager } from '../state/state-manager';
import { ProjectMemory } from './project-memory';
import { LongTermMemory } from './long-term-memory';

export interface CatchupSummary {
  session_restored: boolean;
  current_stage: string;
  iteration: number;
  progress: string;
  client: string;
  model: string;
  recent_memories: number;
  relevant_experience: string[];
  errors_to_avoid: string[];
}

export class SessionCatchup {
  private stateManager: StateManager;
  private projectMemory: ProjectMemory;
  private longTermMemory: LongTermMemory;

  constructor(stateManager: StateManager, projectMemory: ProjectMemory, longTermMemory: LongTermMemory) {
    this.stateManager = stateManager;
    this.projectMemory = projectMemory;
    this.longTermMemory = longTermMemory;
  }

  async catchup(): Promise<CatchupSummary> {
    const state = this.stateManager.getState();

    const recentMemories = await this.projectMemory.getRecent(5);
    const errors = recentMemories.filter(m => m.type === 'error');
    const lastStory = state.loop.current_story;

    let relevantExperience: string[] = [];
    if (lastStory) {
      const semanticResults = await this.longTermMemory.search(lastStory, 3);
      relevantExperience = semanticResults.map(m => m.content);
    }

    return {
      session_restored: true,
      current_stage: state.pipeline.current_stage,
      iteration: state.loop.iteration,
      progress: state.loop.progress,
      client: state.loop.client,
      model: state.loop.model,
      recent_memories: recentMemories.length,
      relevant_experience: relevantExperience,
      errors_to_avoid: errors.map(e => e.summary),
    };
  }

  generateCatchupPrompt(summary: CatchupSummary): string {
    const lines = [
      '# Session Catch-up Summary',
      '',
      `Stage: ${summary.current_stage}`,
      `Iteration: ${summary.iteration}`,
      `Progress: ${summary.progress}`,
      `Client: ${summary.client}`,
      `Model: ${summary.model}`,
      '',
    ];

    if (summary.relevant_experience.length > 0) {
      lines.push('## Relevant Past Experience');
      for (const exp of summary.relevant_experience) {
        lines.push(`- ${exp}`);
      }
      lines.push('');
    }

    if (summary.errors_to_avoid.length > 0) {
      lines.push('## Previous Errors to Avoid');
      for (const err of summary.errors_to_avoid) {
        lines.push(`- ⚠ ${err}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
