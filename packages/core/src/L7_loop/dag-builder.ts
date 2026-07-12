/**
 * DAG (Directed Acyclic Graph) builder for task dependency management.
 *
 * Used by the outer loop to determine which stories/tasks can be executed
 * in parallel and to detect dependency cycles that would deadlock the loop.
 *
 * A task depends on another when it cannot start until the dependency has
 * completed. The builder validates that the graph is acyclic, computes a
 * topological order, and reports the set of "parallel-ready" tasks (pending
 * tasks whose dependencies are all done).
 */

/**
 * A single task node in the dependency graph.
 */
export interface Task {
  /** Unique task identifier. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** IDs of tasks that must complete before this one can start. */
  dependencies?: string[];
  /** Current execution status. */
  status?: 'pending' | 'in_progress' | 'done' | 'blocked';
}

/**
 * A directed edge: `from` must complete before `to` can start.
 */
export interface DAGEdge {
  from: string;
  to: string;
}

/**
 * Serialised DAG — a plain JSON-serialisable representation of the graph.
 */
export interface SerializedDAG {
  nodes: Task[];
  edges: DAGEdge[];
}

/**
 * Status report produced by {@link DAGBuilder.getStatus}.
 */
export interface DAGStatusReport {
  /** Total number of tasks. */
  total: number;
  /** Number of completed tasks. */
  done: number;
  /** Number of in-progress tasks. */
  in_progress: number;
  /** Number of pending tasks (not yet started). */
  pending: number;
  /** Number of blocked tasks (a dependency failed or is in a cycle). */
  blocked: number;
  /** Overall completion percentage (0–100). */
  progress_percent: number;
  /** Tasks ready to execute now (pending with all dependencies done). */
  next_ready: Task[];
  /** Detected cycle, if any (array of task IDs forming the cycle). */
  cycle?: string[];
  /** Whether the graph is acyclic. */
  is_acyclic: boolean;
}

/**
 * Result of building a DAG.
 */
export interface BuildResult {
  dag: SerializedDAG;
  topological_order: string[];
  cycle?: string[];
  is_acyclic: boolean;
}

/**
 * The DAG builder.
 *
 * Typical usage:
 * ```ts
 * const builder = new DAGBuilder();
 * const result = builder.build(tasks);
 * const ready = builder.getParallelTasks();
 * ```
 */
export class DAGBuilder {
  private tasks: Map<string, Task> = new Map();
  private edges: DAGEdge[] = [];

  /**
   * Add a single task to the graph.
   * If a task with the same id already exists it is overwritten.
   */
  addTask(task: Task): void {
    this.tasks.set(task.id, {
      ...task,
      status: task.status ?? 'pending',
      dependencies: task.dependencies ?? [],
    });
  }

  /**
   * Build the DAG from a list of tasks.
   *
   * Computes edges from declared dependencies, validates that referenced
   * dependencies exist, and detects cycles using a depth-first search.
   *
   * @returns A {@link BuildResult} containing the serialised DAG, a
   *          topological order, and (if present) the detected cycle.
   */
  build(tasks: Task[]): BuildResult {
    // Reset internal state for a fresh build.
    this.tasks = new Map();
    this.edges = [];

    for (const task of tasks) {
      this.addTask(task);
    }

    // Derive edges from each task's declared dependencies.
    for (const task of tasks) {
      const deps = task.dependencies ?? [];
      for (const dep of deps) {
        // Only record an edge if the dependency exists. Missing deps make
        // the dependent task "blocked" rather than crashing the build.
        if (this.tasks.has(dep)) {
          this.edges.push({ from: dep, to: task.id });
        }
      }
    }

    const cycle = this.detectCycle();
    const topological_order = cycle ? [] : this.topologicalSort();

    return {
      dag: this.serialize(),
      topological_order,
      cycle,
      is_acyclic: !cycle,
    };
  }

  /**
   * Load a previously serialised DAG into the builder.
   */
  load(dag: SerializedDAG): void {
    this.tasks = new Map();
    this.edges = [];

    for (const node of dag.nodes) {
      this.addTask(node);
    }
    this.edges = [...dag.edges];
  }

  /**
   * Serialise the current graph to a plain object.
   */
  serialize(): SerializedDAG {
    return {
      nodes: Array.from(this.tasks.values()),
      edges: [...this.edges],
    };
  }

  /**
   * Compute a topological order of the task IDs.
   *
   * Uses Kahn's algorithm (BFS). Returns an empty array if a cycle exists.
   */
  topologicalSort(): string[] {
    if (this.tasks.size === 0) return [];

    // adjacency list: dep -> tasks that depend on it
    const dependents = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const id of this.tasks.keys()) {
      dependents.set(id, []);
      inDegree.set(id, 0);
    }

    for (const edge of this.edges) {
      const list = dependents.get(edge.from) ?? [];
      list.push(edge.to);
      dependents.set(edge.from, list);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);
      for (const dep of dependents.get(current) ?? []) {
        const next = (inDegree.get(dep) ?? 0) - 1;
        inDegree.set(dep, next);
        if (next === 0) queue.push(dep);
      }
    }

    // If not all nodes were processed, a cycle exists.
    if (order.length !== this.tasks.size) return [];
    return order;
  }

  /**
   * Detect a cycle in the graph using DFS.
   *
   * @returns The cycle as an array of task IDs, or `undefined` if acyclic.
   */
  detectCycle(): string[] | undefined {
    const WHITE = 0; // unvisited
    const GRAY = 1; // in current DFS path
    const BLACK = 2; // fully processed

    const color = new Map<string, number>();
    for (const id of this.tasks.keys()) color.set(id, WHITE);

    // Build adjacency list (dependency -> dependents).
    const dependents = new Map<string, string[]>();
    for (const id of this.tasks.keys()) dependents.set(id, []);
    for (const edge of this.edges) {
      const list = dependents.get(edge.from) ?? [];
      list.push(edge.to);
      dependents.set(edge.from, list);
    }

    let cycle: string[] | undefined;
    const path: string[] = [];

    const visit = (id: string): boolean => {
      color.set(id, GRAY);
      path.push(id);
      for (const dep of dependents.get(id) ?? []) {
        if (color.get(dep) === GRAY) {
          // Found a back edge — extract the cycle.
          const start = path.indexOf(dep);
          cycle = path.slice(start).concat(dep);
          return true;
        }
        if (color.get(dep) === WHITE && visit(dep)) {
          return true;
        }
      }
      color.set(id, BLACK);
      path.pop();
      return false;
    };

    for (const id of this.tasks.keys()) {
      if (color.get(id) === WHITE && visit(id)) {
        return cycle;
      }
    }
    return undefined;
  }

  /**
   * Return the set of parallel-ready tasks: pending tasks whose
   * dependencies are all `done`.
   */
  getParallelTasks(): Task[] {
    const ready: Task[] = [];
    for (const task of this.tasks.values()) {
      if (task.status !== 'pending') continue;
      const deps = task.dependencies ?? [];
      const allDone = deps.every((dep) => {
        const depTask = this.tasks.get(dep);
        return depTask?.status === 'done';
      });
      if (allDone) ready.push(task);
    }
    return ready;
  }

  /**
   * Mark a task as done.
   */
  markDone(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.status = 'done';
    return true;
  }

  /**
   * Mark a task as in-progress.
   */
  markInProgress(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.status = 'in_progress';
    return true;
  }

  /**
   * Produce a status report for the current graph.
   */
  getStatus(): DAGStatusReport {
    let done = 0;
    let in_progress = 0;
    let pending = 0;
    let blocked = 0;

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'done':
          done++;
          break;
        case 'in_progress':
          in_progress++;
          break;
        case 'pending':
          pending++;
          break;
        default:
          blocked++;
          break;
      }
    }

    // A task is blocked if it references a missing dependency or is in a cycle.
    const cycle = this.detectCycle();
    const missingDeps = new Set<string>();
    for (const task of this.tasks.values()) {
      const deps = task.dependencies ?? [];
      for (const dep of deps) {
        if (!this.tasks.has(dep)) {
          missingDeps.add(task.id);
        }
      }
    }
    blocked += missingDeps.size;

    const total = this.tasks.size;
    const progress_percent = total === 0 ? 0 : Math.round((done / total) * 100);

    return {
      total,
      done,
      in_progress,
      pending,
      blocked,
      progress_percent,
      next_ready: this.getParallelTasks(),
      cycle,
      is_acyclic: !cycle,
    };
  }
}

// ── Artifact/Task node-based DAG (merged from L8_orchestrator) ──

/** The kind of entity a DAG node represents. */
export type DAGNodeType = 'artifact' | 'task';

/** The lifecycle status of a DAG node. */
export type DAGNodeStatus = 'blocked' | 'ready' | 'done';

/**
 * A single node in the artifact/task dependency graph.
 */
export interface DAGNode {
  id: string;
  type: DAGNodeType;
  dependencies: string[];
  status: DAGNodeStatus;
  data?: Record<string, unknown>;
}

/**
 * Aggregate status of the artifact DAG.
 */
export interface ArtifactDAGStatus {
  total: number;
  done: number;
  ready: number;
  blocked: number;
  progress: number;
}

/**
 * Serialized artifact DAG (JSON-safe).
 */
export interface ArtifactDAGSerialized {
  nodes: DAGNode[];
}

/**
 * Artifact-oriented DAG builder (originally L8_orchestrator/dag-builder).
 *
 * Supports addNode / markDone / detectParallel API for artifact-level
 * dependency tracking, complementing the task-oriented {@link DAGBuilder}.
 *
 * Merged from L8_orchestrator to eliminate duplicate module.
 */
export class ArtifactDAGBuilder {
  private nodes: Map<string, DAGNode> = new Map();

  addNode(id: string, type: DAGNodeType, dependencies: string[] = []): this {
    if (this.nodes.has(id)) {
      throw new Error(`DAG node '${id}' already exists`);
    }
    const status: DAGNodeStatus = this.areAllDepsDone(dependencies) ? 'ready' : 'blocked';
    this.nodes.set(id, { id, type, dependencies: [...dependencies], status });
    return this;
  }

  markDone(id: string): void {
    const node = this.nodes.get(id);
    if (!node || node.status === 'done') return;
    node.status = 'done';
    for (const dependent of this.nodes.values()) {
      if (dependent.status === 'blocked' && dependent.dependencies.includes(id)) {
        if (this.areAllDepsDone(dependent.dependencies)) {
          dependent.status = 'ready';
        }
      }
    }
  }

  detectParallel(): DAGNode[] {
    return [...this.nodes.values()].filter(n => n.status === 'ready');
  }

  getTopologicalOrder(): string[] {
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const [id, node] of this.nodes) {
      let degree = 0;
      for (const dep of node.dependencies) {
        if (this.nodes.has(dep)) {
          degree++;
          const list = dependents.get(dep) ?? [];
          list.push(id);
          dependents.set(dep, list);
        }
      }
      inDegree.set(id, degree);
    }
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }
    const result: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      for (const dependent of dependents.get(current) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }
    return result;
  }

  detectCycles(): boolean {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const id of this.nodes.keys()) color.set(id, WHITE);
    const visit = (nodeId: string): boolean => {
      color.set(nodeId, GRAY);
      const node = this.nodes.get(nodeId);
      if (!node) return false;
      for (const dep of node.dependencies) {
        if (!this.nodes.has(dep)) continue;
        const depColor = color.get(dep) ?? WHITE;
        if (depColor === GRAY) return true;
        if (depColor === WHITE && visit(dep)) return true;
      }
      color.set(nodeId, BLACK);
      return false;
    };
    for (const id of this.nodes.keys()) {
      if ((color.get(id) ?? WHITE) === WHITE) {
        if (visit(id)) return true;
      }
    }
    return false;
  }

  serialize(): string {
    const data: ArtifactDAGSerialized = { nodes: [...this.nodes.values()] };
    return JSON.stringify(data);
  }

  static deserialize(json: string): ArtifactDAGBuilder {
    const data = JSON.parse(json) as ArtifactDAGSerialized;
    const builder = new ArtifactDAGBuilder();
    for (const node of data.nodes) {
      builder.nodes.set(node.id, { ...node, dependencies: [...node.dependencies] });
    }
    return builder;
  }

  getStatus(): ArtifactDAGStatus {
    let done = 0, ready = 0, blocked = 0;
    for (const node of this.nodes.values()) {
      if (node.status === 'done') done++;
      else if (node.status === 'ready') ready++;
      else blocked++;
    }
    const total = this.nodes.size;
    const progress = total === 0 ? 0 : Math.round((done / total) * 100);
    return { total, done, ready, blocked, progress };
  }

  getNode(id: string): DAGNode | undefined {
    const node = this.nodes.get(id);
    return node ? { ...node } : undefined;
  }

  getNodes(): DAGNode[] {
    return [...this.nodes.values()].map(n => ({ ...n }));
  }

  private areAllDepsDone(dependencies: string[]): boolean {
    if (dependencies.length === 0) return true;
    return dependencies.every(dep => {
      const depNode = this.nodes.get(dep);
      return depNode !== undefined && depNode.status === 'done';
    });
  }
}
