/**
 * Swarm coordination topology.
 *
 * - **hierarchical** — agents report to a central coordinator (fan-out / fan-in)
 * - **mesh**         — agents communicate peer-to-peer without a central leader
 * - **adaptive**     — topology is chosen dynamically based on task characteristics
 *
 * Borrows from ruflo's swarm coordination patterns.
 */
export type SwarmTopology = 'hierarchical' | 'mesh' | 'adaptive';

/**
 * The lifecycle status of a swarm agent.
 */
export type SwarmAgentStatus = 'idle' | 'busy' | 'done' | 'error';

/**
 * A single agent in the swarm.
 */
export interface SwarmAgent {
  /** Unique agent identifier. */
  id: string;
  /** The agent's role (e.g. `maker`, `checker`, `optimizer`). */
  role: string;
  /** Current lifecycle status. */
  status: SwarmAgentStatus;
  /** The ID of the task currently assigned to this agent, if any. */
  currentTask?: string;
}

export interface SwarmTask {
  id: string;
  type: 'parallel' | 'sequential' | 'conditional';
  agent: string;
  payload: Record<string, unknown>;
  depends_on: string[];
}

export interface SwarmCoordinatorConfig {
  enabled: boolean;
  max_parallel: number;
  agents: string[];
}

/**
 * Host-facing instruction produced when a task is dispatched.
 * The Cursor/Claude host should execute `instruction` then call
 * `reportResult(taskId, ...)`.
 */
export interface SwarmHostInstruction {
  taskId: string;
  agentId: string;
  topology: SwarmTopology;
  instruction: string;
  payload: Record<string, unknown>;
}

/**
 * Result returned by {@link SwarmCoordinator.dispatch}.
 */
export interface SwarmDispatchResult {
  dispatched: boolean;
  topology: SwarmTopology;
  taskId: string;
  agentCount: number;
  /** Why dispatch was skipped (deps unmet / no capacity / unknown agent). */
  reason?: string;
  /** Host instruction when dispatched successfully. */
  host?: SwarmHostInstruction;
}

/**
 * Result returned by {@link SwarmCoordinator.collect}.
 */
export interface SwarmCollectResult {
  /** Map of agent ID → result payload. */
  results: Map<string, unknown>;
  /** Number of agents that completed successfully. */
  completed: number;
  /** Number of agents that encountered an error. */
  failed: number;
  /** Tasks still waiting on dependencies or capacity. */
  pending: number;
  /** Tasks currently running. */
  running: number;
}

/**
 * SwarmCoordinator — queues tasks, respects `depends_on` + `max_parallel`,
 * and emits host instructions for the LLM to execute.
 */
export class SwarmCoordinator {
  private config: SwarmCoordinatorConfig;
  private agents: Map<string, SwarmAgent> = new Map();
  private results: Map<string, unknown> = new Map();
  private taskResults: Map<string, unknown> = new Map();
  private completedTasks: Set<string> = new Set();
  private failedTasks: Set<string> = new Set();
  private pending: SwarmTask[] = [];
  private running: Map<string, SwarmTask> = new Map();
  private lastTopology: SwarmTopology = 'hierarchical';

  constructor(config: SwarmCoordinatorConfig) {
    this.config = config;
    for (const agentId of config.agents) {
      this.agents.set(agentId, { id: agentId, role: 'worker', status: 'idle' });
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getConfig(): SwarmCoordinatorConfig {
    return { ...this.config };
  }

  /** Register an agent if missing (for dynamic swarm expansion). */
  addAgent(id: string, role = 'worker'): void {
    if (!this.agents.has(id)) {
      this.agents.set(id, { id, role, status: 'idle' });
    }
  }

  /**
   * Enqueue a task without immediately dispatching.
   * Call {@link drain} to start ready tasks up to max_parallel.
   */
  enqueue(task: SwarmTask): void {
    this.pending.push(task);
    if (!this.agents.has(task.agent)) {
      this.addAgent(task.agent);
    }
  }

  /**
   * Dispatch a single task if dependencies and capacity allow.
   */
  dispatch(task: SwarmTask, topology: SwarmTopology): SwarmDispatchResult {
    this.lastTopology = topology;
    if (!this.config.enabled) {
      return {
        dispatched: false,
        topology,
        taskId: task.id,
        agentCount: this.agents.size,
        reason: 'swarm disabled',
      };
    }

    if (!this.agents.has(task.agent)) {
      this.addAgent(task.agent);
    }

    const unmet = task.depends_on.filter(
      (dep) => !this.completedTasks.has(dep),
    );
    if (unmet.length > 0) {
      // Keep for later drain
      if (!this.pending.some((t) => t.id === task.id) && !this.running.has(task.id)) {
        this.pending.push(task);
      }
      return {
        dispatched: false,
        topology,
        taskId: task.id,
        agentCount: this.agents.size,
        reason: `waiting on dependencies: ${unmet.join(', ')}`,
      };
    }

    if (this.running.size >= this.config.max_parallel) {
      if (!this.pending.some((t) => t.id === task.id) && !this.running.has(task.id)) {
        this.pending.push(task);
      }
      return {
        dispatched: false,
        topology,
        taskId: task.id,
        agentCount: this.agents.size,
        reason: `at max_parallel=${this.config.max_parallel}`,
      };
    }

    const agent = this.agents.get(task.agent)!;
    if (agent.status === 'busy') {
      if (!this.pending.some((t) => t.id === task.id) && !this.running.has(task.id)) {
        this.pending.push(task);
      }
      return {
        dispatched: false,
        topology,
        taskId: task.id,
        agentCount: this.agents.size,
        reason: `agent ${task.agent} is busy`,
      };
    }

    agent.status = 'busy';
    agent.currentTask = task.id;
    this.running.set(task.id, task);
    this.pending = this.pending.filter((t) => t.id !== task.id);

    const instruction = this.buildInstruction(task, topology);
    const host: SwarmHostInstruction = {
      taskId: task.id,
      agentId: task.agent,
      topology,
      instruction,
      payload: task.payload,
    };

    return {
      dispatched: true,
      topology,
      taskId: task.id,
      agentCount: this.agents.size,
      host,
    };
  }

  /**
   * Start all currently-ready pending tasks (respecting max_parallel).
   */
  drain(topology?: SwarmTopology): SwarmDispatchResult[] {
    const topo = topology || this.lastTopology;
    const results: SwarmDispatchResult[] = [];
    // Stable order: sequential tasks first when mixed
    const ordered = [...this.pending].sort((a, b) => {
      if (a.type === 'sequential' && b.type !== 'sequential') return -1;
      if (b.type === 'sequential' && a.type !== 'sequential') return 1;
      return 0;
    });

    for (const task of ordered) {
      if (this.running.size >= this.config.max_parallel) break;
      const r = this.dispatch(task, topo);
      results.push(r);
    }
    return results;
  }

  /**
   * Host reports completion (or failure) for a previously dispatched task.
   */
  reportResult(
    taskId: string,
    result: unknown,
    opts?: { error?: boolean; agentId?: string },
  ): { ok: boolean; unlocked: SwarmDispatchResult[] } {
    const task = this.running.get(taskId);
    const agentId = opts?.agentId || task?.agent;
    if (agentId) {
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.status = opts?.error ? 'error' : 'done';
        agent.currentTask = undefined;
        this.results.set(agentId, result);
      }
    }

    this.running.delete(taskId);
    this.taskResults.set(taskId, result);
    if (opts?.error) {
      this.failedTasks.add(taskId);
    } else {
      this.completedTasks.add(taskId);
    }

    // Reset agent to idle so it can take more work
    if (agentId) {
      const agent = this.agents.get(agentId);
      if (agent && agent.status === 'done') {
        agent.status = 'idle';
      }
    }

    const unlocked = this.drain();
    return { ok: true, unlocked: unlocked.filter((r) => r.dispatched) };
  }

  collect(): SwarmCollectResult {
    let completed = 0;
    let failed = 0;

    for (const agent of this.agents.values()) {
      if (agent.status === 'done') completed++;
      else if (agent.status === 'error') failed++;
    }

    // Prefer task-level tallies when available
    if (this.completedTasks.size + this.failedTasks.size > 0) {
      completed = this.completedTasks.size;
      failed = this.failedTasks.size;
    }

    return {
      results: new Map(this.results),
      completed,
      failed,
      pending: this.pending.length,
      running: this.running.size,
    };
  }

  getStatus(): SwarmAgent[] {
    return [...this.agents.values()].map((a) => ({ ...a }));
  }

  getPending(): SwarmTask[] {
    return this.pending.map((t) => ({ ...t, depends_on: [...t.depends_on], payload: { ...t.payload } }));
  }

  getRunning(): SwarmTask[] {
    return [...this.running.values()].map((t) => ({
      ...t,
      depends_on: [...t.depends_on],
      payload: { ...t.payload },
    }));
  }

  private buildInstruction(task: SwarmTask, topology: SwarmTopology): string {
    const goal = typeof task.payload.goal === 'string' ? task.payload.goal : task.id;
    const tool = typeof task.payload.tool === 'string' ? task.payload.tool : 'aza_loop';
    const action = typeof task.payload.action === 'string' ? task.payload.action : 'full';
    return (
      `[swarm:${topology}] Agent "${task.agent}" must execute ${tool}(action=${action}) ` +
      `for task "${task.id}": ${goal}. When done, report via aza_meta(action=swarm_report, task_id=${task.id}).`
    );
  }
}
