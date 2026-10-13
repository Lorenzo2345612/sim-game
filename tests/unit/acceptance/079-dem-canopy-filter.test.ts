import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { removeCanopy } from '../../../tools/track-builder/elevation';
import type { DemGrid } from '../../../tools/dem/fetchDem';
import type { TrackDataV2 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');

function makeGrid(rows: number, cols: number, heights: number[]): DemGrid {
  return { lon0: 0, lat0: 0, dLon: 0.001, dLat: 0.001, rows, cols, heights };
}

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
  ) as TrackDataV2;
}

function range(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

describe('079 DEM canopy filter acceptance', () => {
  it('AT1: opening with r=2 removes a 3x3 forest block on a 100 plain, leaving every cell at 100', () => {
    const N = 20;
    const heights = new Array<number>(N * N).fill(100);
    for (let i = 8; i <= 10; i++) {
      for (let j = 8; j <= 10; j++) heights[i * N + j] = 125;
    }
    const out = removeCanopy(makeGrid(N, N, heights), 2);
    expect(out.heights.length).toBe(N * N);
    for (const h of out.heights) {
      expect(Math.abs(h - 100)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AT2: opening with r=2 leaves a plane rising 1 per column unchanged at interior columns 2..17', () => {
    const N = 20;
    const heights: number[] = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) heights.push(j);
    }
    const out = removeCanopy(makeGrid(N, N, heights), 2);
    for (let i = 0; i < N; i++) {
      for (let j = 2; j <= 17; j++) {
        expect(Math.abs(out.heights[i * N + j] - j)).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it('AT3: opening with r=2 drops the peak of a broad gaussian hill (60x60, 30 m cells, sigma 300 m, 40 m high) by less than 2 m', () => {
    const N = 60;
    const C = 30;
    const CELL = 30;
    const SIGMA = 300;
    const heights: number[] = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const d2 = ((i - C) * CELL) ** 2 + ((j - C) * CELL) ** 2;
        heights.push(40 * Math.exp(-d2 / (2 * SIGMA * SIGMA)));
      }
    }
    const out = removeCanopy(makeGrid(N, N, heights), 2);
    expect(Math.max(...heights) - Math.max(...out.heights)).toBeLessThan(2);
  });

  it('AT4: regenerated monza.json has elevation range <= 22.5 m and terrain heights range <= 42 m (canopy spikes removed; was 54)', () => {
    const d = loadTrack('monza');
    expect(range(d.elevation)).toBeLessThanOrEqual(22.5);
    expect(range(d.terrain.heights)).toBeLessThanOrEqual(42);
  });

  it('AT5: regenerated spa.json elevation range is 90-110 m and silverstone.json <= 15 m', () => {
    const spa = range(loadTrack('spa').elevation);
    expect(spa, `spa elevation range ${spa}`).toBeGreaterThanOrEqual(90);
    expect(spa, `spa elevation range ${spa}`).toBeLessThanOrEqual(110);
    expect(range(loadTrack('silverstone').elevation)).toBeLessThanOrEqual(15);
  });

  it('AT6: removeCanopy does not mutate the input grid and returns a new grid with the same dimensions', () => {
    const N = 10;
    const heights = new Array<number>(N * N).fill(0);
    for (let i = 4; i <= 6; i++) {
      for (let j = 4; j <= 6; j++) heights[i * N + j] = 50;
    }
    const input = makeGrid(N, N, heights);
    const before = input.heights.slice();
    const out = removeCanopy(input, 2);
    expect(input.heights).toEqual(before);
    expect(out).not.toBe(input);
    expect(out.rows).toBe(input.rows);
    expect(out.cols).toBe(input.cols);
  });
});
