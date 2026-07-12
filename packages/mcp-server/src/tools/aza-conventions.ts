import { loadConventions, writeConventions, extractConventionsFromTask, type ConventionsEntry } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

export async function handleConventionsList(workspacePath?: string): Promise<LoopResponse> {
  const root = workspacePath ?? process.cwd();
  const azaDir = path.join(root, '.aza');
  const entries = await loadConventions(azaDir);
  return {
    success: true,
    data: {
      conventions: entries,
      count: entries.length,
      tags: [...new Set(entries.map(e => e.tag))],
    },
    metadata: {
      iteration: 0,
      progress: 'conventions_loaded',
      stage: 'archive',
    },
  };
}

export async function handleConventionsWrite(entry: ConventionsEntry, workspacePath?: string): Promise<LoopResponse> {
  const root = workspacePath ?? process.cwd();
  const azaDir = path.join(root, '.aza');
  await writeConventions(azaDir, entry);
  return {
    success: true,
    data: {
      written: true,
      tag: entry.tag,
      recorded_at: entry.recorded_at,
    },
    metadata: {
      iteration: 0,
      progress: 'convention_written',
      stage: entry.source.split(':')[0] || 'archive',
    },
  };
}

export async function handleConventionsExtract(workSummary: string, stage: string, iteration: number, workspacePath?: string): Promise<LoopResponse> {
  const entries = extractConventionsFromTask(workSummary, stage, iteration);
  const root = workspacePath ?? process.cwd();
  const azaDir = path.join(root, '.aza');
  for (const entry of entries) {
    await writeConventions(azaDir, entry);
  }
  return {
    success: true,
    data: {
      extracted: entries,
      count: entries.length,
    },
    metadata: {
      iteration,
      progress: 'conventions_extracted',
      stage,
    },
  };
}
