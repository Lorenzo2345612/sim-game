import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { escapeRoadStrips } from '../../../src/track/surfaces';

function straightTrack(): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: 20 }, (_, i): [number, number] => [0, -2 * i]);
  return {
    version: 2,
    id: 'post-rewind',
    name: 'Post Rewind',
    widthMeters: 12,
    lengthMeters: 40,
    officialLengthMeters: 40,
    centerline,
    sectors: [0, 5, 10],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: -20, sizeX: 100, sizeZ: 200, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 escape strip rewind post-coder gaps', () => {
  it('POST1: a doubling-back road keeps every triangle and winds them all the same way', () => {
    const points: [number, number][] = [[10, 0], [10, 20], [12, 20], [12, 0]];
    const strip = escapeRoadStrips({ ...straightTrack(), escapeRoads: [{ points, width: 4 }] })[0];
    expect(strip).toBeDefined();
    expect(strip.indices.length).toBe((points.length - 1) * 6);
    const p = strip.positions;
    const ind = strip.indices;
    const area2 = (a: number, b: number, c: number): number =>
      (p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[c] - p[a]) * (p[b + 2] - p[a + 2]);
    const signs = new Set<number>();
    for (let k = 0; k + 2 < ind.length; k += 3) {
      const s = Math.sign(area2(3 * ind[k], 3 * ind[k + 1], 3 * ind[k + 2]));
      if (s !== 0) signs.add(s);
    }
    expect(signs.size).toBe(1);
  });
});
