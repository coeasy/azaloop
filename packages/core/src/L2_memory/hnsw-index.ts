/**
 * v14 — v13-P7.3: HNSW Index (placeholder)
 *
 * A lightweight placeholder for an HNSW (Hierarchical Navigable Small
 * World) vector index used by the L9 knowledge injection engine. The
 * real implementation lives in `ruvector` / hnswlib; for now we use a
 * brute-force cosine similarity search. This keeps the interface
 * stable so future v15 can swap in a real HNSW without changing
 * call-sites.
 *
 * Reference: ruvnet/ruflo `ruflo-ruvector` plugin (HNSWLib wrapped).
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

// ── Implementation ───────────────────────────────────────────

/**
 * Create an HNSW index backed by brute-force cosine similarity.
 */
export function createHNSWIndex(options: HNSWOptions): HNSWIndex {
  const dimensions = options.dimensions;
  const normalize = options.normalize ?? true;
  const defaultK = options.defaultK ?? 10;
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('dimensions must be a positive integer');
  }
  const store: Map<string, number[]> = new Map();

  function normalise(v: number[]): number[] {
    if (!normalize) return v;
    let mag = 0;
    for (const x of v) mag += x * x;
    mag = Math.sqrt(mag);
    if (mag === 0) return v;
    return v.map((x) => x / mag);
  }

  return {
    insert(key: string, vector: number[]): void {
      if (vector.length !== dimensions) {
        throw new Error(
          `vector length ${vector.length} != expected dimensions ${dimensions}`,
        );
      }
      store.set(key, normalise(vector));
    },
    search(query: number[], k: number = defaultK): SearchResult[] {
      if (query.length !== dimensions) {
        throw new Error(
          `query length ${query.length} != expected dimensions ${dimensions}`,
        );
      }
      const q = normalise(query);
      const out: SearchResult[] = [];
      for (const [key, vec] of store.entries()) {
        out.push({
          key,
          similarity: cosineSimilarity(q, vec),
          vector: vec,
        });
      }
      out.sort((a, b) => b.similarity - a.similarity);
      return out.slice(0, Math.max(0, k));
    },
    size(): number {
      return store.size;
    },
    keys(): string[] {
      return Array.from(store.keys());
    },
  };
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
