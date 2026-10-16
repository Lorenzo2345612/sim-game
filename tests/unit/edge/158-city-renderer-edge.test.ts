import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

const CITY_RENDERER_MODULE = '../../../src/render/cityRenderer';

type P = [number, number];

interface Building {
  ring: P[];
  height: number;
  material: string;
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

interface CityObject {
  group: THREE.Group;
  buildings: number;
  update(timeSeconds: number): void;
  dispose(): void;
}
type ExtrudeBuilding = (ring: P[], height: number, baseY: number) => THREE.BufferGeometry;
type CreateCityObject = (
  env: CityEnv,
  terrainY: (x: number, z: number) => number,
  loadTexture?: (url: string) => THREE.Texture,
) => CityObject;

async function loadCityRenderer(): Promise<{
  extrudeBuilding: ExtrudeBuilding;
  createCityObject: CreateCityObject;
  CITY_CELL: number;
}> {
  return (await import(CITY_RENDERER_MODULE)) as {
    extrudeBuilding: ExtrudeBuilding;
    createCityObject: CreateCityObject;
    CITY_CELL: number;
  };
}

interface V {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}

function triangles(g: THREE.BufferGeometry): V[][] {
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const idx = g.index;
  const count = idx ? idx.count / 3 : pos.count / 3;
  const out: V[][] = [];
  for (let t = 0; t < count; t++) {
    const verts: V[] = [];
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      verts.push({
        x: pos.getX(vi),
        y: pos.getY(vi),
        z: pos.getZ(vi),
        u: uv.getX(vi),
        v: uv.getY(vi),
      });
    }
    out.push(verts);
  }
  return out;
}

function countMeshes(group: THREE.Group): number {
  let n = 0;
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) n++;
  });
  return n;
}

function firstMesh(group: THREE.Group): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  group.traverse((child) => {
    if (!found && (child as THREE.Mesh).isMesh) found = child as THREE.Mesh;
  });
  if (!found) throw new Error('no mesh in group');
  return found;
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

describe('158 city renderer edge cases', () => {
  it('EDGE1: extrudeBuilding accepts an open or closed ring with identical triangles', async () => {
    const { extrudeBuilding } = await loadCityRenderer();
    const open: P[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const closed: P[] = [...open, open[0]];
    const cases: [string, P[]][] = [
      ['open', open],
      ['closed', closed],
    ];
    for (const [label, ring] of cases) {
      const tris = triangles(extrudeBuilding(ring, 12, 0));
      const walls = tris.filter((t) => t.some((p) => p.y <= 1e-6)).length;
      expect(walls, `${label} wall triangles`).toBe(8);
      expect(tris.length - walls, `${label} roof triangles`).toBe(2);
    }
  });

  it('EDGE2: degenerate rings with fewer than 3 distinct points are skipped and not counted', async () => {
    const { createCityObject } = await loadCityRenderer();
    const env: CityEnv = {
      buildings: [
        {
          ring: [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          height: 10,
          material: 'brick',
        },
        {
          ring: [
            [30, 0],
            [40, 0],
            [40, 10],
            [30, 10],
          ],
          height: 10,
          material: 'brick',
        },
        { ring: [[100000, 100000], [100010, 100010]], height: 10, material: 'stone' },
        {
          ring: [
            [100000, 100020],
            [100000, 100020],
            [100000, 100020],
          ],
          height: 10,
          material: 'stone',
        },
      ],
      walls: [],
      water: [],
    };
    const city = createCityObject(env, () => 0, () => new THREE.Texture());
    expect(city.buildings).toBe(2);
    expect(countMeshes(city.group)).toBe(1);
  });

  it('EDGE3: baseY is the minimum terrainY over the ring vertices', async () => {
    const { createCityObject } = await loadCityRenderer();
    const env: CityEnv = {
      buildings: [
        {
          ring: [
            [100, 1000],
            [110, 1000],
            [110, 1010],
            [100, 1010],
          ],
          height: 15,
          material: 'brick',
        },
      ],
      walls: [],
      water: [],
    };
    const city = createCityObject(env, (x) => (x === 100 ? 4 : 9), () => new THREE.Texture());
    const box = new THREE.Box3().setFromObject(city.group);
    expect(box.min.y, 'wall bottom at min terrain').toBeCloseTo(4, 5);
    expect(box.max.y, 'roof at min terrain + height').toBeCloseTo(19, 5);
  });

  it('EDGE4: wall u is cumulative perimeter / 4 and roof UV is XZ / 4', async () => {
    const { extrudeBuilding } = await loadCityRenderer();
    const ring: P[] = [
      [100, 1000],
      [110, 1000],
      [110, 1010],
      [100, 1010],
    ];
    const tris = triangles(extrudeBuilding(ring, 10, 0));
    const wallU = new Set<number>();
    for (const t of tris) {
      if (t.some((p) => p.y <= 1e-6)) {
        for (const p of t) wallU.add(Math.round(p.u * 1e6) / 1e6);
      }
    }
    expect([...wallU].sort((a, b) => a - b)).toEqual([0, 2.5, 5, 7.5]);
    let roofVerts = 0;
    for (const t of tris) {
      if (t.every((p) => p.y > 1e-6)) {
        for (const p of t) {
          roofVerts++;
          expect(p.u).toBeCloseTo(p.x / 4, 4);
          expect(p.v).toBeCloseTo(p.z / 4, 4);
        }
      }
    }
    expect(roofVerts, 'roof vertices checked').toBe(6);
  });

  it('EDGE5: walls and roof face outward for either ring order', async () => {
    const { extrudeBuilding } = await loadCityRenderer();
    const forward: P[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const reversed: P[] = [...forward].reverse();
    const cases: [string, P[]][] = [
      ['forward', forward],
      ['reversed', reversed],
    ];
    for (const [label, ring] of cases) {
      const tris = triangles(extrudeBuilding(ring, 10, 0));
      expect(tris.length, `${label} triangle count`).toBe(10);
      let roofs = 0;
      let walls = 0;
      for (const t of tris) {
        const n = cross(
          { x: t[1].x - t[0].x, y: t[1].y - t[0].y, z: t[1].z - t[0].z },
          { x: t[2].x - t[0].x, y: t[2].y - t[0].y, z: t[2].z - t[0].z },
        );
        if (t.every((p) => p.y > 5)) {
          roofs++;
          expect(n.y, `${label} roof normal points up`).toBeGreaterThan(0);
        } else {
          walls++;
          const mx = (t[0].x + t[1].x + t[2].x) / 3;
          const mz = (t[0].z + t[1].z + t[2].z) / 3;
          const outward = n.x * (mx - 5) + n.z * (mz - 5);
          expect(outward, `${label} wall at (${mx}, ${mz}) faces outward`).toBeGreaterThan(0);
        }
      }
      expect(walls, `${label} wall triangles`).toBe(8);
      expect(roofs, `${label} roof triangles`).toBe(2);
    }
  });

  it('EDGE6: createCityObject does not mutate the env input', async () => {
    const { createCityObject } = await loadCityRenderer();
    const env: CityEnv = {
      buildings: [
        {
          ring: [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          height: 10,
          material: 'glass',
        },
      ],
      walls: [{ line: [[0, 20], [30, 20]], height: 8, thickness: 2.5 }],
      water: [
        [
          [0, 40],
          [30, 40],
          [30, 70],
          [0, 70],
        ],
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(env)) as CityEnv;
    const city = createCityObject(env, () => 0, () => new THREE.Texture());
    expect(env).toEqual(snapshot);
    city.dispose();
  });

  it('EDGE7: cell index floors negative coordinates and CITY_CELL is 200 m', async () => {
    const { createCityObject, CITY_CELL } = await loadCityRenderer();
    expect(CITY_CELL).toBe(200);
    const squareAt = (cx: number): Building => ({
      ring: [
        [cx - 5, 5],
        [cx + 5, 5],
        [cx + 5, 15],
        [cx - 5, 15],
      ],
      height: 10,
      material: 'brick',
    });
    const pair = (a: number, b: number): CityObject =>
      createCityObject(
        { buildings: [squareAt(a), squareAt(b)], walls: [], water: [] },
        () => 0,
        () => new THREE.Texture(),
      );
    expect(countMeshes(pair(-10, 10).group), 'cells -1 and 0 stay separate').toBe(2);
    expect(countMeshes(pair(-50, -150).group), 'cells -1 and -1 merge').toBe(1);
  });

  it('EDGE8: a wall line extrudes to a box strip of thickness by height spanning the line', async () => {
    const { createCityObject } = await loadCityRenderer();
    const env: CityEnv = {
      buildings: [],
      walls: [{ line: [[0, 0], [50, 0]], height: 8, thickness: 2.5 }],
      water: [],
    };
    const city = createCityObject(env, () => 3, () => new THREE.Texture());
    expect(countMeshes(city.group)).toBe(1);
    const box = new THREE.Box3().setFromObject(city.group);
    const size = box.getSize(new THREE.Vector3());
    expect(size.y, 'height').toBeCloseTo(8, 5);
    expect(size.z, 'thickness across the line').toBeCloseTo(2.5, 5);
    expect(box.min.x, 'strip starts at line start').toBeLessThanOrEqual(1e-3);
    expect(box.max.x, 'strip reaches line end').toBeGreaterThanOrEqual(50 - 1e-3);
  });

  it('EDGE9: water sits at min terrain - 0.3 and update scrolls the normal offset by t x 0.02', async () => {
    const { createCityObject } = await loadCityRenderer();
    const env: CityEnv = {
      buildings: [],
      walls: [],
      water: [
        [
          [0, 0],
          [40, 0],
          [40, 40],
          [0, 40],
        ],
      ],
    };
    const city = createCityObject(env, (_x, z) => 5 + z, () => new THREE.Texture());
    expect(countMeshes(city.group)).toBe(1);
    const box = new THREE.Box3().setFromObject(city.group);
    expect(box.min.y, 'water y').toBeCloseTo(4.7, 5);
    expect(box.max.y, 'water y').toBeCloseTo(4.7, 5);
    const mat = firstMesh(city.group).material as THREE.MeshStandardMaterial;
    const nm = mat.normalMap;
    if (!nm) throw new Error('water material has no normal map');
    const offsetMag = (): number => Math.max(Math.abs(nm.offset.x), Math.abs(nm.offset.y));
    city.update(5);
    expect(offsetMag(), 'offset at t=5').toBeCloseTo(0.1, 9);
    city.update(10);
    expect(offsetMag(), 'offset at t=10').toBeCloseTo(0.2, 9);
  });

  it('EDGE10: an empty env yields an empty group with a safe lifecycle', async () => {
    const { createCityObject } = await loadCityRenderer();
    const city = createCityObject({ buildings: [], walls: [], water: [] }, () => 0);
    expect(city.buildings).toBe(0);
    expect(countMeshes(city.group)).toBe(0);
    expect(() => city.update(1)).not.toThrow();
    expect(() => city.dispose()).not.toThrow();
    expect(() => city.dispose()).not.toThrow();
  });
});
