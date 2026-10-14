import { describe, expect, it } from 'vitest';
import { parseCube, passesFor } from '../../../src/render/postProcessing';
import { generateCubeLut } from '../../../tools/assets/buildLut';

describe('105 post-processing acceptance', () => {
  it('AT1: passesFor returns [] for low, the pass chains for medium and high', () => {
    expect(passesFor('low')).toEqual([]);
    expect(passesFor('medium')).toEqual(['render', 'bloom', 'lut', 'smaa', 'output']);
    expect(passesFor('high')).toEqual(['render', 'gtao', 'bloom', 'lut', 'smaa', 'output']);
  });

  it('AT2: generated .cube parses to 33³ entries, identity ±0.05 on greys, R−B ≥ 0.01 at 0.9 grey', () => {
    const { size, data } = parseCube(generateCubeLut());
    expect(size).toBe(33);
    expect(data.length).toBe(33 ** 3 * 3);
    for (let i = 0; i < size; i++) {
      const v = i / (size - 1);
      const o = (i * size * size + i * size + i) * 3; // grey node (i,i,i), R fastest
      expect(Math.abs(data[o] - v)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(data[o + 1] - v)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(data[o + 2] - v)).toBeLessThanOrEqual(0.05);
    }
    const k = Math.round(0.9 * (size - 1)); // grey grid value nearest 0.9 (0.90625)
    const o = (k * size * size + k * size + k) * 3;
    expect(data[o] - data[o + 2]).toBeGreaterThanOrEqual(0.01);
  });
});
