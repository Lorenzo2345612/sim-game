import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import type { Grandstand, PitLane, TrackDataV2 } from '../../../src/core/types';
import { createPitBuilding } from '../../../src/render/pitAndStart';
import { createGrandstand, disposeGrandstand } from '../../../src/render/grandstand';
import { DEFAULT_TRACK_STYLE } from '../../../src/track/trackStyle';
import type { ResolvedTrackStyle } from '../../../src/track/trackStyle';

const POINTS = 21;
const SPACING = 5;
const WIDTH = 12;
const HALF = WIDTH / 2;

function straightTrack(pit: PitLane): TrackDataV2 {
  return {
    version: 2,
    id: 'monza',
    name: 'Test',
    widthMeters: WIDTH,
    lengthMeters: (POINTS - 1) * SPACING,
    officialLengthMeters: 0,
    centerline: Array.from({ length: POINTS }, (_, i): [number, number] => [i * SPACING, 0]),
    sectors: [0, 0, 0],
    elevation: Array.from({ length: POINTS }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 1, sizeZ: 1, rows: 1, cols: 1, heights: [0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit,
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com', dem: 'test.tif' },
  };
}

const TRACK = straightTrack({ start: 2, end: 18, side: 'right' });

function pitStyle(p: Partial<ResolvedTrackStyle['pitBuilding']>): ResolvedTrackStyle {
  return { ...DEFAULT_TRACK_STYLE, pitBuilding: { ...DEFAULT_TRACK_STYLE.pitBuilding, ...p } };
}

function standStyle(s: Partial<ResolvedTrackStyle['grandstands']>): ResolvedTrackStyle {
  return { ...DEFAULT_TRACK_STYLE, grandstands: { ...DEFAULT_TRACK_STYLE.grandstands, ...s } };
}

function meshes(root: THREE.Object3D, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) out.push(o);
  });
  return out;
}

function one(root: THREE.Object3D, name: string): THREE.Mesh {
  const found = meshes(root, name);
  if (found.length === 0) throw new Error(`missing mesh: ${name}`);
  return found[0];
}

function hexOf(mesh: THREE.Mesh): string {
  return (mesh.material as THREE.MeshStandardMaterial).color.getHexString();
}

function localSize(mesh: THREE.Mesh): THREE.Vector3 {
  mesh.geometry.computeBoundingBox();
  return (mesh.geometry.boundingBox as THREE.Box3).getSize(new THREE.Vector3());
}

function worldBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

const STAND: Grandstand = { x: 12, z: -30, yaw: 0.7, lengthMeters: 10, rows: 2, roof: true };

describe('182 pit building and grandstand style', () => {
  it('AT1: default style keeps colours, garageCount, no glass or roof', () => {
    const group = createPitBuilding(TRACK, DEFAULT_TRACK_STYLE);
    expect(hexOf(one(group, 'pit'))).toBe('b8bcc0');
    expect(hexOf(one(group, 'garageDoor'))).toBe('1c1c1e');
    expect(group.userData.garageCount).toBe(createPitBuilding(TRACK).userData.garageCount);
    expect(group.userData.garageCount).toBe(10);
    expect(meshes(group, 'pitGlass')).toHaveLength(0);
    expect(meshes(group, 'pitRoof')).toHaveLength(0);
  });

  it('AT2: storeys, height and depth', () => {
    const group = createPitBuilding(TRACK, pitStyle({ storeys: 3, heightMeters: 12, depthMeters: 15 }));
    const size = localSize(one(group, 'pit'));
    expect(size.y).toBeGreaterThanOrEqual(12 - 0.01);
    expect(size.z).toBeCloseTo(15, 2);
    expect(group.userData.storeys).toBe(3);
  });

  it('AT3: facade and door colours', () => {
    const group = createPitBuilding(TRACK, pitStyle({ facade: '#dadada', doors: '#333333' }));
    expect(hexOf(one(group, 'pit'))).toBe('dadada');
    const doors = meshes(group, 'garageDoor');
    expect(doors.length).toBeGreaterThan(0);
    for (const door of doors) expect(hexOf(door)).toBe('333333');
  });

  it('AT4: glazing band', () => {
    const group = createPitBuilding(TRACK, pitStyle({ glazing: 0.4, storeys: 2, heightMeters: 9 }));
    const glass = one(group, 'pitGlass');
    expect(localSize(glass).y).toBeCloseTo(0.4 * (9 - 9 / 2), 1);
    const material = glass.material as THREE.MeshStandardMaterial;
    expect(material.transparent || material.metalness >= 0.5).toBe(true);
  });

  it.each(['canopy', 'folded', 'sail', 'curved'] as const)('AT5: %s roof sits above the pit top', (roofStyle) => {
    const group = createPitBuilding(TRACK, pitStyle({ roofStyle }));
    const roof = one(group, 'pitRoof');
    expect(worldBox(roof).max.y).toBeGreaterThanOrEqual(worldBox(one(group, 'pit')).max.y);
  });

  it('AT5: flat roof with colour set', () => {
    const group = createPitBuilding(TRACK, pitStyle({ roofStyle: 'flat', roof: '#aa3300' }));
    expect(hexOf(one(group, 'pitRoof'))).toBe('aa3300');
  });

  it('AT6: accent strip colour', () => {
    const group = createPitBuilding(TRACK, pitStyle({ accent: '#cc0000' }));
    expect(hexOf(one(group, 'pitAccent'))).toBe('cc0000');
  });

  const NEAR_STYLES: Array<[string, Partial<ResolvedTrackStyle['pitBuilding']>]> = [
    ['AT2', { storeys: 3, heightMeters: 12, depthMeters: 15 }],
    ['AT3', { facade: '#dadada', doors: '#333333' }],
    ['AT4', { glazing: 0.4, storeys: 2, heightMeters: 9 }],
    ['AT5 canopy', { roofStyle: 'canopy' }],
    ['AT5 folded', { roofStyle: 'folded' }],
    ['AT5 sail', { roofStyle: 'sail' }],
    ['AT5 curved', { roofStyle: 'curved' }],
    ['AT5 flat', { roofStyle: 'flat', roof: '#aa3300' }],
    ['AT6', { accent: '#cc0000' }],
  ];

  it.each(NEAR_STYLES)('AT7: near face stays at width/2 + 10 (%s)', (_label, p) => {
    const group = createPitBuilding(TRACK, pitStyle(p));
    expect(worldBox(one(group, 'pit')).min.z).toBeCloseTo(HALF + 10, 1);
  });

  it('AT8: grandstand structure, roof, seats and roof style', () => {
    const group = createGrandstand(
      STAND,
      undefined,
      standStyle({ structure: '#cccccc', roof: '#dadada', seats: ['#1f4fbf', '#dac400'], roofStyle: 'sail' }),
    );
    const tiers = group.children.filter((c) => c.name.startsWith('tier_')) as THREE.Mesh[];
    expect(tiers.length).toBeGreaterThan(0);
    for (const tier of tiers) expect(hexOf(tier)).toBe('cccccc');
    const roof = one(group, 'standRoof');
    expect(hexOf(roof)).toBe('dadada');
    expect(roof.userData.roofStyle).toBe('sail');

    const crowd = group.getObjectByName('crowd') as THREE.InstancedMesh;
    const array = (crowd.instanceColor as THREE.InstancedBufferAttribute).array;
    const palette = ['#1f4fbf', '#dac400'].map((h) => new THREE.Color(h));
    const used = new Set<number>();
    for (let i = 0; i < crowd.count; i++) {
      const idx = palette.findIndex(
        (c) =>
          Math.abs(c.r - array[i * 3]) < 1e-4 &&
          Math.abs(c.g - array[i * 3 + 1]) < 1e-4 &&
          Math.abs(c.b - array[i * 3 + 2]) < 1e-4,
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      used.add(idx);
    }
    expect(used.size).toBe(2);
  });

  it('AT9: default style grandstand identical to no style', () => {
    const summary = (g: THREE.Group): string[] =>
      g.children.map((c) => {
        const m = c instanceof THREE.Mesh ? (c.material as THREE.MeshStandardMaterial).color.getHexString() : '';
        return `${c.name}:${m}`;
      });
    const a = createGrandstand(STAND);
    const b = createGrandstand(STAND, undefined, DEFAULT_TRACK_STYLE);
    expect(summary(b)).toEqual(summary(a));
    expect(b.children.length).toBe(a.children.length);
  });

  it('AT10: every geometry and material is disposed', () => {
    const pit = createPitBuilding(
      TRACK,
      pitStyle({ storeys: 2, heightMeters: 9, glazing: 0.4, roofStyle: 'folded', accent: '#cc0000' }),
    );
    const stand = createGrandstand(
      STAND,
      undefined,
      standStyle({ structure: '#cccccc', roof: '#dadada', seats: ['#1f4fbf', '#dac400'], roofStyle: 'truss' }),
    );
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const root of [pit, stand]) {
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        geometries.add(o.geometry);
        materials.add(o.material as THREE.Material);
      });
    }
    const spies = [...geometries, ...materials].map((r) => vi.spyOn(r, 'dispose'));
    pit.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    });
    disposeGrandstand(stand);
    expect(spies.length).toBeGreaterThan(0);
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
