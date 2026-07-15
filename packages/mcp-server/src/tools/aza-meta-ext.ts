/**
 * aza_meta actions for worktree / swarm / stores / shellward DLP.
 */
import * as path from 'node:path';
import {
  WorktreeManager,
  SwarmCoordinator,
  type SwarmTask,
  type SwarmTopology,
  putStoreDoc,
  getStoreDoc,
  listStoreDocs,
  deleteStoreDoc,
  openVectorStore,
  reindexStores,
  ensureStores,
  runShellwardGuard,
} from '@azaloop/core';

function azaDir(workspace?: string): string {
  return path.join(workspace || process.cwd(), '.aza');
}

let swarmSingleton: SwarmCoordinator | null = null;

function getSwarm(args: Record<string, unknown>): SwarmCoordinator {
  if (!swarmSingleton) {
    const agents = Array.isArray(args.agents)
      ? (args.agents as string[])
      : ['maker', 'checker', 'host'];
    swarmSingleton = new SwarmCoordinator({
      enabled: args.enabled !== false,
      max_parallel: typeof args.max_parallel === 'number' ? args.max_parallel : 2,
      agents,
    });
  }
  return swarmSingleton;
}

export async function handleMetaWorktree(args: Record<string, unknown>): Promise<unknown> {
  const workspace = (args.workspace_path as string) || process.cwd();
  const sub = String(args.sub_action || args.op || 'list');
  const mgr = new WorktreeManager({
    enabled: true,
    base_branch: (args.base_branch as string) || 'main',
    worktree_prefix: (args.prefix as string) || 'aza/',
    repo_root: workspace,
  });

  if (sub === 'list') {
    return { success: true, data: { worktrees: mgr.list() } };
  }
  if (sub === 'create') {
    const name = String(args.name || args.branch || 'feature');
    const result = mgr.create(name, {
      branch: args.branch as string | undefined,
      base: args.base as string | undefined,
    });
    return { success: result.ok, data: result, error: result.error };
  }
  if (sub === 'remove') {
    const wtPath = String(args.path || '');
    if (!wtPath) return { success: false, error: 'path required', data: null };
    const result = mgr.remove(wtPath, args.force === true);
    return { success: result.ok, data: result, error: result.error };
  }
  if (sub === 'prune') {
    const result = mgr.prune();
    return { success: result.ok, data: result, error: result.error };
  }
  return { success: false, error: `Unknown worktree sub_action "${sub}"`, data: null };
}

export async function handleMetaSwarm(args: Record<string, unknown>): Promise<unknown> {
  const sub = String(args.sub_action || args.op || 'status');
  const swarm = getSwarm(args);
  const topology = (args.topology as SwarmTopology) || 'hierarchical';

  if (sub === 'status') {
    return {
      success: true,
      data: {
        agents: swarm.getStatus(),
        pending: swarm.getPending(),
        running: swarm.getRunning(),
        collect: Object.fromEntries(swarm.collect().results),
        tallies: swarm.collect(),
      },
    };
  }

  if (sub === 'enqueue' || sub === 'dispatch') {
    const task: SwarmTask = {
      id: String(args.task_id || args.id || `task-${Date.now()}`),
      type: (args.type as SwarmTask['type']) || 'parallel',
      agent: String(args.agent || 'host'),
      payload: (args.payload as Record<string, unknown>) || {
        goal: args.goal || args.instruction,
        tool: args.tool || 'aza_loop',
        action: args.task_action || 'full',
      },
      depends_on: Array.isArray(args.depends_on) ? (args.depends_on as string[]) : [],
    };
    if (sub === 'enqueue') {
      swarm.enqueue(task);
      const drained = swarm.drain(topology);
      return { success: true, data: { enqueued: task.id, drained } };
    }
    const result = swarm.dispatch(task, topology);
    return { success: result.dispatched, data: result, error: result.reason };
  }

  if (sub === 'report') {
    const taskId = String(args.task_id || '');
    if (!taskId) return { success: false, error: 'task_id required', data: null };
    const out = swarm.reportResult(taskId, args.result ?? { ok: true }, {
      error: args.error === true,
      agentId: args.agent as string | undefined,
    });
    return { success: out.ok, data: out };
  }

  if (sub === 'drain') {
    return { success: true, data: { drained: swarm.drain(topology) } };
  }

  if (sub === 'collect') {
    const c = swarm.collect();
    return {
      success: true,
      data: {
        completed: c.completed,
        failed: c.failed,
        pending: c.pending,
        running: c.running,
        results: Object.fromEntries(c.results),
      },
    };
  }

  if (sub === 'reset') {
    swarmSingleton = null;
    return { success: true, data: { reset: true } };
  }

  return { success: false, error: `Unknown swarm sub_action "${sub}"`, data: null };
}

export async function handleMetaStores(args: Record<string, unknown>): Promise<unknown> {
  const workspace = (args.workspace_path as string) || process.cwd();
  const dir = azaDir(workspace);
  const sub = String(args.sub_action || args.op || 'list');
  const kind = (args.kind as 'specs' | 'changes') || 'specs';

  if (sub === 'ensure') {
    return { success: true, data: ensureStores(dir) };
  }
  if (sub === 'put') {
    const id = String(args.id || '');
    const body = String(args.body || '');
    if (!id || !body) return { success: false, error: 'id and body required', data: null };
    const doc = putStoreDoc(dir, kind, {
      id,
      title: args.title as string | undefined,
      body,
      tags: Array.isArray(args.tags) ? (args.tags as string[]) : undefined,
      meta: args.meta as Record<string, unknown> | undefined,
    });
    return { success: true, data: doc };
  }
  if (sub === 'get') {
    const id = String(args.id || '');
    return { success: true, data: getStoreDoc(dir, kind, id) };
  }
  if (sub === 'list') {
    return { success: true, data: { docs: listStoreDocs(dir, kind), kind } };
  }
  if (sub === 'delete') {
    const id = String(args.id || '');
    return { success: true, data: { deleted: deleteStoreDoc(dir, kind, id) } };
  }
  if (sub === 'reindex') {
    return { success: true, data: reindexStores(dir) };
  }
  if (sub === 'search') {
    const q = String(args.query || '');
    const vs = openVectorStore(dir);
    return { success: true, data: { hits: vs.search(q, Number(args.limit) || 5), size: vs.size() } };
  }
  if (sub === 'upsert_vector') {
    const key = String(args.key || args.id || '');
    const text = String(args.text || args.body || '');
    if (!key || !text) return { success: false, error: 'key and text required', data: null };
    const vs = openVectorStore(dir);
    vs.upsert(key, text);
    return { success: true, data: { key, size: vs.size() } };
  }
  return { success: false, error: `Unknown stores sub_action "${sub}"`, data: null };
}

export async function handleMetaDlp(args: Record<string, unknown>): Promise<unknown> {
  const content = String(args.content || args.text || JSON.stringify(args.payload || {}));
  const result = runShellwardGuard(content, String(args.source || 'aza_meta.dlp_scan'), {
    blockOnFail: false,
  });
  return {
    success: result.passed,
    data: {
      passed: result.passed,
      reason: result.reason,
      findings: result.findings,
      layers_run: result.layers_run,
    },
  };
}
