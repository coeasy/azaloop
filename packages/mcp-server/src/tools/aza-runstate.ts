import { RunStateManager, AuditLog, type RunState, type AuditEntry } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as path from 'path';

export async function handleRunstateStatus(workspacePath?: string): Promise<LoopResponse> {
  const root = workspacePath ?? process.cwd();
  const azaDir = path.join(root, '.aza');
  const stateManager = new RunStateManager(azaDir, root);
  await stateManager.load();
  const state = stateManager.getState();
  return {
    success: true,
    data: state,
    metadata: {
      iteration: 0,
      progress: state.current_stage,
      stage: state.current_stage,
    },
  };
}

export async function handleRunstateUpdate(partial: Partial<RunState>, workspacePath?: string): Promise<LoopResponse> {
  const root = workspacePath ?? process.cwd();
  const azaDir = path.join(root, '.aza');
  const stateManager = new RunStateManager(azaDir, root);
  await stateManager.load();
  await stateManager.update(partial);
  const state = stateManager.getState();
  return {
    success: true,
    data: state,
    metadata: {
      iteration: 0,
      progress: 'runstate_updated',
      stage: state.current_stage,
    },
  };
}

export async function handleAuditLogRecent(limit?: number, workspacePath?: string): Promise<LoopResponse> {
  const root = workspacePath ?? process.cwd();
  const azaDir = path.join(root, '.aza');
  const auditLog = new AuditLog(azaDir);
  const entries = await auditLog.getRecent(limit ?? 10);
  return {
    success: true,
    data: {
      entries,
      count: entries.length,
    },
    metadata: {
      iteration: 0,
      progress: `${entries.length} audit entries`,
      stage: 'verify',
    },
  };
}

export async function handleAuditLogSearch(type?: string, source?: string, workspacePath?: string): Promise<LoopResponse> {
  const root = workspacePath ?? process.cwd();
  const azaDir = path.join(root, '.aza');
  const auditLog = new AuditLog(azaDir);
  const all = await auditLog.load();
  let filtered = all;
  if (type) filtered = filtered.filter((e: AuditEntry) => e.type === type);
  if (source) filtered = filtered.filter((e: AuditEntry) => e.source === source);
  return {
    success: true,
    data: {
      entries: filtered.slice(-50),
      total: filtered.length,
    },
    metadata: {
      iteration: 0,
      progress: `${filtered.length} matching entries`,
      stage: 'verify',
    },
  };
}
