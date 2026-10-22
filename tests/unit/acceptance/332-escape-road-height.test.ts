import { describe, expect, it } from 'vitest';
import type { EscapeRoad, TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces, escapeRoadStrips } from '../../../src/track/surfaces';

const RUNOFF_Y = 0.01;

// Closed rectangle 400 x 200, 2 m spacing: bottom edge runs +X at z = 0 (right = +Z, left = -Z).
function rect(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x < 400; x += 2) pts.push([x, 0]);
  for (let z = 0; z < 200; z += 2) pts.push([400, z]);
  for (let x = 400; x > 0; x -= 2) pts.push([x, 200]);
  for (let z = 200; z > 0; z -= 2) pts.push([0, z]);
  return pts;
}

function track(grade: number, bankTan: number, escapeRoads: EscapeRoad[]): TrackDataV2 {
  const pts = rect();
  return {
    version: 2,
    id: 'escape-height',
    name: 'Escape Height',
    widthMeters: 12,
    lengthMeters: 1200,
    officialLengthMeters: 1200,
    centerline: pts,
    sectors: [0, 100, 200],
    elevation: pts.map((_, i) => (i < 200 ? grade * 2 * i : grade * 400)),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 200, originZ: 100, sizeX: 1, sizeZ: 1, rows: 1, cols: 1, heights: [0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 2, end: 20, side: 'left' },
    escapeRoads,
    source: { dataset: 'test', license: 'test', url: '', dem: '' },
    ...(bankTan ? { bank: pts.map(() => Math.atan(bankTan)) } : {}),
  } as TrackDataV2;
}

// Left of the +X edge is -Z; a thin road keeps every vertex at station x = 101.
const leftRoad = (): EscapeRoad => ({
  width: 0.001,
  points: [8, 16, 24, 32, 40].map((d) => [101, -d] as [number, number]),
});

function ys(positions: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 1; i < positions.length; i += 3) out.push(positions[i]);
  return out;
}

describe('332 escape road height follows the track on slopes', () => {
  it('AT1: on a 0.15 grade the road sits at the interpolated elevation between vertices', () => {
    const strips = escapeRoadStrips(track(0.15, 0, [leftRoad()]));
    expect(strips).toHaveLength(1);
    const y = ys(strips[0].positions);
    expect(y.length).toBeGreaterThan(0);
    for (const v of y) expect(Math.abs(v - (0.15 * 101 + RUNOFF_Y))).toBeLessThan(1e-4);
  });

  it('AT2: on a flat banked track the road height is RUNOFF_Y plus offset times bank tan', () => {
    const strips = escapeRoadStrips(track(0, 0.05, [leftRoad()]));
    const p = strips[0].positions;
    for (let i = 0; i < p.length; i += 3) {
      expect(Math.abs(p[i + 1] - (RUNOFF_Y + p[i + 2] * 0.05))).toBeLessThan(1e-4);
    }
  });

  it('AT5: a track without escape roads returns []', () => {
    expect(escapeRoadStrips(track(0.15, 0, []))).toEqual([]);
    const t = track(0.15, 0, []);
    delete t.escapeRoads;
    expect(escapeRoadStrips(t)).toEqual([]);
  });

  it('AT3 (smoke): surfaces still build with an escape road', () => {
    expect(buildTrackSurfaces(track(0.15, 0, [leftRoad()])).length).toBeGreaterThan(0);
  });
});
