import { SkillRegistry } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';

const registry = new SkillRegistry();

export async function handleSkillSearch(query: string): Promise<LoopResponse> {
  const results = registry.search(query);
  return {
    success: true,
    data: results,
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}

export async function handleSkillList(type?: string): Promise<LoopResponse> {
  const skills = type
    ? registry.listByType(type as any)
    : registry.getAll();
  return {
    success: true,
    data: skills,
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}
