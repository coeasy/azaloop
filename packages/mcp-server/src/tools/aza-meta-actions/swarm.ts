/**
 * R12 P6 Plus8 (P1 主链路拆分第8轮) — Swarm sub_action handler。
 *
 * 借鉴 ruflo「swarm coordinator」+ claude-flow「agent topology」：
 * 把 aza-meta-ext.ts 中 80+ 行的 swarm 子命令块抽出为独立 handler。
 *
 * 支持的 sub_action：
 *   - status        当前 swarm 状态
 *   - enqueue       入队（不立即 dispatch）
 *   - dispatch      立即 dispatch 到指定 topology
 *   - report        回报 task 结果
 *   - drain         排空 pending 队列
 *   - collect       收集所有完成 / 失败 / pending task
 *   - reset         重置 swarm singleton
 */
import { SwarmCoordinator, type SwarmTask, type SwarmTopology } from '@azaloop/core';
import type { MetaActionContext, MetaActionHandler } from './context';
import {
  buildMetaError,
  buildMetaNextAction,
  buildMetaResponse,
  dispatchSubAction,
  type SubActionHandlers,
} from './response-builder';

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

export const swarmHandler: MetaActionHandler = (ctx: MetaActionContext) => {
  const { args } = ctx;
  const sub = String(args.sub_action || args.op || 'status');
  const swarm = getSwarm(args);
  const topology = (args.topology as SwarmTopology) || 'hierarchical';

  const handlers: SubActionHandlers = {
    status: () =>
      buildMetaResponse({
        data: {
          agents: swarm.getStatus(),
          pending: swarm.getPending(),
          running: swarm.getRunning(),
          collect: Object.fromEntries(swarm.collect().results),
          tallies: swarm.collect(),
          how_to: {
            dispatch: 'aza_meta(action=swarm_dispatch, goal=..., topology=hierarchical)',
            report: 'aza_meta(action=swarm_report, task_id=...)',
            note: 'ReasoningBank MVP via aza_memory(record|query|promote); layer=reasoning',
          },
        },
        nextAction: buildMetaNextAction(
          'swarm_dispatch',
          'Dispatch a parallel swarm task or continue aza_auto',
        ),
      }),

    enqueue: () => {
      const task = buildSwarmTask(args);
      swarm.enqueue(task);
      const drained = swarm.drain(topology);
      return buildMetaResponse({ data: { enqueued: task.id, drained } });
    },

    dispatch: () => {
      const task = buildSwarmTask(args);
      const result = swarm.dispatch(task, topology);
      return buildMetaResponse({
        success: result.dispatched,
        data: result,
        error: result.reason,
      });
    },

    report: () => {
      const taskId = String(args.task_id || '');
      if (!taskId) return buildMetaError('task_id required');
      const out = swarm.reportResult(taskId, args.result ?? { ok: true }, {
        error: args.error === true,
        agentId: args.agent as string | undefined,
      });
      return buildMetaResponse({ success: out.ok, data: out });
    },

    drain: () => buildMetaResponse({ data: { drained: swarm.drain(topology) } }),

    collect: () => {
      const c = swarm.collect();
      return buildMetaResponse({
        data: {
          completed: c.completed,
          failed: c.failed,
          pending: c.pending,
          running: c.running,
          results: Object.fromEntries(c.results),
        },
      });
    },

    reset: () => {
      swarmSingleton = null;
      return buildMetaResponse({ data: { reset: true } });
    },
  };

  return dispatchSubAction(sub, ctx, handlers, 'swarm');
};

/**
 * 构造 SwarmTask（enqueue / dispatch 共享）。
 */
function buildSwarmTask(args: Record<string, unknown>): SwarmTask {
  return {
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
}
