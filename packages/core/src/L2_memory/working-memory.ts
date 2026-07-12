export interface WorkingMemoryEntry {
  key: string;
  value: unknown;
  ttl?: number;
  created_at: string;
}

export class WorkingMemory {
  private entries: Map<string, WorkingMemoryEntry> = new Map();

  set(key: string, value: unknown, ttl?: number): void {
    this.entries.set(key, {
      key,
      value,
      ttl,
      created_at: new Date().toISOString(),
    });
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.ttl) {
      const age = Date.now() - new Date(entry.created_at).getTime();
      if (age > entry.ttl) {
        this.entries.delete(key);
        return undefined;
      }
    }
    return entry.value as T;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  getAll(): Map<string, WorkingMemoryEntry> {
    return new Map(this.entries);
  }

  keys(): string[] {
    return Array.from(this.entries.keys());
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of this.entries) {
      result[key] = entry.value;
    }
    return result;
  }
}
