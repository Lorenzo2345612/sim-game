import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createTerrainMaterial, terrainTrackDistance } from '../../../src/render/terrainMaterial';
import type { Terrain } from '../../../src/core/types';

function gridTerrain(rows: number, cols: number, sizeX: number, sizeZ: number, originX = 0, originZ = 0): Terrain {
  return { originX, originZ, sizeX, sizeZ, rows, cols, heights: new Array((rows + 1) * (cols + 1)).fill(0) };
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function recordingLoader(): { byName: Map<string, THREE.Texture>; loadTexture: (url: string) => THREE.Texture } {
  const byName = new Map<string, THREE.Texture>();
  return {
    byName,
    loadTexture: (url: string) => {
      const texture = new THREE.Texture();
      texture.name = url;
      byName.set(url, texture);
      return texture;
    },
  };
}

function compileStandardShader(): { material: THREE.MeshStandardMaterial; shader: THREE.WebGLProgramParametersWithUniforms } {
  const material = createTerrainMaterial(recordingLoader().loadTexture);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return { material, shader };
}

describe('081 terrain material post-code gaps', () => {
  it('POST1: fragment shader consumes every patched include and contains the full splat pipeline', () => {
    const { shader } = compileStandardShader();
    const f = shader.fragmentShader;
    for (const inc of ['#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <normal_fragment_maps>']) {
      expect(f, `leftover ${inc}`).not.toContain(inc);
    }
    for (const decl of ['uniform sampler2D uGrassB;', 'uniform sampler2D uGrassC;', 'uniform sampler2D uDirt;', 'uniform sampler2D uDirtNormal;', 'uniform sampler2D uDirtRoughness;']) {
      expect(f, decl).toContain(decl);
    }
    expect(f).toContain('terrainAntiTiled');
    expect(f).toContain('texture2D( uMacro, vSurfaceWorldXz / 220.0 ).r');
    expect(f).toContain('trackDist < 60.0');
    expect(f).toContain('mod( floor( vSurfaceWorldXz.x / 12.0 ), 2.0 ) < 0.5 ? 1.06 : 0.94');
    expect(f).toContain('smoothstep( 0.35, 0.45, vTerrainSlope )');
    expect(f).toContain('mix( mapN, terrainDirtN, terrainDirtW )');
    expect(f).toContain('mix( terrainRoughA, terrainRoughDirt, terrainDirtW )');
    expect(f).toContain('perturbNormalArb');
    expect(f.indexOf('float terrainDirtW')).toBeLessThan(f.indexOf('terrainDirtW > 0.0'));
  });

  it('POST2: vertex shader declares the attribute and computes the varyings the fragment stage reads', () => {
    const { shader } = compileStandardShader();
    const v = shader.vertexShader;
    expect(v).toContain('attribute float trackDist;');
    expect(v).toContain('varying float vTrackDist;');
    expect(v).toContain('varying float vTerrainSlope;');
    expect(v).toContain('vTrackDist = trackDist;');
    expect(v).toContain('vTerrainSlope = acos( clamp( terrainWorldNormal.y, -1.0, 1.0 ) );');
    expect(v).toContain('vSurfaceWorldXz = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
  });

  it('POST3: material maps the grass-mown set, keeps a stable cache key and owns its 13 textures', () => {
    const { byName, loadTexture } = recordingLoader();
    const material = createTerrainMaterial(loadTexture);
    expect(material.map!.name).toBe('textures/grass-mown/color.jpg');
    expect(material.normalMap!.name).toBe('textures/grass-mown/normal.jpg');
    expect(material.roughnessMap!.name).toBe('textures/grass-mown/roughness.jpg');
    expect(material.customProgramCacheKey()).toBe('terrain-splat');
    const owned = material.userData.textures as THREE.Texture[];
    expect(owned).toHaveLength(13);
    for (const dir of ['grass-mown', 'grass', 'grass-dark', 'dirt']) {
      for (const kind of ['color', 'normal', 'roughness']) {
        expect(owned, `${dir}/${kind}`).toContain(byName.get(`textures/${dir}/${kind}.jpg`));
      }
    }
    expect(owned).toContain(byName.get('textures/macro-noise.png'));
  });

  it('POST4: explicit non-default caps match brute force, clamping above and exact below', () => {
    const rnd = lcg(81081);
    const centerline: [number, number][] = [];
    for (let p = 0; p < 24; p++) centerline.push([-50 + 100 * rnd(), -50 + 100 * rnd()]);
    const rows = 6;
    const cols = 9;
    const t = gridTerrain(rows, cols, 400, 400);
    for (const cap of [60, 15]) {
      const dist = terrainTrackDistance(t, centerline, cap);
      let clamped = 0;
      let below = 0;
      for (let i = 0; i <= rows; i++) {
        const z = t.originZ - t.sizeZ / 2 + (i * t.sizeZ) / rows;
        for (let j = 0; j <= cols; j++) {
          const x = t.originX - t.sizeX / 2 + (j * t.sizeX) / cols;
          let best = Infinity;
          for (const [px, pz] of centerline) best = Math.min(best, Math.hypot(x - px, z - pz));
          const expected = Math.min(cap, best);
          const got = dist[i * (cols + 1) + j];
          expect(got, `cap ${cap} vertex ${i},${j}`).toBeCloseTo(expected, 4);
          if (got === cap) clamped++;
          else below++;
        }
      }
      expect(clamped, `cap ${cap} clamped`).toBeGreaterThan(0);
      expect(below, `cap ${cap} below`).toBeGreaterThan(0);
    }
  });

  it('POST5: degenerate-but-defined inputs follow min(cap, distance)', () => {
    const single = terrainTrackDistance(gridTerrain(1, 1, 10, 10), [[0, 0]]);
    expect(single).toHaveLength(4);
    for (const v of single) expect(v).toBeCloseTo(Math.sqrt(50), 5);
    const zeroCap = terrainTrackDistance(gridTerrain(2, 3, 12, 8), [[1, 2], [-40, 9]], 0);
    expect(zeroCap).toHaveLength(12);
    for (const v of zeroCap) expect(v).toBe(0);
  });
});
