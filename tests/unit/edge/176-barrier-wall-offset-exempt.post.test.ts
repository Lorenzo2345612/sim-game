import { describe, expect, it } from 'vitest';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { barrierRuns } from '../../../src/track/barrierPath';

// Two straights 3 m apart with a uniform half-width of 3 (no parallel narrowing).
function medianLoop(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 300; x += 2) pts.push([x, 0]);
  for (let x = 300; x >= 2; x -= 2) pts.push([x, 3]);
  pts.push([0, 3]);
  return pts;
}

function track(type: BarrierSegment['type']): TrackDataV2 {
  const centerline = medianLoop();
  return {
    version: 2,
    id: 'post-wall-exempt',
    name: 'Post Wall Exempt',
    widthMeters: 6,
    lengthMeters: 612,
    officialLengthMeters: 612,
    centerline,
    sectors: [0, 100, 200],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [{ start: 0, end: 150, side: 'right', type, offsetMeters: 2.5 }],
    terrain: { originX: 150, originZ: 1.5, sizeX: 800, sizeZ: 100, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 barrier wall offset exemption post-coder gaps', () => {
  it('POST1: a wall inside the nominal half-width of a non-narrowed side keeps every vertex; armco at the same offset loses the mid-track ones', () => {
    const wall = barrierRuns(track('wall'), 'right');
    expect(wall).toHaveLength(1);
    expect(wall[0].map((v) => v.index)).toEqual(Array.from({ length: 151 }, (_, i) => i));
    const armco = barrierRuns(track('armco'), 'right').flat();
    expect(armco.length).toBeLessThan(151);
    for (const v of armco) {
      expect(v.x > 5 && v.x < 295, `armco survivor (${v.x}, ${v.z})`).toBe(false);
    }
  });
});
