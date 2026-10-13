import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createTerrainMaterial, terrainTrackDistance } from '../../../src/render/terrainMaterial';
import { createTerrainMesh } from '../../../src/render/terrainRenderer';
import type { Terrain } from '../../../src/core/types';

// Vertex world positions follow createTerrainMesh: x = originX - sizeX/2 + j*sizeX/cols,
// z = originZ - sizeZ/2 + i*sizeZ/rows, index k = i * (cols+1) + j (i = row/z, j = col/x).
function gridTerrain(rows: number, cols: number, sizeX: number, sizeZ: number, originX = 0, originZ = 0, heights?: number[]): Terrain {
  return { originX, originZ, sizeX, sizeZ, rows, cols, heights: heights ?? new Array((rows + 1) * (cols + 1)).fill(0) };
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function recordingLoader(): { urls: string[]; byName: Map<string, THREE.Texture>; loadTexture: (url: string) => THREE.Texture } {
  const urls: string[] = [];
  const byName = new Map<string, THREE.Texture>();
  const loadTexture = (url: string): THREE.Texture => {
    urls.push(url);
    const texture = new THREE.Texture();
    texture.name = url;
    byName.set(url, texture);
    return texture;
  };
  return { urls, byName, loadTexture };
}

function fakeShader(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

const SET_DIRS = ['grass-mown', 'grass', 'grass-dark', 'dirt'];

describe('081 terrain material edge cases', () => {
  it('EDGE1: distances are the exact euclidean minimum to the nearest centerline point in world coordinates', () => {
    // 4x4 grid, 10 m cells, origin (10, -5): x_j = -10 + 10j, z_i = -25 + 10i.
    const t = gridTerrain(4, 4, 40, 40, 10, -5);
    const dist = terrainTrackDistance(t, [[10, -5], [30, 15]]);
    expect(dist).toBeInstanceOf(Float32Array);
    expect(dist.length).toBe(25);
    expect(dist[12]).toBeCloseTo(0, 6); // vertex (10, -5) coincides with point 1
    expect(dist[24]).toBeCloseTo(0, 6); // vertex (30, 15) coincides with point 2
    expect(dist[10]).toBeCloseTo(20, 6); // (-10, -5): 20 to point 1, hypot(40, 20) to point 2
    expect(dist[0]).toBeCloseTo(Math.sqrt(800), 5); // (-10, -25): nearest is point 1 at hypot(20, 20)
    expect(dist[4]).toBeCloseTo(Math.sqrt(800), 5); // (30, -25): nearest is point 1 at hypot(20, 20)
  });

  it('EDGE2: every vertex of an asymmetric grid (rows != cols, non-zero origin) equals min(cap, brute-force nearest distance)', () => {
    const rnd = lcg(20261013);
    const centerline: [number, number][] = [];
    for (let p = 0; p < 48; p++) centerline.push([-260 + 100 * rnd(), -260 + 100 * rnd()]);
    const rows = 7;
    const cols = 11;
    const t = gridTerrain(rows, cols, 176, 112, -30, 45);
    const dist = terrainTrackDistance(t, centerline);
    expect(dist.length).toBe((rows + 1) * (cols + 1));
    const expected: number[] = [];
    for (let i = 0; i <= rows; i++) {
      const z = t.originZ - t.sizeZ / 2 + (i * t.sizeZ) / rows;
      for (let j = 0; j <= cols; j++) {
        const x = t.originX - t.sizeX / 2 + (j * t.sizeX) / cols;
        let best = Infinity;
        for (const [px, pz] of centerline) best = Math.min(best, Math.hypot(x - px, z - pz));
        expected.push(Math.min(200, best));
      }
    }
    let capped = 0;
    for (let k = 0; k < expected.length; k++) {
      expect(dist[k], `vertex ${k}`).toBeCloseTo(expected[k], 4);
      if (expected[k] === 200) capped++;
    }
    expect(capped).toBeGreaterThan(0); // scatter reaches beyond the default cap
  });

  it('EDGE3: an explicit cap clamps to that value while distances below it stay exact', () => {
    // 4x4 grid, 20 m cells centred on the single centerline point (0, 0).
    const t = gridTerrain(4, 4, 80, 80);
    const clamped = terrainTrackDistance(t, [[0, 0]], 30);
    expect(clamped[13]).toBeCloseTo(20, 6); // (20, 0) below cap
    expect(clamped[18]).toBeCloseTo(Math.sqrt(800), 5); // (20, 20) = 28.28 below cap
    expect(clamped[14]).toBe(30); // (40, 0) = 40 above cap
    expect(clamped[24]).toBe(30); // (40, 40) above cap
    for (const v of clamped) expect(v).toBeLessThanOrEqual(30);
    expect(terrainTrackDistance(t, [[0, 0]])[14]).toBeCloseTo(40, 6); // default cap 200 does not clamp here
  });

  it('EDGE4: an empty centerline gives every vertex the default cap 200', () => {
    const dist = terrainTrackDistance(gridTerrain(2, 3, 12, 8), []);
    expect(dist.length).toBe(12);
    for (const v of dist) expect(v).toBe(200);
  });

  it('EDGE5: heights do not influence the result (horizontal x,z distance only)', () => {
    const rows = 3;
    const cols = 3;
    const rough = new Array((rows + 1) * (cols + 1)).fill(0);
    for (let j = 0; j <= cols; j++) {
      for (let i = 0; i <= rows; i++) rough[j * (rows + 1) + i] = ((3 * i + 5 * j) % 9) - 4;
    }
    const centerline: [number, number][] = [[-4.5, 2.5], [10, 10], [-20, -1]];
    const flat = terrainTrackDistance(gridTerrain(rows, cols, 27, 21, -9, 6), centerline);
    const elevated = terrainTrackDistance(gridTerrain(rows, cols, 27, 21, -9, 6, rough), centerline);
    expect(flat[6]).toBeCloseTo(0, 6); // vertex (-4.5, 2.5) coincides with a centerline point
    expect(Array.from(elevated)).toEqual(Array.from(flat));
  });

  it('EDGE6: terrain and centerline inputs are not mutated', () => {
    const heights = Array.from({ length: 20 }, (_, n) => n * 0.5 - 3);
    const t = gridTerrain(3, 4, 24, 18, 6, -4, [...heights]);
    const centerline: [number, number][] = [[3, -2], [10, 5], [-8, -7], [100, -100]];
    const centerlineCopy = centerline.map((p) => [...p]);
    terrainTrackDistance(t, centerline);
    expect(t.heights).toEqual(heights);
    expect(centerline).toEqual(centerlineCopy);
    expect([t.originX, t.originZ, t.sizeX, t.sizeZ, t.rows, t.cols]).toEqual([6, -4, 24, 18, 3, 4]);
  });

  it('EDGE7: createTerrainMesh throws when trackDist length differs from the vertex count', () => {
    const t = gridTerrain(3, 5, 30, 20);
    // trackDist is the third parameter added by this task; typed loosely so the test compiles before the change
    const createWithDist = createTerrainMesh as unknown as (...args: unknown[]) => unknown;
    expect(() => createWithDist(t, undefined, new Float32Array(23))).toThrow('createTerrainMesh: invalid trackDist');
    expect(() => createWithDist(t, undefined, new Float32Array(25))).toThrow('createTerrainMesh: invalid trackDist');
  });

  it('EDGE8: createTerrainMesh without trackDist adds no trackDist attribute', () => {
    const mesh = createTerrainMesh(gridTerrain(3, 5, 30, 20));
    expect(mesh.geometry.getAttribute('trackDist')).toBeUndefined();
    expect(mesh.geometry.getAttribute('position').count).toBe(24);
    mesh.geometry.dispose();
  });

  it('EDGE9: normal and roughness maps load for all four sets and every texture is wrapped, sRGB for colours only, repeat 2 (5 m tiles)', () => {
    const { urls, byName, loadTexture } = recordingLoader();
    createTerrainMaterial(loadTexture);
    for (const dir of SET_DIRS) {
      expect(urls, `${dir} normal`).toContain(`textures/${dir}/normal.jpg`);
      expect(urls, `${dir} roughness`).toContain(`textures/${dir}/roughness.jpg`);
    }
    const setUrls = SET_DIRS.flatMap((dir) => ['color', 'normal', 'roughness'].map((kind) => `textures/${dir}/${kind}.jpg`));
    for (const url of [...setUrls, 'textures/macro-noise.png']) {
      const texture = byName.get(url)!;
      expect(texture, url).toBeDefined();
      expect(texture.wrapS, `${url} wrapS`).toBe(THREE.RepeatWrapping);
      expect(texture.wrapT, `${url} wrapT`).toBe(THREE.RepeatWrapping);
    }
    for (const dir of SET_DIRS) {
      expect(byName.get(`textures/${dir}/color.jpg`)!.colorSpace, `${dir} colour sRGB`).toBe(THREE.SRGBColorSpace);
      for (const kind of ['normal', 'roughness']) {
        expect(byName.get(`textures/${dir}/${kind}.jpg`)!.colorSpace, `${dir} ${kind} not sRGB`).not.toBe(THREE.SRGBColorSpace);
      }
    }
    expect(byName.get('textures/macro-noise.png')!.colorSpace).not.toBe(THREE.SRGBColorSpace);
    for (const url of setUrls) {
      const texture = byName.get(url)!;
      expect(texture.repeat.x, `${url} repeat.x`).toBe(2);
      expect(texture.repeat.y, `${url} repeat.y`).toBe(2);
    }
  });

  it('EDGE10: onBeforeCompile composes the 080 anti-tiling (uSaturation/uTint/uMacro, vSurfaceWorldXz in both stages) and passes trackDist to the fragment shader', () => {
    const material = createTerrainMaterial(recordingLoader().loadTexture);
    const shader = fakeShader();
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uSaturation).toBeDefined();
    expect(shader.uniforms.uTint).toBeDefined();
    expect((shader.uniforms.uMacro as THREE.IUniform).value.name).toBe('textures/macro-noise.png');
    expect(shader.vertexShader).toContain('vSurfaceWorldXz');
    expect(shader.fragmentShader).toContain('vSurfaceWorldXz');
    expect(shader.fragmentShader).toContain('trackDist');
  });
});
