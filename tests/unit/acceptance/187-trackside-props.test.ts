import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2 } from '../../../src/core/types';
import { createTrackProps } from '../../../src/render/trackProps';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle, type TrackProp } from '../../../src/track/trackStyle';
import { fixture } from './022-fixture-trackdatav2';

const POINTS = 100;

const STRAIGHT: TrackDataV2 = {
  ...fixture,
  widthMeters: 12,
  centerline: Array.from({ length: POINTS }, (_, i): [number, number] => [i * 10, 0]),
  lengthMeters: 990,
  elevation: Array.from({ length: POINTS }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 10, end: 30, side: 'right' },
};

const HAIRPIN_CENTERLINE: [number, number][] = [];
for (let i = 0; i <= 10; i++) HAIRPIN_CENTERLINE.push([i * 10, 0]);
for (let k = 1; k <= 11; k++) {
  const a = (k * Math.PI) / 12;
  HAIRPIN_CENTERLINE.push([100 + 6 * Math.sin(a), -6 + 6 * Math.cos(a)]);
}
HAIRPIN_CENTERLINE.push([100, -12]);
for (let i = 9; i >= 0; i--) HAIRPIN_CENTERLINE.push([i * 10, -12]);

const HAIRPIN: TrackDataV2 = {
  ...fixture,
  id: 'hairpin',
  widthMeters: 12,
  centerline: HAIRPIN_CENTERLINE,
  lengthMeters: 990,
  elevation: HAIRPIN_CENTERLINE.map(() => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 10, end: 30, side: 'right' },
};

function styleWith(props: TrackProp[]): ResolvedTrackStyle {
  const style = structuredClone(DEFAULT_TRACK_STYLE) as ResolvedTrackStyle;
  style.props = props;
  return style;
}

function prop(p: Partial<TrackProp> & Pick<TrackProp, 'type'>): TrackProp {
  return { index: 0, side: 'left', offsetMeters: 10, lengthMeters: 10, heightMeters: 4, color: null, ...p };
}

function build(track: TrackDataV2, props: TrackProp[]): { group: THREE.Group; dispose(): void } {
  const result = createTrackProps(track, styleWith(props));
  if (!result) throw new Error('expected a props object');
  return result;
}

function one(group: THREE.Group, name: string): THREE.Mesh {
  const found: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) found.push(o);
  });
  if (found.length !== 1) throw new Error(`expected one mesh ${name}, got ${found.length}`);
  return found[0];
}

function worldBox(mesh: THREE.Mesh): THREE.Box3 {
  mesh.updateWorldMatrix(true, false);
  return new THREE.Box3().setFromObject(mesh);
}

function hex(mesh: THREE.Mesh): string {
  return `#${(mesh.material as THREE.MeshStandardMaterial).color.getHexString()}`;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
}

// Lowest y of any triangle whose z range overlaps the asphalt strip: the deck
// crossing the track has no vertices over the asphalt, only faces spanning it.
function minYOverAsphalt(mesh: THREE.Mesh, halfWidth: number): number {
  const pos = mesh.geometry.getAttribute('position');
  const m = mesh.matrixWorld;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i).applyMatrix4(m);
    b.fromBufferAttribute(pos, i + 1).applyMatrix4(m);
    c.fromBufferAttribute(pos, i + 2).applyMatrix4(m);
    const zMin = Math.min(a.z, b.z, c.z);
    const zMax = Math.max(a.z, b.z, c.z);
    if (zMin < halfWidth && zMax > -halfWidth) min = Math.min(min, a.y, b.y, c.y);
  }
  return min;
}

function isPlainColourMap(map: THREE.Texture): boolean {
  const img = map.image as { data?: Uint8Array | Uint8ClampedArray; width?: number; height?: number } | null | undefined;
  if (!img?.data || !img.width || !img.height) return false;
  const d = img.data;
  for (let i = 4; i < d.length; i += 4) {
    if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) return false;
  }
  return true;
}

function minDistanceToCenterline(track: TrackDataV2, x: number, z: number): number {
  let min = Infinity;
  for (const p of track.centerline) min = Math.min(min, Math.hypot(p[0] - x, p[1] - z));
  return min;
}

describe('187 trackside props acceptance', () => {
  it('AT1: empty props returns null', () => {
    expect(createTrackProps(STRAIGHT, DEFAULT_TRACK_STYLE)).toBeNull();
    expect(createTrackProps(STRAIGHT, styleWith([]))).toBeNull();
  });

  it('AT2: a footbridge spans the track with its deck clear above it, in the style colour', () => {
    const result = build(STRAIGHT, [prop({ type: 'footbridge', index: 50, lengthMeters: 30, heightMeters: 6, color: '#2e8b57' })]);
    const bridge = one(result.group, 'prop:footbridge');
    const b = worldBox(bridge);
    expect(b.min.z).toBeLessThan(-6);
    expect(b.max.z).toBeGreaterThan(6);
    expect((b.min.x + b.max.x) / 2).toBeGreaterThanOrEqual(499);
    expect((b.min.x + b.max.x) / 2).toBeLessThanOrEqual(501);
    expect(minYOverAsphalt(bridge, STRAIGHT.widthMeters / 2)).toBeGreaterThanOrEqual(5.5);
    expect(hex(bridge)).toBe('#2e8b57');
    result.dispose();
  });

  it('AT3: a marshal post stands outside the right edge, offset 8 from it', () => {
    const result = build(STRAIGHT, [prop({ type: 'marshalPost', index: 20, side: 'right', offsetMeters: 8 })]);
    const b = worldBox(one(result.group, 'prop:marshalPost'));
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    expect(cx).toBeGreaterThanOrEqual(199);
    expect(cx).toBeLessThanOrEqual(201);
    expect(cz).toBeGreaterThanOrEqual(13);
    expect(cz).toBeLessThanOrEqual(17);
    result.dispose();
  });

  it('AT4: every roadside prop has a named child whose footprint stays off the asphalt', () => {
    const result = build(STRAIGHT, [
      prop({ type: 'tent', index: 20 }),
      prop({ type: 'scoreboard', index: 40 }),
      prop({ type: 'billboardRow', index: 60 }),
      prop({ type: 'tower', index: 80 }),
    ]);
    const half = STRAIGHT.widthMeters / 2;
    for (const name of ['prop:tent', 'prop:scoreboard', 'prop:billboardRow', 'prop:tower']) {
      const b = worldBox(one(result.group, name));
      for (const x of [b.min.x, b.max.x]) {
        for (const z of [b.min.z, b.max.z]) {
          expect(minDistanceToCenterline(STRAIGHT, x, z)).toBeGreaterThanOrEqual(half);
        }
      }
    }
    result.dispose();
  });

  it('AT5: a 40 m billboard row carries no text texture', () => {
    const result = build(STRAIGHT, [prop({ type: 'billboardRow', index: 30, lengthMeters: 40 })]);
    const board = one(result.group, 'prop:billboardRow');
    for (const mat of materialsOf(board)) {
      const map = (mat as THREE.MeshStandardMaterial).map;
      expect(map === undefined || map === null || isPlainColourMap(map)).toBe(true);
    }
    result.dispose();
  });

  it('AT6: a prop whose offset lands on the other hairpin leg is skipped and counted', () => {
    const result = createTrackProps(HAIRPIN, styleWith([prop({ type: 'tent', index: 27, side: 'left', offsetMeters: 10 })]));
    expect(result).not.toBeNull();
    if (!result) throw new Error('expected a props object');
    expect(result.group.userData.skipped).toBe(1);
    expect(result.group.getObjectByName('prop:tent')).toBeUndefined();
    result.dispose();
  });

  it('AT7: 60 props in 3 types x 2 colours merge into at most 12 draw objects', () => {
    const props: TrackProp[] = [];
    for (let i = 0; i < 20; i++) props.push(prop({ type: 'tent', index: i, color: i % 2 === 0 ? '#33aa33' : '#aa3333' }));
    for (let i = 0; i < 20; i++) props.push(prop({ type: 'marshalPost', index: 20 + i, color: i % 2 === 0 ? '#aaaa33' : '#3333aa' }));
    for (let i = 0; i < 20; i++) props.push(prop({ type: 'billboardRow', index: 40 + i, color: i % 2 === 0 ? '#33aaaa' : '#aa33aa' }));
    const result = build(STRAIGHT, props);
    expect(result.group.userData.placed).toBe(60);
    let draw = 0;
    result.group.traverse((o) => {
      if (o instanceof THREE.Mesh) draw += 1;
    });
    expect(draw).toBeLessThanOrEqual(12);
    result.dispose();
  });

  it('AT8: dispose disposes every geometry and material', () => {
    const result = build(STRAIGHT, [
      prop({ type: 'tent', index: 20 }),
      prop({ type: 'footbridge', index: 50, heightMeters: 6 }),
      prop({ type: 'billboardRow', index: 70 }),
    ]);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    result.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      for (const m of materialsOf(o)) materials.add(m);
    });
    const spies = [...geometries, ...materials].map((r) => vi.spyOn(r, 'dispose'));
    expect(spies.length).toBeGreaterThan(0);
    expect(() => result.dispose()).not.toThrow();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
