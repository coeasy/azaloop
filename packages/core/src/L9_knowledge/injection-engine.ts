/**
 * v14 — P8.4: InjectionEngine with RAG (graph hops + hybrid search).
 *
 * Extends the base InjectionEngine with:
 *   • `followHops(key, depth, options?)` — traverse the causal edge graph
 *     and return content of downstream / upstream keys.
 *   • `hybridSearch(query, options?)` — combine keyword matching (BOW) and
 *     vector similarity (HNSWIndex) with configurable weights.
 *   • `diversityRanking(results, limit, lambda?)` — simplified MMR to
 *     avoid near-duplicate results.
 *   • A small in-memory LRU cache (size 128) for hot queries.
 *
 * The base behaviour (inject + write + append) is unchanged.
 *
 * Reference:
 *   • ruvnet/ruflo v3.10.33 — RUFLO_KG_GRAPH plugin (vector + graph)
 *   • ruflo-ruvector — HNSWLib wrapper (we use a brute-force placeholder
 *     from `L2_memory/hnsw-index.ts`).
 */

import {
  CausalEdge,
  CausalRelation,
  createCausalGraph,
  addEdge,
  followCausalChain,
  CausalGraph,
} from './causal-edge';
import { createHNSWIndex, HNSWIndex, SearchResult as HNSWSearchResult } from '../L2_memory/hnsw-index';
import { validateNamespace } from '../L2_memory/namespace';

export interface InjectionContext {
  stage: string;
  story_type?: string;
  language?: string;
  tags: string[];
}

/**
 * Options forwarded to `inject()`. v14 — P8.4 added `useHops` and `hops`.
 */
export interface InjectionOptions {
  /** When true, extend results with downstream causal graph neighbours. */
  useHops?: boolean;
  /** Max depth when following hops. Default 2. */
  hops?: number;
  /** Restrict hop relations. Default: all. */
  hopRelations?: CausalRelation[];
}

export interface HybridSearchOptions {
  /** Weight of keyword (BOW) score in [0, 1]. Default 0.5. */
  keywordWeight?: number;
  /** Weight of vector (cosine) score in [0, 1]. Default 0.5. */
  vectorWeight?: number;
  /** Number of results to return. Default 5. */
  k?: number;
  /** Restrict the candidate pool to specific keys. */
  restrictTo?: string[];
}

export interface RAGSearchResult {
  key: string;
  /** Final score in [0, 1] (weighted combination of keyword + vector). */
  score: number;
  /** Keyword component in [0, 1]. */
  keywordScore: number;
  /** Vector component (cosine similarity in [-1, 1], mapped to [0, 1]). */
  vectorScore: number;
  /** Stored content (joined by '\n'). */
  content: string;
}

// ── Tiny LRU (Map-based) ─────────────────────────────────────

class LRU<K, V> {
  private maxSize: number;
  private store: Map<K, V>;
  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.store = new Map();
  }
  get(key: K): V | undefined {
    const v = this.store.get(key);
    if (v === undefined) return undefined;
    // Move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, v);
    return v;
  }
  set(key: K, value: V): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, value);
    if (this.store.size > this.maxSize) {
      // Evict oldest
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
  }
  get size(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
}

// ── Helpers ─────────────────────────────────────────────────

/** Naive bag-of-words vectorisation. Tokens are lowercased words. */
export function bowVectorize(text: string, vocab: string[]): number[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_一-鿿]+/)
    .filter((t) => t.length > 0);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return vocab.map((w) => counts.get(w) ?? 0);
}

/** Build a vocabulary from a set of strings (alphanumeric + CJK). */
export function buildVocab(documents: string[]): string[] {
  const seen = new Set<string>();
  for (const doc of documents) {
    for (const t of doc
      .toLowerCase()
      .split(/[^a-z0-9_一-鿿]+/)
      .filter((x) => x.length > 0)) {
      seen.add(t);
    }
  }
  return Array.from(seen).sort();
}

/** Map cosine similarity in [-1, 1] to [0, 1]. */
function mapSimilarity(s: number): number {
  return Math.max(0, Math.min(1, (s + 1) / 2));
}

// ── Main class ────────────────────────────────────────────────

export class InjectionEngine {
  private knowledgeBase: Map<string, string[]> = new Map();
  /**
   * v13 — P3.2: when a key is reserved (pattern / claude-memories /
   * default), writes are rejected. Set `strict: true` to throw on
   * rejection; otherwise the engine silently skips.
   */
  private strict: boolean = false;

  // ── v14 — P8.4: RAG additions ─────────────────────────────
  /** Causal-edge graph (forward references between knowledge keys). */
  private edges: CausalEdge[] = [];
  /** Backing graph object so we can reuse `followCausalChain`. */
  private graph: CausalGraph = createCausalGraph();
  /** Vector index over knowledge values. Lazy-initialised on first use. */
  private vectorIndex: HNSWIndex = createHNSWIndex({ dimensions: 1 });
  /** Whether the vector index has been built. */
  private vectorIndexReady: boolean = false;
  /** Vocabulary used to tokenise queries and documents for hybrid search. */
  private vocab: string[] = [];
  /** LRU cache for `hybridSearch` queries. */
  private lruCache: LRU<string, RAGSearchResult[]> = new LRU(128);
  /** Cached dimension count (size of vocab). */
  private vectorDim: number = 1;

  constructor(options: { strict?: boolean } = {}) {
    this.strict = options.strict ?? false;
    this.initializeKnowledge();
  }

  inject(context: InjectionContext, options?: InjectionOptions): string[] {
    const results: string[] = [];

    for (const [category, techniques] of this.knowledgeBase) {
      if (this.matchesContext(category, context)) {
        results.push(...techniques);
      }
    }

    // v14 — P8.4: optional graph-hop extension
    if (options?.useHops) {
      const depth = options.hops ?? 2;
      for (const key of this.matchKeys(context)) {
        const hopResults = this.followHops(key, depth, {
          relations: options.hopRelations,
        });
        for (const r of hopResults) {
          if (!results.includes(r)) results.push(r);
        }
      }
    }

    return results.slice(0, 10); // Limit to 10 techniques per injection
  }

  /**
   * v13 — P3.2: write a value to a key in the AgentDB. Validates the
   * key against the namespace conventions. Throws when strict mode
   * is enabled and the key is reserved or invalid.
   *
   * v14 — P8.4: invalidates the vector index cache so the next
   * `hybridSearch` will rebuild it with the new value.
   */
  write(key: string, value: string): void {
    const v = validateNamespace(key);
    if (!v.valid) {
      if (this.strict) {
        throw new Error(`InjectionEngine.write: ${v.reason}`);
      }
      return;
    }
    this.knowledgeBase.set(key, [value]);
    this.invalidateVectorIndex();
  }

  /**
   * v13 — P3.2: append a value to a key. Validates the key.
   *
   * v14 — P8.4: invalidates the vector index cache.
   */
  append(key: string, value: string): void {
    const v = validateNamespace(key);
    if (!v.valid) {
      if (this.strict) {
        throw new Error(`InjectionEngine.append: ${v.reason}`);
      }
      return;
    }
    const existing = this.knowledgeBase.get(key) ?? [];
    existing.push(value);
    this.knowledgeBase.set(key, existing);
    this.invalidateVectorIndex();
  }

  /**
   * v14 — P8.4: add a causal edge to the knowledge graph. The graph
   * powers `followHops` so the engine can surface downstream content
   * beyond the immediate category match.
   */
  addKnowledgeEdge(edge: Omit<CausalEdge, 'createdAt'>): { ok: boolean; reason?: string } {
    const r = addEdge(this.graph, edge);
    if (r.ok) {
      this.edges = this.graph.edges;
    }
    return r;
  }

  /**
   * v14 — P8.4: follow the causal edge graph from a starting key, then
   * return the actual content stored at each reachable key.
   *
   * - `depth` defaults to 2.
   * - `relations` restricts the traversal (default: all).
   * - Returns an array of content strings (joined values), de-duplicated
   *   and excluding the start key.
   */
  followHops(
    key: string,
    depth: number = 2,
    options?: { relations?: CausalRelation[]; direction?: 'forward' | 'backward' | 'both' },
  ): string[] {
    // Walk BFS ourselves so we can collect content for *every* visited
    // key (not just neighbours of the start key). This is critical for
    // depth > 1 — e.g. A → B → C must surface content from B and C.
    const relations = options?.relations;
    const direction = options?.direction ?? 'forward';
    const visited = new Set<string>([key]);
    let frontier: string[] = [key];
    const orderedKeys: string[] = [];

    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const k of frontier) {
        for (const edge of this.graph.edges) {
          if (relations && !relations.includes(edge.relation)) continue;
          const matches =
            (direction === 'forward' && edge.from === k) ||
            (direction === 'backward' && edge.to === k) ||
            (direction === 'both' && (edge.from === k || edge.to === k));
          if (!matches) continue;
          const other = edge.from === k ? edge.to : edge.from;
          if (visited.has(other)) continue;
          visited.add(other);
          orderedKeys.push(other);
          next.push(other);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }

    const collected: string[] = [];
    const seenContent = new Set<string>();
    for (const k of orderedKeys) {
      const values = this.knowledgeBase.get(k);
      if (!values) continue;
      for (const v of values) {
        if (seenContent.has(v)) continue;
        seenContent.add(v);
        collected.push(v);
      }
    }
    return collected;
  }

  /**
   * v14 — P8.4: hybrid keyword + vector search over the knowledge base.
   *
   * Steps:
   *   1. Ensure the vector index is built (lazy, invalidated on write).
   *   2. Compute keyword scores by tokenising the query and counting
   *      overlap with each key's joined content.
   *   3. Query the HNSW index for cosine similarity.
   *   4. Combine with `keywordWeight` / `vectorWeight` and return the
   *      top-K results. Results are LRU-cached by query string.
   */
  hybridSearch(query: string, options?: HybridSearchOptions): RAGSearchResult[] {
    const cached = this.lruCache.get(query);
    if (cached && !options?.restrictTo) {
      return cached;
    }

    this.ensureVectorIndex();

    const k = options?.k ?? 5;
    const kwWeight = options?.keywordWeight ?? 0.5;
    const vecWeight = options?.vectorWeight ?? 0.5;

    // 1) keyword scores
    const qTokens = query
      .toLowerCase()
      .split(/[^a-z0-9_一-鿿]+/)
      .filter((t) => t.length > 0);
    const qVec = bowVectorize(query, this.vocab);
    const keywordScores = new Map<string, number>();
    for (const [key, values] of this.knowledgeBase.entries()) {
      if (options?.restrictTo && !options.restrictTo.includes(key)) continue;
      const joined = values.join(' ').toLowerCase();
      if (joined.length === 0) {
        keywordScores.set(key, 0);
        continue;
      }
      let matches = 0;
      for (const t of qTokens) {
        if (joined.includes(t)) matches += 1;
      }
      // Normalise by query length to get a [0, 1] score.
      keywordScores.set(key, qTokens.length === 0 ? 0 : matches / qTokens.length);
    }

    // 2) vector scores
    const vecResults: HNSWSearchResult[] = this.vectorIndex.search(qVec, this.knowledgeBase.size);
    const vectorScores = new Map<string, number>();
    for (const r of vecResults) {
      if (options?.restrictTo && !options.restrictTo.includes(r.key)) continue;
      vectorScores.set(r.key, mapSimilarity(r.similarity));
    }

    // 3) combine
    const allKeys = new Set<string>([
      ...keywordScores.keys(),
      ...vectorScores.keys(),
    ]);
    const combined: RAGSearchResult[] = [];
    for (const key of allKeys) {
      const kw = keywordScores.get(key) ?? 0;
      const vs = vectorScores.get(key) ?? 0;
      const finalScore = kwWeight * kw + vecWeight * vs;
      const values = this.knowledgeBase.get(key) ?? [];
      combined.push({
        key,
        score: finalScore,
        keywordScore: kw,
        vectorScore: vs,
        content: values.join('\n'),
      });
    }

    combined.sort((a, b) => b.score - a.score);
    const top = combined.slice(0, k);
    if (!options?.restrictTo) {
      this.lruCache.set(query, top);
    }
    return top;
  }

  /**
   * v14 — P8.4: simplified Maximal Marginal Relevance (MMR) reranking.
   *
   * Iteratively picks the highest-scoring result that isn't too similar
   * to anything already selected. Similarity is computed on the
   * concatenated text of each result (cheap proxy — Jaccard over tokens).
   */
  diversityRanking(
    results: RAGSearchResult[],
    limit: number,
    lambda: number = 0.5,
  ): RAGSearchResult[] {
    if (limit <= 0) return [];
    if (results.length <= limit) return [...results];

    const selected: RAGSearchResult[] = [];
    const remaining = [...results];

    // Pre-compute token sets for Jaccard similarity
    const tokenize = (s: string): Set<string> =>
      new Set(
        s
          .toLowerCase()
          .split(/[^a-z0-9_一-鿿]+/)
          .filter((t) => t.length > 0),
      );
    const tokenSets = new Map<string, Set<string>>();
    for (const r of remaining) {
      tokenSets.set(r.key, tokenize(r.content));
    }
    const jaccard = (a: Set<string>, b: Set<string>): number => {
      if (a.size === 0 && b.size === 0) return 0;
      let inter = 0;
      for (const t of a) if (b.has(t)) inter += 1;
      const union = a.size + b.size - inter;
      return union === 0 ? 0 : inter / union;
    };

    while (selected.length < limit && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const r = remaining[i]!;
        const tA = tokenSets.get(r.key) ?? new Set<string>();
        let maxSim = 0;
        for (const s of selected) {
          const tB = tokenSets.get(s.key) ?? new Set<string>();
          const sim = jaccard(tA, tB);
          if (sim > maxSim) maxSim = sim;
        }
        const mmr = lambda * r.score - (1 - lambda) * maxSim;
        if (mmr > bestScore) {
          bestScore = mmr;
          bestIdx = i;
        }
      }
      const chosen = remaining.splice(bestIdx, 1)[0]!;
      selected.push(chosen);
    }
    return selected;
  }

  /**
   * v14 — P8.4: expose the LRU cache size for testing / observability.
   */
  getCacheSize(): number {
    return this.lruCache.size;
  }

  /** v14 — P8.4: clear all caches (vector + LRU). */
  clearCaches(): void {
    this.invalidateVectorIndex();
    this.lruCache.clear();
  }

  // ── Private helpers ───────────────────────────────────────

  private initializeKnowledge(): void {
    this.knowledgeBase.set('architecture', [
      'Use layered architecture for maintainability',
      'Prefer composition over inheritance',
      'SOLID principles apply to all designs',
    ]);
    this.knowledgeBase.set('typescript', [
      'Use strict mode — no implicit any',
      'Prefer interfaces over type aliases for public APIs',
      'Use discriminated unions for state machines',
    ]);
    this.knowledgeBase.set('testing', [
      'TDD: RED → GREEN → REFACTOR',
      'Test behaviors, not implementation',
      'Mock external boundaries only',
    ]);
    this.knowledgeBase.set('security', [
      'Validate all inputs — never trust user data',
      'Use parameterized queries for SQL',
      'Never hardcode secrets',
    ]);
    this.knowledgeBase.set('build', [
      'Fail fast — validate inputs at boundaries',
      'Profile before optimizing',
      'Atomic commits per concern',
    ]);
  }

  private matchesContext(category: string, context: InjectionContext): boolean {
    const stageLower = context.stage.toLowerCase();
    const tagsLower = context.tags.map(t => t.toLowerCase());

    if (category === 'testing' && (stageLower === 'verify' || tagsLower.includes('test'))) return true;
    if (category === 'security' && (stageLower === 'build' || tagsLower.includes('security'))) return true;
    if (category === 'architecture' && (stageLower === 'design' || tagsLower.includes('architecture'))) return true;
    if (category === 'typescript' && context.language === 'typescript') return true;
    if (category === 'build' && (stageLower === 'build' || stageLower === 'verify')) return true;

    return false;
  }

  /**
   * v14 — P8.4: which knowledge keys match the given context.
   * Used to seed `followHops` from `inject()`.
   */
  private matchKeys(context: InjectionContext): string[] {
    const matched: string[] = [];
    for (const [category] of this.knowledgeBase) {
      if (this.matchesContext(category, context)) {
        matched.push(category);
      }
    }
    return matched;
  }

  private invalidateVectorIndex(): void {
    this.vectorIndexReady = false;
    this.vocab = [];
    this.vectorDim = 1;
    this.lruCache.clear();
  }

  private ensureVectorIndex(): void {
    if (this.vectorIndexReady) return;
    const docs: string[] = [];
    const keys: string[] = [];
    for (const [key, values] of this.knowledgeBase.entries()) {
      keys.push(key);
      docs.push(values.join(' '));
    }
    this.vocab = buildVocab(docs);
    this.vectorDim = Math.max(1, this.vocab.length);
    this.vectorIndex = createHNSWIndex({ dimensions: this.vectorDim, normalize: true });
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      const vec = bowVectorize(docs[i] ?? '', this.vocab);
      this.vectorIndex.insert(k, vec);
    }
    this.vectorIndexReady = true;
  }
}
