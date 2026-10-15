import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { halfWidthAt } from '../../../src/track/surfaces';
import { barrierRuns } from '../../../src/track/barrierPath';

function rectangleLoop(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 300; x += 2) pts.push([x, 0]);
  pts.push([300, 2], [300, 4]);
  for (let x = 300; x >= 2; x -= 2) pts.push([x, 6]);
  pts.push([0, 6], [0, 4], [0, 2]);
  return pts;
}

function track(): TrackDataV2 {
  const centerline = rectangleLoop();
  return {
    version: 2,
    id: 'edge-barrier-drop',
    name: 'Edge Barrier Drop',
    widthMeters: 4,
    lengthMeters: 624,
    officialLengthMeters: 624,
    centerline,
    sectors: [0, 102, 204],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [
      { start: 0, end: centerline.length - 1, side: 'right', type: 'armco', offsetMeters: 4 },
      { start: 0, end: centerline.length - 1, side: 'left', type: 'armco', offsetMeters: 4 },
    ],
    terrain: { originX: 150, originZ: 3, sizeX: 800, sizeZ: 100, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 barrier drop edge cases', () => {
  it('EDGE7: barrier vertices near another track part are dropped and runs never fall below 2 vertices', () => {
    const t = track();
    const n = t.centerline.length;
    for (const side of ['right', 'left'] as const) {
      const runs = barrierRuns(t, side);
      for (const run of runs) {
        expect(run.length).toBeGreaterThanOrEqual(2);
        for (const v of run) {
          for (let j = 0; j < n; j++) {
            const dIdx = Math.min(Math.abs(j - v.index), n - Math.abs(j - v.index));
            if (dIdx <= 5) continue;
            const d = Math.hypot(t.centerline[j][0] - v.x, t.centerline[j][1] - v.z);
            expect(d, `${side} vertex ${v.index} vs point ${j}`).toBeGreaterThanOrEqual(
              halfWidthAt(t, side, j) + 0.3 - 1e-3,
            );
          }
        }
      }
    }
    const right = barrierRuns(t, 'right').flat();
    expect(right.length).toBeLessThan(n);
    for (const v of right) {
      expect(v.x > 5 && v.x < 295 && v.z > 2.1 && v.z < 5.9, `survivor (${v.x}, ${v.z})`).toBe(false);
    }
    const left = barrierRuns(t, 'left').flat();
    expect(left.some((v) => Math.abs(v.x - 150) < 1e-3 && Math.abs(v.z + 4) < 1e-3)).toBe(true);
  });
});
