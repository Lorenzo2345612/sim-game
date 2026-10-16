import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { asphaltOwner, buildTrackSurfaces } from '../../../src/track/surfaces';

const R = 50;
const N = 180;
const HW = 6;

function circleTrack(): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: N }, (_, i) => {
    const a = (2 * Math.PI * i) / N;
    return [R * Math.cos(a), R * Math.sin(a)] as [number, number];
  });
  return {
    version: 2,
    id: 'post-verge',
    name: 'Post Verge',
    widthMeters: 2 * HW,
    lengthMeters: 2 * Math.PI * R,
    officialLengthMeters: 2 * Math.PI * R,
    centerline,
    sectors: [0, 60, 120],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [{ start: 0, end: N - 1, side: 'right', surface: 'runoff', widthMeters: 100 }],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 500, sizeZ: 500, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 verge clamp post-coder gaps', () => {
  it('POST1: verge columns on a tight inner corner stay between the half-width and 0.9 x radius', () => {
    const track = circleTrack();
    const grass = buildTrackSurfaces(track).filter((s) => s.surface === 'grass');
    expect(grass).toHaveLength(2);
    const owner = asphaltOwner(track);
    for (const strip of grass) {
      for (let v = 0; v < strip.positions.length; v += 3) {
        const x = strip.positions[v];
        const z = strip.positions[v + 2];
        const lateral = Math.abs(Math.hypot(x, z) - R);
        expect(lateral, `verge vertex lateral ${lateral}`).toBeGreaterThanOrEqual(HW - 1e-3);
        expect(lateral, `verge vertex lateral ${lateral}`).toBeLessThanOrEqual(0.9 * R + 1e-3);
        expect(owner(x, z), `verge vertex on asphalt (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(-1);
      }
    }
  });
});
