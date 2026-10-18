import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type {
  BarrierSegment,
  EnvironmentType,
  PitLane,
  RunoffSegment,
  Terrain,
  TrackSegment,
  TreeInstances,
} from '../../../src/core/types';
import {
  bboxCenter,
  EARTH_RADIUS_M,
  projectLonLat,
  type LonLat,
  type Point2,
} from '../../../src/track/geo';
import type { DemGrid } from '../../../tools/dem/fetchDem';
import { fixture } from './022-fixture-trackdatav2';

// Task 243 lands tools/track-builder/arroyo.ts and src/render/bridgeRenderer.ts and
// widens the terrain/barrier/tree signatures; the variable specifiers keep typecheck
// green until those modules exist (the 158/162 pattern).
const ARROYO_MODULE = '../../../tools/track-builder/arroyo';
const TERRAIN_MODULE = '../../../tools/track-builder/terrain';
const BARRIERS_MODULE = '../../../tools/track-builder/barriers';
const TREES_MODULE = '../../../tools/track-builder/trees';
const BRIDGE_RENDERER_MODULE = '../../../src/render/bridgeRenderer';

// Local copies of the task-243 contracts.
interface Arroyo243 {
  line: Point2[];
  width: number;
}
interface Bridge243 {
  from: number;
  to: number;
}
interface ArroyoModule {
  findBridges(centerline: Point2[], arroyos: Arroyo243[]): Bridge243[];
  applyBridgeElevation(elevation: number[], bridges: Bridge243[]): number[];
}
type BuildTerrain243 = (
  grid: DemGrid, centerline: Point2[], elevation: number[],
  origin: LonLat, widthMeters: number, maxBarrierOffset: number, bank?: number[],
  arroyos?: Arroyo243[], bridges?: Bridge243[],
) => Terrain;
interface TerrainModule {
  buildTerrain: BuildTerrain243;
}
type LayoutBarriers243 = (
  centerline: Point2[], widthMeters: number, kerbs: TrackSegment[], runoffs: RunoffSegment[],
  pit?: PitLane, environment?: EnvironmentType, walls?: boolean, bridges?: Bridge243[],
) => BarrierSegment[];
interface BarriersModule {
  layoutBarriers: LayoutBarriers243;
}
interface Biome243 {
  species: { name: string; weight: number }[];
  density: number;
}
type PlaceTrees243 = (
  trackId: string, centerline: Point2[], terrain: Terrain,
  barriers: BarrierSegment[], biome: Biome243, arroyos?: Arroyo243[],
) => TreeInstances[];
interface TreesModule {
  placeTrees: PlaceTrees243;
}
interface BridgeRendererModule {
  createBridgeObject(
    track: TrackDataG,
    terrainY: (x: number, z: number) => number,
  ): { group: THREE.Group; dispose(): void };
}
type TrackDataG = typeof fixture & { bridges?: Bridge243[]; arroyos?: Arroyo243[] };

async function loadModule<T>(path: string): Promise<T> {
  return (await import(path)) as T;
}

const ROOT = join(__dirname, '..', '..', '..');
const ORIGIN: LonLat = [0, 0];
const DEG_M = (EARTH_RADIUS_M * Math.PI) / 180;

const G_CENTERLINE: Point2[] = Array.from({ length: 1001 }, (_, i): Point2 => [i, 0]);
const G_WIDTH = 12;
const G_WATER: Arroyo243 = { line: [[500, -300], [500, 300]], width: 30 };
const G_BIOME: Biome243 = { species: [{ name: 'shrub-dry', weight: 1 }], density: 0.04 };

// DEM pixels (30 m) centred on world x = -615 + 30*j, z = -615 + 30*i; height linear in x
function makeDem(slopeX: number): DemGrid {
  const rows = 42;
  const cols = 72;
  const heights: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      heights.push(100 + slopeX * (-615 + 30 * j));
    }
  }
  return {
    lon0: -615 / DEG_M,
    lat0: 615 / DEG_M,
    dLon: 30 / DEG_M,
    dLat: 30 / DEG_M,
    rows,
    cols,
    heights,
  };
}

// height of the node at world (x, z), column-major Rapier layout (the 028 helper)
function nodeHeight(t: Terrain, x: number, z: number): number {
  const j = Math.round((x - (t.originX - t.sizeX / 2)) / (t.sizeX / t.cols));
  const i = Math.round((z - (t.originZ - t.sizeZ / 2)) / (t.sizeZ / t.rows));
  return t.heights[j * (t.rows + 1) + i];
}

interface GOutput {
  elevation: number[];
  terrain: Terrain;
  barriers: BarrierSegment[];
  trees: TreeInstances[];
  bridges?: Bridge243[];
  arroyos?: Arroyo243[];
}

// Composes the task-243 units on fixture G the way buildTrackV2 does.
async function buildG(opts: { slope?: number; water?: boolean; arroyo?: boolean }): Promise<GOutput> {
  const { slope = 0, water = false, arroyo = false } = opts;
  const { findBridges, applyBridgeElevation } = await loadModule<ArroyoModule>(ARROYO_MODULE);
  const { buildTerrain } = await loadModule<TerrainModule>(TERRAIN_MODULE);
  const { layoutBarriers } = await loadModule<BarriersModule>(BARRIERS_MODULE);
  const { placeTrees } = await loadModule<TreesModule>(TREES_MODULE);
  const centerline = G_CENTERLINE;
  const elevation = centerline.map((_, i) => slope * i);
  const arroyos = arroyo && water ? [G_WATER] : undefined;
  const bridges = arroyos ? findBridges(centerline, arroyos) : undefined;
  const elevationOut = bridges ? applyBridgeElevation(elevation, bridges) : elevation;
  const barriers = layoutBarriers(centerline, G_WIDTH, [], [], undefined, undefined, undefined, bridges);
  const maxBarrierOffset = Math.max(...barriers.map((b) => b.offsetMeters));
  const terrain = buildTerrain(
    makeDem(slope), centerline, elevationOut, ORIGIN, G_WIDTH, maxBarrierOffset,
    undefined, arroyos, bridges,
  );
  const trees = placeTrees('g-fixture', centerline, terrain, barriers, G_BIOME, arroyos);
  const out: GOutput = { elevation: elevationOut, terrain, barriers, trees };
  if (bridges) out.bridges = bridges;
  if (arroyos) out.arroyos = arroyos;
  return out;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;
}

function pointToPolyline(x: number, z: number, line: Point2[]): number {
  let min = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (d < min) min = d;
  }
  return min;
}

// Metres outside the corridor edge (negative inside every corridor).
function edgeDistance(x: number, z: number, arroyos: { line: Point2[]; width: number }[]): number {
  let min = Infinity;
  for (const a of arroyos) {
    const d = pointToPolyline(x, z, a.line) - a.width / 2;
    if (d < min) min = d;
  }
  return min;
}

function clGrid(points: Point2[], cell: number): Map<string, Point2[]> {
  const map = new Map<string, Point2[]>();
  for (const p of points) {
    const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return map;
}

function nearestClDistance(map: Map<string, Point2[]>, cell: number, x: number, z: number): number {
  const cx = Math.floor(x / cell);
  const cz = Math.floor(z / cell);
  let min = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const list = map.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const [px, pz] of list) {
        const d = Math.hypot(x - px, z - pz);
        if (d < min) min = d;
      }
    }
  }
  return min;
}

// Bed profile of fixture G's arroyo (the task-243 depth formula).
function gTerrainY(x: number, z: number): number {
  const cz = Math.max(-300, Math.min(300, z));
  const d = Math.hypot(x - 500, z - cz);
  if (d <= 15) return -2;
  if (d <= 18) return -1 * (1 + Math.cos((Math.PI * (d - 15)) / 3));
  return 0;
}

function usesStoneSet(material: THREE.Material | THREE.Material[]): boolean {
  const mats = Array.isArray(material) ? material : [material];
  return mats.some((m) => {
    const std = m as THREE.MeshStandardMaterial;
    return [std.map, std.normalMap, std.roughnessMap].some((t) =>
      (t?.name ?? '').includes('textures/stone/old-wall'),
    );
  });
}

// sha256 of every non-ermita public/tracks/*.json on master at test-writing time.
const MASTER_HASHES: Record<string, string> = {
  'bahrain.json': '1ac84b1117cb810b9666db011e1333877c92a2d8ebf2e186fee1f1cf99978371',
  'bahrain.style.json': 'ef217935d71fe5774b48b845dd3dae7cd82bb96df06f2c83d2add784acec5645',
  'baku-env.json': '38b9a37e60f941e887fe175791f604c36ce4d38a4a10e71475e64cc9372e8099',
  'baku.json': 'd95b9a60fff71c63585a20142952f690592c6cc9e66ccf586ca5d0255925633f',
  'baku.style.json': '4af365cbc2fd9d62d274853a94a2970a68ffa1101321f1fbab1d2c0a59840b27',
  'braselton.json': 'bd5a7ba0a01c71e47ef14d36826e351a6f813e9241399050515876a791f079bc',
  'braselton.style.json': '1f93dc666f4e852f14b9472b09f8124be32710476b6377a235e3733e3c2c523e',
  'budapest.json': 'baa4756e928958c6eaff19c58578378ef9d1a14e13ad4bd4f5a2d33ca8845350',
  'budapest.style.json': 'e64716fd9411f2ea77f9c25ce74a53fd264444be05458a128cf6bcb64a3cc336',
  'cleveland.json': '412f66295709d16106349c56d68ff94ae5dbae09a0c391d6c9e757bfec7f4d50',
  'cleveland.style.json': '43f2c819fdfbd7e2e2183a508ea7df34bf602d304a60cc10de7e70ed2258f967',
  'daytona.json': '5a7dd75b0f9ca9f2bbea161efa66cebaa3a43312665127ad1c9505fd3f7b3217',
  'daytona.style.json': '5047c1f4a1e01f2e19cc6c67be0b0922fc91b6078c825bbf53c4f022fbb56eb6',
  'detroit.json': '587de9985bd876fa17603c633aebb3408e8a250ec63093105ebd21993a97d16b',
  'detroit.style.json': '0f052d52743836b620825c2c36a7f93f8237b0ba7b0afdbcd1d83106c70d8ddc',
  'elkhart.json': '4ae7ca652ab8e62c058dec49b29ac00ba8842d418a21514b11d23e4ff687ebad',
  'elkhart.style.json': 'fbd45c076cd531eebf3be2ddc8ff97c4da954a7c4ede734c40097926965c37ba',
  'fontana-roval.json': '18e1269f2cdfe97e03837bc22f7cddd3bb8c9d7f2b0404ef2611f0a5ea03a574',
  'fontana.json': '26b619a9f2e3582d8787025a5db6c97e26e36976134f8b6af44dc83dbc3295fa',
  'fontana.style.json': '7e23763cf6aad97e39326fb8f791626ec82a75a5c7071a27cbc35989078615ba',
  'index.json': '06e70fb3eabfba57315fced377e0590ea1e56c37ddd8ea5fac9960d8b0d3fdc9',
  'lasvegas-env.json': '626ec59afecbe38550053872269d6838381e46175a2734f16714c72f8f2f64ce',
  'lasvegas.json': '33482acf564d93a7df27dd6db310cad883cc59e11e4c344af1ec6cf4d9871a4e',
  'lasvegas.style.json': 'a1a84f3967ae29c6ab7b2006eae3a3e3af938bd3387c424b681a92c0d740233e',
  'lusail.json': '6c92afd076bc334e086f572be016e4fbba392e984b4a7ae060340cc0dc8c7ae8',
  'lusail.style.json': '152200e366f6af1ac17aa7db87f74ba6462f5978a7261b71967442c4ee03073f',
  'mexico.json': '73ee24c221135659dabfb735bd7c8f7f9d61080cda328b3ae8e629cd26cec243',
  'mexico.style.json': '99e125322dffadc2889be05c3fd39dfc737b2efbaa25ed09455379fa4b805cb0',
  'monza.json': 'c9c395f30372df560aa5cc03219f1e68ddc7835f929662ad76e69305bf23e843',
  'monza.style.json': '22ee66af5dc9e215802bdd43bdc02f98cea928b0d49cd356ee033087f455ab9c',
  'sepang.json': '96a94c6000276f3e231d2bc4564ea6b484f86263c1a10280823180639747b27b',
  'sepang.style.json': 'fa46aa49846c6ebfec068c3cda6d665b780e8043a271b21032a476dd5acfa231',
  'silverstone.json': '06a217e8a0dbb52f3888acc5d2f65357687739e085b89e2725e520a1bdff758a',
  'silverstone.style.json': '33235655e19b30f1536b668e5ca44173e4d82de168665fb90f0dc6070719e8e0',
  'singapore-env.json': '82ca9b70c48a5ccabfe14a02c2459ec33de01295d90be52a5ec7bd648de0fdc7',
  'singapore.json': 'b9ea673dc33ea70bea76816f4affe0178dbe6e33b9db195371e29d914dc4f644',
  'singapore.style.json': '053c9e6ddcb6ace084ec973993195321f0ac796def621f631c7ad8280b28bfbf',
  'spa.json': 'ab84e19f2cb2a291ca3d3e24ee209d6ddb53fd5dc2f9697977b960192b15a29c',
  'spa.style.json': '8cd6ad25ad82dba77425f9327677b2099adb9543edf74ca32a82369d2a021190',
  'spielberg.json': '33dec7af3d84709735a3e8f0a5416cb12d625ca0415609a0551db8157d209cd3',
  'spielberg.style.json': '4acb88eba030d2b2992c6535066f1f6fd77980ac795aa2557ab50f20b2c7c9b9',
};

describe('243 arroyo bridges acceptance', () => {
  it('AT1: fixture G yields exactly one bridge spanning x 480-520', async () => {
    const out = await buildG({ water: true, arroyo: true });
    expect(out.bridges, 'bridges present').toBeDefined();
    const bridges = out.bridges ?? [];
    expect(bridges).toHaveLength(1);
    const [from, to] = [bridges[0].from, bridges[0].to];
    expect(Math.abs(G_CENTERLINE[from][0] - 480), 'span start x').toBeLessThanOrEqual(1);
    expect(Math.abs(G_CENTERLINE[to][0] - 520), 'span end x').toBeLessThanOrEqual(1);
  });

  it('AT2: bridge span elevation is linear and matches the no-arroyo elevation at both abutment ends', async () => {
    const withArroyo = await buildG({ slope: 0.01, water: true, arroyo: true });
    const noWater = await buildG({ slope: 0.01, water: false });
    const bridges = withArroyo.bridges ?? [];
    expect(bridges).toHaveLength(1);
    const { from, to } = bridges[0];
    let maxSecond = 0;
    for (let k = from + 1; k < to; k++) {
      maxSecond = Math.max(
        maxSecond,
        Math.abs(withArroyo.elevation[k - 1] - 2 * withArroyo.elevation[k] + withArroyo.elevation[k + 1]),
      );
    }
    expect(maxSecond, 'abs second difference').toBeLessThanOrEqual(1e-6);
    expect(Math.abs(withArroyo.elevation[from] - noWater.elevation[from]), 'start abutment').toBeLessThanOrEqual(1e-6);
    expect(Math.abs(withArroyo.elevation[to] - noWater.elevation[to]), 'end abutment').toBeLessThanOrEqual(1e-6);
  });

  it('AT3: the bed carves the terrain to -2 m on the arroyo line and is back to 0 by 30 m', async () => {
    const out = await buildG({ water: true, arroyo: true });
    expect(Math.abs(nodeHeight(out.terrain, 500, 200) - -2.0), 'on the line').toBeLessThanOrEqual(0.1);
    for (const x of [500 - 21, 500 + 21]) {
      const h = nodeHeight(out.terrain, x, 200);
      expect(h, `x=${x} between -2 and 0`).toBeGreaterThanOrEqual(-2.0 - 1e-6);
      expect(h, `x=${x} between -2 and 0`).toBeLessThanOrEqual(1e-6);
    }
    for (const x of [500 - 30, 500 + 30]) {
      expect(Math.abs(nodeHeight(out.terrain, x, 200)), `x=${x} at 0`).toBeLessThanOrEqual(0.05);
    }
  });

  it('AT4: elevation outside the bridge span equals the same build without water', async () => {
    const withArroyo = await buildG({ water: true, arroyo: true });
    const noWater = await buildG({ water: false });
    const bridges = withArroyo.bridges ?? [];
    expect(bridges).toHaveLength(1);
    const { from, to } = bridges[0];
    for (let i = 0; i < G_CENTERLINE.length; i++) {
      if (i >= from && i <= to) continue;
      expect(
        Math.abs(withArroyo.elevation[i] - noWater.elevation[i]),
        `index ${i} outside the span`,
      ).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AT5: with arroyo absent the build deep-equals the no-water build and has no bridges/arroyos keys', async () => {
    const flagOff = await buildG({ water: true, arroyo: false });
    const noWater = await buildG({ water: false });
    expect('bridges' in flagOff, 'no bridges key').toBe(false);
    expect('arroyos' in flagOff, 'no arroyos key').toBe(false);
    expect(flagOff).toEqual(noWater);
  });

  it('AT6: bridge spans get armco guardrails at 7.25 m on both sides', async () => {
    const out = await buildG({ water: true, arroyo: true });
    const bridges = out.bridges ?? [];
    expect(bridges).toHaveLength(1);
    const { from, to } = bridges[0];
    for (const side of ['left', 'right'] as const) {
      for (let i = from; i <= to; i++) {
        const covering = out.barriers.filter((s) => s.side === side && i >= s.start && i <= s.end);
        expect(covering, `${side} index ${i} coverage`).toHaveLength(1);
        expect(covering[0].type, `${side} index ${i} type`).toBe('armco');
        expect(Math.abs(covering[0].offsetMeters - 7.25), `${side} index ${i} offset`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('AT7: the bridge renderer builds deck and two stone side walls, with no parapets above the deck and no piers', async () => {
    const { createBridgeObject } = await loadModule<BridgeRendererModule>(BRIDGE_RENDERER_MODULE);
    const track: TrackDataG = {
      ...fixture,
      centerline: G_CENTERLINE,
      elevation: G_CENTERLINE.map(() => 0),
      widthMeters: G_WIDTH,
      bridges: [{ from: 480, to: 520 }],
      arroyos: [{ line: [[500, -300], [500, 300]], width: 30 }],
    };
    const { group } = createBridgeObject(track, gTerrainY);
    const meshes: THREE.Mesh[] = [];
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m));
    const boxOf = (m: THREE.Mesh) => boxes[meshes.indexOf(m)];
    const extent = (b: THREE.Box3) => ({
      x: b.max.x - b.min.x,
      y: b.max.y - b.min.y,
      z: b.max.z - b.min.z,
    });
    const zCenter = (b: THREE.Box3) => (b.max.z + b.min.z) / 2;
    const half = G_WIDTH / 2 + 1.25;
    const span = 40;

    const deck = meshes.find((m) => {
      const b = boxOf(m);
      const e = extent(b);
      return Math.abs(e.x - span) <= 0.5 && e.y >= 0.5 && e.y <= 0.7 &&
        e.z >= 13 && e.z <= 15 && Math.abs(zCenter(b)) <= 0.5;
    });
    expect(deck, 'deck slab present').toBeDefined();
    const deckTop = boxOf(deck!).max.y;
    expect(Math.abs(deckTop - -0.05), 'deck top 0.05 below the track surface').toBeLessThanOrEqual(0.05);

    // No parapets: nothing box-like stands on the deck top above it.
    for (let k = 0; k < meshes.length; k++) {
      const b = boxes[k];
      expect(
        b.min.y < deckTop - 0.01 || extent(b).y < 0.4,
        `mesh ${k} must not be a parapet above the deck top`,
      ).toBe(true);
    }

    const walls = meshes.filter((m) => {
      const b = boxOf(m);
      const e = extent(b);
      return Math.abs(e.x - span) <= 0.5 && e.y >= 1.0 &&
        Math.abs(e.z - 0.5) <= 0.05 && Math.abs(Math.abs(zCenter(b)) - half) <= 0.01;
    });
    expect(walls, 'two side walls').toHaveLength(2);
    expect(walls.map((w) => Math.sign(zCenter(boxOf(w)))).sort(), 'one wall per side').toEqual([-1, 1]);
    for (const w of walls) {
      const b = boxOf(w);
      expect(Math.abs(b.max.y - deckTop), 'wall top = deck top').toBeLessThanOrEqual(0.01);
      expect(b.min.y, 'wall bottom at mid-span follows the bed').toBeLessThanOrEqual(gTerrainY(500, 0) + 0.05);
      expect(Math.abs(extent(b).z - 0.5), 'wall thickness').toBeLessThanOrEqual(0.05);
      expect(Math.abs(Math.abs(zCenter(b)) - half), 'wall lateral offset').toBeLessThanOrEqual(0.01);
      expect(usesStoneSet(w.material), 'wall stone set').toBe(true);
    }

    for (let k = 0; k < meshes.length; k++) {
      const e = extent(boxes[k]);
      if (e.y >= 1.0) {
        expect(Math.abs(zCenter(boxes[k])), `tall mesh ${k} is not a pier under the roadway`).toBeGreaterThan(
          G_WIDTH / 2,
        );
      }
    }
  });

  it('AT8: federal and poniente each have a bridge whose midpoint is within 30 m of the real OSM crossing', () => {
    const cases: { id: string; way: number }[] = [
      { id: 'ermita-federal', way: 1553277736 },
      { id: 'ermita-poniente', way: 911201276 },
    ];
    for (const { id, way } of cases) {
      const track = readJson<{ centerline: Point2[]; bridges?: Bridge243[] }>(`public/tracks/${id}.json`);
      const bridges = track.bridges ?? [];
      expect(bridges.length, `${id}: bridges present`).toBeGreaterThan(0);
      const geo = readJson<{ features: { geometry: { coordinates: LonLat[] } }[] }>(
        `assets/source/tracks/mx-${id}.geojson`,
      );
      const origin = bboxCenter(geo.features[0].geometry.coordinates);
      const areas = readJson<{ features: { id: number; ring: LonLat[] }[] }>(
        `assets/source/osm/${id}-areas.json`,
      );
      const feature = areas.features.find((f) => f.id === way);
      expect(feature, `${id}: OSM way ${way} in the areas file`).toBeDefined();
      const ring = feature!.ring;
      const midLonLat: LonLat = [
        (ring[0][0] + ring[ring.length - 1][0]) / 2,
        (ring[0][1] + ring[ring.length - 1][1]) / 2,
      ];
      const [wx, wz] = projectLonLat([midLonLat], origin)[0];
      let best = Infinity;
      for (const b of bridges) {
        const [x, z] = track.centerline[Math.floor((b.from + b.to) / 2)];
        best = Math.min(best, Math.hypot(x - wx, z - wz));
      }
      expect(best, `${id}: bridge midpoint vs OSM crossing`).toBeLessThanOrEqual(30);
    }
  });

  it('AT9: every non-ermita public/tracks JSON is byte-identical to master', () => {
    const files = readdirSync(join(ROOT, 'public', 'tracks'))
      .filter((f) => f.endsWith('.json') && !f.startsWith('ermita-'))
      .sort();
    expect(files).toEqual(Object.keys(MASTER_HASHES).sort());
    for (const [file, hash] of Object.entries(MASTER_HASHES)) {
      const actual = createHash('sha256').update(readFileSync(join(ROOT, 'public', 'tracks', file))).digest('hex');
      expect(actual, file).toBe(hash);
    }
  });

  it(
    'AT10: on every ermita track tree density within 15 m of an arroyo corridor edge is at least 2x the density 50-100 m away',
    () => {
      const ids = [
        'ermita-centro',
        'ermita-federal',
        'ermita-norte',
        'ermita-mixto',
        'ermita-poniente',
        'ermita-veloz',
      ];
      const STEP = 5;
      const MARGIN = 105;
      for (const id of ids) {
        const track = readJson<{
          centerline: Point2[];
          barriers: { offsetMeters: number }[];
          trees: { data: number[] }[];
          arroyos?: Arroyo243[];
        }>(`public/tracks/${id}.json`);
        const arroyos = track.arroyos ?? [];
        expect(arroyos.length, `${id}: arroyos present`).toBeGreaterThan(0);
        const exclusion = Math.max(...track.barriers.map((b) => b.offsetMeters)) + 15;
        const cmap = clGrid(track.centerline, exclusion);
        const plantable = (x: number, z: number) => nearestClDistance(cmap, exclusion, x, z) > exclusion;
        let treesNear = 0;
        let treesFar = 0;
        for (const t of track.trees) {
          for (let i = 0; i + 1 < t.data.length; i += 4) {
            const x = t.data[i];
            const z = t.data[i + 1];
            if (!plantable(x, z)) continue;
            const d = edgeDistance(x, z, arroyos);
            if (d <= 15) treesNear++;
            else if (d >= 50 && d <= 100) treesFar++;
          }
        }
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const a of arroyos) {
          for (const [x, z] of a.line) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
          }
        }
        let cellsNear = 0;
        let cellsFar = 0;
        const nx = Math.floor((maxX + MARGIN - (minX - MARGIN)) / STEP);
        const nz = Math.floor((maxZ + MARGIN - (minZ - MARGIN)) / STEP);
        for (let i = 0; i <= nx; i++) {
          for (let j = 0; j <= nz; j++) {
            const x = minX - MARGIN + i * STEP;
            const z = minZ - MARGIN + j * STEP;
            if (!plantable(x, z)) continue;
            const d = edgeDistance(x, z, arroyos);
            if (d <= 15) cellsNear++;
            else if (d >= 50 && d <= 100) cellsFar++;
          }
        }
        expect(cellsNear, `${id}: near-band area`).toBeGreaterThan(0);
        expect(cellsFar, `${id}: far-band area`).toBeGreaterThan(0);
        const densityNear = treesNear / (cellsNear * STEP * STEP);
        const densityFar = treesFar / (cellsFar * STEP * STEP);
        expect(densityNear, `${id}: near density >= 2x far density`).toBeGreaterThanOrEqual(2 * densityFar);
      }
    },
    60000,
  );
});
