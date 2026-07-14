import { describe, it, expect } from 'vitest';
import {
  createHNSWIndex,
  cosineSimilarity,
  euclideanDistance,
} from '../../packages/core/src/L2_memory/hnsw-index';

describe('HNSWIndex placeholder (v14-P7.3)', () => {
  it('1) createHNSWIndex throws on invalid dimensions', () => {
    expect(() => createHNSWIndex({ dimensions: 0 })).toThrow();
    expect(() => createHNSWIndex({ dimensions: -1 })).toThrow();
  });

  it('2) insert + size + keys', () => {
    const idx = createHNSWIndex({ dimensions: 3, normalize: false });
    idx.insert('a', [1, 0, 0]);
    idx.insert('b', [0, 1, 0]);
    expect(idx.size()).toBe(2);
    expect(idx.keys().sort()).toEqual(['a', 'b']);
  });

  it('3) insert rejects wrong dimension', () => {
    const idx = createHNSWIndex({ dimensions: 3 });
    expect(() => idx.insert('a', [1, 0])).toThrow(/vector length/);
  });

  it('4) search returns top-k by similarity', () => {
    const idx = createHNSWIndex({ dimensions: 3, normalize: true });
    idx.insert('x', [1, 0, 0]);
    idx.insert('y', [0, 1, 0]);
    idx.insert('z', [0.9, 0.1, 0]);
    const out = idx.search([1, 0, 0], 2);
    expect(out[0].key).toBe('x');
    expect(out[1].key).toBe('z');
    expect(out[0].similarity).toBeGreaterThan(out[1].similarity);
  });

  it('5) search rejects wrong query dimension', () => {
    const idx = createHNSWIndex({ dimensions: 3 });
    expect(() => idx.search([1, 0])).toThrow(/query length/);
  });

  it('6) cosineSimilarity of identical normalised vectors is 1', () => {
    const a = [1, 0, 0];
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it('7) cosineSimilarity of orthogonal vectors is 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('8) cosineSimilarity of zero vector is 0', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('9) euclideanDistance of identical vectors is 0', () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it('10) euclideanDistance of 1-unit-apart vectors is 1', () => {
    expect(euclideanDistance([0, 0], [1, 0])).toBe(1);
  });
});
