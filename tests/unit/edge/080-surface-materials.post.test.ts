import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  applyAntiTiling,
  createSurfaceMaterial,
  type SurfaceMaterialKind,
  type SurfaceMaterialUserData,
} from '../../../src/render/surfaceMaterials';
import { createTrackSurfaceObject } from '../../../src/render/trackSurfaceRenderer';
import type { Surface, SurfaceStrip } from '../../../src/core/types';

const ALL_KINDS: SurfaceMaterialKind[] = ['asphalt', 'runoff', 'gravel', 'grass', 'kerb', 'concrete'];
const ALL_SURFACES: Surface[] = ['asphalt', 'kerb', 'grass', 'gravel', 'runoff'];

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

function compile(material: THREE.MeshStandardMaterial): THREE.WebGLProgramParametersWithUniforms {
  const shader = fakeShader();
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

function strip(surface: SurfaceStrip['surface']): SurfaceStrip {
  return {
    surface,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
  };
}

describe('080 surface materials post-code gaps', () => {
  it('texture repeat is 10/tileMeters on both axes for every map, and (1,1) for kerb', () => {
    const expected: Record<SurfaceMaterialKind, number> = {
      asphalt: 1.25,
      runoff: 1.25,
      gravel: 10 / 3,
      grass: 2,
      kerb: 1,
      concrete: 2.5,
    };
    for (const kind of ALL_KINDS) {
      const material = createSurfaceMaterial(kind, recordingLoader().loadTexture);
      for (const texture of [material.map!, material.normalMap!, material.roughnessMap!]) {
        expect(texture.repeat.x, `${kind} repeat.x`).toBeCloseTo(expected[kind], 10);
        expect(texture.repeat.y, `${kind} repeat.y`).toBeCloseTo(expected[kind], 10);
      }
    }
  });

  it('userData.tint is 1.15 for runoff, 0.85 for gravel and 1 for the other kinds', () => {
    const tint: Record<SurfaceMaterialKind, number> = {
      asphalt: 1,
      runoff: 1.15,
      gravel: 0.85,
      grass: 1,
      kerb: 1,
      concrete: 1,
    };
    for (const kind of ALL_KINDS) {
      const material = createSurfaceMaterial(kind, recordingLoader().loadTexture);
      expect(material.userData.tint, `tint ${kind}`).toBeCloseTo(tint[kind], 10);
    }
  });

  it('userData.textures owns map, normalMap, roughnessMap and the loaded macro', () => {
    const material = createSurfaceMaterial('grass', recordingLoader().loadTexture);
    const userData = material.userData as SurfaceMaterialUserData;
    expect(userData.textures).toHaveLength(4);
    expect(userData.textures[0]).toBe(material.map);
    expect(userData.textures[1]).toBe(material.normalMap);
    expect(userData.textures[2]).toBe(material.roughnessMap);
    expect(userData.textures[3].name).toBe('textures/macro-noise.png');
  });

  it('a passed shared macro is not re-loaded and is listed in userData.textures', () => {
    const { urls, loadTexture } = recordingLoader();
    const shared = new THREE.Texture();
    const material = createSurfaceMaterial('asphalt', loadTexture, shared);
    expect(urls).not.toContain('textures/macro-noise.png');
    expect(urls).toHaveLength(3);
    const userData = material.userData as SurfaceMaterialUserData;
    expect(userData.textures).toHaveLength(4);
    expect(userData.textures[3]).toBe(shared);
    expect(shared.wrapS).toBe(THREE.RepeatWrapping);
    expect(shared.wrapT).toBe(THREE.RepeatWrapping);
  });

  it('uniform values match the kind config: uSaturation, uTint and uMacro point at the loaded textures', () => {
    const material = createSurfaceMaterial('runoff', recordingLoader().loadTexture);
    const shader = compile(material);
    expect(shader.uniforms.uSaturation.value).toBeCloseTo(0.8, 10);
    expect(shader.uniforms.uTint.value).toBeCloseTo(1.15, 10);
    expect(shader.uniforms.uMacro.value).toBe((material.userData as SurfaceMaterialUserData).textures[3]);

    const gravel = compile(createSurfaceMaterial('gravel', recordingLoader().loadTexture));
    expect(gravel.uniforms.uSaturation.value).toBeCloseTo(0.55, 10);
    expect(gravel.uniforms.uTint.value).toBeCloseTo(0.85, 10);
  });

  it('kerb stripe uniforms are red (0.78,0.1,0.1) and white (0.7,0.7,0.7)', () => {
    const shader = compile(createSurfaceMaterial('kerb', recordingLoader().loadTexture));
    const a = shader.uniforms.uStripeA.value as THREE.Vector3;
    const b = shader.uniforms.uStripeB.value as THREE.Vector3;
    expect(a.x).toBeCloseTo(0.78, 10);
    expect(a.y).toBeCloseTo(0.1, 10);
    expect(a.z).toBeCloseTo(0.1, 10);
    expect(b.x).toBeCloseTo(0.7, 10);
    expect(b.y).toBeCloseTo(0.7, 10);
    expect(b.z).toBeCloseTo(0.7, 10);
  });

  it('non-kerb kinds get no stripe uniforms and no stripe shader code', () => {
    for (const kind of ALL_KINDS.filter((k) => k !== 'kerb')) {
      const shader = compile(createSurfaceMaterial(kind, recordingLoader().loadTexture));
      expect(shader.uniforms.uStripeA, kind).toBeUndefined();
      expect(shader.uniforms.uStripeB, kind).toBeUndefined();
      expect(shader.fragmentShader, kind).not.toContain('uStripeA');
    }
  });

  it('vertex shader exports world xz; normal and roughness chunks stay untouched; macro scales are 180/40 m', () => {
    const shader = compile(createSurfaceMaterial('asphalt', recordingLoader().loadTexture));
    expect(shader.vertexShader).toContain('varying vec2 vSurfaceWorldXz;');
    expect(shader.vertexShader).toContain('( modelMatrix * vec4( transformed, 1.0 ) ).xz');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    expect(shader.fragmentShader).toContain('#include <normal_fragment_maps>');
    expect(shader.fragmentShader).toContain('#include <roughnessmap_fragment>');
    expect(shader.fragmentShader).toContain('180.0');
    expect(shader.fragmentShader).toContain('40.0');
    expect(shader.fragmentShader).toContain('0.29');
  });

  it('applyAntiTiling patches any standard shader with the caller uniforms (081 reuse)', () => {
    const shader = fakeShader();
    const macro = new THREE.Texture();
    applyAntiTiling(shader, {
      uMacro: { value: macro },
      uSaturation: { value: 0.5 },
      uTint: { value: 2 },
    });
    expect(shader.uniforms.uMacro.value).toBe(macro);
    expect(shader.uniforms.uSaturation.value).toBeCloseTo(0.5, 10);
    expect(shader.uniforms.uTint.value).toBeCloseTo(2, 10);
    expect(shader.vertexShader).toContain('vSurfaceWorldXz');
    expect(shader.fragmentShader).toContain('uniform sampler2D uMacro;');
  });

  it('customProgramCacheKey is per kind so kerb and plain shaders never collide', () => {
    const keys = ALL_KINDS.map(
      (kind) => createSurfaceMaterial(kind, recordingLoader().loadTexture).customProgramCacheKey!(),
    );
    expect(new Set(keys).size).toBe(ALL_KINDS.length);
    const again = createSurfaceMaterial('kerb', recordingLoader().loadTexture).customProgramCacheKey!();
    expect(again).toBe(keys[ALL_KINDS.indexOf('kerb')]);
  });

  it('createTrackSurfaceObject loads one shared macro for all surfaces and every material samples it', () => {
    const { urls, loadTexture } = recordingLoader();
    const obj = createTrackSurfaceObject(ALL_SURFACES.map(strip), { loadTexture });
    const macroUrls = urls.filter((url) => url === 'textures/macro-noise.png');
    expect(macroUrls).toHaveLength(1);

    const macros = new Set<THREE.Texture>();
    for (const name of ['asphalt', 'kerbs', 'grass', 'gravel', 'runoff']) {
      const mesh = obj.group.getObjectByName(name) as THREE.Mesh;
      expect(mesh, name).toBeInstanceOf(THREE.Mesh);
      const shader = compile(mesh.material as THREE.MeshStandardMaterial);
      macros.add(shader.uniforms.uMacro.value as THREE.Texture);
    }
    expect(macros.size).toBe(1);
    obj.dispose();
  });

  it('renderer gives each surface mesh the material of its own kind, including grass', () => {
    const obj = createTrackSurfaceObject(ALL_SURFACES.map(strip), {
      loadTexture: recordingLoader().loadTexture,
    });
    const tileMeters: Record<string, number> = {
      asphalt: 8,
      kerbs: 1.5,
      grass: 5,
      gravel: 3,
      runoff: 8,
    };
    for (const [name, meters] of Object.entries(tileMeters)) {
      const mesh = obj.group.getObjectByName(name) as THREE.Mesh;
      const userData = (mesh.material as THREE.MeshStandardMaterial)
        .userData as SurfaceMaterialUserData;
      expect(userData.tileMeters, `${name} tileMeters`).toBeCloseTo(meters, 10);
    }
    obj.dispose();
  });

  it('empty strips load no textures at all, not even the macro', () => {
    const { urls, loadTexture } = recordingLoader();
    const obj = createTrackSurfaceObject([], { loadTexture });
    expect(urls).toEqual([]);
    expect(obj.group.children).toHaveLength(0);
    expect(() => obj.dispose()).not.toThrow();
  });
});
