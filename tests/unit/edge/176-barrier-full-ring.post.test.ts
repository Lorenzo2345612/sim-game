import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { barrierRuns } from '../../../src/track/barrierPath';

// Two 300 m straights 40 m apart joined by R 20 semicircles (~2 m sampling): a
// barrier offset of 2 m (half-width) on either side stays clear of every distant
// centerline point and the bends are smooth enough to clamp nothing.
function stadiumLoop(): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = 0; k * 2 < 300; k++) pts.push([k * 2, 0]);
  const m = Math.ceil((Math.PI * 20) / 2);
  for (let j = 0; j < m; j++) {
    const t = (Math.PI * j) / m;
    pts.push([300 + 20 * Math.sin(t), -20 + 20 * Math.cos(t)]);
  }
  for (let k = 0; k * 2 < 300; k++) pts.push([300 - k * 2, -40]);
  for (let j = 0; j < m; j++) {
    const t = (Math.PI * j) / m;
    pts.push([-20 * Math.sin(t), -20 - 20 * Math.cos(t)]);
  }
  return pts;
}

function track(): TrackDataV2 {
  const centerline = stadiumLoop();
  return {
    version: 2,
    id: 'post-full-ring',
    name: 'Post Full Ring',
    widthMeters: 4,
    lengthMeters: 726,
    officialLengthMeters: 726,
    centerline,
    sectors: [0, 121, 242],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [
      { start: 0, end: centerline.length - 1, side: 'right', type: 'armco', offsetMeters: 2 },
      { start: 0, end: centerline.length - 1, side: 'left', type: 'armco', offsetMeters: 2 },
    ],
    terrain: { originX: 150, originZ: -20, sizeX: 800, sizeZ: 100, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 barrier full-ring no-drop post-coder gaps', () => {
  it('POST1: full-ring barriers that cross nothing return one closed run with every index in order', () => {
    const t = track();
    const n = t.centerline.length;
    for (const side of ['right', 'left'] as const) {
      const runs = barrierRuns(t, side);
      expect(runs).toHaveLength(1);
      expect(runs[0].map((v) => v.index)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });
});
