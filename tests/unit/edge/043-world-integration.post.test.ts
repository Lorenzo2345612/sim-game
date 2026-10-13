import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIXED_DT } from '../../../src/core/constants';
import { spawnFromTrack } from '../../../src/game/game';
import type { TrackDataV2 } from '../../../src/core/types';

const ROOT = new URL('../../..', import.meta.url);

function mainSrc(): string {
  return readFileSync(fileURLToPath(new URL('src/main.ts', ROOT)), 'utf8');
}

const CENTERLINE: [number, number][] = [
  [0, 0],
  [0, -2],
  [0, -4],
  [0, -6],
  [0, -8],
  [0, -10],
];

function v2Track(elevation: number[]): TrackDataV2 {
  return {
    version: 2,
    id: 'post-043',
    name: 'Post 043',
    widthMeters: 12,
    lengthMeters: 12,
    officialLengthMeters: 12,
    centerline: CENTERLINE,
    sectors: [0, 1, 2],
    elevation,
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 10, sizeZ: 10, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 1, side: 'right' },
    source: { dataset: 'test', license: 'test', url: 'https://example.com', dem: 'test.tif' },
  };
}

describe('043 world integration post-code gaps', () => {
  it('POST1: spawn y follows a negative elevation[N-5] (spawn below sea level)', () => {
    // N = 6 → N-5 = 1; elevation[1] = -4 → y = -3.4.
    const pose = spawnFromTrack(v2Track([0, -4, 0, 0, 0, 0]));
    expect(pose.position.y).toBeCloseTo(-3.4, 9);
    expect(pose.position.x).toBeCloseTo(CENTERLINE[1][0], 9);
    expect(pose.position.z).toBeCloseTo(CENTERLINE[1][1], 9);
  });

  it('POST2: the per-frame catch-up budget covers the whole frame clamp (steps >= clamp / FIXED_DT)', () => {
    const steps = Number(/MAX_SIM_STEPS_PER_FRAME = (\d+)/.exec(mainSrc())?.[1]);
    const clamp = Number(/Math\.min\(\(now - last\) \/ 1000, ([\d.]+)\)/.exec(mainSrc())?.[1]);
    expect(steps).toBeGreaterThan(0);
    expect(clamp).toBeGreaterThan(0);
    // A fully clamped frame must be consumable in one advance, or the sim runs slower than wall time.
    expect(steps).toBeGreaterThanOrEqual(clamp / FIXED_DT - 1e-9);
  });
});
