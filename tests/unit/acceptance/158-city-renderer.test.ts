import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

// Task 158 lands src/render/cityRenderer.ts; the variable specifier keeps typecheck
// green until the module exists (the 162 pattern).
const CITY_RENDERER_MODULE = '../../../src/render/cityRenderer';

type P = [number, number];

// Local copy of the CityEnv contract in tools/env/osmBuildings.ts (same reason as above).
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

interface BufferAttr {
  count: number;
  array: ArrayLike<number>;
  itemSize: number;
}
interface GeometryLike {
  attributes: { position: BufferAttr; uv: BufferAttr };
  index: BufferAttr | null;
}
interface CityObjectLike {
  group: { traverse(fn: (child: { isMesh?: boolean }) => void): void };
  buildings: number;
  update(timeSeconds: number): void;
  dispose(): void;
}
type ExtrudeBuilding = (ring: P[], height: number, baseY: number) => GeometryLike;
type CreateCityObject = (
  env: CityEnv,
  terrainY: (x: number, z: number) => number,
  loadTexture?: (url: string) => THREE.Texture,
) => CityObjectLike;

async function loadCityRenderer(): Promise<{
  extrudeBuilding: ExtrudeBuilding;
  createCityObject: CreateCityObject;
}> {
  return (await import(CITY_RENDERER_MODULE)) as {
    extrudeBuilding: ExtrudeBuilding;
    createCityObject: CreateCityObject;
  };
}

function triangleVertices(g: GeometryLike, t: number): { y: number; v: number }[] {
  const idx = g.index;
  const verts: { y: number; v: number }[] = [];
  for (let k = 0; k < 3; k++) {
    const vi = idx ? idx.array[t * 3 + k] : t * 3 + k;
    verts.push({
      y: g.attributes.position.array[vi * 3 + 1],
      v: g.attributes.uv.array[vi * 2 + 1],
    });
  }
  return verts;
}

describe('158 city renderer acceptance', () => {
  it('AT1: a 10x10 square ring extrudes to 8 wall + 2 roof triangles with wall v in 0..6.25', async () => {
    const { extrudeBuilding } = await loadCityRenderer();
    const ring: P[] = [[100, 1000], [110, 1000], [110, 1010], [100, 1010]];
    const height = 20;
    const baseY = 5;
    const geo = extrudeBuilding(ring, height, baseY);
    const triCount = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    let wallTriangles = 0;
    let roofTriangles = 0;
    let minWallV = Number.POSITIVE_INFINITY;
    let maxWallV = Number.NEGATIVE_INFINITY;
    for (let t = 0; t < triCount; t++) {
      const verts = triangleVertices(geo, t);
      // Wall triangles reach down to baseY; the flat roof sits at baseY + height only.
      if (verts.some((p) => p.y <= baseY + 1e-6)) {
        wallTriangles++;
        for (const { v } of verts) {
          minWallV = Math.min(minWallV, v);
          maxWallV = Math.max(maxWallV, v);
        }
      } else {
        roofTriangles++;
      }
    }
    expect(wallTriangles).toBe(8);
    expect(roofTriangles).toBe(2);
    expect(minWallV).toBeCloseTo(0, 6);
    expect(maxWallV).toBeCloseTo(6.25, 6);
  });

  it('AT2: 100 buildings across 2 cells and 2 materials merge into at most 4 meshes', async () => {
    const { createCityObject } = await loadCityRenderer();
    const buildings: Building[] = [];
    for (let i = 0; i < 100; i++) {
      const col = i % 5;
      const row = Math.floor((i % 50) / 5);
      // Cells: i < 50 centroids x in [20, 68] -> cell 0; i >= 50 x in [220, 268] -> cell 1;
      // all z in [20, 128] -> cell 0. Two cells x two materials = 4 (material, cell) groups.
      const cx = i < 50 ? 20 + col * 12 : 220 + col * 12;
      const cz = 20 + row * 12;
      buildings.push({
        ring: [
          [cx - 5, cz - 5],
          [cx + 5, cz - 5],
          [cx + 5, cz + 5],
          [cx - 5, cz + 5],
        ],
        height: 10,
        material: i % 2 === 0 ? 'glass' : 'brick',
      });
    }
    const env: CityEnv = { buildings, walls: [], water: [] };
    const city = createCityObject(env, () => 0, () => new THREE.Texture());
    let meshes = 0;
    city.group.traverse((child) => {
      if (child.isMesh) meshes++;
    });
    expect(meshes).toBeLessThanOrEqual(4);
  });
});
