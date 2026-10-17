import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Terrain, TrackDataV2 } from '../../../src/core/types';
import { footprintGround, groundHeightAt, terrainHeightAt } from '../../../src/track/ground';

const ROOT = join(__dirname, '..', '..', '..');

const RAMP: Terrain = {
  originX: 0,
  originZ: 0,
  sizeX: 200,
  sizeZ: 100,
  cols: 20,
  rows: 10,
  heights: Array.from({ length: 21 * 11 }, (_, k) => 0.1 * (-100 + 10 * Math.floor(k / 11))),
};

function straight(elevation: number[]): TrackDataV2 {
  const t: Omit<TrackDataV2, 'terrain'> = {
    version: 2,
    id: 'straight',
    name: 'Straight',
    widthMeters: 12,
    lengthMeters: 990,
    officialLengthMeters: 990,
    centerline: Array.from({ length: 100 }, (_, i): [number, number] => [i * 10, 0]),
    sectors: [0, 33, 66],
    elevation,
    kerbs: [],
    runoffs: [],
    barriers: [],
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 10, end: 30, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
  };
  return t as TrackDataV2;
}

const STRAIGHT = straight(Array.from({ length: 100 }, () => 0));

const LINE: TrackDataV2 = {
  version: 2,
  id: 'line',
  name: 'Line',
  widthMeters: 12,
  lengthMeters: 180,
  officialLengthMeters: 180,
  centerline: Array.from({ length: 91 }, (_, i): [number, number] => [-90 + 2 * i, 0]),
  sectors: [0, 30, 60],
  elevation: Array.from({ length: 91 }, (_, i) => 0.1 * (-90 + 2 * i)),
  kerbs: [],
  runoffs: [],
  barriers: [],
  terrain: RAMP,
  treeSpecies: [],
  trees: [],
  grandstands: [],
  pit: { start: 10, end: 30, side: 'right' },
  source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
};

describe('233 ground sampler acceptance', () => {
  it('AT1: terrainHeightAt at RAMP vertex j=3 i=4 (-70, -10) is -7', () => {
    expect(terrainHeightAt(RAMP, -70, -10)).toBeCloseTo(-7, 9);
  });

  it('AT2: terrainHeightAt at (5, 7) interpolates the RAMP to 0.5', () => {
    expect(terrainHeightAt(RAMP, 5, 7)).toBeCloseTo(0.5, 9);
  });

  it('AT3: terrainHeightAt clamps (500, 0) and (-500, 0) to 10 and -10', () => {
    expect(terrainHeightAt(RAMP, 500, 0)).toBeCloseTo(10, 9);
    expect(terrainHeightAt(RAMP, -500, 0)).toBeCloseTo(-10, 9);
  });

  it('AT4: groundHeightAt without terrain at (40, 3) uses the nearest elevation 2.0', () => {
    const track = { ...STRAIGHT, elevation: Array.from({ length: 100 }, (_, i) => 0.5 * i) };
    expect(groundHeightAt(track, 40, 3)).toBeCloseTo(2, 9);
  });

  it('AT5: groundHeightAt on LINE at (5, 7) equals terrainHeightAt of the RAMP terrain', () => {
    expect(groundHeightAt(LINE, 5, 7)).toBeCloseTo(terrainHeightAt(RAMP, 5, 7), 12);
  });

  it('AT6: footprintGround at yaw 0 spans -1 to 1', () => {
    const { min, max } = footprintGround(LINE, 0, 0, 0, -10, 10, 0, 10);
    expect(min).toBeCloseTo(-1, 9);
    expect(max).toBeCloseTo(1, 9);
  });

  it('AT7: footprintGround at yaw pi/2 spans 0 to 1', () => {
    const { min, max } = footprintGround(LINE, 0, 0, Math.PI / 2, -10, 10, 0, 10);
    expect(min).toBeCloseTo(0, 9);
    expect(max).toBeCloseTo(1, 9);
  });

  it('AT8: footprintGround with xMin > xMax throws RangeError', () => {
    expect(() => footprintGround(LINE, 0, 0, 0, 10, -10, 0, 10)).toThrow(RangeError);
  });

  it('AT9: main.ts imports the ground module and neither main.ts nor pitAndStart.ts carry local samplers; ground.ts imports no three', () => {
    const mainSrc = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
    const pitSrc = readFileSync(join(ROOT, 'src', 'render', 'pitAndStart.ts'), 'utf8');
    const groundSrc = readFileSync(join(ROOT, 'src', 'track', 'ground.ts'), 'utf8');
    expect(mainSrc).not.toMatch(/\bfunction\s+makeTerrainY\b/);
    expect(mainSrc).not.toMatch(/\bfunction\s+nearestElevation\b/);
    expect(pitSrc).not.toMatch(/\bfunction\s+terrainY\b/);
    expect(mainSrc).toMatch(/from\s+['"][^'"]*\/ground['"]/);
    expect(groundSrc).not.toMatch(/from\s+['"]three['"]/);
  });
});
