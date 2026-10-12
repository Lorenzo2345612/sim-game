import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { TrackDataV2, Terrain, TrackSegment } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');

interface TrackExpectation {
  id: string;
  name: string;
  lengthMeters: number;
  elevationRange: [number, number];
  treeRange: [number, number];
}

const TRACKS: TrackExpectation[] = [
  { id: 'monza', name: 'Monza', lengthMeters: 5793, elevationRange: [5, 30], treeRange: [2500, 6000] },
  { id: 'spa', name: 'Spa', lengthMeters: 7004, elevationRange: [80, 120], treeRange: [3000, 6000] },
  { id: 'silverstone', name: 'Silverstone', lengthMeters: 5891, elevationRange: [3, 25], treeRange: [300, 2500] },
];

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
  ) as TrackDataV2;
}

// Terrain grid layout (types.ts: origin = centre): x varies with column j, z with row i.
function terrainHeight(t: Terrain, x: number, z: number): number {
  const fx = ((x - t.originX) / t.sizeX + 0.5) * t.cols;
  const fz = ((z - t.originZ) / t.sizeZ + 0.5) * t.rows;
  const j0 = Math.min(t.cols - 1, Math.max(0, Math.floor(fx)));
  const i0 = Math.min(t.rows - 1, Math.max(0, Math.floor(fz)));
  const tx = fx - j0;
  const tz = fz - i0;
  const w = t.rows + 1;
  const h = (j: number, i: number) => t.heights[j * w + i];
  return (h(j0, i0) * (1 - tx) + h(j0 + 1, i0) * tx) * (1 - tz) +
    (h(j0, i0 + 1) * (1 - tx) + h(j0 + 1, i0 + 1) * tx) * tz;
}

function covers(seg: TrackSegment, i: number): boolean {
  return seg.end >= seg.start ? i >= seg.start && i <= seg.end : i >= seg.start || i <= seg.end;
}

describe('030 track builder v2 acceptance', () => {
  it('AT1: each built track json has version 2 and length within ±1 % of its official length', () => {
    for (const t of TRACKS) {
      const d = loadTrack(t.id);
      expect(d.version).toBe(2);
      expect(Math.abs(d.lengthMeters - t.lengthMeters) / t.lengthMeters).toBeLessThanOrEqual(0.01);
    }
  });

  it('AT2: elevation range of each track lies within its expected band', () => {
    for (const t of TRACKS) {
      const d = loadTrack(t.id);
      const range = Math.max(...d.elevation) - Math.min(...d.elevation);
      expect(range, `${t.id} elevation range ${range}`).toBeGreaterThanOrEqual(t.elevationRange[0]);
      expect(range, `${t.id} elevation range ${range}`).toBeLessThanOrEqual(t.elevationRange[1]);
    }
  });

  it('AT3: each track has ≥10 kerb runs, ≥6 run-offs and barriers on both sides covering every index', () => {
    for (const t of TRACKS) {
      const d = loadTrack(t.id);
      const n = d.centerline.length;
      expect(d.kerbs.length, `${t.id} kerbs`).toBeGreaterThanOrEqual(10);
      expect(d.runoffs.length, `${t.id} runoffs`).toBeGreaterThanOrEqual(6);
      for (const side of ['left', 'right'] as const) {
        const segs = d.barriers.filter(b => b.side === side);
        for (let i = 0; i < n; i++) {
          expect(segs.some(s => covers(s, i)), `${t.id} ${side} barrier gap at ${i}`).toBe(true);
        }
      }
    }
  });

  it('AT4: terrain heights length = (rows+1)(cols+1) and terrain under centerline[0] is within 0.3 m of elevation[0] − 0.15', () => {
    for (const t of TRACKS) {
      const d = loadTrack(t.id);
      expect(d.terrain.heights.length).toBe((d.terrain.rows + 1) * (d.terrain.cols + 1));
      const [x, z] = d.centerline[0];
      const sample = terrainHeight(d.terrain, x, z);
      expect(Math.abs(sample - (d.elevation[0] - 0.15)), `${t.id} terrain under start`).toBeLessThanOrEqual(0.3);
    }
  });

  it('AT5: tree counts fall in each track band (monza 2500-6000, spa 3000-6000, silverstone 300-2500)', () => {
    for (const t of TRACKS) {
      const d = loadTrack(t.id);
      const count = d.trees.reduce((sum, inst) => sum + inst.data.length / 4, 0);
      expect(count, `${t.id} trees`).toBeGreaterThanOrEqual(t.treeRange[0]);
      expect(count, `${t.id} trees`).toBeLessThanOrEqual(t.treeRange[1]);
    }
  });

  it('AT6: each track has ≥2 grandstands and a pit with a set side and both indices within the lap', () => {
    for (const t of TRACKS) {
      const d = loadTrack(t.id);
      expect(d.grandstands.length, `${t.id} grandstands`).toBeGreaterThanOrEqual(2);
      expect(['left', 'right']).toContain(d.pit.side);
      const n = d.centerline.length;
      expect(d.pit.start).toBeGreaterThanOrEqual(0);
      expect(d.pit.start).toBeLessThan(n);
      expect(d.pit.end).toBeGreaterThanOrEqual(0);
      expect(d.pit.end).toBeLessThan(n);
    }
  });

  it('AT7: the name field is the plain city/region name, never a commercial name', () => {
    for (const t of TRACKS) {
      expect(loadTrack(t.id).name).toBe(t.name);
    }
  });
});
