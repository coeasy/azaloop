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
 * Result returned by {@link SwarmCoordinator.dispatch}.
 */
export interface SwarmDispatchResult {
  dispatched: boolean;
  topology: SwarmTopology;
  taskId: string;
  agentCount: number;
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
}

/**
 * SwarmCoordinator — coordinates a swarm of agents for parallel task
 * execution.
 *
 * This is an **interface stub** for the current phase. It provides the
 * type contracts and basic state tracking; the actual dispatch and
 * collection logic will be implemented in a future phase.
 *
 * @example
 * ```ts
 * const coord = new SwarmCoordinator({ enabled: true, max_parallel: 4, agents: ['a1', 'a2'] });
 * coord.dispatch(task, 'hierarchical');
 * const status = coord.getStatus();
 * const results = coord.collect();
 * ```
 */
export class SwarmCoordinator {
  private config: SwarmCoordinatorConfig;
  private agents: Map<string, SwarmAgent> = new Map();
  private results: Map<string, unknown> = new Map();

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

  /**
   * Dispatch a task using the specified topology.
   *
   * **Stub** — assigns the task to the target agent and marks it `busy`.
   * The real parallel/sequential/conditional dispatch logic will be
   * implemented in a future phase.
   *
   * @param task     - The task to dispatch.
   * @param topology - The coordination topology to use.
   * @returns A {@link SwarmDispatchResult} describing the dispatch outcome.
   */
  dispatch(task: SwarmTask, topology: SwarmTopology): SwarmDispatchResult {
    const agent = this.agents.get(task.agent);
    if (agent) {
      agent.status = 'busy';
      agent.currentTask = task.id;
    }

    return {
      dispatched: agent !== undefined,
      topology,
      taskId: task.id,
      agentCount: this.agents.size,
    };
  }

  /**
   * Collect results from all agents.
   *
   * **Stub** — returns the current result map and tallies completed /
   * failed agents. The real collection logic will be implemented in a
   * future phase.
   *
   * @returns A {@link SwarmCollectResult} with all collected results.
   */
  collect(): SwarmCollectResult {
    let completed = 0;
    let failed = 0;

    for (const agent of this.agents.values()) {
      if (agent.status === 'done') {
        completed++;
      } else if (agent.status === 'error') {
        failed++;
      }
    }

    return {
      results: new Map(this.results),
      completed,
      failed,
    };
  }

  /**
   * Return the status of all agents in the swarm.
   *
   * @returns An array of {@link SwarmAgent} objects (shallow copies).
   */
  getStatus(): SwarmAgent[] {
    return [...this.agents.values()].map(a => ({ ...a }));
  }
}
