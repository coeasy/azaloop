import { DAGBuilder } from '@azaloop/core';
import type { Task, SerializedDAG } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';

/**
 * `aza_dag` — manage task dependency graphs.
 *
 * Actions:
 *  - `build`: construct a DAG from a list of tasks, returning the serialised
 *             graph, topological order, and any detected cycle.
 *  - `status`: load a serialised DAG and report progress / next-ready tasks.
 *  - `parallel`: load a serialised DAG and return the set of tasks that are
 *                ready to execute in parallel right now.
 */
export async function handleDag(
  action: 'build' | 'status' | 'parallel',
  tasks?: Task[],
  dag?: SerializedDAG,
): Promise<LoopResponse> {
  try {
    const builder = new DAGBuilder();

    switch (action) {
      case 'build': {
        if (!tasks || tasks.length === 0) {
          return {
            success: false,
            data: null,
            error: 'tasks array is required for build action',
            metadata: { iteration: 0, progress: '0%', stage: 'design' },
          };
        }
        const result = builder.build(tasks);
        return {
          success: result.is_acyclic,
          data: {
            dag: result.dag,
            topological_order: result.topological_order,
            cycle: result.cycle,
            is_acyclic: result.is_acyclic,
          },
          next_action: result.is_acyclic
            ? { tool: 'aza_dag', action: 'parallel', reason: 'DAG built — fetch parallel-ready tasks', payload: { dag: result.dag } }
            : { tool: 'aza_dag', action: 'fix', reason: `Cycle detected: ${(result.cycle ?? []).join(' -> ')}` },
          metadata: { iteration: 0, progress: '25%', stage: 'design' },
        };
      }

      case 'status': {
        if (!dag) {
          return {
            success: false,
            data: null,
            error: 'dag (SerializedDAG) is required for status action',
            metadata: { iteration: 0, progress: '0%', stage: 'build' },
          };
        }
        builder.load(dag);
        const status = builder.getStatus();
        return {
          success: status.is_acyclic,
          data: status,
          next_action: status.next_ready.length > 0
            ? { tool: 'aza_dag', action: 'parallel', reason: `${status.next_ready.length} task(s) ready to execute` }
            : { tool: 'aza_loop_next', action: 'next', reason: status.done === status.total ? 'All tasks complete' : 'No parallel-ready tasks — resolve blockers' },
          metadata: { iteration: 0, progress: `${status.progress_percent}%`, stage: 'build' },
        };
      }

      case 'parallel': {
        if (!dag) {
          return {
            success: false,
            data: null,
            error: 'dag (SerializedDAG) is required for parallel action',
            metadata: { iteration: 0, progress: '0%', stage: 'build' },
          };
        }
        builder.load(dag);
        const ready = builder.getParallelTasks();
        const status = builder.getStatus();
        return {
          success: true,
          data: {
            ready_tasks: ready,
            count: ready.length,
            total: status.total,
            done: status.done,
            progress_percent: status.progress_percent,
          },
          next_action: ready.length > 0
            ? { tool: 'aza_task_implement', action: 'implement', reason: `Execute ${ready.length} parallel task(s): ${ready.map((t) => t.id).join(', ')}` }
            : { tool: 'aza_loop_next', action: 'next', reason: 'No parallel-ready tasks remaining' },
          metadata: { iteration: 0, progress: `${status.progress_percent}%`, stage: 'build' },
        };
      }

      default: {
        return {
          success: false,
          data: null,
          error: `Unknown action: ${action}. Valid actions: build | status | parallel`,
          metadata: { iteration: 0, progress: '0%', stage: 'design' },
        };
      }
    }
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: '0%', stage: 'design' },
    };
  }
}
