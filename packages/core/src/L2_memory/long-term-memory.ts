import * as fs from 'fs/promises';
import * as path from 'path';

export interface SemanticMemory {
  key: string;
  content: string;
  source: string;
  tags: string[];
  confidence: number;
  created_at: string;
  updated_at: string;
}

export class LongTermMemory {
  private memories: Map<string, SemanticMemory> = new Map();
  private memoryDir: string;

  constructor(baseDir: string) {
    this.memoryDir = path.join(baseDir, 'memory', 'semantic');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    await this.loadAll();
  }

  async store(key: string, content: string, source: string, tags: string[] = [], confidence: number = 1.0): Promise<SemanticMemory> {
    const now = new Date().toISOString();
    const existing = this.memories.get(key);
    const memory: SemanticMemory = {
      key,
      content,
      source,
      tags,
      confidence: existing ? Math.min(1, existing.confidence + 0.1) : confidence,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    this.memories.set(key, memory);
    await this.persist(memory);
    return memory;
  }

  async retrieve(key: string): Promise<SemanticMemory | undefined> {
    return this.memories.get(key);
  }

  async search(query: string, limit: number = 5): Promise<SemanticMemory[]> {
    const q = query.toLowerCase();
    const results: SemanticMemory[] = [];
    for (const memory of this.memories.values()) {
      if (memory.key.toLowerCase().includes(q) ||
          memory.content.toLowerCase().includes(q) ||
          memory.tags.some(t => t.toLowerCase().includes(q))) {
        results.push(memory);
      }
    }
    return results
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  async getByTag(tag: string): Promise<SemanticMemory[]> {
    return Array.from(this.memories.values())
      .filter(m => m.tags.includes(tag))
      .sort((a, b) => b.confidence - a.confidence);
  }

  async getAll(): Promise<SemanticMemory[]> {
    return Array.from(this.memories.values());
  }

  private async persist(memory: SemanticMemory): Promise<void> {
    const filePath = path.join(this.memoryDir, `${memory.key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    await fs.writeFile(filePath, JSON.stringify(memory, null, 2), 'utf8');
  }

  private async loadAll(): Promise<void> {
    try {
      const files = await fs.readdir(this.memoryDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.memoryDir, file), 'utf8');
          const memory = JSON.parse(content) as SemanticMemory;
          this.memories.set(memory.key, memory);
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }
}
