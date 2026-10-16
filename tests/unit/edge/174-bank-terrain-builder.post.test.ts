import { describe, expect, it } from 'vitest';
import { buildTerrain, clampTerrainBelowStrips } from '../../../tools/track-builder/terrain';
import type { DemGrid } from '../../../tools/dem/fetchDem';
import { EARTH_RADIUS_M, type LonLat, type Point2 } from '../../../src/track/geo';
import type { Terrain, TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';

const ORIGIN: LonLat = [0, 0];
const DEG_M = (EARTH_RADIUS_M * Math.PI) / 180;
const DEG = Math.PI / 180;
const TAN = Math.tan(10 * DEG);

// Flat DEM (30 m pixels) around the world nodes, as in the 028 builder tests.
function flatDem(): DemGrid {
  const rows = 42;
  const cols = 42;
  return {
    lon0: -615 / DEG_M,
    lat0: 615 / DEG_M,
    dLon: 30 / DEG_M,
    dLat: 30 / DEG_M,
    rows,
    cols,
    heights: new Array<number>(rows * cols).fill(100),
  };
}

function nodeHeight(t: Terrain, x: number, z: number): number {
  const j = Math.round((x - (t.originX - t.sizeX / 2)) / (t.sizeX / t.cols));
  const i = Math.round((z - (t.originZ - t.sizeZ / 2)) / (t.sizeZ / t.rows));
  return t.heights[j * (t.rows + 1) + i];
}

// Straight 200 m centerline along +X at z = 0 (right = +Z), 5 m spacing.
const STRAIGHT: Point2[] = Array.from({ length: 41 }, (_, k) => [-100 + 5 * k, 0] as Point2);
const STRAIGHT_ELEV = STRAIGHT.map(() => 0);

function terrainHeightAt(t: Terrain): (x: number, z: number) => number {
  const x0 = t.originX - t.sizeX / 2;
  const z0 = t.originZ - t.sizeZ / 2;
  const sx = t.sizeX / t.cols;
  const sz = t.sizeZ / t.rows;
  const st = t.rows + 1;
  const h = t.heights;
  return (x, z): number => {
    const fx = (x - x0) / sx;
    const fz = (z - z0) / sz;
    const j = Math.min(t.cols - 1, Math.max(0, Math.floor(fx)));
    const i = Math.min(t.rows - 1, Math.max(0, Math.floor(fz)));
    const u = fx - j;
    const v = fz - i;
    return (
      h[j * st + i] * (1 - u) * (1 - v) +
      h[(j + 1) * st + i] * u * (1 - v) +
      h[j * st + i + 1] * (1 - u) * v +
      h[(j + 1) * st + i + 1] * u * v
    );
  };
}

function rectTrack(bank: number[] | undefined): TrackDataV2 {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 200; x += 5) pts.push([x, 0]);
  for (let z = 5; z <= 100; z += 5) pts.push([200, z]);
  for (let x = 195; x >= 5; x -= 5) pts.push([x, 100]);
  for (let z = 95; z >= 5; z -= 5) pts.push([0, z]);
  return {
    version: 2,
    id: 'bank-terrain',
    name: 'Bank Terrain',
    widthMeters: 12,
    lengthMeters: 600,
    officialLengthMeters: 600,
    centerline: pts,
    sectors: [0, 40, 80],
    elevation: pts.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 1, sizeZ: 1, rows: 1, cols: 1, heights: [0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'test', url: '', dem: '' },
    ...(bank ? { bank } : {}),
  };
}

describe('174 banked terrain builder post-coder gaps', () => {
  it('POST1: buildTerrain follows the cross-slope inside the corridor and ignores a zero bank exactly like no bank', () => {
    const sloped = STRAIGHT.map(() => 10 * DEG);
    const a = buildTerrain(flatDem(), STRAIGHT, STRAIGHT_ELEV, ORIGIN, 12, 3, sloped);
    const b = buildTerrain(flatDem(), STRAIGHT, STRAIGHT_ELEV, ORIGIN, 12, 3);
    const z0 = buildTerrain(flatDem(), STRAIGHT, STRAIGHT_ELEV, ORIGIN, 12, 3, STRAIGHT.map(() => 0));
    expect(z0.heights).toEqual(b.heights);
    // Nodes at x = -500 + 8j, z = -400 + 8i; (4, ±8) sit inside the 14 m corridor.
    expect(nodeHeight(a, 4, 8)).toBeCloseTo(-0.15 + 8 * TAN, 2);
    expect(nodeHeight(a, 4, -8)).toBeCloseTo(-0.15 - 8 * TAN, 2);
    expect(nodeHeight(b, 4, 8)).toBeCloseTo(-0.15, 2);
    expect(nodeHeight(b, 4, -8)).toBeCloseTo(-0.15, 2);
  });

  it('POST2: after the strip clamp the terrain stays 0.05 m below every banked surface vertex', () => {
    const track = rectTrack(Array.from({ length: 119 }, () => 10 * DEG));
    const strips = buildTrackSurfaces(track);
    const terrain = buildTerrain(
      flatDem(),
      track.centerline,
      track.elevation,
      ORIGIN,
      track.widthMeters,
      3,
      track.bank,
    );
    clampTerrainBelowStrips(terrain, strips);
    const th = terrainHeightAt(terrain);
    let checked = 0;
    for (const s of strips) {
      const p = s.positions;
      for (let k = 0; k + 2 < p.length; k += 3) {
        expect(th(p[k], p[k + 2]), `${s.surface} vertex`).toBeLessThanOrEqual(p[k + 1] - 0.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 120000);
});
