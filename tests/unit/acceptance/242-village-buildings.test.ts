import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// The modules land with this task; variable specifiers keep typecheck green until then (157/158 pattern).
const VILLAGE_MODULE = '../../../tools/env/villageBuildings';
const CITY_RENDERER_MODULE = '../../../src/render/cityRenderer';
const ROOT = join(__dirname, '..', '..', '..');

type P = [number, number];
type Seg = [P, P];
type Range = [number, number];

interface Building {
  ring: P[];
  height: number;
  material: string;
  color?: number;
  tank?: boolean;
}
interface Wall {
  line: P[];
  height: number;
  thickness: number;
}
interface CityEnv {
  buildings: Building[];
  walls: Wall[];
  water: P[][];
}
interface VillageParams {
  centerline: P[];
  halfWidthLeft: number[];
  halfWidthRight: number[];
  streets: P[][];
  mask: P[][];
  exclusions: P[][];
  seed: number;
}
interface VillageModule {
  VILLAGE_PALETTE: readonly number[];
  buildVillageEnv(p: VillageParams): CityEnv;
}
interface CityObjectLike {
  group: THREE.Group;
  dispose(): void;
}
type CreateCityObject = (
  env: CityEnv,
  terrainY: (x: number, z: number) => number,
  loadTexture?: (url: string) => THREE.Texture,
) => CityObjectLike;
interface Barrier {
  start: number;
  end: number;
  side: 'left' | 'right';
  offsetMeters: number;
}
interface TrackJson {
  centerline: P[];
  barriers: Barrier[];
}

async function loadVillage(): Promise<VillageModule> {
  return (await import(VILLAGE_MODULE)) as VillageModule;
}

async function loadCityRenderer(): Promise<{ createCityObject: CreateCityObject }> {
  return (await import(CITY_RENDERER_MODULE)) as { createCityObject: CreateCityObject };
}

function rect(x0: number, x1: number, z0: number, z1: number): P[] {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

function fixture(overrides: Partial<VillageParams> = {}): VillageParams {
  const centerline: P[] = [];
  for (let i = 0; i <= 400; i++) centerline.push([i, 0]);
  return {
    centerline,
    halfWidthLeft: centerline.map(() => 5),
    halfWidthRight: centerline.map(() => 5),
    streets: [[[200, -80], [200, 80]]],
    mask: [rect(-20, 420, -80, 80)],
    exclusions: [],
    seed: 7,
    ...overrides,
  };
}

let fixtureCache: CityEnv | undefined;
async function fixtureEnv(): Promise<CityEnv> {
  if (!fixtureCache) {
    const mod = await loadVillage();
    fixtureCache = mod.buildVillageEnv(fixture());
  }
  return fixtureCache;
}

function pointSegDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

function orient(a: P, b: P, c: P): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segSegDist(a: P, b: P, c: P, d: P): number {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(
    pointSegDist(a, c, d),
    pointSegDist(b, c, d),
    pointSegDist(c, a, b),
    pointSegDist(d, a, b),
  );
}

function loopSegments(poly: P[], closed: boolean): Seg[] {
  const segs: Seg[] = [];
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) segs.push([poly[i], poly[(i + 1) % poly.length]]);
  return segs;
}

function segsDist(p: P, segs: Seg[]): number {
  let min = Infinity;
  for (const [a, b] of segs) min = Math.min(min, pointSegDist(p, a, b));
  return min;
}

function segsSegDist(a: P, b: P, segs: Seg[]): number {
  let min = Infinity;
  for (const [c, d] of segs) min = Math.min(min, segSegDist(a, b, c, d));
  return min;
}

function pointInPoly(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (pointSegDist(p, poly[i], poly[j]) <= 1e-9) return true;
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Interior overlap deeper than tol on every separating axis; touching counts as separated.
function satOverlap(a: P[], b: P[], tol: number): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = -(q[1] - p[1]);
      const nz = q[0] - p[0];
      const len = Math.hypot(nx, nz);
      if (len === 0) continue;
      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const v of a) {
        const d = (v[0] * nx + v[1] * nz) / len;
        if (d < aMin) aMin = d;
        if (d > aMax) aMax = d;
      }
      for (const v of b) {
        const d = (v[0] * nx + v[1] * nz) / len;
        if (d < bMin) bMin = d;
        if (d > bMax) bMax = d;
      }
      if (Math.max(bMin - aMax, aMin - bMax) >= -tol) return false;
    }
  }
  return true;
}

function roadDist(p: P, roads: Seg[][]): number {
  let min = Infinity;
  for (const segs of roads) min = Math.min(min, segsDist(p, segs));
  return min;
}

function frontIndex(ring: P[], roads: Seg[][]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const d = (roadDist(a, roads) + roadDist(b, roads)) / 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function fixtureRoads(): Seg[][] {
  const f = fixture();
  return [loopSegments(f.centerline, true), loopSegments(f.streets[0], false)];
}

function coversIndex(b: Barrier, i: number): boolean {
  return b.start <= b.end ? i >= b.start && i <= b.end : i >= b.start || i <= b.end;
}

function sideAt(c: P[], i: number, p: P): 'left' | 'right' {
  const n = c.length;
  const prev = c[(i - 1 + n) % n];
  const next = c[(i + 1) % n];
  const tx = next[0] - prev[0];
  const tz = next[1] - prev[1];
  return (p[0] - c[i][0]) * -tz + (p[1] - c[i][1]) * tx >= 0 ? 'right' : 'left';
}

function nearestVertexIndex(c: P[], p: P): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < c.length; i++) {
    const d = Math.hypot(p[0] - c[i][0], p[1] - c[i][1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function nearestVertexEdgeIndex(c: P[], a: P, b: P): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < c.length; i++) {
    const d = pointSegDist(c[i], a, b);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function barrierLimit(track: TrackJson, i: number, p: P): number {
  const side = sideAt(track.centerline, i, p);
  const seg = track.barriers.find((b) => b.side === side && coversIndex(b, i));
  expect(seg, `barrier covering index ${i} on the ${side}`).toBeDefined();
  if (!seg) return 0;
  return seg.offsetMeters + 1.0 - 1e-6;
}

describe('242 village buildings acceptance', () => {
  it('AT1: fixture F is reproducible and seed 8 changes the output', async () => {
    const mod = await loadVillage();
    const first = mod.buildVillageEnv(fixture());
    const second = mod.buildVillageEnv(fixture());
    expect(second).toEqual(first);
    const other = mod.buildVillageEnv(fixture({ seed: 8 }));
    expect(other).not.toEqual(first);
  });

  it('AT2: every ring vertex and edge keeps 7.5 m from the track and 5.0 m from the street', async () => {
    const env = await fixtureEnv();
    const f = fixture();
    const track = loopSegments(f.centerline, true);
    const street = loopSegments(f.streets[0], false);
    for (const b of env.buildings) {
      for (let i = 0; i < b.ring.length; i++) {
        const p = b.ring[i];
        const q = b.ring[(i + 1) % b.ring.length];
        const label = `${b.ring[0][0]},${b.ring[0][1]} edge ${i}`;
        expect(segsDist(p, track), `vertex ${label}`).toBeGreaterThanOrEqual(7.5 - 1e-6);
        expect(segsSegDist(p, q, track), `edge ${label}`).toBeGreaterThanOrEqual(7.5 - 1e-6);
        expect(segsDist(p, street), `vertex ${label}`).toBeGreaterThanOrEqual(5.0 - 1e-6);
        expect(segsSegDist(p, q, street), `edge ${label}`).toBeGreaterThanOrEqual(5.0 - 1e-6);
      }
    }
  });

  it('AT3: front edges cover at least 70% of the 320 m per side', async () => {
    const env = await fixtureEnv();
    const roads = fixtureRoads();
    const sides: Record<'plus' | 'minus', Range[]> = { plus: [], minus: [] };
    for (const b of env.buildings) {
      const i = frontIndex(b.ring, roads);
      const a = b.ring[i];
      const c = b.ring[(i + 1) % b.ring.length];
      const side = (a[1] + c[1]) / 2 > 0 ? 'plus' : 'minus';
      sides[side].push([Math.min(a[0], c[0]), Math.max(a[0], c[0])]);
    }
    for (const key of ['plus', 'minus'] as const) {
      const clipped: Range[] = [];
      for (const [x0, x1] of sides[key]) {
        for (const [lo, hi] of [[20, 180], [220, 380]] as Range[]) {
          const l = Math.max(x0, lo);
          const h = Math.min(x1, hi);
          if (h > l) clipped.push([l, h]);
        }
      }
      clipped.sort((p, q) => p[0] - q[0]);
      let covered = 0;
      let end = -Infinity;
      for (const [l, h] of clipped) {
        if (h > end) {
          covered += h - Math.max(l, end);
          end = h;
        }
      }
      expect(covered, `${key} side covered length`).toBeGreaterThanOrEqual(0.7 * 320);
    }
  });

  it('AT4: with the mask cut at x=200 every building centroid stays inside', async () => {
    const mod = await loadVillage();
    const mask = [rect(-20, 200, -80, 80)];
    const env = mod.buildVillageEnv(fixture({ mask }));
    for (const b of env.buildings) {
      const cx = b.ring.reduce((s, p) => s + p[0], 0) / b.ring.length;
      const cz = b.ring.reduce((s, p) => s + p[1], 0) / b.ring.length;
      expect(mask.some((poly) => pointInPoly([cx, cz], poly)), `centroid ${cx},${cz}`).toBe(true);
    }
  });

  it('AT5: no two building rings overlap', async () => {
    const env = await fixtureEnv();
    const rings = env.buildings.map((b) => b.ring);
    for (let i = 0; i < rings.length; i++) {
      for (let j = i + 1; j < rings.length; j++) {
        expect(satOverlap(rings[i], rings[j], 1e-6), `rings ${i} and ${j}`).toBe(false);
      }
    }
  });

  it('AT6: every house is a 4-vertex rectangle with spec frontage, depth, height, material and colour', async () => {
    const mod = await loadVillage();
    const env = await fixtureEnv();
    const roads = fixtureRoads();
    let tall = 0;
    for (const b of env.buildings) {
      const label = `${b.ring[0][0]},${b.ring[0][1]}`;
      expect(b.ring, `ring ${label}`).toHaveLength(4);
      expect(new Set(b.ring.map((p) => `${p[0]},${p[1]}`)).size, `distinct vertices ${label}`).toBe(4);
      for (let i = 0; i < 4; i++) {
        const prev = b.ring[(i + 3) % 4];
        const cur = b.ring[i];
        const next = b.ring[(i + 1) % 4];
        const ax = prev[0] - cur[0];
        const az = prev[1] - cur[1];
        const bx = next[0] - cur[0];
        const bz = next[1] - cur[1];
        const angle = (Math.atan2(Math.abs(ax * bz - az * bx), ax * bx + az * bz) * 180) / Math.PI;
        expect(Math.abs(angle - 90), `angle ${i} of ${label}`).toBeLessThanOrEqual(0.1);
      }
      const f = frontIndex(b.ring, roads);
      const frontage = Math.hypot(
        b.ring[(f + 1) % 4][0] - b.ring[f][0],
        b.ring[(f + 1) % 4][1] - b.ring[f][1],
      );
      const depth = Math.hypot(
        b.ring[(f + 2) % 4][0] - b.ring[(f + 1) % 4][0],
        b.ring[(f + 2) % 4][1] - b.ring[(f + 1) % 4][1],
      );
      expect(frontage, `frontage ${label}`).toBeGreaterThanOrEqual(6);
      expect(frontage, `frontage ${label}`).toBeLessThanOrEqual(14);
      expect(depth, `depth ${label}`).toBeGreaterThanOrEqual(9);
      expect(depth, `depth ${label}`).toBeLessThanOrEqual(16);
      expect([3.2, 6.4], `height ${label}`).toContain(b.height);
      expect(b.material, `material ${label}`).toBe('plaster');
      expect(mod.VILLAGE_PALETTE, `colour ${label}`).toContain(b.color);
      if (b.height === 6.4) tall++;
    }
    expect(tall / env.buildings.length, 'share of 6.4 m houses').toBeGreaterThanOrEqual(0.15);
    expect(new Set(env.buildings.map((b) => b.color)).size, 'distinct colours').toBeGreaterThanOrEqual(5);
  });

  it('AT7: no building overlaps the exclusion square x in [90,130], z in [5,40]', async () => {
    const mod = await loadVillage();
    const exclusion = rect(90, 130, 5, 40);
    const env = mod.buildVillageEnv(fixture({ exclusions: [exclusion] }));
    for (const b of env.buildings) {
      expect(satOverlap(b.ring, exclusion, 1e-6), `ring ${b.ring[0][0]},${b.ring[0][1]}`).toBe(false);
    }
  });

  it('AT8: every ring vertex stays 8 m from the junction at (200, 0)', async () => {
    const env = await fixtureEnv();
    for (const b of env.buildings) {
      for (const p of b.ring) {
        expect(Math.hypot(p[0] - 200, p[1]), `vertex ${p[0]},${p[1]}`).toBeGreaterThanOrEqual(8 - 1e-9);
      }
    }
  });

  it('AT9: walls are 2.2 m high, 0.3 m thick, on the setback line and clear of buildings', async () => {
    const env = await fixtureEnv();
    const f = fixture();
    const track = loopSegments(f.centerline, true);
    const street = loopSegments(f.streets[0], false);
    for (const w of env.walls) {
      const label = `${w.line[0][0]},${w.line[0][1]}`;
      expect(w.height, `height ${label}`).toBe(2.2);
      expect(w.thickness, `thickness ${label}`).toBe(0.3);
      const onTrack = w.line.every((p) => Math.abs(segsDist(p, track) - 7.5) <= 1e-6);
      const onStreet = w.line.every((p) => Math.abs(segsDist(p, street) - 5.0) <= 1e-6);
      expect(onTrack || onStreet, `setback line ${label}`).toBe(true);
      const a = w.line[0];
      const b = w.line[w.line.length - 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = (-(b[1] - a[1]) / len) * 0.15;
      const nz = ((b[0] - a[0]) / len) * 0.15;
      const wallRing: P[] = [
        [a[0] + nx, a[1] + nz],
        [b[0] + nx, b[1] + nz],
        [b[0] - nx, b[1] - nz],
        [a[0] - nx, a[1] - nz],
      ];
      for (const house of env.buildings) {
        expect(satOverlap(wallRing, house.ring, 1e-6), `wall ${label} vs house ${house.ring[0][0]},${house.ring[0][1]}`).toBe(false);
      }
    }
  });

  it('AT10: every ermita env has >= 150 plaster houses clear of the barrier line', async () => {
    const dir = join(ROOT, 'public', 'tracks');
    const files = readdirSync(dir).filter((f) => /^ermita-.*-env\.json$/.test(f));
    const tracks = readdirSync(dir).filter((f) => /^ermita-[^-]+\.json$/.test(f));
    for (const track of tracks) {
      expect(files, `env for ${track}`).toContain(track.replace(/\.json$/, '-env.json'));
    }
    const mod = await loadVillage();
    for (const file of files) {
      const env = JSON.parse(readFileSync(join(dir, file), 'utf8')) as CityEnv;
      const trackJson = JSON.parse(
        readFileSync(join(dir, file.replace(/-env\.json$/, '.json')), 'utf8'),
      ) as TrackJson;
      expect(env.buildings.length, `${file} buildings`).toBeGreaterThanOrEqual(150);
      const segs = loopSegments(trackJson.centerline, true);
      for (const b of env.buildings) {
        expect(b.material, `${file} material`).toBe('plaster');
        expect(mod.VILLAGE_PALETTE, `${file} colour ${b.color}`).toContain(b.color);
        for (let i = 0; i < b.ring.length; i++) {
          const p = b.ring[i];
          const vi = nearestVertexIndex(trackJson.centerline, p);
          expect(segsDist(p, segs), `${file} vertex ${p[0]},${p[1]}`).toBeGreaterThanOrEqual(
            barrierLimit(trackJson, vi, p),
          );
          const q = b.ring[(i + 1) % b.ring.length];
          const mid: P = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          const ei = nearestVertexEdgeIndex(trackJson.centerline, p, q);
          expect(segsSegDist(p, q, segs), `${file} edge ${i}`).toBeGreaterThanOrEqual(
            barrierLimit(trackJson, ei, mid),
          );
        }
      }
    }
  }, 300000);

  it('AT11: plaster houses merge into one vertex-coloured mesh plus a tank instanced mesh', async () => {
    const { createCityObject } = await loadCityRenderer();
    const env: CityEnv = {
      buildings: [
        { ring: [[0, 0], [10, 0], [10, 10], [0, 10]], height: 3.2, material: 'plaster', color: 0xc8963e, tank: true },
        { ring: [[250, 0], [260, 0], [260, 10], [250, 10]], height: 6.4, material: 'plaster', color: 0xd98c8c, tank: true },
        { ring: [[500, 0], [510, 0], [510, 10], [500, 10]], height: 3.2, material: 'plaster', color: 0x8fb8c8 },
      ],
      walls: [],
      water: [],
    };
    const city = createCityObject(env, () => 0, () => new THREE.Texture());
    const meshes: THREE.Mesh[] = [];
    const instanced: THREE.InstancedMesh[] = [];
    city.group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) instanced.push(mesh as THREE.InstancedMesh);
      else meshes.push(mesh);
    });
    expect(meshes, 'merged plaster meshes').toHaveLength(1);
    expect(instanced, 'tank meshes').toHaveLength(1);
    expect(instanced[0].count, 'tank count').toBe(2);
    const material = meshes[0].material as THREE.MeshStandardMaterial;
    expect(material.vertexColors, 'vertexColors').toBe(true);
    const attr = meshes[0].geometry.getAttribute('color');
    expect(attr, 'color attribute').toBeDefined();
    const colors = attr as THREE.BufferAttribute;
    const seen: [number, number, number][] = [];
    for (let i = 0; i < colors.count; i++) seen.push([colors.getX(i), colors.getY(i), colors.getZ(i)]);
    for (const hex of [0xc8963e, 0xd98c8c, 0x8fb8c8]) {
      const expected = new THREE.Color().setHex(hex);
      const hit = seen.some(
        ([r, g, b]) =>
          Math.abs(r - expected.r) < 1e-6 &&
          Math.abs(g - expected.g) < 1e-6 &&
          Math.abs(b - expected.b) < 1e-6,
      );
      expect(hit, `colour ${hex.toString(16)} in vertex colours`).toBe(true);
    }
    const all = [...meshes, ...instanced];
    const geometries = [...new Set(all.map((m) => m.geometry))];
    const materials = [
      ...new Set(all.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material]))),
    ];
    const geoSpies = geometries.map((g) => vi.spyOn(g, 'dispose'));
    const matSpies = materials.map((m) => vi.spyOn(m, 'dispose'));
    city.dispose();
    for (const s of geoSpies) expect(s, 'geometry disposed').toHaveBeenCalled();
    for (const s of matSpies) expect(s, 'material disposed').toHaveBeenCalled();
  });

  it('AT12: baku, lasvegas and singapore env files are byte-identical to master', () => {
    for (const id of ['baku', 'lasvegas', 'singapore']) {
      const file = `public/tracks/${id}-env.json`;
      const before = execFileSync('git', ['show', `master:${file}`], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
      });
      const after = readFileSync(join(ROOT, file));
      expect(after.equals(before), `${file} differs from master`).toBe(true);
    }
  });
});
