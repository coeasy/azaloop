/**
 * Local vector index — NSW (Navigable Small World) with brute-force
 * fallback for tiny corpora. Keeps the historical `createHNSWIndex`
 * API (compat) while adding real graph-navigated search via
 * `createNSWIndex`.
 *
 * Not a full HNSW library; sufficient for `.aza/stores/vectors` product use.
 */

// ── Public types ─────────────────────────────────────────────

export interface HNSWOptions {
  /** Dimensionality of the vectors. */
  dimensions: number;
  /** Maximum results to return from `search()`. */
  defaultK?: number;
  /** Whether to normalise vectors on insert. Default true. */
  normalize?: boolean;
}

export interface NSWOptions extends HNSWOptions {
  /** Max bidirectional neighbors per node. Default 16. */
  M?: number;
  /** Candidate list size during search. Default 32. */
  efSearch?: number;
}

export interface SearchResult {
  key: string;
  /** Cosine similarity in [-1, 1]. */
  similarity: number;
  /** Stored vector. */
  vector: number[];
}

export interface HNSWIndex {
  insert(key: string, vector: number[]): void;
  search(query: number[], k?: number): SearchResult[];
  size(): number;
  /** All keys currently stored. */
  keys(): string[];
}

export type NSWIndex = HNSWIndex;

// ── Helpers ──────────────────────────────────────────────────

function normaliseVec(v: number[], enabled: boolean): number[] {
  if (!enabled) return v;
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag);
  if (mag === 0) return v;
  return v.map((x) => x / mag);
}

/**
 * Cosine similarity of two equal-length vectors. Returns a value in
 * [-1, 1]. Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Euclidean distance between two equal-length vectors.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Create an index backed by brute-force cosine similarity
 * (historical HNSW placeholder API).
 */
export function createHNSWIndex(options: HNSWOptions): HNSWIndex {
  return createNSWIndex({ ...options, M: 0 });
}

/**
 * Create an NSW graph index. When `M <= 0` or corpus is small, search
 * falls back to exact brute-force ranking.
 */
export function createNSWIndex(options: NSWOptions): NSWIndex {
  const dimensions = options.dimensions;
  const normalize = options.normalize ?? true;
  const defaultK = options.defaultK ?? 10;
  const M = options.M ?? 16;
  const efSearch = options.efSearch ?? 32;

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('dimensions must be a positive integer');
  }

  const store: Map<string, number[]> = new Map();
  const neighbors: Map<string, Set<string>> = new Map();
  let entryPoint: string | null = null;

  function ensureNode(key: string): void {
    if (!neighbors.has(key)) neighbors.set(key, new Set());
  }

  function topMSimilar(key: string, vector: number[], limit: number): string[] {
    const scored: Array<{ k: string; s: number }> = [];
    for (const [other, vec] of store.entries()) {
      if (other === key) continue;
      scored.push({ k: other, s: cosineSimilarity(vector, vec) });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, Math.max(0, limit)).map((x) => x.k);
  }

  function link(a: string, b: string): void {
    ensureNode(a);
    ensureNode(b);
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
    // Cap degree by dropping weakest links
    for (const node of [a, b]) {
      const set = neighbors.get(node)!;
      if (set.size <= M) continue;
      const vec = store.get(node)!;
      const ranked = [...set]
        .map((n) => ({ n, s: cosineSimilarity(vec, store.get(n)!) }))
        .sort((x, y) => y.s - x.s);
      neighbors.set(node, new Set(ranked.slice(0, M).map((r) => r.n)));
    }
  }

  function bruteForce(query: number[], k: number): SearchResult[] {
    const out: SearchResult[] = [];
    for (const [key, vec] of store.entries()) {
      out.push({ key, similarity: cosineSimilarity(query, vec), vector: vec });
    }
    out.sort((a, b) => b.similarity - a.similarity);
    return out.slice(0, Math.max(0, k));
  }

  function graphSearch(query: number[], k: number): SearchResult[] {
    if (!entryPoint || store.size === 0) return [];
    if (M <= 0 || store.size <= Math.max(32, M * 2)) {
      return bruteForce(query, k);
    }

    const visited = new Set<string>();
    const candidates: Array<{ key: string; sim: number }> = [];
    const push = (key: string) => {
      if (visited.has(key)) return;
      visited.add(key);
      const vec = store.get(key);
      if (!vec) return;
      candidates.push({ key, sim: cosineSimilarity(query, vec) });
    };

    push(entryPoint);
    let improved = true;
    let rounds = 0;
    while (improved && rounds < store.size) {
      improved = false;
      rounds++;
      candidates.sort((a, b) => b.sim - a.sim);
      const focus = candidates.slice(0, efSearch);
      for (const c of focus) {
        for (const nb of neighbors.get(c.key) || []) {
          if (!visited.has(nb)) {
            push(nb);
            improved = true;
          }
        }
      }
    }

    // Fill any gaps with brute force if graph coverage is thin
    if (visited.size < Math.min(store.size, Math.max(k * 4, efSearch))) {
      return bruteForce(query, k);
    }

    candidates.sort((a, b) => b.sim - a.sim);
    return candidates.slice(0, Math.max(0, k)).map((c) => ({
      key: c.key,
      similarity: c.sim,
      vector: store.get(c.key)!,
    }));
  }

  return {
    insert(key: string, vector: number[]): void {
      if (vector.length !== dimensions) {
        throw new Error(
          `vector length ${vector.length} != expected dimensions ${dimensions}`,
        );
      }
      const v = normaliseVec(vector, normalize);
      store.set(key, v);
      ensureNode(key);
      if (!entryPoint) entryPoint = key;
      if (M > 0 && store.size > 1) {
        for (const nb of topMSimilar(key, v, M)) {
          link(key, nb);
        }
      }
    },
    search(query: number[], k: number = defaultK): SearchResult[] {
      if (query.length !== dimensions) {
        throw new Error(
          `query length ${query.length} != expected dimensions ${dimensions}`,
        );
      }
      const q = normaliseVec(query, normalize);
      return graphSearch(q, k);
    },
    size(): number {
      return store.size;
    },
    keys(): string[] {
      return Array.from(store.keys());
    },
  };
}
