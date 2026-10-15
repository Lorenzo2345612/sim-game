import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { asphaltOwner, buildTrackSurfaces } from '../../../src/track/surfaces';

const R = 100;
const N = 120;

function circleTrack(runoffWidth: number): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: N }, (_, i) => {
    const a = (2 * Math.PI * i) / N;
    return [R * Math.cos(a), R * Math.sin(a)] as [number, number];
  });
  return {
    version: 2,
    id: 'edge-overlap',
    name: 'Edge Overlap',
    widthMeters: 12,
    lengthMeters: 2 * Math.PI * R,
    officialLengthMeters: 2 * Math.PI * R,
    centerline,
    sectors: [0, 40, 80],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [
      { start: 0, end: N - 1, side: 'left', surface: 'runoff', widthMeters: runoffWidth },
      { start: 0, end: N - 1, side: 'right', surface: 'runoff', widthMeters: runoffWidth },
    ],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 1000, sizeZ: 1000, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 overlap filter edge cases', () => {
  it('EDGE2: no runoff/grass/gravel triangle has a centroid or vertex on asphalt per asphaltOwner', () => {
    // Runoff wide enough that unclamped ribbons wrap past the centre and land on the far asphalt.
    const track = circleTrack(195);
    const strips = buildTrackSurfaces(track);
    expect(strips.some((s) => s.surface === 'asphalt')).toBe(true);
    const owner = asphaltOwner(track);
    for (const s of strips) {
      if (s.surface === 'asphalt' || s.surface === 'kerb') continue;
      const p = s.positions;
      const ind = s.indices;
      for (let k = 0; k + 2 < ind.length; k += 3) {
        const a = 3 * ind[k];
        const b = 3 * ind[k + 1];
        const c = 3 * ind[k + 2];
        expect(owner((p[a] + p[b] + p[c]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3), `${s.surface} centroid`).toBe(-1);
        expect(owner(p[a], p[a + 2]), `${s.surface} vertex a`).toBe(-1);
        expect(owner(p[b], p[b + 2]), `${s.surface} vertex b`).toBe(-1);
        expect(owner(p[c], p[c + 2]), `${s.surface} vertex c`).toBe(-1);
      }
    }
  });
});
