import {
  ProjectMemory,
  LongTermMemory,
  ReasoningBank,
  episodeToReasoningInput,
  openVectorStore,
} from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

let projectMemory: ProjectMemory | null = null;
let longTermMemory: LongTermMemory | null = null;
let reasoningBank: ReasoningBank | null = null;
let memoryBase: string | null = null;

async function ensureMemory(baseDir?: string) {
  const root = baseDir || '.aza';
  const azaDir = root.endsWith('.aza') || root.endsWith(`${path.sep}.aza`)
    ? root
    : path.join(root, '.aza');

  if (!projectMemory || memoryBase !== azaDir) {
    memoryBase = azaDir;
    const vs = openVectorStore(azaDir);
    projectMemory = new ProjectMemory(azaDir, { vectorStore: vs });
    await projectMemory.init();
    await projectMemory.loadAll();
    longTermMemory = new LongTermMemory(azaDir);
    await longTermMemory.init();
    reasoningBank = new ReasoningBank(azaDir);
    await reasoningBank.init();
  }
  return { projectMemory: projectMemory!, longTermMemory: longTermMemory!, reasoningBank: reasoningBank!, azaDir };
}

export async function handleMemoryQuery(
  query: string,
  baseDir?: string,
  layer?: string,
): Promise<LoopResponse> {
  const { projectMemory, longTermMemory, reasoningBank } = await ensureMemory(baseDir);
  const q = query || '';
  const lyr = (layer || 'all').toLowerCase();
  const episodic = lyr === 'all' || lyr === 'episodic' ? await projectMemory.search(q) : [];
  const semantic = lyr === 'all' || lyr === 'semantic' ? await longTermMemory.search(q) : [];
  const reasoning = lyr === 'all' || lyr === 'reasoning' ? await reasoningBank.search(q) : [];
  return {
    success: true,
    data: { episodic, semantic, reasoning, layer: lyr },
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}

export async function handleMemoryRecord(
  type: string,
  summary: string,
  details: string,
  tags: string[],
  baseDir?: string,
): Promise<LoopResponse> {
  const { projectMemory, longTermMemory, reasoningBank } = await ensureMemory(baseDir);
  const entry = await projectMemory.record({
    type: type as any,
    summary,
    details,
    tags,
  });

  const wantReasoning =
    tags.some((t) => /reasoning|reflexion|decision|finding/i.test(t)) ||
    ['decision', 'finding', 'reflexion', 'success', 'error'].includes(type);

  let reasoning = null;
  if (wantReasoning) {
    reasoning = await reasoningBank.upsert(episodeToReasoningInput(summary, details, tags, type));
    try {
      await longTermMemory.store(
        `reasoning:${reasoning.id}`,
        `${reasoning.problem}\n${reasoning.steps.join('\n')}\noutcome=${reasoning.outcome}`,
        'reasoning-bank',
        reasoning.tags,
        reasoning.confidence,
      );
    } catch {
      /* best-effort semantic mirror */
    }
  }

  return {
    success: true,
    data: { entry, reasoning },
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}

export async function handleMemoryPromote(
  episodeId: string | undefined,
  baseDir?: string,
  summary?: string,
  details?: string,
  tags?: string[],
): Promise<LoopResponse> {
  const { projectMemory, longTermMemory, reasoningBank } = await ensureMemory(baseDir);
  let problem = summary || '';
  let body = details || '';
  let tagList = tags || ['reasoning', 'promoted'];

  if (episodeId) {
    const all = await projectMemory.getAll();
    const ep = all.find((e) => e.id === episodeId);
    if (ep) {
      problem = problem || ep.summary;
      body = body || ep.details;
      tagList = [...new Set([...tagList, ...ep.tags])];
    }
  }

  if (!problem) {
    return {
      success: false,
      error: 'promote requires episode_id or summary',
      data: null,
      metadata: { iteration: 0, progress: '', stage: '' },
    };
  }

  const reasoning = await reasoningBank.upsert(
    episodeToReasoningInput(problem, body || problem, tagList, 'decision'),
  );
  await longTermMemory.store(
    `reasoning:${reasoning.id}`,
    `${reasoning.problem}\n${reasoning.steps.join('\n')}`,
    'promote',
    reasoning.tags,
    reasoning.confidence,
  );

  return {
    success: true,
    data: { reasoning, promoted: true },
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}
