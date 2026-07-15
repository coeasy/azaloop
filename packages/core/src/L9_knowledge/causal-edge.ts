/**
 * v14 — v13-P7.3: Causal Edge Graph
 *
 * @status deferred-experimental — not on critical MCP full-auto path (P1-3 orphan triage).
 *
 * A lightweight in-memory knowledge-graph used by the L9 knowledge
 * injection engine. Each edge is a typed directed relation between two
 * keys (e.g. `fromKey: 'aza-spec/loop-001'`, `toKey: 'aza-adr/0005'`).
 *
 * ## Edge relations
 *   - `causes`   — `from` directly produces `to`
 *   - `enables`  — `from` makes `to` possible (but not required)
 *   - `blocks`   — `from` prevents `to`
 *   - `requires` — `from` needs `to` to be true
 *
 * ## Use cases
 *   - Trace why a stage stalled (`followCausalChain` backward).
 *   - Surface upstream dependencies before a destructive change.
 *   - Power the `followHops` extension in InjectionEngine.
 *
 * Reference: ruvnet/ruflo knowledge-graph plugin + mindfold-ai/Trellis
 * causal edge concept.
 */

// ── Public types ─────────────────────────────────────────────

export type CausalRelation = 'causes' | 'enables' | 'blocks' | 'requires';

export interface CausalEdge {
  /** Source key (e.g. `'aza-spec/loop-001'`). */
  from: string;
  /** Target key. */
  to: string;
  /** Edge relation. */
  relation: CausalRelation;
  /** Edge weight in [0, 1] (default 1). */
  weight: number;
  /** Optional human-readable note. */
  note?: string;
  /** ISO timestamp. */
  createdAt: string;
}

export interface CausalGraph {
  edges: CausalEdge[];
}

export interface HopOptions {
  /** Maximum BFS depth. Default 2. */
  depth?: number;
  /** Restrict the traversal to specific relations. */
  relations?: CausalRelation[];
  /** Direction to traverse: 'forward' (follow .to), 'backward' (follow .from), or 'both'. */
  direction?: 'forward' | 'backward' | 'both';
}

// ── Graph construction ───────────────────────────────────────

/**
 * Create an empty graph.
 */
export function createCausalGraph(): CausalGraph {
  return { edges: [] };
}

/**
 * Add an edge to the graph. Duplicate edges (same from/to/relation) are
 * rejected with a warning rather than silently overwritten.
 */
export function addEdge(
  graph: CausalGraph,
  edge: Omit<CausalEdge, 'createdAt'>,
): { ok: boolean; reason?: string } {
  if (typeof edge.from !== 'string' || edge.from.length === 0) {
    return { ok: false, reason: 'edge.from must be a non-empty string' };
  }
  if (typeof edge.to !== 'string' || edge.to.length === 0) {
    return { ok: false, reason: 'edge.to must be a non-empty string' };
  }
  if (edge.from === edge.to) {
    return { ok: false, reason: 'self-loops are not allowed' };
  }
  if (typeof edge.weight !== 'number' || edge.weight < 0 || edge.weight > 1) {
    return { ok: false, reason: 'edge.weight must be in [0, 1]' };
  }

  const dup = graph.edges.find(
    (e) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation,
  );
  if (dup) {
    return { ok: false, reason: `duplicate edge ${edge.from} --${edge.relation}--> ${edge.to}` };
  }

  graph.edges.push({
    ...edge,
    createdAt: new Date().toISOString(),
  });
  return { ok: true };
}

/**
 * Remove all edges matching a predicate.
 */
export function removeEdges(graph: CausalGraph, predicate: (e: CausalEdge) => boolean): number {
  const before = graph.edges.length;
  graph.edges = graph.edges.filter((e) => !predicate(e));
  return before - graph.edges.length;
}

// ── Traversal ────────────────────────────────────────────────

/**
 * Follow the causal chain starting from `startKey`. Returns the list of
 * visited edges (in BFS order) up to the configured depth. The result
 * excludes the starting key itself.
 */
export function followCausalChain(
  graph: CausalGraph,
  startKey: string,
  options: HopOptions = {},
): CausalEdge[] {
  const depth = options.depth ?? 2;
  const direction = options.direction ?? 'forward';
  const relations = options.relations;
  const out: CausalEdge[] = [];
  const visited = new Set<string>([startKey]);
  let frontier: string[] = [startKey];

  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const edge of graph.edges) {
        if (relations && !relations.includes(edge.relation)) continue;
        const matches =
          (direction === 'forward' && edge.from === key) ||
          (direction === 'backward' && edge.to === key) ||
          (direction === 'both' && (edge.from === key || edge.to === key));
        if (!matches) continue;
        const other = edge.from === key ? edge.to : edge.from;
        if (visited.has(other)) continue;
        visited.add(other);
        out.push(edge);
        next.push(other);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return out;
}

// ── Serialization ────────────────────────────────────────────

/**
 * Serialize a graph to a JSON string. Stable across versions because
 * the edge list is sorted by (from, to, relation).
 */
export function serializeGraph(graph: CausalGraph): string {
  const sorted = [...graph.edges].sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.relation.localeCompare(b.relation);
  });
  return JSON.stringify({ version: 1, edges: sorted }, null, 2);
}

/**
 * Parse a JSON string back into a graph. Throws on parse error or
 * schema violation.
 */
export function loadGraph(text: string): CausalGraph {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('graph JSON must be an object');
  }
  const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
  const graph: CausalGraph = { edges: [] };
  for (const raw of edges) {
    const r = addEdge(graph, {
      from: raw.from,
      to: raw.to,
      relation: raw.relation,
      weight: typeof raw.weight === 'number' ? raw.weight : 1,
      note: raw.note,
    });
    if (!r.ok) {
      throw new Error(`Failed to add edge: ${r.reason}`);
    }
  }
  return graph;
}
