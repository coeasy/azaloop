import { describe, it, expect } from 'vitest';
import {
  createCausalGraph,
  addEdge,
  followCausalChain,
  serializeGraph,
  loadGraph,
  removeEdges,
} from '../../packages/core/src/L9_knowledge/causal-edge';

describe('CausalEdge (v14-P7.3)', () => {
  it('1) empty graph has no edges', () => {
    const g = createCausalGraph();
    expect(g.edges).toEqual([]);
  });

  it('2) addEdge succeeds for valid input', () => {
    const g = createCausalGraph();
    const r = addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: 0.8 });
    expect(r.ok).toBe(true);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].createdAt).toBeTruthy();
  });

  it('3) addEdge rejects self-loops', () => {
    const g = createCausalGraph();
    const r = addEdge(g, { from: 'a', to: 'a', relation: 'causes', weight: 1 });
    expect(r.ok).toBe(false);
  });

  it('4) addEdge rejects duplicate (from, to, relation) edges', () => {
    const g = createCausalGraph();
    addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: 1 });
    const r = addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: 0.5 });
    expect(r.ok).toBe(false);
    expect(g.edges).toHaveLength(1);
  });

  it('5) addEdge rejects out-of-range weight', () => {
    const g = createCausalGraph();
    expect(addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: 1.5 }).ok).toBe(false);
    expect(addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: -0.1 }).ok).toBe(false);
  });

  it('6) followCausalChain traverses forward up to depth', () => {
    const g = createCausalGraph();
    addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: 1 });
    addEdge(g, { from: 'b', to: 'c', relation: 'causes', weight: 1 });
    addEdge(g, { from: 'c', to: 'd', relation: 'causes', weight: 1 });
    addEdge(g, { from: 'x', to: 'b', relation: 'enables', weight: 1 }); // unrelated
    const out = followCausalChain(g, 'a', { depth: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.to)).toEqual(['b', 'c']);
  });

  it('7) followCausalChain with direction=backward', () => {
    const g = createCausalGraph();
    addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: 1 });
    addEdge(g, { from: 'b', to: 'c', relation: 'causes', weight: 1 });
    const out = followCausalChain(g, 'c', { depth: 2, direction: 'backward' });
    expect(out.map((e) => e.from)).toEqual(['b', 'a']);
  });

  it('8) followCausalChain respects relations filter', () => {
    const g = createCausalGraph();
    addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: 1 });
    addEdge(g, { from: 'a', to: 'c', relation: 'enables', weight: 1 });
    const out = followCausalChain(g, 'a', { depth: 1, relations: ['causes'] });
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe('b');
  });

  it('9) followCausalChain handles cycles via visited set', () => {
    const g = createCausalGraph();
    addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: 1 });
    addEdge(g, { from: 'b', to: 'a', relation: 'causes', weight: 1 });
    const out = followCausalChain(g, 'a', { depth: 10 });
    expect(out).toHaveLength(1);
  });

  it('10) removeEdges counts deletions', () => {
    const g = createCausalGraph();
    addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: 1 });
    addEdge(g, { from: 'b', to: 'c', relation: 'causes', weight: 1 });
    const n = removeEdges(g, (e) => e.from === 'a');
    expect(n).toBe(1);
    expect(g.edges).toHaveLength(1);
  });

  it('11) serialize + loadGraph round-trips', () => {
    const g = createCausalGraph();
    addEdge(g, { from: 'a', to: 'b', relation: 'causes', weight: 0.7 });
    addEdge(g, { from: 'b', to: 'c', relation: 'requires', weight: 1 });
    const text = serializeGraph(g);
    const restored = loadGraph(text);
    expect(restored.edges).toHaveLength(2);
  });

  it('12) loadGraph throws on invalid JSON', () => {
    expect(() => loadGraph('not-json')).toThrow();
  });
});
