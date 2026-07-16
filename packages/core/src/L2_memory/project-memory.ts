import * as fs from 'fs/promises';
import * as path from 'path';
// R10 第9轮 (D14)：接入向量记忆——ruflo HNSW 思路落地
import type { VectorStore } from './stores';

export interface EpisodicMemory {
  id: string;
  type: 'reflexion' | 'finding' | 'decision' | 'error' | 'success';
  story_id?: string;
  summary: string;
  details: string;
  tags: string[];
  created_at: string;
}

/**
 * R10 第9轮 (D14)：ProjectMemory 可选配置。
 *
 * - `vectorStore`：若提供，每条 episodic memory 写入时同步索引到向量存储，
 *   支持基于语义相似度的检索（替代纯字符串 substring 匹配）。
 *   借鉴 ruflo AgentDB：历史推理可被向量召回复用，减少重复 LLM 推理。
 */
export interface ProjectMemoryOptions {
  /** 向量存储实例（可选）。提供后 record() 会同步 upsert，searchVector() 可用 */
  vectorStore?: VectorStore;
}

export class ProjectMemory {
  private episodes: EpisodicMemory[] = [];
  private memoryDir: string;
  /** R10 第9轮 (D14)：可选向量索引，支持语义检索 */
  private vectorStore: VectorStore | null;

  constructor(baseDir: string, options: ProjectMemoryOptions = {}) {
    this.memoryDir = path.join(baseDir, 'memory', 'episodic');
    this.vectorStore = options.vectorStore ?? null;
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
    // R10 第9轮 (D14)：同步索引到向量存储，便于后续语义检索
    if (this.vectorStore) {
      try {
        const doc = `${entry.summary}\n${entry.details}\n${entry.tags.join(' ')}`;
        this.vectorStore.upsert(`episodic:${entry.id}`, doc);
      } catch {
        /* best-effort：向量索引失败不阻断记忆写入 */
      }
    }
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

  /**
   * R10 第9轮 (D14)：基于语义相似度检索历史 episodic memory。
   *
   * 借鉴 ruflo AgentDB：跨会话/跨 story 复用历史推理。
   * 调用方传入自然语言 query（如当前 stage + story 标题），
   * 返回 top-K 最相关的 episodic memory 条目。
   *
   * 若未配置 vectorStore，回退到字符串 search()，保证向后兼容。
   *
   * @param query  自然语言查询（如 "build story-001 implementation context"）
   * @param k      返回条数上限（默认 5）
   * @returns 按 similarity 降序排列的 episodic memory 列表
   */
  async searchVector(query: string, k: number = 5): Promise<EpisodicMemory[]> {
    if (!this.vectorStore) {
      // 回退到字符串搜索
      return this.search(query, k);
    }
    try {
      const results = this.vectorStore.search(query, k);
      if (results.length === 0) return [];
      // 从结果 key（格式：episodic:<id>）解析回 episode id
      const ids = results
        .map((r) => {
          const m = r.key.match(/^episodic:(.+)$/);
          return m ? m[1] : null;
        })
        .filter((x): x is string => x !== null);
      // 按 similarity 顺序从内存 episodes 中查找
      const byId = new Map(this.episodes.map((e) => [e.id, e]));
      const out: EpisodicMemory[] = [];
      for (const id of ids) {
        const ep = byId.get(id);
        if (ep) out.push(ep);
      }
      return out;
    } catch {
      // 向量检索异常时回退到字符串搜索
      return this.search(query, k);
    }
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
    // R10 第9轮 (D14)：加载完成后重建向量索引，确保 searchVector 可用
    if (this.vectorStore && this.episodes.length > 0) {
      for (const ep of this.episodes) {
        try {
          const doc = `${ep.summary}\n${ep.details}\n${ep.tags.join(' ')}`;
          this.vectorStore.upsert(`episodic:${ep.id}`, doc);
        } catch {
          /* best-effort：单条索引失败不阻断整体加载 */
        }
      }
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
