import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createTerrainMaterial, terrainTrackDistance } from '../../../src/render/terrainMaterial';
import { createTerrainMesh } from '../../../src/render/terrainRenderer';
import type { Terrain } from '../../../src/core/types';
import { circleTrack } from '../../fixtures/circleTrack';

// Flat 8 m grid spanning [-400, 400] in x and z around the circle fixture (R 100, N 120).
const SIZE = 800;
const CELL = 8;
const N = SIZE / CELL; // 100 cells -> 101 vertices per side
const VERTEX_COUNT = (N + 1) * (N + 1);

function flatTerrain(): Terrain {
  return {
    originX: 0,
    originZ: 0,
    sizeX: SIZE,
    sizeZ: SIZE,
    rows: N,
    cols: N,
    heights: new Array(VERTEX_COUNT).fill(0),
  };
}

// Vertex index in createTerrainMesh order (k = i * (cols+1) + j, i = row/z, j = col/x)
// nearest to a world (x, z) point.
function nearestVertexIndex(x: number, z: number): number {
  const j = Math.min(N, Math.max(0, Math.round((x + SIZE / 2) / CELL)));
  const i = Math.min(N, Math.max(0, Math.round((z + SIZE / 2) / CELL)));
  return i * (N + 1) + j;
}

function recordingLoader(): { urls: string[]; loadTexture: (url: string) => THREE.Texture } {
  const urls: string[] = [];
  const loadTexture = (url: string): THREE.Texture => {
    urls.push(url);
    const texture = new THREE.Texture();
    texture.name = url;
    return texture;
  };
  return { urls, loadTexture };
}

function fakeShader(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

describe('081 terrain material acceptance', () => {
  const terrain = flatTerrain();
  const dist = terrainTrackDistance(terrain, circleTrack.centerline);

  it('AT1: vertex nearest the circle centre reads 100 ± 6 and every circle point has a vertex within 6', () => {
    expect(dist.length).toBe(VERTEX_COUNT);
    const atCentre = dist[nearestVertexIndex(0, 0)];
    expect(Math.abs(atCentre - 100)).toBeLessThanOrEqual(6);
    for (const [cx, cz] of circleTrack.centerline) {
      expect(dist[nearestVertexIndex(cx, cz)], `circle point (${cx.toFixed(1)}, ${cz.toFixed(1)})`).toBeLessThanOrEqual(6);
    }
  });

  it('AT2: corner vertices more than 300 m from the centerline read exactly the 200 cap', () => {
    const corners: [number, number][] = [
      [-400, -400],
      [-400, 400],
      [400, -400],
      [400, 400],
    ];
    for (const [cx, cz] of corners) {
      const nearest = Math.min(...circleTrack.centerline.map(([px, pz]) => Math.hypot(cx - px, cz - pz)));
      expect(nearest, `corner (${cx}, ${cz}) precondition`).toBeGreaterThanOrEqual(300);
      expect(dist[nearestVertexIndex(cx, cz)], `corner (${cx}, ${cz})`).toBe(200);
    }
  });

  it('AT3: createTerrainMesh stores trackDist as an itemSize-1 attribute with the input values', () => {
    const vertexCount = (terrain.rows + 1) * (terrain.cols + 1);
    expect(vertexCount).toBe(VERTEX_COUNT);
    const trackDist = Float32Array.from({ length: vertexCount }, (_, k) => k * 0.25);
    const mesh = createTerrainMesh(terrain, new THREE.MeshStandardMaterial(), trackDist);
    const attr = mesh.geometry.getAttribute('trackDist') as THREE.BufferAttribute;
    expect(attr).toBeInstanceOf(THREE.BufferAttribute);
    expect(attr.itemSize).toBe(1);
    expect(attr.count).toBe(vertexCount);
    expect(Array.from(attr.array)).toEqual(Array.from(trackDist));
  });

  it('AT4: onBeforeCompile adds uGrassA, uGrassB, uGrassC, uDirt and uMacro and passes trackDist in the vertex shader', () => {
    const material = createTerrainMaterial(recordingLoader().loadTexture);
    const shader = fakeShader();
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    for (const name of ['uGrassA', 'uGrassB', 'uGrassC', 'uDirt', 'uMacro']) {
      expect(shader.uniforms[name], name).toBeDefined();
    }
    expect(shader.vertexShader).toContain('trackDist');
  });

  it('AT5: colour maps of grass-mown, grass, grass-dark and dirt plus macro-noise are loaded', () => {
    const { urls, loadTexture } = recordingLoader();
    createTerrainMaterial(loadTexture);
    for (const url of [
      'textures/grass-mown/color.jpg',
      'textures/grass/color.jpg',
      'textures/grass-dark/color.jpg',
      'textures/dirt/color.jpg',
      'textures/macro-noise.png',
    ]) {
      expect(urls, url).toContain(url);
    }
  });
});
