import * as fs from 'fs/promises';
import * as path from 'path';

export interface EpisodicMemory {
  id: string;
  type: 'reflexion' | 'finding' | 'decision' | 'error' | 'success';
  story_id?: string;
  summary: string;
  details: string;
  tags: string[];
  created_at: string;
}

export class ProjectMemory {
  private episodes: EpisodicMemory[] = [];
  private memoryDir: string;

  constructor(baseDir: string) {
    this.memoryDir = path.join(baseDir, 'memory', 'episodic');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
  }

  async record(episode: Omit<EpisodicMemory, 'id' | 'created_at'>): Promise<EpisodicMemory> {
    const entry: EpisodicMemory = {
      ...episode,
      id: `ep-${new Date().toISOString().slice(0, 10)}-${this.episodes.length + 1}`,
      created_at: new Date().toISOString(),
    };
    this.episodes.push(entry);
    await this.persist(entry);
    return entry;
  }

  async search(query: string, limit: number = 5): Promise<EpisodicMemory[]> {
    const q = query.toLowerCase();
    return this.episodes
      .filter(e =>
        e.summary.toLowerCase().includes(q) ||
        e.details.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      )
      .slice(-limit);
  }

  async getByStory(storyId: string): Promise<EpisodicMemory[]> {
    return this.episodes.filter(e => e.story_id === storyId);
  }

  async getRecent(n: number = 10): Promise<EpisodicMemory[]> {
    return this.episodes.slice(-n);
  }

  async getAll(): Promise<EpisodicMemory[]> {
    return [...this.episodes];
  }

  private async persist(entry: EpisodicMemory): Promise<void> {
    const filePath = path.join(this.memoryDir, `${entry.id}.md`);
    const content = [
      `# ${entry.type}: ${entry.summary}`,
      ``,
      `**ID:** ${entry.id}`,
      `**Type:** ${entry.type}`,
      entry.story_id ? `**Story:** ${entry.story_id}` : '',
      `**Date:** ${entry.created_at}`,
      `**Tags:** ${entry.tags.join(', ')}`,
      ``,
      entry.details,
      ``,
    ].filter(Boolean).join('\n');
    await fs.writeFile(filePath, content, 'utf8');
  }

  async loadAll(): Promise<void> {
    try {
      const files = await fs.readdir(this.memoryDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = await fs.readFile(path.join(this.memoryDir, file), 'utf8');
          const episode = this.parseEpisode(content);
          if (episode) {
            this.episodes.push(episode);
          }
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  private parseEpisode(content: string): EpisodicMemory | null {
    try {
      const lines = content.split('\n');
      const firstLine = lines[0];
      const typeMatch = firstLine?.match(/^# (\w+): (.+)/);
      if (!typeMatch) return null;

      const idMatch = content.match(/\*\*ID:\*\* (.+)/);
      const storyMatch = content.match(/\*\*Story:\*\* (.+)/);
      const dateMatch = content.match(/\*\*Date:\*\* (.+)/);
      const tagsMatch = content.match(/\*\*Tags:\*\* (.+)/);

      const detailsStart = content.indexOf('\n\n', content.indexOf('\n\n') + 1);
      const details = detailsStart > 0 ? content.slice(detailsStart + 2).trim() : '';

      return {
        id: idMatch?.[1] || `ep-${Date.now()}`,
        type: typeMatch[1]?.toLowerCase() as EpisodicMemory['type'] || 'reflexion',
        story_id: storyMatch?.[1],
        summary: typeMatch[2] || '',
        details,
        tags: tagsMatch?.[1]?.split(', ').filter(Boolean) || [],
        created_at: dateMatch?.[1] || new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
