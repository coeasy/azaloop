import { ProjectMemory, type EpisodicMemory } from './project-memory';
import { LongTermMemory } from './long-term-memory';

export interface CompressionResult {
  compressed: number;
  summaries: string[];
  semantic_stored: string[];
}

export class MemoryCompressor {
  private projectMemory: ProjectMemory;
  private longTermMemory: LongTermMemory;
  private threshold: number;

  constructor(projectMemory: ProjectMemory, longTermMemory: LongTermMemory, threshold: number = 50) {
    this.projectMemory = projectMemory;
    this.longTermMemory = longTermMemory;
    this.threshold = threshold;
  }

  async compressIfNeeded(): Promise<CompressionResult | null> {
    const allEpisodes = await this.projectMemory.getAll();
    if (allEpisodes.length < this.threshold) return null;

    return this.compress(allEpisodes);
  }

  async compress(episodes: EpisodicMemory[]): Promise<CompressionResult> {
    const byType = this.groupByType(episodes);
    const result: CompressionResult = { compressed: 0, summaries: [], semantic_stored: [] };

    for (const [type, group] of Object.entries(byType)) {
      if (group.length <= 3) continue;

      const summary = this.summarizeGroup(type, group);
      result.summaries.push(summary);

      const key = `compressed_${type}_${new Date().toISOString().slice(0, 10)}`;
      await this.longTermMemory.store(
        key,
        summary,
        'compression',
        [type, 'compressed'],
        0.7
      );
      result.semantic_stored.push(key);
    }

    return result;
  }

  private groupByType(episodes: EpisodicMemory[]): Record<string, EpisodicMemory[]> {
    const groups: Record<string, EpisodicMemory[]> = {};
    for (const ep of episodes) {
      const type = ep.type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(ep);
    }
    return groups;
  }

  private summarizeGroup(type: string, episodes: EpisodicMemory[]): string {
    const count = episodes.length;
    const summaries = episodes.slice(-5).map(e => e.summary);
    return `[Compressed] ${count} ${type} episodes. Recent: ${summaries.join('; ')}`;
  }
}
