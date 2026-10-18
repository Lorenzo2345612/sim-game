import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { BarrierSegment, RunoffSegment, Terrain } from '../../../src/core/types';
import { projectLonLat, type LonLat, type Point2 } from '../../../src/track/geo';
import type { DemGrid } from '../../../tools/dem/fetchDem';

const ARROYO_MODULE = '../../../tools/track-builder/arroyo';
const TERRAIN_MODULE = '../../../tools/track-builder/terrain';
const BARRIERS_MODULE = '../../../tools/track-builder/barriers';
const TREES_MODULE = '../../../tools/track-builder/trees';

interface Arroyo243 {
  line: Point2[];
  width: number;
}
interface Bridge243 {
  from: number;
  to: number;
}
interface ArroyoModule {
  loadArroyos(areasJsonPath: string, origin: LonLat): Arroyo243[];
  findBridges(centerline: Point2[], arroyos: Arroyo243[]): Bridge243[];
  applyBridgeElevation(elevation: number[], bridges: Bridge243[]): number[];
  arroyoDepthAt(arroyos: Arroyo243[], x: number, z: number): number;
  ARROYO_DEPTH: number;
  ARROYO_BANK: number;
}
type BuildTerrain243 = (
  grid: DemGrid, centerline: Point2[], elevation: number[],
  origin: LonLat, widthMeters: number, maxBarrierOffset: number, bank?: number[],
  arroyos?: Arroyo243[], bridges?: Bridge243[],
) => Terrain;
type LayoutBarriers243 = (
  centerline: Point2[], widthMeters: number, kerbs: never[], runoffs: RunoffSegment[],
  pit?: undefined, environment?: undefined, walls?: undefined, bridges?: Bridge243[],
) => BarrierSegment[];
type PlaceTrees243 = (
  trackId: string, centerline: Point2[], terrain: Terrain,
  barriers: BarrierSegment[], biome: { species: { name: string; weight: number }[]; density: number },
  arroyos?: Arroyo243[],
) => { species: string; data: number[] }[];

async function loadModule<T>(path: string): Promise<T> {
  return (await import(path)) as T;
}

const ORIGIN: LonLat = [0, 0];
const CENTERLINE: Point2[] = Array.from({ length: 1001 }, (_, i): Point2 => [i, 0]);
const WIDTH = 12;
async function arroyo(): Promise<ArroyoModule> {
  return loadModule<ArroyoModule>(ARROYO_MODULE);
}

const tmp = mkdtempSync(join(tmpdir(), 'arroyo-edge-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function makeDem(slopeX: number): DemGrid {
  const rows = 42;
  const cols = 72;
  const heights: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) heights.push(100 + slopeX * (-615 + 30 * j));
  }
  return {
    lon0: -615 / ((6371008.8 * Math.PI) / 180),
    lat0: 615 / ((6371008.8 * Math.PI) / 180),
    dLon: 30 / ((6371008.8 * Math.PI) / 180),
    dLat: 30 / ((6371008.8 * Math.PI) / 180),
    rows,
    cols,
    heights,
  };
}

function nodeHeight(t: Terrain, x: number, z: number): number {
  const j = Math.round((x - (t.originX - t.sizeX / 2)) / (t.sizeX / t.cols));
  const i = Math.round((z - (t.originZ - t.sizeZ / 2)) / (t.sizeZ / t.rows));
  return t.heights[j * (t.rows + 1) + i];
}

describe('243 arroyo bridges edge cases', () => {
  it('EDGE1: loadArroyos returns [] when the areas file is missing', async () => {
    const V = await arroyo();
    expect(V.loadArroyos(join(tmp, 'no-such-areas.json'), ORIGIN)).toEqual([]);
  });

  it('EDGE2: loadArroyos keeps only open water lines with width from est_width_m', async () => {
    const V = await arroyo();
    const openRing: LonLat[] = [[0.001, -0.001], [0.001, 0.001]];
    const closedRing: LonLat[] = [[0.002, 0], [0.003, 0], [0.003, 0.001]];
    const bridgeRing: LonLat[] = [[0.004, -0.001], [0.004, 0.001]];
    const path = join(tmp, 'areas.json');
    writeFileSync(path, JSON.stringify({
      features: [
        { id: 1, kind: 'water', closed: false, tags: { est_width_m: 25 }, ring: openRing },
        { id: 2, kind: 'water', closed: true, tags: { est_width_m: 40 }, ring: closedRing },
        { id: 3, kind: 'bridge', closed: false, tags: { est_width_m: 50 }, ring: bridgeRing },
      ],
    }));
    const arroyos = V.loadArroyos(path, ORIGIN);
    expect(arroyos).toHaveLength(1);
    expect(arroyos[0].width).toBe(25);
    expect(arroyos[0].line).toEqual(projectLonLat(openRing, ORIGIN));
  });

  it('EDGE3: findBridges throws when the corridor run touches either track end', async () => {
    const V = await arroyo();
    const nearStart: Arroyo243 = { line: [[5, -100], [5, 100]], width: 30 };
    const nearEnd: Arroyo243 = { line: [[995, -100], [995, 100]], width: 30 };
    expect(() => V.findBridges(CENTERLINE, [nearStart])).toThrow(Error);
    expect(() => V.findBridges(CENTERLINE, [nearEnd])).toThrow(Error);
  });

  it('EDGE4: findBridges merges overlapping abutment spans into one bridge', async () => {
    const V = await arroyo();
    const a: Arroyo243 = { line: [[500, -300], [500, 300]], width: 30 };
    const b: Arroyo243 = { line: [[535, -300], [535, 300]], width: 30 };
    const bridges = V.findBridges(CENTERLINE, [a, b]);
    expect(bridges).toHaveLength(1);
    expect(Math.abs(CENTERLINE[bridges[0].from][0] - 480)).toBeLessThanOrEqual(1);
    expect(Math.abs(CENTERLINE[bridges[0].to][0] - 555)).toBeLessThanOrEqual(1);
  });

  it('EDGE5: findBridges sorts disjoint bridges by from and ignores non-crossing arroyos', async () => {
    const V = await arroyo();
    const later: Arroyo243 = { line: [[700, -300], [700, 300]], width: 30 };
    const earlier: Arroyo243 = { line: [[300, -300], [300, 300]], width: 30 };
    const far: Arroyo243 = { line: [[0, 900], [1000, 900]], width: 10 };
    const bridges = V.findBridges(CENTERLINE, [later, earlier, far]);
    expect(bridges).toHaveLength(2);
    expect(bridges[0].from).toBeLessThan(bridges[1].from);
    expect(Math.abs(CENTERLINE[bridges[0].from][0] - 280)).toBeLessThanOrEqual(1);
    expect(Math.abs(CENTERLINE[bridges[0].to][0] - 320)).toBeLessThanOrEqual(1);
    expect(Math.abs(CENTERLINE[bridges[1].from][0] - 680)).toBeLessThanOrEqual(1);
    expect(Math.abs(CENTERLINE[bridges[1].to][0] - 720)).toBeLessThanOrEqual(1);
  });

  it('EDGE6: applyBridgeElevation interpolates each span, copies outside, returns a new array', async () => {
    const V = await arroyo();
    const elevation = CENTERLINE.map((_, i) => 0.01 * i);
    const bridges: Bridge243[] = [
      { from: 100, to: 200 },
      { from: 400, to: 500 },
    ];
    const out = V.applyBridgeElevation(elevation, bridges);
    expect(out).not.toBe(elevation);
    for (let i = 0; i < elevation.length; i++) {
      const span = bridges.find((b) => i >= b.from && i <= b.to);
      if (!span) {
        expect(out[i]).toBe(elevation[i]);
      } else {
        const expected =
          elevation[span.from] +
          ((elevation[span.to] - elevation[span.from]) * (i - span.from)) / (span.to - span.from);
        expect(Math.abs(out[i] - expected)).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it('EDGE7: arroyoDepthAt follows the cosine bank, is 0 beyond the bank and takes the max over arroyos', async () => {
    const V = await arroyo();
    const a: Arroyo243 = { line: [[500, -300], [500, 300]], width: 30 };
    expect(Math.abs(V.arroyoDepthAt([a], 500, 0) - V.ARROYO_DEPTH)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(V.arroyoDepthAt([a], 515, 0) - V.ARROYO_DEPTH)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(V.arroyoDepthAt([a], 500 + 15 + 1.5, 0) - V.ARROYO_DEPTH * 0.5)).toBeLessThanOrEqual(1e-9);
    expect(V.arroyoDepthAt([a], 500 + 15 + 3, 0)).toBe(0);
    expect(V.arroyoDepthAt([a], 500 + 15 + 4, 0)).toBe(0);
    const b: Arroyo243 = { line: [[510, -300], [510, 300]], width: 10 };
    const at = V.arroyoDepthAt([a, b], 503, 0);
    expect(Math.abs(at - V.ARROYO_DEPTH)).toBeLessThanOrEqual(1e-9);
    expect(at).toBeLessThan(V.ARROYO_DEPTH + 1e-9);
  });

  it('EDGE8: buildTerrain protects the road corridor outside spans but carves beyond it', async () => {
    const V = await arroyo();
    const { buildTerrain } = await loadModule<{ buildTerrain: BuildTerrain243 }>(TERRAIN_MODULE);
    const water: Arroyo243 = { line: [[0, 17], [1000, 17]], width: 30 };
    const bridges = V.findBridges(CENTERLINE, [water]);
    expect(bridges).toEqual([]);
    const elevation = CENTERLINE.map(() => 0);
    const base = buildTerrain(makeDem(0), CENTERLINE, elevation, ORIGIN, WIDTH, 20);
    const carved = buildTerrain(makeDem(0), CENTERLINE, elevation, ORIGIN, WIDTH, 20, undefined, [water], bridges);
    // grid nodes: x = -400 + 8j, z = -400 + 8i → (504, 0) and (504, 24)
    expect(Math.abs(nodeHeight(carved, 504, 0) - nodeHeight(base, 504, 0))).toBeLessThanOrEqual(0.01);
    expect(Math.abs(nodeHeight(carved, 504, 24) - (nodeHeight(base, 504, 24) - 2))).toBeLessThanOrEqual(0.01);
  });

  it('EDGE9: layoutBarriers splits neighbouring runoff at the span and leaves outside indices unchanged', async () => {
    const { layoutBarriers } = await loadModule<{ layoutBarriers: LayoutBarriers243 }>(BARRIERS_MODULE);
    const runoffs: RunoffSegment[] = [{ start: 0, end: 1000, side: 'left', surface: 'gravel', widthMeters: 20 }];
    const bridges: Bridge243[] = [{ from: 480, to: 520 }];
    const baseline = layoutBarriers(CENTERLINE, WIDTH, [], runoffs);
    const out = layoutBarriers(CENTERLINE, WIDTH, [], runoffs, undefined, undefined, undefined, bridges);
    const covering = (segs: BarrierSegment[], side: 'left' | 'right', i: number) =>
      segs.find((s) => s.side === side && i >= s.start && i <= s.end)!;
    for (let i = 0; i < CENTERLINE.length; i++) {
      for (const side of ['left', 'right'] as const) {
        const got = covering(out, side, i);
        if (i >= 480 && i <= 520) {
          expect(got.type).toBe('armco');
          expect(Math.abs(got.offsetMeters - (WIDTH / 2 + 1.25))).toBeLessThanOrEqual(1e-9);
        } else {
          const want = covering(baseline, side, i);
          expect(got.type).toBe(want.type);
          expect(got.offsetMeters).toBe(want.offsetMeters);
        }
      }
    }
    expect(layoutBarriers(CENTERLINE, WIDTH, [], runoffs, undefined, undefined, undefined, [])).toEqual(baseline);
  });

  it('EDGE10: placeTrees keeps the 6000 cap and the centerline exclusion with arroyos present', async () => {
    const { placeTrees } = await loadModule<{ placeTrees: PlaceTrees243 }>(TREES_MODULE);
    const loop: Point2[] = [];
    for (let x = 0; x < 1000; x += 2) loop.push([x, 0]);
    for (let z = 0; z < 1000; z += 2) loop.push([1000, z]);
    for (let x = 1000; x > 0; x -= 2) loop.push([x, 1000]);
    for (let z = 1000; z > 0; z -= 2) loop.push([0, z]);
    const terrain: Terrain = {
      originX: 500, originZ: 500, sizeX: 1200, sizeZ: 1200, rows: 100, cols: 100,
      heights: new Array<number>(101 * 101).fill(0),
    };
    const barriers: BarrierSegment[] = [
      { start: 0, end: loop.length - 1, side: 'left', type: 'wall', offsetMeters: 7.25 },
    ];
    const arroyos: Arroyo243[] = [{ line: [[500, -100], [500, 1100]], width: 10 }];
    const biome = { species: [{ name: 'shrub-dry', weight: 1 }], density: 1 };
    const trees = placeTrees('edge-cap', loop, terrain, barriers, biome, arroyos);
    const total = trees.reduce((s, t) => s + t.data.length / 4, 0);
    expect(total).toBe(6000);
    const exclusion = 7.25 + 15;
    for (const t of trees) {
      for (let i = 0; i + 1 < t.data.length; i += 4) {
        const [x, z] = [t.data[i], t.data[i + 1]];
        let min = Infinity;
        for (let k = 0; k + 1 < loop.length; k += 10) {
          const d = Math.hypot(x - loop[k][0], z - loop[k][1]);
          if (d < min) min = d;
        }
        expect(min).toBeGreaterThan(exclusion);
      }
    }
  });
});
