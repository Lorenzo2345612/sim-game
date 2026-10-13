import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSurfaceMaterial, type SurfaceMaterialKind } from '../../../src/render/surfaceMaterials';
import { createTrackSurfaceObject } from '../../../src/render/trackSurfaceRenderer';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import type { RunoffSegment, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { fixture } from './022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

function recordingLoader(): { urls: string[]; textures: THREE.Texture[]; loadTexture: (url: string) => THREE.Texture } {
  const urls: string[] = [];
  const textures: THREE.Texture[] = [];
  const loadTexture = (url: string): THREE.Texture => {
    urls.push(url);
    const texture = new THREE.Texture();
    texture.name = url;
    textures.push(texture);
    return texture;
  };
  return { urls, textures, loadTexture };
}

function fakeShader(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

const N = 120;

function circleV2(kerbs: TrackSegment[], runoffs: RunoffSegment[]): TrackDataV2 {
  return {
    ...fixture,
    version: 2,
    centerline: circleTrack.centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    elevation: Array.from({ length: N }, () => 0),
    kerbs,
    runoffs,
  };
}

describe('080 surface materials acceptance', () => {
  it('AT1: gravel loads color, normal, roughness and macro-noise, all RepeatWrapping, map SRGB', () => {
    const { urls, textures, loadTexture } = recordingLoader();
    const material = createSurfaceMaterial('gravel', loadTexture);
    expect(urls.slice().sort()).toEqual([
      'textures/gravel/color.jpg',
      'textures/gravel/normal.jpg',
      'textures/gravel/roughness.jpg',
      'textures/macro-noise.png',
    ]);
    for (const texture of textures) {
      expect(texture.wrapS, `${texture.name} wrapS`).toBe(THREE.RepeatWrapping);
      expect(texture.wrapT, `${texture.name} wrapT`).toBe(THREE.RepeatWrapping);
    }
    expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('AT2: colour URLs are asphalt-track, asphalt, grass-mown and kerb for asphalt, runoff, grass and kerb', () => {
    const cases: [SurfaceMaterialKind, string][] = [
      ['asphalt', 'textures/asphalt-track/color.jpg'],
      ['runoff', 'textures/asphalt/color.jpg'],
      ['grass', 'textures/grass-mown/color.jpg'],
      ['kerb', 'textures/kerb/color.jpg'],
    ];
    for (const [kind, colorUrl] of cases) {
      const { urls, loadTexture } = recordingLoader();
      createSurfaceMaterial(kind, loadTexture);
      expect(urls, kind).toContain(colorUrl);
    }
  });

  it('AT3: userData holds tileMeters 8/8/3/5/1.5/4 and saturation 0.8/0.55/0.9/1 per kind', () => {
    const tileMeters: [SurfaceMaterialKind, number][] = [
      ['asphalt', 8],
      ['runoff', 8],
      ['gravel', 3],
      ['grass', 5],
      ['kerb', 1.5],
      ['concrete', 4],
    ];
    const saturation: [SurfaceMaterialKind, number][] = [
      ['asphalt', 0.8],
      ['gravel', 0.55],
      ['grass', 0.9],
      ['kerb', 1],
    ];
    for (const [kind, meters] of tileMeters) {
      const material = createSurfaceMaterial(kind, recordingLoader().loadTexture);
      expect(material.userData.tileMeters, `tileMeters ${kind}`).toBeCloseTo(meters, 10);
    }
    for (const [kind, value] of saturation) {
      const material = createSurfaceMaterial(kind, recordingLoader().loadTexture);
      expect(material.userData.saturation, `saturation ${kind}`).toBeCloseTo(value, 10);
    }
  });

  it('AT4: onBeforeCompile adds uMacro and uSaturation uniforms and uMacro sampling; kerb also uStripeA and uStripeB', () => {
    const renderer = {} as THREE.WebGLRenderer;
    const asphalt = createSurfaceMaterial('asphalt', recordingLoader().loadTexture);
    const shader = fakeShader();
    asphalt.onBeforeCompile(shader, renderer);
    expect(shader.uniforms.uMacro).toBeDefined();
    expect(shader.uniforms.uSaturation).toBeDefined();
    expect(shader.fragmentShader).toContain('uMacro');

    const kerb = createSurfaceMaterial('kerb', recordingLoader().loadTexture);
    const kerbShader = fakeShader();
    kerb.onBeforeCompile(kerbShader, renderer);
    expect(kerbShader.uniforms.uMacro).toBeDefined();
    expect(kerbShader.uniforms.uSaturation).toBeDefined();
    expect(kerbShader.fragmentShader).toContain('uMacro');
    expect(kerbShader.fragmentShader).toContain('uStripeA');
    expect(kerbShader.fragmentShader).toContain('uStripeB');
  });

  it('AT5: with strips of every surface, dispose disposes every created texture exactly once', () => {
    const strips = buildTrackSurfaces(
      circleV2(
        [{ start: 10, end: 30, side: 'left' }],
        [
          { start: 10, end: 30, side: 'right', surface: 'gravel', widthMeters: 18 },
          { start: 60, end: 80, side: 'right', surface: 'runoff', widthMeters: 15 },
        ],
      ),
    );
    expect(new Set(strips.map((s) => s.surface))).toEqual(
      new Set(['asphalt', 'kerb', 'grass', 'gravel', 'runoff']),
    );

    const disposals = new Map<THREE.Texture, number>();
    const loadTexture = (url: string): THREE.Texture => {
      const texture = new THREE.Texture();
      texture.name = url;
      const original = texture.dispose.bind(texture);
      texture.dispose = (): void => {
        disposals.set(texture, (disposals.get(texture) ?? 0) + 1);
        original();
      };
      disposals.set(texture, 0);
      return texture;
    };

    const obj = createTrackSurfaceObject(strips, { loadTexture });
    for (const name of ['asphalt', 'kerbs', 'grass', 'gravel', 'runoff']) {
      expect(obj.group.getObjectByName(name), name).toBeInstanceOf(THREE.Mesh);
    }
    expect(disposals.size).toBeGreaterThan(0);
    obj.dispose();
    for (const [texture, count] of disposals) {
      expect(count, `${texture.name} dispose calls`).toBe(1);
    }
  });
});
