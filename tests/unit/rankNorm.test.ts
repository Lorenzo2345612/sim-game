import { describe, it, expect } from 'vitest';
import { centeredRanks, rankSumFitness } from '../../scripts/evolve/rank.mts';

describe('multi-track rank normalisation', () => {
  it('maps ranks to [-0.5, 0.5], lowest first', () => {
    expect(centeredRanks([30, 10, 20])).toEqual([0.5, -0.5, 0]);
    const r = centeredRanks([5, 1, 9, 3, 7]);
    expect(Math.min(...r)).toBe(-0.5);
    expect(Math.max(...r)).toBe(0.5);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
  });
  it('ties share the mean rank; degenerate sizes give zeros', () => {
    expect(centeredRanks([1, 1, 1])).toEqual([0, 0, 0]);
    expect(centeredRanks([2, 1, 2, 3])[0]).toBeCloseTo(centeredRanks([2, 1, 2, 3])[2], 12);
    expect(centeredRanks([7])).toEqual([0]);
    expect(centeredRanks([])).toEqual([]);
  });
  it('is scale free: a track with 100x larger fitness does not dominate', () => {
    const small = [1, 2, 3, 4], big = [400, 300, 200, 100].map((v) => v * 100);
    const sum = rankSumFitness([small, big]);
    expect(sum.every((v) => Math.abs(v) < 1e-12)).toBe(true); // opposite orderings cancel exactly
    expect(rankSumFitness([small, small])[3]).toBeCloseTo(1, 12);
  });
});
