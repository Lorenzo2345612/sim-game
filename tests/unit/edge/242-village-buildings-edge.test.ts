import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const VILLAGE_MODULE = '../../../tools/env/villageBuildings';
const CITY_RENDERER_MODULE = '../../../src/render/cityRenderer';

type P = [number, number];
type Seg = [P, P];

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
  trackSetback?: number[];
  trackSetbackRight?: number[];
}
interface VillageModule {
  VILLAGE_PALETTE: readonly number[];
  villageSeed(id: string): number;
  buildVillageEnv(p: VillageParams): CityEnv;
}
interface CityObjectLike {
  group: THREE.Group;
  buildings: number;
  dispose(): void;
}
type CreateCityObject = (
  env: CityEnv,
  terrainY: (x: number, z: number) => number,
  loadTexture?: (url: string) => THREE.Texture,
) => CityObjectLike;

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

function centroid(ring: P[]): P {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
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

function wallRing(w: Wall): P[] {
  const a = w.line[0];
  const b = w.line[w.line.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = (-(b[1] - a[1]) / len) * (w.thickness / 2);
  const nz = ((b[0] - a[0]) / len) * (w.thickness / 2);
  return [
    [a[0] + nx, a[1] + nz],
    [b[0] + nx, b[1] + nz],
    [b[0] - nx, b[1] - nz],
    [a[0] - nx, a[1] - nz],
  ];
}

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

describe('242 village buildings edge', () => {
  it('EDGE1: villageSeed is unsigned FNV-1a 32-bit over UTF-16 code units', async () => {
    const mod = await loadVillage();
    expect(mod.villageSeed('')).toBe(0x811c9dc5);
    expect(mod.villageSeed('a')).toBe(0xe40c292c);
    expect(mod.villageSeed('ermita-centro')).toBe(0xc4db8e6f);
    expect(mod.villageSeed('🚗')).toBe(0x6232b26d);
    for (const id of ['', 'a', 'ermita-centro', '🚗']) {
      const s = mod.villageSeed(id);
      expect(Number.isInteger(s), `integer for ${id}`).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
    expect(mod.villageSeed('a')).not.toBe(mod.villageSeed('b'));
  });

  it('EDGE2: explicit trackSetback and trackSetbackRight set the per-side front distance', async () => {
    const mod = await loadVillage();
    const base = fixture();
    const both = mod.buildVillageEnv({
      ...base,
      trackSetback: base.centerline.map(() => 20),
    });
    expect(both.buildings.length).toBeGreaterThan(0);
    let leftMin = Infinity;
    let rightMin = Infinity;
    for (const b of both.buildings) {
      for (const p of b.ring) {
        const d = segsDist(p, loopSegments(base.centerline, true));
        if (centroid(b.ring)[1] < 0) leftMin = Math.min(leftMin, d);
        else rightMin = Math.min(rightMin, d);
      }
    }
    expect(leftMin).toBeCloseTo(20, 5);
    expect(rightMin).toBeCloseTo(20, 5);

    const split = mod.buildVillageEnv({
      ...base,
      trackSetback: base.centerline.map(() => 20),
      trackSetbackRight: base.centerline.map(() => 35),
    });
    expect(split.buildings.length).toBeGreaterThan(0);
    leftMin = Infinity;
    rightMin = Infinity;
    for (const b of split.buildings) {
      for (const p of b.ring) {
        const d = segsDist(p, loopSegments(base.centerline, true));
        if (centroid(b.ring)[1] < 0) leftMin = Math.min(leftMin, d);
        else rightMin = Math.min(rightMin, d);
      }
    }
    expect(leftMin).toBeCloseTo(20, 5);
    expect(rightMin).toBeCloseTo(35, 5);
  });

  it('EDGE3: a street-street intersection is a junction with 8 m clearance', async () => {
    const mod = await loadVillage();
    const f = fixture({ streets: [[[200, -80], [200, 80]], [[50, 30], [350, 30]]] });
    const env = mod.buildVillageEnv(f);
    expect(env.buildings.length).toBeGreaterThan(0);
    for (const b of env.buildings) {
      for (const p of b.ring) {
        expect(Math.hypot(p[0] - 200, p[1] - 30), `vertex ${p[0]},${p[1]}`).toBeGreaterThanOrEqual(
          8 - 1e-9,
        );
      }
    }
    const nearest = Math.min(...env.buildings.map((b) => {
      const [cx, cz] = centroid(b.ring);
      return Math.hypot(cx - 200, cz - 30);
    }));
    expect(nearest, 'village populated near the junction').toBeLessThan(50);
  });

  it('EDGE4: a street endpoint within 3 m of the track is a junction with 8 m clearance', async () => {
    const mod = await loadVillage();
    const f = fixture({ streets: [[[150, 2], [150, 80]]] });
    const env = mod.buildVillageEnv(f);
    expect(env.buildings.length).toBeGreaterThan(0);
    for (const b of env.buildings) {
      for (const p of b.ring) {
        expect(Math.hypot(p[0] - 150, p[1] - 2), `vertex ${p[0]},${p[1]}`).toBeGreaterThanOrEqual(
          8 - 1e-9,
        );
      }
    }
    const nearest = Math.min(...env.buildings.map((b) => {
      const [cx, cz] = centroid(b.ring);
      return Math.hypot(cx - 150, cz - 2);
    }));
    expect(nearest, 'village populated near the endpoint junction').toBeLessThan(60);
  });

  it('EDGE5: a lot is discarded whole when any vertex leaves the mask', async () => {
    const mod = await loadVillage();
    const mask = [rect(-20, 420, -80, 15)];
    const env = mod.buildVillageEnv(fixture({ mask }));
    expect(env.buildings.length).toBeGreaterThanOrEqual(10);
    for (const b of env.buildings) {
      for (const p of b.ring) {
        expect(mask.some((poly) => pointInPoly(p, poly)), `vertex ${p[0]},${p[1]}`).toBe(true);
      }
    }
  });

  it('EDGE6: a closed track loop gets houses on all four outer sides', async () => {
    const mod = await loadVillage();
    const centerline: P[] = [[0, 0], [200, 0], [200, 100], [0, 100]];
    const env = mod.buildVillageEnv({
      centerline,
      halfWidthLeft: centerline.map(() => 5),
      halfWidthRight: centerline.map(() => 5),
      streets: [],
      mask: [rect(-60, 260, -60, 160)],
      exclusions: [],
      seed: 1,
    });
    const bands = {
      west: env.buildings.filter((b) => centroid(b.ring)[0] < 0).length,
      east: env.buildings.filter((b) => centroid(b.ring)[0] > 200).length,
      south: env.buildings.filter((b) => centroid(b.ring)[1] < 0).length,
      north: env.buildings.filter((b) => centroid(b.ring)[1] > 100).length,
    };
    expect(bands.west, 'west side houses').toBeGreaterThanOrEqual(1);
    expect(bands.east, 'east side houses').toBeGreaterThanOrEqual(1);
    expect(bands.south, 'south side houses').toBeGreaterThanOrEqual(1);
    expect(bands.north, 'north side houses').toBeGreaterThanOrEqual(1);
  });

  it('EDGE7: vacant-lot walls are discarded for exclusion overlap too', async () => {
    const mod = await loadVillage();
    const exclusion = rect(90, 130, 5, 40);
    const env = mod.buildVillageEnv(fixture({ exclusions: [exclusion] }));
    expect(env.walls.length, 'some vacant lots exist').toBeGreaterThanOrEqual(1);
    for (const w of env.walls) {
      expect(w.line.length, `wall ${w.line[0][0]},${w.line[0][1]}`).toBe(2);
      expect(
        satOverlap(wallRing(w), exclusion, 1e-6),
        `wall ${w.line[0][0]},${w.line[0][1]} vs exclusion`,
      ).toBe(false);
    }
  });

  it('EDGE8: building tank is true or absent, never false', async () => {
    const mod = await loadVillage();
    const env = mod.buildVillageEnv(fixture());
    expect(env.buildings.length).toBeGreaterThan(0);
    for (const b of env.buildings) {
      expect([undefined, true], `tank ${b.ring[0][0]},${b.ring[0][1]}`).toContain(b.tank);
    }
    expect(env.buildings.some((b) => b.tank === true), 'some tanked houses').toBe(true);
    expect(env.buildings.some((b) => b.tank === undefined), 'some tankless houses').toBe(true);
  });

  it('EDGE9: tank instances sit at the building centroid at base + height + 0.4 + 0.55', async () => {
    const { createCityObject } = await loadCityRenderer();
    const env: CityEnv = {
      buildings: [
        { ring: [[0, 0], [10, 0], [10, 10], [0, 10]], height: 3.2, material: 'plaster', color: 0xc8963e, tank: true },
      ],
      walls: [],
      water: [],
    };
    const city = createCityObject(env, () => 2, () => new THREE.Texture());
    const { instanced } = collectMeshes(city.group);
    expect(instanced, 'tank instanced mesh').toHaveLength(1);
    expect(instanced[0].count).toBe(1);
    const m = new THREE.Matrix4();
    instanced[0].getMatrixAt(0, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.x).toBeCloseTo(5, 6);
    expect(pos.y).toBeCloseTo(2 + 3.2 + 0.4 + 0.55, 6);
    expect(pos.z).toBeCloseTo(5, 6);
    city.dispose();
  });

  it('EDGE10: a plaster building without color renders with the default 0xE8D8B0', async () => {
    const { createCityObject } = await loadCityRenderer();
    const env: CityEnv = {
      buildings: [
        { ring: [[0, 0], [10, 0], [10, 10], [0, 10]], height: 3.2, material: 'plaster' },
      ],
      walls: [],
      water: [],
    };
    const city = createCityObject(env, () => 0, () => new THREE.Texture());
    const { meshes } = collectMeshes(city.group);
    expect(meshes, 'plaster mesh').toHaveLength(1);
    const material = meshes[0].material as THREE.MeshStandardMaterial;
    expect(material.vertexColors).toBe(true);
    const attr = meshes[0].geometry.getAttribute('color') as THREE.BufferAttribute;
    expect(attr).toBeDefined();
    const expected = new THREE.Color().setHex(0xe8d8b0);
    for (let i = 0; i < attr.count; i++) {
      expect(attr.getX(i), `r vertex ${i}`).toBeCloseTo(expected.r, 6);
      expect(attr.getY(i), `g vertex ${i}`).toBeCloseTo(expected.g, 6);
      expect(attr.getZ(i), `b vertex ${i}`).toBeCloseTo(expected.b, 6);
    }
    const geoSpies = [meshes[0].geometry].map((g) => vi.spyOn(g, 'dispose'));
    city.dispose();
    for (const s of geoSpies) expect(s).toHaveBeenCalled();
  });
});
