import { describe, it, expect, beforeEach } from 'vitest';
import {
  InjectionEngine,
  bowVectorize,
  buildVocab,
} from '../../packages/core/src/L9_knowledge/injection-engine';

describe('v14-P8.4 RAG memory + graph hops', () => {
  let engine: InjectionEngine;
  beforeEach(() => {
    engine = new InjectionEngine({ strict: true });
  });

  it('1) hybridSearch ranks by combined keyword + vector score', () => {
    // architecture is seeded with "layered architecture" etc.
    const results = engine.hybridSearch('layered architecture', { k: 3 });
    expect(results.length).toBeGreaterThan(0);
    // 'architecture' should be top-ranked because the query overlaps fully.
    expect(results[0]!.key).toBe('architecture');
    expect(results[0]!.keywordScore).toBeGreaterThan(0);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('2) followHops traverses the causal graph and returns neighbour content', () => {
    // Seed: architecture --causes--> build --enables--> testing
    const r1 = engine.addKnowledgeEdge({
      from: 'architecture',
      to: 'build',
      relation: 'causes',
      weight: 1,
    });
    const r2 = engine.addKnowledgeEdge({
      from: 'build',
      to: 'testing',
      relation: 'enables',
      weight: 1,
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // depth=2 should reach 'testing' through 'build'
    const hops = engine.followHops('architecture', 2, { relations: ['causes', 'enables'] });
    // 'build' content is 'Fail fast…', 'Profile before…', 'Atomic commits…'
    // 'testing' content is 'TDD: RED → GREEN → REFACTOR', …
    expect(hops.some((h) => h.toLowerCase().includes('fail fast') || h.toLowerCase().includes('profile before') || h.toLowerCase().includes('atomic commits'))).toBe(true);
    expect(hops.some((h) => h.toLowerCase().includes('tdd') || h.toLowerCase().includes('mock external'))).toBe(true);
  });

  it('3) followHops respects the relations filter', () => {
    engine.addKnowledgeEdge({ from: 'architecture', to: 'build', relation: 'causes', weight: 1 });
    engine.addKnowledgeEdge({ from: 'architecture', to: 'security', relation: 'blocks', weight: 1 });
    // 'causes' only — should reach 'build' but not 'security'
    const hops = engine.followHops('architecture', 2, { relations: ['causes'] });
    expect(hops.some((h) => h.toLowerCase().includes('fail fast'))).toBe(true);
    expect(hops.every((h) => !h.toLowerCase().includes('parameterized') && !h.toLowerCase().includes('hardcode secrets'))).toBe(true);
  });

  it('4) diversityRanking avoids selecting near-duplicate results first', () => {
    // The seed already has 'maintainability' in 2 categories: 'architecture'
    // ("Use layered architecture for maintainability") and 'typescript'
    // ("Use TypeScript with strict mode for maintainability"). That's
    // enough overlap to demonstrate MMR.
    const results = engine.hybridSearch('maintainability', { k: 5 });
    const reranked = engine.diversityRanking(results, 3, 0.5);
    expect(reranked.length).toBe(3);
    // Reranked top result should still be a high scorer, but the 2nd/3rd
    // should not be the most-similar-to-top alternative.
    expect(reranked[0]!.score).toBeGreaterThan(0);
    // Verify Jaccard-based de-duplication actually selected diverse items
    // (the exact selection depends on tokens, but all 3 should be different keys).
    const keys = reranked.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('5) hybridSearch is LRU-cached — second call returns same object', () => {
    const r1 = engine.hybridSearch('security secrets', { k: 3 });
    expect(engine.getCacheSize()).toBe(1);
    const r2 = engine.hybridSearch('security secrets', { k: 3 });
    // Same reference means the cache hit.
    expect(r2).toBe(r1);
    expect(engine.getCacheSize()).toBe(1);
  });

  it('6) bowVectorize + buildVocab helpers are exported and consistent', () => {
    const docs = ['hello world', 'hello there'];
    const vocab = buildVocab(docs);
    expect(vocab).toContain('hello');
    expect(vocab).toContain('world');
    expect(vocab).toContain('there');
    const v = bowVectorize('hello', vocab);
    expect(v.length).toBe(vocab.length);
    // 'hello' is at index of 'hello' in the sorted vocab.
    const idx = vocab.indexOf('hello');
    expect(v[idx]).toBe(1);
  });

  it('7) addKnowledgeEdge rejects duplicate edges', () => {
    engine.addKnowledgeEdge({ from: 'architecture', to: 'build', relation: 'causes', weight: 1 });
    const dup = engine.addKnowledgeEdge({ from: 'architecture', to: 'build', relation: 'causes', weight: 0.5 });
    expect(dup.ok).toBe(false);
  });

  it('8) inject() with useHops extends results with downstream content', () => {
    engine.addKnowledgeEdge({ from: 'architecture', to: 'build', relation: 'causes', weight: 1 });
    const base = engine.inject({ stage: 'design', tags: ['architecture'] });
    const extended = engine.inject(
      { stage: 'design', tags: ['architecture'] },
      { useHops: true, hops: 1 },
    );
    expect(extended.length).toBeGreaterThanOrEqual(base.length);
    // The hop result for 'build' should now be included.
    expect(extended.some((s) => s.toLowerCase().includes('fail fast') || s.toLowerCase().includes('profile before'))).toBe(true);
  });

  it('9) clearCaches resets vector index and LRU', () => {
    engine.hybridSearch('TDD', { k: 3 });
    expect(engine.getCacheSize()).toBeGreaterThan(0);
    engine.clearCaches();
    expect(engine.getCacheSize()).toBe(0);
  });
});
