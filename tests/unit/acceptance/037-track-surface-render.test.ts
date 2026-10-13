import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { RunoffSegment, SurfaceStrip, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { buildTrackSurfaces as buildAllSurfaces } from '../../../src/track/surfaces';
// Task 077 appends grass verge strips; these pre-077 contracts cover the other strips only.
const buildTrackSurfaces = (track: Parameters<typeof buildAllSurfaces>[0]) =>
  buildAllSurfaces(track).filter((strip) => strip.surface !== 'grass');
import { createTrackSurfaceObject } from '../../../src/render/trackSurfaceRenderer';
import { fixture } from './022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

const N = 120;
const MESH_FOR_SURFACE: Record<string, string> = {
  asphalt: 'asphalt',
  kerb: 'kerbs',
  gravel: 'gravel',
  runoff: 'runoff',
};

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

function allSurfaceStrips(): SurfaceStrip[] {
  return buildTrackSurfaces(
    circleV2(
      [{ start: 10, end: 30, side: 'left' }],
      [
        { start: 50, end: 60, side: 'right', surface: 'gravel', widthMeters: 18 },
        { start: 70, end: 80, side: 'right', surface: 'runoff', widthMeters: 10 },
      ],
    ),
  );
}

function meshesOf(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
}

function meshByName(group: THREE.Group, name: string): THREE.Mesh {
  const mesh = meshesOf(group).find((candidate) => candidate.name === name);
  if (!mesh) throw new Error(`missing mesh: ${name}`);
  return mesh;
}

describe('037 track surface render acceptance', () => {
  it('AT1: group holds meshes asphalt, kerbs, runoff, gravel with geometry counts matching the input strips', () => {
    const strips = allSurfaceStrips();
    const { group } = createTrackSurfaceObject(strips);
    expect(group).toBeInstanceOf(THREE.Group);
    expect(group.children).toHaveLength(4);
    expect(meshesOf(group).map((mesh) => mesh.name).sort()).toEqual(['asphalt', 'gravel', 'kerbs', 'runoff']);
    const bySurface = new Map<string, SurfaceStrip[]>();
    for (const strip of strips) {
      const same = bySurface.get(strip.surface) ?? [];
      same.push(strip);
      bySurface.set(strip.surface, same);
    }
    expect(bySurface.size).toBe(4);
    for (const [surface, same] of bySurface) {
      const geometry = meshByName(group, MESH_FOR_SURFACE[surface]).geometry;
      const position = geometry.getAttribute('position');
      const uv = geometry.getAttribute('uv');
      const index = geometry.getIndex();
      expect(position).toBeDefined();
      expect(uv).toBeDefined();
      expect(index).not.toBeNull();
      expect(position.count).toBe(same.reduce((n, s) => n + s.positions.length / 3, 0));
      expect(uv.count).toBe(same.reduce((n, s) => n + s.uvs.length / 2, 0));
      expect(index!.count).toBe(same.reduce((n, s) => n + s.indices.length, 0));
    }
  });

  it('AT2: asphalt/gravel/runoff use textures/<surface>/{color,normal,roughness}.jpg and kerbs a red/white uv.v stripe', () => {
    const strips = allSurfaceStrips();
    const loaded: string[] = [];
    const byUrl = new Map<string, THREE.Texture>();
    const { group } = createTrackSurfaceObject(strips, {
      loadTexture: (url: string) => {
        loaded.push(url);
        const texture = new THREE.Texture();
        texture.name = url;
        byUrl.set(url, texture);
        return texture;
      },
    });
    const expectedUrls = ['asphalt', 'gravel', 'runoff'].flatMap((surface) =>
      ['color', 'normal', 'roughness'].map((channel) => `textures/${surface}/${channel}.jpg`),
    );
    expect([...loaded].sort()).toEqual([...expectedUrls].sort());
    const slot = (surface: string, channel: string): THREE.Texture => {
      const texture = byUrl.get(`textures/${surface}/${channel}.jpg`);
      if (!texture) throw new Error(`texture not loaded: ${surface}/${channel}`);
      return texture;
    };
    for (const surface of ['asphalt', 'gravel', 'runoff']) {
      const material = meshByName(group, surface).material as THREE.MeshStandardMaterial;
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(material.map).toBe(slot(surface, 'color'));
      expect(material.normalMap).toBe(slot(surface, 'normal'));
      expect(material.roughnessMap).toBe(slot(surface, 'roughness'));
      expect(material.map!.colorSpace).toBe(THREE.SRGBColorSpace);
      for (const texture of [material.map!, material.normalMap!, material.roughnessMap!]) {
        expect(texture.wrapS).toBe(THREE.RepeatWrapping);
        expect(texture.wrapT).toBe(THREE.RepeatWrapping);
      }
    }
    const kerbMaterial = meshByName(group, 'kerbs').material as THREE.MeshStandardMaterial;
    expect(kerbMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);
    const stripe = kerbMaterial.map;
    expect(stripe).toBeInstanceOf(THREE.DataTexture);
    if (!(stripe instanceof THREE.DataTexture)) throw new Error('kerb map is not a DataTexture');
    expect(stripe.image.width).toBe(1);
    expect(stripe.image.height).toBe(2);
    expect(stripe.magFilter).toBe(THREE.NearestFilter);
    expect(stripe.minFilter).toBe(THREE.NearestFilter);
    expect(stripe.wrapS).toBe(THREE.RepeatWrapping);
    expect(stripe.wrapT).toBe(THREE.RepeatWrapping);
    expect(stripe.repeat.y).toBeCloseTo(0.5, 10);
    const data = stripe.image.data!;
    const pixel = (i: number): string => `${data[i * 4]},${data[i * 4 + 1]},${data[i * 4 + 2]}`;
    expect([pixel(0), pixel(1)].sort()).toEqual(['204,34,34', '238,238,238']);
  });

  it('AT3: dispose() disposes every geometry, material and texture exactly once', () => {
    const strips = allSurfaceStrips();
    const result = createTrackSurfaceObject(strips, {
      loadTexture: (url: string) => {
        const texture = new THREE.Texture();
        texture.name = url;
        return texture;
      },
    });
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];
    result.group.traverse((object: THREE.Object3D) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.push(object.geometry);
      const material = object.material as THREE.MeshStandardMaterial;
      materials.push(material);
      for (const texture of [material.map, material.normalMap, material.roughnessMap]) {
        if (texture) textures.push(texture);
      }
    });
    expect(geometries).toHaveLength(4);
    expect(materials).toHaveLength(4);
    expect(textures).toHaveLength(10);
    const spies = [
      ...geometries.map((geometry) => vi.spyOn(geometry, 'dispose')),
      ...materials.map((material) => vi.spyOn(material, 'dispose')),
      ...textures.map((texture) => vi.spyOn(texture, 'dispose')),
    ];
    result.dispose();
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
});
