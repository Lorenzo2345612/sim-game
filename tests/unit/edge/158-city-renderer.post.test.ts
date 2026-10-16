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
}> {
  return (await import(CITY_RENDERER_MODULE)) as {
    extrudeBuilding: ExtrudeBuilding;
    createCityObject: CreateCityObject;
  };
}

function square(cx: number, cz: number, material: string, height = 10): Building {
  return {
    ring: [
      [cx - 5, cz - 5],
      [cx + 5, cz - 5],
      [cx + 5, cz + 5],
      [cx - 5, cz + 5],
    ],
    height,
    material,
  };
}

function meshesOf(group: THREE.Group): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) out.push(child as THREE.Mesh);
  });
  return out;
}

function stubLoader(): {
  loadTexture: (url: string) => THREE.Texture;
  urls: string[];
  byName: Map<string, THREE.Texture>;
} {
  const urls: string[] = [];
  const byName = new Map<string, THREE.Texture>();
  const loadTexture = (url: string): THREE.Texture => {
    urls.push(url);
    const t = new THREE.Texture();
    t.name = url;
    byName.set(url, t);
    return t;
  };
  return { loadTexture, urls, byName };
}

function splitTriangles(g: THREE.BufferGeometry, baseY: number): { walls: number; roof: number } {
  const pos = g.getAttribute('position');
  const idx = g.index;
  const count = idx ? idx.count / 3 : pos.count / 3;
  let walls = 0;
  let roof = 0;
  for (let t = 0; t < count; t++) {
    let down = false;
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      if (pos.getY(vi) <= baseY + 1e-6) down = true;
    }
    if (down) walls++;
    else roof++;
  }
  return { walls, roof };
}

const TEX_DIRS = [
  'textures/facade/glass-a',
  'textures/facade/glass-b',
  'textures/facade/glass-c',
  'textures/facade/brick',
  'textures/stone/old-wall',
];

describe('158 city renderer post-gap', () => {
  it('POST1: facade and stone textures load through loadTexture as sRGB color maps with repeat wrapping', async () => {
    const { createCityObject } = await loadCityRenderer();
    const { loadTexture, urls, byName } = stubLoader();
    createCityObject({ buildings: [], walls: [], water: [] }, () => 0, loadTexture);
    const expected = TEX_DIRS.flatMap((d) =>
      ['color.jpg', 'normal.jpg', 'roughness.jpg'].map((f) => `${d}/${f}`),
    ).sort();
    expect([...urls].sort()).toEqual(expected);
    for (const url of urls) {
      const t = byName.get(url)!;
      expect(t.wrapS, `${url} wrapS`).toBe(THREE.RepeatWrapping);
      expect(t.wrapT, `${url} wrapT`).toBe(THREE.RepeatWrapping);
      expect(t.colorSpace === THREE.SRGBColorSpace, `${url} colorSpace`).toBe(
        url.endsWith('/color.jpg'),
      );
    }
  });

  it('POST2: concrete reuses the glass-c texture set tinted 0x9a9a9a', async () => {
    const { createCityObject } = await loadCityRenderer();
    const { loadTexture, byName } = stubLoader();
    const city = createCityObject(
      { buildings: [square(10, 10, 'concrete')], walls: [], water: [] },
      () => 0,
      loadTexture,
    );
    const meshes = meshesOf(city.group);
    expect(meshes).toHaveLength(1);
    const mat = meshes[0].material as THREE.MeshStandardMaterial;
    expect(mat.color.getHex()).toBe(0x9a9a9a);
    expect(mat.map).toBe(byName.get('textures/facade/glass-c/color.jpg'));
    expect(mat.normalMap).toBe(byName.get('textures/facade/glass-c/normal.jpg'));
    expect(mat.roughnessMap).toBe(byName.get('textures/facade/glass-c/roughness.jpg'));
  });

  it('POST3: one material instance is shared across cells with frustum culling on', async () => {
    const { createCityObject } = await loadCityRenderer();
    const city = createCityObject(
      { buildings: [square(10, 10, 'brick'), square(250, 10, 'brick')], walls: [], water: [] },
      () => 0,
      () => new THREE.Texture(),
    );
    expect(city.buildings).toBe(2);
    const meshes = meshesOf(city.group);
    expect(meshes).toHaveLength(2);
    expect(meshes[0].material).toBe(meshes[1].material);
    expect(meshes.every((m) => m.frustumCulled)).toBe(true);
  });

  it('POST4: the glass variant pick is deterministic per cell', async () => {
    const { createCityObject } = await loadCityRenderer();
    const env: CityEnv = {
      buildings: [square(10, 10, 'glass'), square(40, 10, 'glass')],
      walls: [],
      water: [],
    };
    const pick = (): string => {
      const { loadTexture } = stubLoader();
      const city = createCityObject(env, () => 0, loadTexture);
      expect(city.buildings).toBe(2);
      expect(meshesOf(city.group)).toHaveLength(1);
      const mat = meshesOf(city.group)[0].material as THREE.MeshStandardMaterial;
      return mat.map?.name ?? '';
    };
    const first = pick();
    expect(first).toMatch(/^textures\/facade\/glass-[abc]\/color\.jpg$/);
    expect(pick()).toBe(first);
  });

  it('POST5: dispose releases geometries, materials and textures exactly once', async () => {
    const { createCityObject } = await loadCityRenderer();
    const { loadTexture, byName } = stubLoader();
    const city = createCityObject(
      {
        buildings: [square(10, 10, 'brick')],
        walls: [{ line: [[0, 20], [30, 20]], height: 6, thickness: 2 }],
        water: [
          [
            [0, 40],
            [30, 40],
            [30, 70],
            [0, 70],
          ],
        ],
      },
      () => 0,
      loadTexture,
    );
    const counts = new Map<object, number>();
    const watch = (o: object): void => {
      counts.set(o, 0);
      const d = o as { addEventListener(type: 'dispose', fn: () => void): void };
      d.addEventListener('dispose', () => counts.set(o, (counts.get(o) ?? 0) + 1));
    };
    const meshes = meshesOf(city.group);
    expect(meshes).toHaveLength(3);
    for (const m of meshes) watch(m.geometry);
    for (const m of new Set(meshes.map((x) => x.material))) watch(m);
    for (const t of byName.values()) watch(t);
    city.dispose();
    city.dispose();
    for (const [o, n] of counts) expect(n, `dispose count for ${o.constructor.name}`).toBe(1);
  });

  it('POST6: wall segments bucket per cell, so a line across cells splits into one mesh per cell', async () => {
    const { createCityObject } = await loadCityRenderer();
    const city = createCityObject(
      {
        buildings: [],
        walls: [
          {
            line: [
              [-300, 0],
              [-100, 0],
              [100, 0],
              [300, 0],
            ],
            height: 5,
            thickness: 2,
          },
        ],
        water: [],
      },
      () => 0,
      () => new THREE.Texture(),
    );
    expect(meshesOf(city.group)).toHaveLength(3);
    const box = new THREE.Box3().setFromObject(city.group);
    expect(box.min.x).toBeCloseTo(-300, 3);
    expect(box.max.x).toBeCloseTo(300, 3);
    expect(box.getSize(new THREE.Vector3()).z).toBeCloseTo(2, 5);
    expect(box.getSize(new THREE.Vector3()).y).toBeCloseTo(5, 5);
  });

  it('POST7: degenerate wall lines and water polygons produce no geometry', async () => {
    const { createCityObject } = await loadCityRenderer();
    const city = createCityObject(
      {
        buildings: [],
        walls: [{ line: [[5, 5], [5, 5], [5, 5]], height: 4, thickness: 1 }],
        water: [[[0, 0], [10, 0]]],
      },
      () => 0,
      () => new THREE.Texture(),
    );
    expect(city.buildings).toBe(0);
    expect(city.group.children).toHaveLength(0);
    expect(meshesOf(city.group)).toHaveLength(0);
  });

  it('POST8: non-finite terrain samples fall back to height 0', async () => {
    const { createCityObject } = await loadCityRenderer();
    const city = createCityObject(
      {
        buildings: [square(0, 0, 'brick', 12)],
        walls: [],
        water: [
          [
            [-5, -5],
            [5, -5],
            [5, 5],
            [-5, 5],
          ],
        ],
      },
      () => Number.NaN,
      () => new THREE.Texture(),
    );
    const box = new THREE.Box3().setFromObject(city.group);
    expect(box.min.y, 'water at 0 - 0.3').toBeCloseTo(-0.3, 5);
    expect(box.max.y, 'roof at 0 + 12').toBeCloseTo(12, 5);
  });

  it('POST9: zero and negative heights emit finite geometry', async () => {
    const { extrudeBuilding } = await loadCityRenderer();
    const ring: P[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const flat = extrudeBuilding(ring, 0, 5);
    const flatPos = flat.getAttribute('position');
    expect(flatPos.count).toBe(30);
    for (let i = 0; i < flatPos.count; i++) {
      expect(Number.isFinite(flatPos.getY(i))).toBe(true);
      expect(flatPos.getY(i)).toBeCloseTo(5, 6);
    }
    const neg = extrudeBuilding(ring, -4, 5);
    const negPos = neg.getAttribute('position');
    expect(negPos.count).toBe(30);
    for (let i = 0; i < negPos.count; i++) {
      expect(Number.isFinite(negPos.getY(i))).toBe(true);
      expect(negPos.getY(i)).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(negPos.getY(i)).toBeLessThanOrEqual(5 + 1e-6);
    }
  });

  it('POST10: update accepts zero, negative and huge time values', async () => {
    const { createCityObject } = await loadCityRenderer();
    const city = createCityObject(
      {
        buildings: [],
        walls: [],
        water: [
          [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
          ],
        ],
      },
      () => 0,
      () => new THREE.Texture(),
    );
    const mesh = meshesOf(city.group)[0];
    const nm = (mesh.material as THREE.MeshStandardMaterial).normalMap!;
    const offset = (): [number, number] => [nm.offset.x, nm.offset.y];
    city.update(0);
    expect(offset()).toEqual([0, 0]);
    city.update(-3);
    expect(offset()[0]).toBeCloseTo(-0.06, 9);
    expect(offset()[1]).toBeCloseTo(-0.06, 9);
    city.update(1e6);
    expect(offset()[0]).toBeCloseTo(20000, 6);
    expect(offset().every(Number.isFinite)).toBe(true);
  });

  it('POST11: a concave ring triangulates the roof into n-2 triangles', async () => {
    const { extrudeBuilding } = await loadCityRenderer();
    const lRing: P[] = [
      [0, 0],
      [30, 0],
      [30, 10],
      [10, 10],
      [10, 30],
      [0, 30],
    ];
    expect(splitTriangles(extrudeBuilding(lRing, 8, 0), 0)).toEqual({ walls: 12, roof: 4 });
  });

  it('POST12: each water polygon sits at its own terrain minimum minus 0.3', async () => {
    const { createCityObject } = await loadCityRenderer();
    const city = createCityObject(
      {
        buildings: [],
        walls: [],
        water: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          [
            [100, 100],
            [110, 100],
            [110, 110],
            [100, 110],
          ],
        ],
      },
      (x) => (x >= 100 ? 7 : 0),
      () => new THREE.Texture(),
    );
    const box = new THREE.Box3().setFromObject(city.group);
    expect(box.min.y).toBeCloseTo(-0.3, 5);
    expect(box.max.y).toBeCloseTo(6.7, 5);
    expect(box.min.x).toBeCloseTo(0, 5);
    expect(box.max.x).toBeCloseTo(110, 5);
  });
});
