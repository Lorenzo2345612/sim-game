import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { TreeInstances, TreeSpecies } from '../../../src/core/types';
import { createTreeField } from '../../../src/render/treeField';
import { createTerrainMaterial, groundPalette, type GroundPalette } from '../../../src/render/terrainMaterial';
import { bakedSpeciesFor, loadGlbModels, type TreeModels, type TreeVariant } from '../../../src/render/treeModels';
import { biomeFor, type Biome } from '../../../tools/track-builder/trees';

const ROOT = join(__dirname, '..', '..', '..');

const { loadAsyncMock } = vi.hoisted(() => ({ loadAsyncMock: vi.fn() }));
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    loadAsync(url: string) {
      return loadAsyncMock(url);
    }
  },
}));

function textureLoader(): { urls: string[]; loadTexture: (url: string) => THREE.Texture } {
  const urls: string[] = [];
  return {
    urls,
    loadTexture: (url: string) => {
      const texture = new THREE.Texture();
      texture.name = url;
      urls.push(url);
      return texture;
    },
  };
}

function compile(palette?: GroundPalette): THREE.WebGLProgramParametersWithUniforms {
  const material = createTerrainMaterial(textureLoader().loadTexture, undefined, palette);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

function gltfScene(height: number, color = 0x3fae29): THREE.Object3D {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, height, 2), new THREE.MeshStandardMaterial({ color }));
  mesh.position.y = height / 2;
  const group = new THREE.Group();
  group.add(mesh);
  group.updateMatrixWorld(true);
  return group;
}

function bakedModels(): TreeModels {
  return { oak: [18, 18, 18, 18].map(makeVariant), plane: [16, 16, 16, 16].map(makeVariant), pine: [26, 26, 26, 26].map(makeVariant) };
}

function makeVariant(height: number): TreeVariant {
  const lod = (size: number): THREE.Mesh[] => [
    new THREE.Mesh(new THREE.BoxGeometry(size, height, size), new THREE.MeshStandardMaterial()),
  ];
  return { height, lods: [lod(4), lod(2), lod(1)] };
}

function batchAt(name: string, xs: number[]): TreeInstances {
  const data: number[] = [];
  for (const x of xs) data.push(x, 0, 1, 0);
  return { species: name, data };
}

const OAK: TreeSpecies = { name: 'oak', preset: 'Oak Medium', heightMeters: 18 };
const PALM_DATE: TreeSpecies = { name: 'palm-date', preset: 'Palm Date', heightMeters: 9 };

describe('156 environment vegetation post-code gaps', () => {
  it('POST1: the desert palette as 3rd argument loads sand/dry/sand-b plus dirt and macro, leaving the palette untouched', () => {
    const palette = groundPalette('desert');
    const { urls, loadTexture } = textureLoader();
    const material = createTerrainMaterial(loadTexture, undefined, palette);
    const expected: string[] = [];
    for (const dir of [...palette.dirs, 'dirt']) {
      for (const map of ['color', 'normal', 'roughness']) expected.push(`textures/${dir}/${map}.jpg`);
    }
    expected.push('textures/macro-noise.png');
    expect([...urls].sort()).toEqual(expected.sort());
    expect(material.map!.name).toBe('textures/ground/sand/color.jpg');
    expect(palette.dirs).toEqual(['ground/sand', 'ground/dry', 'ground/sand-b']);
    expect(palette.stripes).toBe(false);
  });

  it('POST2: uStripes uniform follows the palette and the fragment shader gates the mown stripes on it', () => {
    expect((compile(groundPalette('desert')).uniforms.uStripes as THREE.IUniform).value).toBe(0);
    expect((compile(groundPalette('parkland')).uniforms.uStripes as THREE.IUniform).value).toBe(1);
    expect((compile().uniforms.uStripes as THREE.IUniform).value).toBe(1);
    const f = compile(groundPalette('desert')).fragmentShader;
    expect(f).toContain('uniform float uStripes;');
    expect(f).toContain('mix( 1.0, terrainStripe, uStripes )');
  });

  it('POST3: every groundPalette call returns its own dirs array, so mutating one result cannot leak', () => {
    const first = groundPalette('desert');
    first.dirs.push('injected');
    const second = groundPalette('desert');
    expect(second.dirs).toEqual(['ground/sand', 'ground/dry', 'ground/sand-b']);
    expect(groundPalette('parkland').dirs).toEqual(['grass-mown', 'grass', 'grass-dark']);
  });

  it('POST4: the desert texture dirs of groundPalette resolve to color/normal/roughness files on disk', () => {
    const missing: string[] = [];
    for (const dir of groundPalette('desert').dirs) {
      for (const map of ['color', 'normal', 'roughness']) {
        if (!existsSync(join(ROOT, 'public', 'textures', dir, `${map}.jpg`))) missing.push(`${dir}/${map}.jpg`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('POST5: bakedSpeciesFor maps the four GLB species names to themselves', () => {
    for (const name of ['palm-date', 'palm-coconut', 'cactus', 'shrub-dry']) {
      expect(bakedSpeciesFor(name), name).toBe(name);
    }
    expect(bakedSpeciesFor('Palm Date')).toBe('oak');
  });

  it('POST6: loadGlbModels ignores non-GLB names without touching the loader', async () => {
    loadAsyncMock.mockReset();
    const out = await loadGlbModels(['oak', 'pine', 'ash', '', 'constructor', 'toString']);
    expect(out).toEqual({});
    expect(loadAsyncMock).not.toHaveBeenCalled();
  });

  it('POST7: loadGlbModels loads each requested species once and shares it across the four variants', async () => {
    loadAsyncMock.mockReset();
    loadAsyncMock.mockImplementation(async (url: string) => ({ scene: gltfScene(url.includes('cactus') ? 3 : 9) }));
    const models = await loadGlbModels(['palm-date', 'palm-date', 'oak', 'cactus']);
    expect([...new Set(loadAsyncMock.mock.calls.map((call) => call[0] as string))].sort()).toEqual([
      '/models/props/cactus.glb',
      '/models/vegetation/palm-date.glb',
    ]);
    expect(Object.keys(models).sort()).toEqual(['cactus', 'palm-date']);

    const variants = models['palm-date']!;
    expect(variants).toHaveLength(4);
    for (const variant of variants) expect(variant).toBe(variants[0]);
    expect(variants[0].height).toBeCloseTo(9, 6);
    expect(variants[0].lods[0]).toHaveLength(1);
    expect(variants[0].lods[1]).toHaveLength(1);
    expect(variants[0].lods[1][0]).toBe(variants[0].lods[2][0]); // LOD2 reuses the LOD1 quads

    const quads = variants[0].lods[1][0];
    expect(quads.geometry.getAttribute('position').count).toBe(8);
    expect(quads.geometry.getIndex()!.count).toBe(12);
    expect([...quads.geometry.getAttribute('uv').array]).toEqual([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
    const quadMaterial = quads.material as THREE.MeshStandardMaterial;
    expect(quadMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(quadMaterial.alphaTest).toBe(0.5);
    expect(quadMaterial.side).toBe(THREE.DoubleSide);
    expect(quadMaterial.transparent).toBe(false);
    expect(models['cactus']![0].height).toBeCloseTo(3, 6);
  });

  it('POST8: the four GLB URLs point at the installed files and only shrub-dry is tinted dry', async () => {
    loadAsyncMock.mockReset();
    loadAsyncMock.mockImplementation(async () => ({ scene: gltfScene(2) }));
    await loadGlbModels(['palm-date', 'palm-coconut', 'cactus', 'shrub-dry']);
    const urls = loadAsyncMock.mock.calls.map((call) => call[0] as string).sort();
    expect(urls).toEqual([
      '/models/props/cactus.glb',
      '/models/props/shrub-dry.glb',
      '/models/vegetation/palm-coconut.glb',
      '/models/vegetation/palm-date.glb',
    ]);
    for (const url of urls) expect(existsSync(join(ROOT, 'public', url)), url).toBe(true);

    loadAsyncMock.mockReset();
    loadAsyncMock.mockImplementation(async () => ({ scene: gltfScene(1.2) }));
    const shrub = (await loadGlbModels(['shrub-dry']))['shrub-dry']![0];
    expect((shrub.lods[0][0].material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xc4a86a);
    expect((shrub.lods[1][0].material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xc4a86a);

    loadAsyncMock.mockReset();
    loadAsyncMock.mockImplementation(async () => ({ scene: gltfScene(9, 0x2f7f3f) }));
    const palm = (await loadGlbModels(['palm-date']))['palm-date']![0];
    expect((palm.lods[0][0].material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x2f7f3f);
  });

  it('POST9: a GLB with no vertical extent falls back to height 1 instead of a zero scale', async () => {
    loadAsyncMock.mockReset();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
    group.updateMatrixWorld(true);
    loadAsyncMock.mockImplementation(async () => ({ scene: group }));
    const variant = (await loadGlbModels(['cactus']))['cactus']![0];
    expect(variant.height).toBe(1);
  });

  it('POST10: a GLB species batch is placed and scaled by target height / variant height', () => {
    const models: TreeModels = { ...bakedModels(), 'palm-date': [4.5, 4.5, 4.5, 4.5].map(makeVariant) };
    const field = createTreeField([batchAt('palm-date', [5])], [PALM_DATE], { models, terrainY: () => 0 });
    expect(field.instanceCount('palm-date')).toBe(1);
    expect(field.variantCount('palm-date')).toBe(4);

    const out = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    field.getInstanceMatrix('palm-date', 0, out).decompose(position, new THREE.Quaternion(), scale);
    expect(position.x).toBeCloseTo(5, 6);
    expect(scale.x).toBeCloseTo(9 / 4.5, 6);
    field.dispose();
  });

  it('POST11: a present GLB species without models fails loudly instead of rendering nothing', () => {
    const models: TreeModels = bakedModels();
    expect(() =>
      createTreeField([batchAt('palm-date', [0])], [PALM_DATE], { models, terrainY: () => 0 }),
    ).toThrow('models missing species palm-date');
  });

  it('POST12: undefined GLB entries in the model table are skipped for a baked-only track', () => {
    const models = { ...bakedModels(), 'palm-date': undefined } as TreeModels;
    const field = createTreeField([batchAt('oak', [0])], [OAK], { models, terrainY: () => 0 });
    expect(field.instanceCount('oak')).toBe(1);
    expect(field.instanceCount('palm-date')).toBe(0);
    field.dispose();
  });

  it('POST13: desert, tropical and city biomes fall back to the specified default species and densities', () => {
    const own: Biome = { species: [{ name: 'oak', weight: 1 }], density: 0.5 };
    expect(biomeFor('desert', own)).toEqual({
      species: [{ name: 'palm-date', weight: 0.5 }, { name: 'shrub-dry', weight: 0.4 }, { name: 'cactus', weight: 0.1 }],
      density: 0.08,
    });
    expect(biomeFor('tropical', own)).toEqual({
      species: [{ name: 'palm-coconut', weight: 0.6 }, { name: 'oak', weight: 0.4 }],
      density: 0.5,
    });
    expect(biomeFor('city', own)).toEqual({
      species: [{ name: 'palm-date', weight: 0.5 }, { name: 'oak', weight: 0.5 }],
      density: 0.03,
    });
  });

  it('POST14: biomeFor keeps the track biome when it names a vegetation species or is parkland/forest', () => {
    const cactus: Biome = { species: [{ name: 'cactus', weight: 1 }], density: 0.7 };
    expect(biomeFor('desert', cactus)).toBe(cactus);
    const own: Biome = { species: [{ name: 'palm-coconut', weight: 0.2 }, { name: 'oak', weight: 0.8 }], density: 0.9 };
    expect(biomeFor('tropical', own)).toBe(own);
    for (const type of ['parkland', 'forest'] as const) expect(biomeFor(type, cactus)).toBe(cactus);
    expect(cactus).toEqual({ species: [{ name: 'cactus', weight: 1 }], density: 0.7 });
  });
});
