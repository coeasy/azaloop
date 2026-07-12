import { ProjectMemory, LongTermMemory } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';

let projectMemory: ProjectMemory | null = null;
let longTermMemory: LongTermMemory | null = null;

function ensureMemory(baseDir?: string) {
  if (!projectMemory) {
    projectMemory = new ProjectMemory(baseDir || '.aza');
    projectMemory.init();
  }
  if (!longTermMemory) {
    longTermMemory = new LongTermMemory(baseDir || '.aza');
    longTermMemory.init();
  }
  return { projectMemory, longTermMemory };
}

export async function handleMemoryQuery(query: string, baseDir?: string): Promise<LoopResponse> {
  const { projectMemory, longTermMemory } = ensureMemory(baseDir);
  const episodic = await projectMemory.search(query);
  const semantic = await longTermMemory.search(query);
  return {
    success: true,
    data: { episodic, semantic },
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}

export async function handleMemoryRecord(type: string, summary: string, details: string, tags: string[], baseDir?: string): Promise<LoopResponse> {
  const { projectMemory } = ensureMemory(baseDir);
  const entry = await projectMemory.record({
    type: type as any,
    summary,
    details,
    tags,
  });
  return {
    success: true,
    data: entry,
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}
