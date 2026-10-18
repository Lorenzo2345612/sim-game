import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CityEnv } from '../../../src/core/types';
import { bboxCenter, projectLonLat, type LonLat } from '../../../src/track/geo';
import {
  buildVillageEnv,
  VILLAGE_PALETTE,
  villageSeed,
  type VillageParams,
} from '../../../tools/env/villageBuildings';

type P = [number, number];
type Seg = [P, P];

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

function pointSegDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
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

function centroid(ring: P[]): P {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

describe('242 village buildings post', () => {
  it('POST1: empty or single-point centerline yields an empty env without throwing', () => {
    for (const centerline of [[] as P[], [[0, 0]] as P[]]) {
      const env = buildVillageEnv({
        centerline,
        halfWidthLeft: centerline.map(() => 5),
        halfWidthRight: centerline.map(() => 5),
        streets: [],
        mask: [rect(-20, 420, -80, 80)],
        exclusions: [],
        seed: 7,
      });
      expect(env.buildings).toEqual([]);
      expect(env.walls).toEqual([]);
      expect(env.water).toEqual([]);
    }
  });

  it('POST2: buildVillageEnv always returns an empty water list', () => {
    expect(buildVillageEnv(fixture()).water).toEqual([]);
    expect(buildVillageEnv(fixture({ streets: [], mask: [] })).water).toEqual([]);
  });

  it('POST3: an empty mask list leaves lots unconstrained and empty streets skip street rows', () => {
    const free = buildVillageEnv(fixture({ mask: [], streets: [] }));
    expect(free.buildings.length).toBeGreaterThan(0);
    const track = loopSegments(fixture().centerline, true);
    for (const b of free.buildings) {
      for (const p of b.ring) expect(segsDist(p, track)).toBeGreaterThanOrEqual(7.5 - 1e-6);
    }
  });

  it('POST4: default setbacks follow each side half-width plus 2.5 m', () => {
    const base = fixture({
      halfWidthLeft: Array.from({ length: 401 }, () => 5),
      halfWidthRight: Array.from({ length: 401 }, () => 12),
    });
    const env = buildVillageEnv(base);
    const track = loopSegments(base.centerline, true);
    let leftMin = Infinity;
    let rightMin = Infinity;
    for (const b of env.buildings) {
      for (const p of b.ring) {
        const d = segsDist(p, track);
        if (centroid(b.ring)[1] < 0) leftMin = Math.min(leftMin, d);
        else rightMin = Math.min(rightMin, d);
      }
    }
    expect(leftMin).toBeCloseTo(7.5, 5);
    expect(rightMin).toBeCloseTo(14.5, 5);
  });

  it('POST5: trackSetbackRight alone leaves the left side at halfWidth + 2.5', () => {
    const base = fixture();
    const env = buildVillageEnv({
      ...base,
      trackSetbackRight: base.centerline.map(() => 30),
    });
    const track = loopSegments(base.centerline, true);
    let leftMin = Infinity;
    let rightMin = Infinity;
    for (const b of env.buildings) {
      for (const p of b.ring) {
        const d = segsDist(p, track);
        if (centroid(b.ring)[1] < 0) leftMin = Math.min(leftMin, d);
        else rightMin = Math.min(rightMin, d);
      }
    }
    expect(leftMin).toBeCloseTo(7.5, 5);
    expect(rightMin).toBeCloseTo(30, 5);
  });

  it('POST6: a parallel street gets rows on both of its sides', () => {
    const env = buildVillageEnv(fixture({ streets: [[[50, 50], [350, 50]]] }));
    const south = env.buildings.filter((b) => {
      const [, cz] = centroid(b.ring);
      return cz > 25 && cz < 50;
    });
    const north = env.buildings.filter((b) => {
      const [, cz] = centroid(b.ring);
      return cz > 50 && cz < 80;
    });
    expect(south.length, 'houses south of the street').toBeGreaterThanOrEqual(1);
    expect(north.length, 'houses north of the street').toBeGreaterThanOrEqual(1);
    const street = loopSegments([[50, 50], [350, 50]], false);
    for (const b of [...south, ...north]) {
      for (const p of b.ring) expect(segsDist(p, street)).toBeGreaterThanOrEqual(5 - 1e-6);
    }
  });

  it('POST7: lots land in every disjoint mask polygon and never outside them', () => {
    const mask = [rect(-20, 180, -80, 80), rect(240, 420, -80, 80)];
    const env = buildVillageEnv(fixture({ mask }));
    const inMask = (p: P): boolean =>
      mask.some((poly) => {
        const xs = poly.map((q) => q[0]);
        const zs = poly.map((q) => q[1]);
        return p[0] >= Math.min(...xs) && p[0] <= Math.max(...xs) && p[1] >= Math.min(...zs) && p[1] <= Math.max(...zs);
      });
    for (const b of env.buildings) {
      for (const p of b.ring) expect(inMask(p), `vertex ${p[0]},${p[1]}`).toBe(true);
    }
    const left = env.buildings.filter((b) => centroid(b.ring)[0] < 180).length;
    const right = env.buildings.filter((b) => centroid(b.ring)[0] > 240).length;
    expect(left, 'houses in the first mask polygon').toBeGreaterThanOrEqual(1);
    expect(right, 'houses in the second mask polygon').toBeGreaterThanOrEqual(1);
  });

  it('POST8: an exclusion over the whole mask drops every lot and wall', () => {
    const env = buildVillageEnv(fixture({ exclusions: [rect(-50, 450, -80, 80)] }));
    expect(env.buildings).toEqual([]);
    expect(env.walls).toEqual([]);
  });

  it('POST9: degenerate and single-point streets are ignored without throwing', () => {
    const env = buildVillageEnv(
      fixture({ streets: [[[200, 40], [200, 40]], [[100, 60]]] }),
    );
    expect(env.buildings.length).toBeGreaterThan(0);
    const track = loopSegments(fixture().centerline, true);
    for (const b of env.buildings) {
      for (const p of b.ring) expect(segsDist(p, track)).toBeGreaterThanOrEqual(7.5 - 1e-6);
    }
  });

  it('POST10: seed 0 is a valid stream distinct from seed 1 and negative seeds coerce', () => {
    const a = buildVillageEnv(fixture({ seed: 0 }));
    const b = buildVillageEnv(fixture({ seed: 1 }));
    expect(a.buildings.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
    const neg = buildVillageEnv(fixture({ seed: -1 }));
    const wrap = buildVillageEnv(fixture({ seed: 0xffffffff }));
    expect(neg).toEqual(wrap);
  });

  it('POST11: vacant walls carry the lot frontage and sit on the setback line', () => {
    const base = fixture();
    const env = buildVillageEnv(base);
    expect(env.walls.length).toBeGreaterThanOrEqual(1);
    const track = loopSegments(base.centerline, true);
    const street = loopSegments(base.streets[0], false);
    for (const w of env.walls) {
      const a = w.line[0];
      const b = w.line[w.line.length - 1];
      const frontage = Math.hypot(b[0] - a[0], b[1] - a[1]);
      expect(frontage, `wall frontage ${a[0]},${a[1]}`).toBeGreaterThanOrEqual(6);
      expect(frontage, `wall frontage ${a[0]},${a[1]}`).toBeLessThanOrEqual(14);
      const onTrack = w.line.every((p) => Math.abs(segsDist(p, track) - 7.5) <= 1e-6);
      const onStreet = w.line.every((p) => Math.abs(segsDist(p, street) - 5.0) <= 1e-6);
      expect(onTrack || onStreet, `wall ${a[0]},${a[1]} on a setback line`).toBe(true);
      expect(w.line, `wall line points ${a[0]},${a[1]}`).toHaveLength(2);
    }
  });

  it('POST12: tall and tanked shares stay in their configured bands for seed 7', () => {
    const env = buildVillageEnv(fixture());
    const n = env.buildings.length;
    expect(n).toBeGreaterThan(0);
    const tall = env.buildings.filter((b) => b.height === 6.4).length / n;
    const tanked = env.buildings.filter((b) => b.tank === true).length / n;
    expect(tall, 'tall share').toBeGreaterThanOrEqual(0.15);
    expect(tall, 'tall share').toBeLessThanOrEqual(0.5);
    expect(tanked, 'tank share').toBeGreaterThanOrEqual(0.2);
    expect(tanked, 'tank share').toBeLessThanOrEqual(0.6);
    const vacantShare = env.walls.length / (env.buildings.length + env.walls.length);
    expect(vacantShare, 'vacant share').toBeGreaterThanOrEqual(0.04);
    expect(vacantShare, 'vacant share').toBeLessThanOrEqual(0.22);
    for (const b of env.buildings) {
      expect(VILLAGE_PALETTE).toContain(b.color);
      expect(b.material).toBe('plaster');
    }
  });

  it('POST13: villageSeed matches a plain FNV-1a reference over code units', () => {
    const ref = (id: string): number => {
      let h = 0x811c9dc5;
      for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    };
    for (const id of ['', 'ermita-veloz', 'x'.repeat(64), 'ñ🚗']) {
      expect(villageSeed(id), id).toBe(ref(id));
    }
  });
});

function collectMeshes(group: THREE.Group): { meshes: THREE.Mesh[]; instanced: THREE.InstancedMesh[] } {
  const meshes: THREE.Mesh[] = [];
  const instanced: THREE.InstancedMesh[] = [];
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) instanced.push(mesh as THREE.InstancedMesh);
    else meshes.push(mesh);
  });
  return { meshes, instanced };
}

function yRange(mesh: THREE.Mesh): { min: number; max: number } {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    min = Math.min(min, pos.getY(i));
    max = Math.max(max, pos.getY(i));
  }
  return { min, max };
}

describe('242 village render post', () => {
  it('POST14: CityObject.buildings counts plaster houses and skips degenerate rings', async () => {
    const { createCityObject } = await import('../../../src/render/cityRenderer');
    const env = {
      buildings: [
        { ring: [[0, 0], [10, 0], [10, 10], [0, 10]] as P[], height: 3.2, material: 'plaster' as const, color: 0xc8963e },
        { ring: [[50, 0], [60, 0], [60, 10], [50, 10]] as P[], height: 6.4, material: 'plaster' as const, color: 0xd98c8c },
        { ring: [[100, 0], [110, 0], [110, 0], [100, 0]] as P[], height: 3.2, material: 'plaster' as const, color: 0x8fb8c8 },
      ],
      walls: [],
      water: [],
    };
    const city = createCityObject(env, () => 0, () => new THREE.Texture());
    expect(city.buildings).toBe(2);
    const { meshes } = collectMeshes(city.group);
    expect(meshes).toHaveLength(1);
    city.dispose();
  });

  it('POST15: plaster material is untextured with roughness 0.95', async () => {
    const { createCityObject } = await import('../../../src/render/cityRenderer');
    const env = {
      buildings: [
        { ring: [[0, 0], [10, 0], [10, 10], [0, 10]] as P[], height: 3.2, material: 'plaster' as const, color: 0xc8963e },
      ],
      walls: [],
      water: [],
    };
    const city = createCityObject(env, () => 0, () => new THREE.Texture());
    const { meshes } = collectMeshes(city.group);
    const material = meshes[0].material as THREE.MeshStandardMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.map).toBeNull();
    expect(material.normalMap).toBeNull();
    expect(material.roughnessMap).toBeNull();
    expect(material.roughness).toBeCloseTo(0.95, 6);
    const pos = meshes[0].geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = meshes[0].geometry.getAttribute('color') as THREE.BufferAttribute;
    expect(col.count).toBe(pos.count);
    city.dispose();
  });

  it('POST16: the merged plaster mesh spans base to base + height + 0.4 including the parapet', async () => {
    const { createCityObject } = await import('../../../src/render/cityRenderer');
    const env = {
      buildings: [
        { ring: [[0, 0], [10, 0], [10, 10], [0, 10]] as P[], height: 6.4, material: 'plaster' as const, color: 0xc8963e },
      ],
      walls: [],
      water: [],
    };
    const city = createCityObject(env, () => 3, () => new THREE.Texture());
    const { meshes } = collectMeshes(city.group);
    const { min, max } = yRange(meshes[0]);
    expect(min).toBeCloseTo(3, 6);
    expect(max).toBeCloseTo(3 + 6.4 + 0.4, 6);
    city.dispose();
  });

  it('POST17: each plaster house sits on the minimum terrain height of its ring', async () => {
    const { createCityObject } = await import('../../../src/render/cityRenderer');
    const env = {
      buildings: [
        { ring: [[0, 0], [10, 0], [10, 10], [0, 10]] as P[], height: 3.2, material: 'plaster' as const, color: 0xc8963e },
        { ring: [[50, 0], [60, 0], [60, 10], [50, 10]] as P[], height: 3.2, material: 'plaster' as const, color: 0xd98c8c },
      ],
      walls: [],
      water: [],
    };
    const terrainY = (x: number): number => (x < 30 ? 2 : 8);
    const city = createCityObject(env, terrainY, () => new THREE.Texture());
    const { meshes } = collectMeshes(city.group);
    const pos = meshes[0].geometry.getAttribute('position') as THREE.BufferAttribute;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      low = Math.min(low, pos.getY(i));
      high = Math.max(high, pos.getY(i));
    }
    expect(low).toBeCloseTo(2, 6);
    expect(high).toBeCloseTo(8 + 3.2 + 0.4, 6);
    city.dispose();
  });

  it('POST18: tank geometry is a 0.55 x 1.1 black cylinder with no texture', async () => {
    const { createCityObject } = await import('../../../src/render/cityRenderer');
    const env = {
      buildings: [
        { ring: [[0, 0], [10, 0], [10, 10], [0, 10]] as P[], height: 3.2, material: 'plaster' as const, color: 0xc8963e, tank: true },
      ],
      walls: [],
      water: [],
    };
    const city = createCityObject(env, () => 0, () => new THREE.Texture());
    const { instanced } = collectMeshes(city.group);
    expect(instanced).toHaveLength(1);
    const geo = instanced[0].geometry as THREE.CylinderGeometry;
    const params = geo.parameters as { radiusTop: number; radiusBottom: number; height: number };
    expect(params.radiusTop).toBeCloseTo(0.55, 6);
    expect(params.radiusBottom).toBeCloseTo(0.55, 6);
    expect(params.height).toBeCloseTo(1.1, 6);
    const material = instanced[0].material as THREE.MeshStandardMaterial;
    expect(material.color.getHex()).toBe(0x000000);
    expect(material.map).toBeNull();
    city.dispose();
  });

  it('POST19: plaster and other materials merge separately and keep their own material', async () => {
    const { createCityObject } = await import('../../../src/render/cityRenderer');
    const env = {
      buildings: [
        { ring: [[0, 0], [10, 0], [10, 10], [0, 10]] as P[], height: 3.2, material: 'plaster' as const, color: 0xc8963e },
        { ring: [[250, 0], [260, 0], [260, 10], [250, 10]] as P[], height: 3.2, material: 'brick' as const },
      ],
      walls: [],
      water: [],
    };
    const city = createCityObject(env, () => 0, () => new THREE.Texture());
    expect(city.buildings).toBe(2);
    const { meshes } = collectMeshes(city.group);
    expect(meshes).toHaveLength(2);
    const plaster = meshes.find(
      (m) => (m.material as THREE.MeshStandardMaterial).vertexColors === true,
    );
    const brick = meshes.find(
      (m) => (m.material as THREE.MeshStandardMaterial).vertexColors !== true,
    );
    expect(plaster, 'plaster mesh').toBeDefined();
    expect(brick, 'brick mesh').toBeDefined();
    expect((brick!.material as THREE.MeshStandardMaterial).map).not.toBeNull();
    city.dispose();
  });

  it('POST20: an env with no plaster still builds and disposes cleanly', async () => {
    const { createCityObject } = await import('../../../src/render/cityRenderer');
    const env = {
      buildings: [
        { ring: [[0, 0], [10, 0], [10, 10], [0, 10]] as P[], height: 3.2, material: 'brick' as const },
      ],
      walls: [{ line: [[20, 0], [30, 0]] as P[], height: 2.2, thickness: 0.3 }],
      water: [],
    };
    const city = createCityObject(env, () => 0, () => new THREE.Texture());
    expect(city.buildings).toBe(1);
    const { meshes, instanced } = collectMeshes(city.group);
    expect(instanced).toHaveLength(0);
    expect(meshes.every((m) => (m.material as THREE.MeshStandardMaterial).vertexColors !== true)).toBe(true);
    const spies = meshes.map((m) => vi.spyOn(m.geometry, 'dispose'));
    city.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});

const ERMITA = ['centro', 'federal', 'norte', 'mixto', 'poniente', 'veloz'];
const ROOT = join(__dirname, '..', '..', '..');

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

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;
}

describe('242 baked ermita envs post', () => {
  it('POST21: baked envs are all-plaster with 4-vertex rectangles, 2.2 x 0.3 walls and no water', () => {
    for (const id of ERMITA) {
      const env = readJson<CityEnv>(`public/tracks/ermita-${id}-env.json`);
      expect(env.water, `${id} water`).toEqual([]);
      expect(env.buildings.length, `${id} buildings`).toBeGreaterThanOrEqual(150);
      expect(env.walls.length, `${id} walls`).toBeGreaterThanOrEqual(1);
      for (const b of env.buildings) {
        const label = `${id} ${b.ring[0][0]},${b.ring[0][1]}`;
        expect(b.material, label).toBe('plaster');
        expect(VILLAGE_PALETTE, label).toContain(b.color);
        expect([undefined, true], label).toContain(b.tank);
        expect([3.2, 6.4], label).toContain(b.height);
        expect(b.ring, label).toHaveLength(4);
        const lens = [0, 1, 2, 3]
          .map((i) =>
            Math.hypot(
              b.ring[(i + 1) % 4][0] - b.ring[i][0],
              b.ring[(i + 1) % 4][1] - b.ring[i][1],
            ),
          )
          .sort((a, c) => a - c);
        expect(lens[0], `frontage ${label}`).toBeCloseTo(lens[1], 6);
        expect(lens[2], `depth ${label}`).toBeCloseTo(lens[3], 6);
        expect(lens[0], `min side ${label}`).toBeGreaterThanOrEqual(6 - 1e-6);
        expect(lens[0], `min side ${label}`).toBeLessThanOrEqual(14 + 1e-6);
        expect(lens[2], `max side ${label}`).toBeGreaterThanOrEqual(9 - 1e-6);
        expect(lens[2], `max side ${label}`).toBeLessThanOrEqual(16 + 1e-6);
      }
      for (const w of env.walls) {
        expect(w.height, `${id} wall height`).toBe(2.2);
        expect(w.thickness, `${id} wall thickness`).toBe(0.3);
        expect(w.line, `${id} wall line`).toHaveLength(2);
      }
    }
  }, 60000);
});

interface PitLane {
  start: number;
  end: number;
  side: 'left' | 'right';
}
interface Grandstand {
  x: number;
  z: number;
  yaw: number;
  lengthMeters: number;
  rows: number;
}
interface TrackJson {
  centerline: P[];
  barriers: { start: number; end: number; side: string; offsetMeters: number }[];
  halfWidthLeft?: number[];
  halfWidthRight?: number[];
  widthMeters: number;
  pit: PitLane;
  grandstands: Grandstand[];
}
interface AreasFile {
  features: { kind: string; tags: Record<string, string>; ring: LonLat[] }[];
}

function covers(start: number, end: number, i: number): boolean {
  return start <= end ? i >= start && i <= end : i >= start || i <= end;
}

function rightNormals(pts: P[], closed: boolean): P[] {
  const n = pts.length;
  const out: P[] = [];
  let last: P = [0, 1];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(i - 1, 0)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(i + 1, n - 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
      last = [-dz, dx];
    }
    out.push([last[0], last[1]]);
  }
  return out;
}

function bakeExclusions(id: string): P[][] {
  const track = readJson<TrackJson>(`public/tracks/ermita-${id}.json`);
  const configs = readJson<{ id: string; geojson: string }[]>('tools/track-builder/tracks.json');
  const geojson = configs.find((c) => c.id === `ermita-${id}`)!.geojson;
  const fc = readJson<{ features: { geometry: { coordinates: LonLat[] } }[] }>(
    `assets/source/tracks/${geojson}.geojson`,
  );
  const origin = bboxCenter(fc.features[0].geometry.coordinates);
  const out: P[][] = [];
  const n = track.centerline.length;
  const normals = rightNormals(track.centerline, true);
  const half = (side: string, i: number): number => {
    const arr = side === 'left' ? track.halfWidthLeft : track.halfWidthRight;
    return arr?.[i] ?? track.widthMeters / 2;
  };
  const sign = track.pit.side === 'right' ? 1 : -1;
  const edge = (i: number, extra: number): P => {
    const t = half(track.pit.side, i) + extra;
    return [
      track.centerline[i][0] + normals[i][0] * sign * t,
      track.centerline[i][1] + normals[i][1] * sign * t,
    ];
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!covers(track.pit.start, track.pit.end, i) || !covers(track.pit.start, track.pit.end, j)) continue;
    out.push([edge(i, 0), edge(j, 0), edge(j, 15), edge(i, 15)]);
  }
  for (const g of track.grandstands) {
    const length = g.lengthMeters + 6;
    const depth = g.rows * 0.9 + 6;
    const cos = Math.cos(g.yaw);
    const sin = Math.sin(g.yaw);
    const corner = (u: number, v: number): P => [g.x + u * cos + v * sin, g.z - u * sin + v * cos];
    out.push([
      corner(-length / 2, -depth / 2),
      corner(length / 2, -depth / 2),
      corner(length / 2, depth / 2),
      corner(-length / 2, depth / 2),
    ]);
  }
  const areas = readJson<AreasFile>(`assets/source/osm/ermita-${id}-areas.json`);
  for (const feature of areas.features) {
    if (feature.kind !== 'water' || feature.ring.length < 2) continue;
    const width = Number.parseFloat(feature.tags.est_width_m ?? '');
    if (!(width > 0)) continue;
    const halfW = width / 2 + 3;
    const line = projectLonLat(feature.ring, origin);
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len === 0) continue;
      const nx = (-(b[1] - a[1]) / len) * halfW;
      const nz = ((b[0] - a[0]) / len) * halfW;
      out.push([
        [a[0] + nx, a[1] + nz],
        [b[0] + nx, b[1] + nz],
        [b[0] - nx, b[1] - nz],
        [a[0] - nx, a[1] - nz],
      ]);
    }
  }
  return out;
}

describe('242 baked exclusions post', () => {
  it('POST22: no baked house overlaps the pit strip, a grandstand pad or a water corridor', () => {
    for (const id of ERMITA) {
      const env = readJson<CityEnv>(`public/tracks/ermita-${id}-env.json`);
      const exclusions = bakeExclusions(id);
      expect(exclusions.length, `${id} exclusion count`).toBeGreaterThan(0);
      for (const b of env.buildings) {
        for (const poly of exclusions) {
          expect(
            satOverlap(b.ring, poly, 1e-6),
            `${id} house ${b.ring[0][0]},${b.ring[0][1]}`,
          ).toBe(false);
        }
      }
      for (const w of env.walls) {
        const a = w.line[0];
        const c = w.line[w.line.length - 1];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const nx = (-(c[1] - a[1]) / len) * (w.thickness / 2);
        const nz = ((c[0] - a[0]) / len) * (w.thickness / 2);
        const ring: P[] = [
          [a[0] + nx, a[1] + nz],
          [c[0] + nx, c[1] + nz],
          [c[0] - nx, c[1] - nz],
          [a[0] - nx, a[1] - nz],
        ];
        for (const poly of exclusions) {
          expect(satOverlap(ring, poly, 1e-6), `${id} wall ${a[0]},${a[1]}`).toBe(false);
        }
      }
    }
  }, 60000);
});

describe('242 bake CLI post', () => {
  it('POST23: bakeVillage without ids prints usage and exits 1', () => {
    const result = spawnSync('npx', ['tsx', 'tools/env/bakeVillage.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('usage: tsx tools/env/bakeVillage.ts <id>...');
  }, 90000);

  it('POST24: package.json exposes build:village over bakeVillage.ts', () => {
    const pkg = readJson<{ scripts: Record<string, string> }>('package.json');
    expect(pkg.scripts['build:village']).toBe('tsx tools/env/bakeVillage.ts');
  });
});
