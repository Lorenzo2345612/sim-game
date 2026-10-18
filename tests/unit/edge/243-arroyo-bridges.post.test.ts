import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, Terrain, TrackDataV2 } from '../../../src/core/types';
import { projectLonLat, type LonLat, type Point2 } from '../../../src/track/geo';
import type { DemGrid } from '../../../tools/dem/fetchDem';
import {
  applyBridgeElevation,
  arroyoDepthAt,
  findBridges,
  loadArroyos,
} from '../../../tools/track-builder/arroyo';
import { buildTerrain } from '../../../tools/track-builder/terrain';
import { layoutBarriers } from '../../../tools/track-builder/barriers';
import { placeTrees } from '../../../tools/track-builder/trees';
import { createBridgeObject } from '../../../src/render/bridgeRenderer';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const ORIGIN: LonLat = [0, 0];
const WIDTH = 12;
const CENTERLINE: Point2[] = Array.from({ length: 1001 }, (_, i): Point2 => [i, 0]);
const WATER_LINE: [number, number][] = [[500, -300], [500, 300]];
const WATER = { line: WATER_LINE, width: 30 };
const ROOT = join(__dirname, '..', '..', '..');

const tmp = mkdtempSync(join(tmpdir(), 'arroyo-post-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function makeDem(): DemGrid {
  const rows = 42;
  const cols = 72;
  const heights: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) heights.push(100);
  }
  const deg = (6371008.8 * Math.PI) / 180;
  return { lon0: -615 / deg, lat0: 615 / deg, dLon: 30 / deg, dLat: 30 / deg, rows, cols, heights };
}

function nodeHeight(t: Terrain, x: number, z: number): number {
  const j = Math.round((x - (t.originX - t.sizeX / 2)) / (t.sizeX / t.cols));
  const i = Math.round((z - (t.originZ - t.sizeZ / 2)) / (t.sizeZ / t.rows));
  return t.heights[j * (t.rows + 1) + i];
}

function meshesOf(group: THREE.Group): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) out.push(child as THREE.Mesh);
  });
  return out;
}

function textureNames(material: THREE.Material | THREE.Material[]): string[] {
  const mats = Array.isArray(material) ? material : [material];
  return mats.flatMap((m) => {
    const std = m as THREE.MeshStandardMaterial;
    return [std.map, std.normalMap, std.roughnessMap].map((t) => t?.name ?? '');
  });
}

function gTrack(overrides: Partial<TrackDataV2>): TrackDataV2 {
  return {
    ...fixture,
    centerline: CENTERLINE,
    elevation: CENTERLINE.map(() => 0),
    widthMeters: WIDTH,
    ...overrides,
  };
}

describe('243 arroyo bridges post-code gaps', () => {
  it('GAP1: loadArroyos drops water lines with invalid width or fewer than two points', () => {
    const valid: LonLat[] = [[0.001, -0.001], [0.001, 0.001]];
    const path = join(tmp, 'areas-invalid.json');
    writeFileSync(path, JSON.stringify({
      features: [
        { id: 1, kind: 'water', closed: false, tags: {}, ring: valid },
        { id: 2, kind: 'water', closed: false, tags: { est_width_m: 0 }, ring: valid },
        { id: 3, kind: 'water', closed: false, tags: { est_width_m: -5 }, ring: valid },
        { id: 4, kind: 'water', closed: false, tags: { est_width_m: 'wide' }, ring: valid },
        { id: 5, kind: 'water', closed: false, tags: { est_width_m: 20 }, ring: [valid[0]] },
        { id: 6, kind: 'water', closed: false, tags: { est_width_m: 20 }, ring: valid },
      ],
    }));
    const arroyos = loadArroyos(path, ORIGIN);
    expect(arroyos).toHaveLength(1);
    expect(arroyos[0].width).toBe(20);
    expect(arroyos[0].line).toEqual(projectLonLat(valid, ORIGIN));
  });

  it('GAP2: loadArroyos returns [] for a JSON without a features array', () => {
    const path = join(tmp, 'areas-no-features.json');
    writeFileSync(path, JSON.stringify({ ok: true }));
    expect(loadArroyos(path, ORIGIN)).toEqual([]);
  });

  it('GAP3: findBridges returns [] for an empty centerline or empty arroyos', () => {
    expect(findBridges([], [WATER])).toEqual([]);
    expect(findBridges(CENTERLINE, [])).toEqual([]);
  });

  it('GAP4: findBridges treats the corridor boundary as inclusive at exactly width/2', () => {
    const line: Point2[] = Array.from({ length: 601 }, (_, i): Point2 => [i, 0]);
    const bridges = findBridges(line, [WATER]);
    expect(bridges).toEqual([{ from: 480, to: 520 }]);
  });

  it('GAP5: findBridges merges abutment spans that merely touch', () => {
    const touching = { line: [[541, -300], [541, 300]] as Point2[], width: 30 };
    const bridges = findBridges(CENTERLINE, [WATER, touching]);
    expect(bridges).toEqual([{ from: 480, to: 561 }]);
  });

  it('GAP6: applyBridgeElevation copies degenerate spans and still returns a new array', () => {
    const elevation = CENTERLINE.map((_, i) => 0.01 * i);
    const same = applyBridgeElevation(elevation, [{ from: 100, to: 100 }]);
    expect(same).not.toBe(elevation);
    expect(same).toEqual(elevation);
    expect(applyBridgeElevation(elevation, [{ from: 200, to: 100 }])).toEqual(elevation);
    expect(applyBridgeElevation(elevation, [])).toEqual(elevation);
  });

  it('GAP7: arroyoDepthAt is 0 for empty and degenerate arroyo lines', () => {
    expect(arroyoDepthAt([], 500, 0)).toBe(0);
    expect(arroyoDepthAt([{ line: [], width: 30 }], 500, 0)).toBe(0);
    const point = { line: [[500, 0]] as Point2[], width: 30 };
    expect(arroyoDepthAt([point], 500, 0)).toBeCloseTo(2, 9);
    expect(arroyoDepthAt([point], 515, 0)).toBeCloseTo(2, 9);
    expect(arroyoDepthAt([point], 516, 0)).toBeCloseTo(1.5, 9);
    expect(arroyoDepthAt([point], 519, 0)).toBe(0);
  });

  it('GAP8: buildTerrain carves the road corridor under a bridge span and keeps it outside spans', () => {
    const elevation = CENTERLINE.map(() => 0);
    const bridges = findBridges(CENTERLINE, [WATER]);
    expect(bridges).toEqual([{ from: 480, to: 520 }]);
    const base = buildTerrain(makeDem(), CENTERLINE, elevation, ORIGIN, WIDTH, 20);
    const withBridge = buildTerrain(makeDem(), CENTERLINE, elevation, ORIGIN, WIDTH, 20, undefined, [WATER], bridges);
    const noBridge = buildTerrain(makeDem(), CENTERLINE, elevation, ORIGIN, WIDTH, 20, undefined, [WATER], []);
    // node (504, 0) is on the road corridor and inside the span; (504, 32) is off the corridor
    expect(Math.abs(nodeHeight(withBridge, 504, 0) - nodeHeight(base, 504, 0) + 2)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(nodeHeight(noBridge, 504, 0) - nodeHeight(base, 504, 0))).toBeLessThanOrEqual(0.02);
    expect(Math.abs(nodeHeight(withBridge, 504, 32) - nodeHeight(base, 504, 32) + 2)).toBeLessThanOrEqual(0.02);
  });

  it('GAP9: buildTerrain with an empty arroyos list is unchanged', () => {
    const elevation = CENTERLINE.map(() => 0);
    const base = buildTerrain(makeDem(), CENTERLINE, elevation, ORIGIN, WIDTH, 20);
    const empty = buildTerrain(makeDem(), CENTERLINE, elevation, ORIGIN, WIDTH, 20, undefined, []);
    expect(empty).toEqual(base);
  });

  it('GAP10: layoutBarriers keeps armco on the span for walls and city tracks', () => {
    const bridges = [{ from: 480, to: 520 }];
    const covering = (segs: BarrierSegment[], side: 'left' | 'right', i: number) =>
      segs.find((s) => s.side === side && i >= s.start && i <= s.end)!;
    for (const [environment, walls] of [['city', undefined], [undefined, true]] as const) {
      const base = layoutBarriers(CENTERLINE, WIDTH, [], [], undefined, environment, walls);
      expect(base.every((s) => s.type === 'wall'), 'baseline is wall all round').toBe(true);
      const out = layoutBarriers(CENTERLINE, WIDTH, [], [], undefined, environment, walls, bridges);
      for (let i = 0; i < CENTERLINE.length; i++) {
        for (const side of ['left', 'right'] as const) {
          const got = covering(out, side, i);
          if (i >= 480 && i <= 520) {
            expect(got.type, `span ${side} ${i}`).toBe('armco');
            expect(Math.abs(got.offsetMeters - 7.25), `span offset ${side} ${i}`).toBeLessThanOrEqual(1e-9);
          } else {
            const want = covering(base, side, i);
            expect(got.type, `outside ${side} ${i}`).toBe(want.type);
            expect(got.offsetMeters, `outside offset ${side} ${i}`).toBe(want.offsetMeters);
          }
        }
      }
    }
  });

  it('GAP11: placeTrees with an empty arroyos list is unchanged', () => {
    const loop: Point2[] = [];
    for (let x = 0; x < 200; x += 4) loop.push([x, 0]);
    for (let z = 0; z < 200; z += 4) loop.push([200, z]);
    for (let x = 200; x > 0; x -= 4) loop.push([x, 200]);
    for (let z = 200; z > 0; z -= 4) loop.push([0, z]);
    const terrain: Terrain = {
      originX: 100, originZ: 100, sizeX: 400, sizeZ: 400, rows: 50, cols: 50,
      heights: new Array<number>(51 * 51).fill(0),
    };
    const barriers: BarrierSegment[] = [
      { start: 0, end: loop.length - 1, side: 'left', type: 'armco', offsetMeters: 7.25 },
    ];
    const biome = { species: [{ name: 'shrub-dry', weight: 1 }], density: 0.4 };
    const none = placeTrees('post-empty', loop, terrain, barriers, biome);
    const empty = placeTrees('post-empty', loop, terrain, barriers, biome, []);
    expect(empty).toEqual(none);
  });

  it('GAP12: placeTrees keeps zero density on the bank', () => {
    const loop: Point2[] = [];
    for (let x = 0; x < 200; x += 4) loop.push([x, 0]);
    for (let z = 0; z < 200; z += 4) loop.push([200, z]);
    for (let x = 200; x > 0; x -= 4) loop.push([x, 200]);
    for (let z = 200; z > 0; z -= 4) loop.push([0, z]);
    const terrain: Terrain = {
      originX: 100, originZ: 100, sizeX: 400, sizeZ: 400, rows: 50, cols: 50,
      heights: new Array<number>(51 * 51).fill(0),
    };
    const barriers: BarrierSegment[] = [
      { start: 0, end: loop.length - 1, side: 'left', type: 'armco', offsetMeters: 7.25 },
    ];
    const biome = { species: [{ name: 'shrub-dry', weight: 1 }], density: 0 };
    const trees = placeTrees('post-zero', loop, terrain, barriers, biome, [WATER]);
    expect(trees.reduce((s, t) => s + t.data.length / 4, 0)).toBe(0);
  });

  it('GAP13: createBridgeObject adds nothing when the track has no bridges or arroyos', () => {
    const { group, dispose } = createBridgeObject(gTrack({}), () => 0);
    expect(group.children).toHaveLength(0);
    expect(() => dispose()).not.toThrow();
  });

  it('GAP14: createBridgeObject skips degenerate bridge spans', () => {
    const { group } = createBridgeObject(
      gTrack({
        bridges: [
          { from: -1, to: 10 },
          { from: 500, to: 500 },
          { from: 990, to: 2000 },
          { from: 480, to: 520 },
        ],
      }),
      () => 0,
    );
    const meshes = meshesOf(group);
    expect(meshes).toHaveLength(3);
    for (const m of meshes) {
      const box = new THREE.Box3().setFromObject(m);
      expect(box.min.x).toBeGreaterThanOrEqual(480 - 0.5);
      expect(box.max.x).toBeLessThanOrEqual(520 + 0.5);
    }
  });

  it('GAP15: createBridgeObject ignores arroyo lines shorter than two points', () => {
    const single = { line: [[500, 0]] as [number, number][], width: 30 };
    const { group } = createBridgeObject(gTrack({ arroyos: [single] }), () => 0);
    expect(group.children).toHaveLength(0);
    const both = createBridgeObject(gTrack({ arroyos: [single, { line: WATER_LINE, width: 30 }] }), () => 0);
    expect(meshesOf(both.group)).toHaveLength(1);
  });

  it('GAP16: the gravel bed strip is draped at terrainY + 0.05', () => {
    const terrainY = (x: number, z: number): number => z / 100;
    const { group } = createBridgeObject(gTrack({ arroyos: [{ line: WATER_LINE, width: 30 }] }), terrainY);
    const meshes = meshesOf(group);
    expect(meshes).toHaveLength(1);
    const bed = meshes[0];
    expect(textureNames(bed.material).some((n) => n.includes('textures/gravel'))).toBe(true);
    const pos = bed.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(pos.count).toBe(4);
    for (let k = 0; k < pos.count; k++) {
      const [x, y, z] = [pos.getX(k), pos.getY(k), pos.getZ(k)];
      expect(Math.abs(x - 500), `bed x ${k}`).toBeCloseTo(15, 6);
      expect(y, `bed y ${k}`).toBeCloseTo(terrainY(x, z) + 0.05, 6);
    }
  });

  it('GAP17: the deck and wall tops follow a sloped span elevation', () => {
    const { group } = createBridgeObject(
      gTrack({ elevation: CENTERLINE.map((_, i) => 0.01 * i), bridges: [{ from: 480, to: 520 }] }),
      () => 0,
    );
    const meshes = meshesOf(group);
    const deck = meshes.find((m) => textureNames(m.material).some((n) => n.includes('textures/concrete')));
    expect(deck, 'deck present').toBeDefined();
    const pitch = Math.atan2(0.4, 40);
    const deckBox = new THREE.Box3().setFromObject(deck!);
    const centerY = (deckBox.min.y + deckBox.max.y) / 2;
    expect(Math.abs(centerY - (5 - 0.05 - 0.3 * Math.cos(pitch)))).toBeLessThanOrEqual(0.02);
    expect(deckBox.max.y - deckBox.min.y, 'deck pitched, not flat').toBeGreaterThan(0.9);
    expect(Math.abs(deckBox.max.y - (5.2 - 0.05)), 'deck top at the high abutment').toBeLessThanOrEqual(0.02);
    const walls = meshes.filter((m) => textureNames(m.material).some((n) => n.includes('textures/stone/old-wall')));
    expect(walls).toHaveLength(2);
    for (const w of walls) {
      const box = new THREE.Box3().setFromObject(w);
      expect(Math.abs(box.max.y - (5.2 - 0.05)), 'wall top follows the deck plane').toBeLessThanOrEqual(0.02);
    }
  });

  it('GAP18: dispose releases every geometry, material and texture exactly once', () => {
    const { group, dispose } = createBridgeObject(
      gTrack({ bridges: [{ from: 480, to: 520 }], arroyos: [{ line: WATER_LINE, width: 30 }] }),
      () => 0,
    );
    const meshes = meshesOf(group);
    expect(meshes.length).toBeGreaterThan(0);
    const geometries = meshes.map((m) => m.geometry);
    const materials = new Set(meshes.map((m) => m.material as THREE.Material));
    const textures = new Set<THREE.Texture>();
    for (const m of materials) {
      const std = m as THREE.MeshStandardMaterial;
      for (const t of [std.map, std.normalMap, std.roughnessMap]) if (t) textures.add(t);
      const owned = (m.userData as { textures?: THREE.Texture[] }).textures;
      if (owned) for (const t of owned) textures.add(t);
    }
    let events = 0;
    for (const g of geometries) g.addEventListener('dispose', () => { events++; });
    for (const m of materials) m.addEventListener('dispose', () => { events++; });
    for (const t of textures) t.addEventListener('dispose', () => { events++; });
    dispose();
    expect(events).toBe(geometries.length + materials.size + textures.size);
    dispose();
    expect(events).toBe(geometries.length + materials.size + textures.size);
  });

  it('GAP19: rebuilt ermita JSONs omit bridges on mixto and carry spans on the rest', () => {
    const ids = [
      'ermita-centro',
      'ermita-federal',
      'ermita-mixto',
      'ermita-norte',
      'ermita-poniente',
      'ermita-veloz',
    ];
    for (const id of ids) {
      const track = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
      ) as TrackDataV2;
      expect(track.arroyos?.length ?? 0, `${id}: arroyos`).toBeGreaterThan(0);
      const bridges = track.bridges ?? [];
      if (id === 'ermita-mixto') {
        expect('bridges' in track, 'mixto omits bridges').toBe(false);
        continue;
      }
      expect(bridges.length, `${id}: bridges`).toBeGreaterThan(0);
      for (const b of bridges) {
        expect(b.from, `${id}: from`).toBeGreaterThanOrEqual(0);
        expect(b.from).toBeLessThan(b.to);
        expect(b.to).toBeLessThan(track.centerline.length);
      }
    }
  });
});
