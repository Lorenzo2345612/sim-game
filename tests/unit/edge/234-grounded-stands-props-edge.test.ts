import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Grandstand, Terrain, TrackDataV2 } from '../../../src/core/types';
import { grandstandFootprint, groundedBase } from '../../../src/track/placement';
import { createGrandstand, disposeGrandstand } from '../../../src/render/grandstand';
import { createTrackProps } from '../../../src/render/trackProps';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle, type TrackProp } from '../../../src/track/trackStyle';

const RAMP: Terrain = {
  originX: 0,
  originZ: 0,
  sizeX: 200,
  sizeZ: 100,
  cols: 20,
  rows: 10,
  heights: Array.from({ length: 21 * 11 }, (_, k) => 0.1 * (-100 + 10 * Math.floor(k / 11))),
};

function lineWith(elevation: number[], heights: number[]): TrackDataV2 {
  return {
    version: 2,
    id: 'line',
    name: 'Line',
    widthMeters: 12,
    lengthMeters: 180,
    officialLengthMeters: 180,
    centerline: Array.from({ length: 91 }, (_, i): [number, number] => [-90 + 2 * i, 0]),
    sectors: [0, 30, 60],
    elevation,
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { ...RAMP, heights },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 10, end: 30, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
  };
}

const CELLS = 21 * 11;
const LINE = lineWith(
  Array.from({ length: 91 }, (_, i) => 0.1 * (-90 + 2 * i)),
  Array.from({ length: CELLS }, (_, k) => 0.1 * (-100 + 10 * Math.floor(k / 11))),
);
const FLAT_LINE = lineWith(Array.from({ length: 91 }, () => 0), Array.from({ length: CELLS }, () => 0));

const STAND: Grandstand = { x: 0, z: 0, yaw: 0, lengthMeters: 20, rows: 10, roof: false };
const TENT: TrackProp = {
  type: 'tent',
  index: 45,
  side: 'right',
  offsetMeters: 10,
  lengthMeters: 10,
  heightMeters: 4,
  color: null,
};

const stubTexture = (): THREE.Texture => new THREE.Texture();

function styleWith(props: TrackProp[]): ResolvedTrackStyle {
  const style = structuredClone(DEFAULT_TRACK_STYLE) as ResolvedTrackStyle;
  style.props = props;
  return style;
}

function tentMesh(track: TrackDataV2): { mesh: THREE.Mesh; group: THREE.Group; dispose(): void } {
  const result = createTrackProps(track, styleWith([TENT]));
  if (!result) throw new Error('expected a props object');
  const mesh = result.group.getObjectByName('prop:tent');
  if (!(mesh instanceof THREE.Mesh)) throw new Error('missing prop:tent');
  return { mesh, group: result.group, dispose: result.dispose };
}

function geometryCounts(mesh: THREE.Mesh): { positions: number; indices: number } {
  return {
    positions: mesh.geometry.getAttribute('position').count,
    indices: mesh.geometry.getIndex()?.count ?? 0,
  };
}

describe('234 grounded stands and props edge', () => {
  it('EDGE1: createGrandstand adds standPlinth only for plinthHeight strictly above 0.1', () => {
    expect(createGrandstand(STAND, stubTexture, undefined, 0.1).getObjectByName('standPlinth')).toBeUndefined();
    const group = createGrandstand(STAND, stubTexture, undefined, 0.100001);
    const plinth = group.getObjectByName('standPlinth');
    expect(plinth).toBeInstanceOf(THREE.Mesh);
    const box = new THREE.Box3().setFromObject(plinth as THREE.Object3D);
    expect(box.min.x).toBeCloseTo(-10, 6);
    expect(box.max.x).toBeCloseTo(10, 6);
    expect(box.min.y).toBeCloseTo(-0.100001, 6);
    expect(box.max.y).toBeCloseTo(0, 6);
    expect(box.min.z).toBeCloseTo(0, 6);
    expect(box.max.z).toBeCloseTo(9, 6);
  });

  it('EDGE2: disposeGrandstand frees the standPlinth geometry exactly once', () => {
    const group = createGrandstand(STAND, stubTexture, undefined, 2.05);
    const plinth = group.getObjectByName('standPlinth');
    if (!(plinth instanceof THREE.Mesh)) throw new Error('missing standPlinth');
    const spy = vi.spyOn(plinth.geometry, 'dispose');
    disposeGrandstand(group);
    expect(spy).toHaveBeenCalledTimes(1);
    disposeGrandstand(group);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('EDGE3: groundedBase on all-equal ground keeps the 0.05 gap and no plinth', () => {
    const { baseY, plinthBottom } = groundedBase(FLAT_LINE, 0, 0, 0, grandstandFootprint(STAND));
    expect(baseY).toBeCloseTo(0, 9);
    expect(plinthBottom).toBeCloseTo(-0.05, 9);
    expect(baseY - plinthBottom).toBeCloseTo(0.05, 9);
  });

  it('EDGE4: groundedBase maps the footprint through the stand yaw', () => {
    const { baseY, plinthBottom } = groundedBase(LINE, 0, 0, Math.PI / 2, grandstandFootprint(STAND));
    expect(baseY).toBeCloseTo(0.9, 9);
    expect(plinthBottom).toBeCloseTo(-0.05, 9);
  });

  it('EDGE5: groundedBase falls back to the track plane where terrain heights are non-finite', () => {
    const nanLine = lineWith(
      Array.from({ length: 91 }, () => 5),
      Array.from({ length: CELLS }, () => NaN),
    );
    const { baseY, plinthBottom } = groundedBase(nanLine, 0, 0, 0, grandstandFootprint(STAND));
    expect(baseY).toBeCloseTo(5, 9);
    expect(plinthBottom).toBeCloseTo(4.95, 9);
  });

  it('EDGE6: a prop plinth adds one box to the merged bucket without new meshes or names', () => {
    const flat = tentMesh(FLAT_LINE);
    const flatCounts = geometryCounts(flat.mesh);
    const flatNames = flat.group.children.map((child) => child.name);
    flat.dispose();
    const ramp = tentMesh(LINE);
    const rampCounts = geometryCounts(ramp.mesh);
    expect(ramp.group.children).toHaveLength(1);
    expect(ramp.group.children.map((child) => child.name)).toEqual(flatNames);
    expect(rampCounts.positions).toBe(flatCounts.positions + 24);
    expect(rampCounts.indices).toBe(flatCounts.indices + 36);
    ramp.dispose();
  });

  it('EDGE7: a left-side prop grounds on its mirrored footprint', () => {
    const left: TrackProp = { ...TENT, side: 'left' };
    const result = createTrackProps(LINE, styleWith([left]));
    if (!result) throw new Error('expected a props object');
    const mesh = result.group.getObjectByName('prop:tent');
    if (!(mesh instanceof THREE.Mesh)) throw new Error('missing prop:tent');
    const box = new THREE.Box3().setFromObject(mesh);
    result.dispose();
    expect(box.min.y).toBeCloseTo(-0.55, 4);
    expect(box.min.x).toBeCloseTo(-5, 4);
    expect(box.max.x).toBeCloseTo(5, 4);
    expect(box.min.z).toBeCloseTo(-22, 4);
    expect(box.max.z).toBeCloseTo(-16, 4);
  });

  it('EDGE8: the footbridge keeps the centerline elevation and gains no plinth', () => {
    const bridge: TrackProp = {
      type: 'footbridge',
      index: 30,
      side: 'right',
      offsetMeters: 0,
      lengthMeters: 12,
      heightMeters: 4,
      color: null,
    };
    const result = createTrackProps(LINE, styleWith([bridge]));
    if (!result) throw new Error('expected a props object');
    const mesh = result.group.getObjectByName('prop:footbridge');
    if (!(mesh instanceof THREE.Mesh)) throw new Error('missing prop:footbridge');
    const box = new THREE.Box3().setFromObject(mesh);
    result.dispose();
    expect(box.min.y).toBeCloseTo(-3, 4);
  });

  it('EDGE9: a prop overlapping the track is still skipped with terrain present', () => {
    const overlapping: TrackProp = { ...TENT, offsetMeters: -4 };
    const result = createTrackProps(LINE, styleWith([overlapping]));
    if (!result) throw new Error('expected a props object');
    expect(result.group.userData.placed).toBe(0);
    expect(result.group.userData.skipped).toBe(1);
    expect(result.group.getObjectByName('prop:tent')).toBeUndefined();
    result.dispose();
  });

  it('EDGE10: groundedBase and createTrackProps leave the track and style unchanged', () => {
    const trackBefore = structuredClone(LINE);
    const style = styleWith([TENT]);
    const styleBefore = structuredClone(style);
    groundedBase(LINE, STAND.x, STAND.z, STAND.yaw, grandstandFootprint(STAND));
    createGrandstand(STAND, stubTexture, undefined, 2.05);
    createTrackProps(LINE, style)?.dispose();
    expect(LINE).toEqual(trackBefore);
    expect(style).toEqual(styleBefore);
  });
});
