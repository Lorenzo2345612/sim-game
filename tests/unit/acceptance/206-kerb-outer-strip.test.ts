import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2, TrackSegment } from '../../../src/core/types';
import { KERB_WIDTH } from '../../../src/core/constants';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
import { createKerbOuterStrips } from '../../../src/render/kerbOuterStrip';
import { fixture } from './022-fixture-trackdatav2';

const STRAIGHT: TrackDataV2 = {
  ...fixture,
  centerline: Array.from({ length: 100 }, (_, i): [number, number] => [i * 10, 0]),
  lengthMeters: 990,
  officialLengthMeters: 990,
  widthMeters: 12,
  elevation: Array.from({ length: 100 }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  grandstands: [],
  pit: { start: 10, end: 30, side: 'right' },
};

const KERB_LEFT: TrackSegment = { start: 0, end: 20, side: 'left' };
const KERB_RIGHT: TrackSegment = { start: 40, end: 60, side: 'right' };

function styleOf(raw: Record<string, unknown>): ResolvedTrackStyle {
  return parseTrackStyle({ version: 1, ...raw }, 100).style;
}

function withKerbs(kerbs: TrackSegment[], elevation?: number[]): TrackDataV2 {
  return { ...STRAIGHT, kerbs, elevation: elevation ?? Array.from({ length: 100 }, () => 0) };
}

function meshesOf(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
}

function hexOf(mesh: THREE.Mesh): string {
  return `#${(mesh.material as THREE.MeshStandardMaterial).color.getHexString()}`;
}

function positions(mesh: THREE.Mesh): THREE.BufferAttribute {
  return mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
}

describe('206 kerb outer strip', () => {
  it('AT1: null outerStrip with no range returns null', () => {
    expect(createKerbOuterStrips(withKerbs([KERB_LEFT]), DEFAULT_TRACK_STYLE)).toBeNull();
  });

  it('AT2: a left kerb with a green outer strip builds one mesh inside the lateral band', () => {
    const style = styleOf({ kerbs: { outerStrip: '#2e8b57' } });
    const result = createKerbOuterStrips(withKerbs([KERB_LEFT]), style);
    expect(result).not.toBeNull();
    const meshes = meshesOf(result!.group);
    expect(meshes.map((m) => m.name)).toEqual(['kerbOuterStrip']);
    expect(hexOf(meshes[0])).toBe('#2e8b57');
    const pos = positions(meshes[0]);
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      expect(z).toBeGreaterThanOrEqual(-(6 + KERB_WIDTH + 0.6) - 0.01);
      expect(z).toBeLessThanOrEqual(-(6 + KERB_WIDTH) + 0.01);
      const x = pos.getX(i);
      expect(x).toBeGreaterThanOrEqual(0 - 0.01);
      expect(x).toBeLessThanOrEqual(200 + 0.01);
    }
    expect(meshes[0].userData.meters).toBeGreaterThanOrEqual(200 - 1);
    expect(meshes[0].userData.meters).toBeLessThanOrEqual(200 + 1);
  });

  it('AT3: a range overrides the right kerb colour into a second mesh', () => {
    const style = styleOf({
      kerbs: {
        outerStrip: '#2e8b57',
        ranges: [{ start: 35, end: 70, side: 'right', outerStrip: '#1f4fbf' }],
      },
    });
    const result = createKerbOuterStrips(withKerbs([KERB_LEFT, KERB_RIGHT]), style);
    expect(result).not.toBeNull();
    const meshes = meshesOf(result!.group);
    expect(meshes.map((m) => m.name)).toEqual(['kerbOuterStrip', 'kerbOuterStrip:1']);
    const [first, second] = meshes;
    expect(hexOf(first)).toBe('#2e8b57');
    expect(hexOf(second)).toBe('#1f4fbf');
    const firstPos = positions(first);
    const secondPos = positions(second);
    for (let i = 0; i < firstPos.count; i++) {
      expect(firstPos.getX(i)).toBeGreaterThanOrEqual(0 - 0.01);
      expect(firstPos.getX(i)).toBeLessThanOrEqual(200 + 0.01);
      expect(firstPos.getZ(i)).toBeLessThan(0);
    }
    for (let i = 0; i < secondPos.count; i++) {
      expect(secondPos.getX(i)).toBeGreaterThanOrEqual(400 - 0.01);
      expect(secondPos.getX(i)).toBeLessThanOrEqual(600 + 0.01);
      expect(secondPos.getZ(i)).toBeGreaterThan(0);
    }
  });

  it('AT4: only the range-coloured right strip exists when the global colour is null', () => {
    const style = styleOf({
      kerbs: { ranges: [{ start: 35, end: 70, side: 'right', outerStrip: '#1f4fbf' }] },
    });
    const result = createKerbOuterStrips(withKerbs([KERB_LEFT, KERB_RIGHT]), style);
    expect(result).not.toBeNull();
    const meshes = meshesOf(result!.group);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].name).toBe('kerbOuterStrip');
    expect(meshes[0].userData.meters).toBeGreaterThanOrEqual(200 - 1);
    expect(meshes[0].userData.meters).toBeLessThanOrEqual(200 + 1);
  });

  it('AT5: vertices sit on elevation + kerb height', () => {
    const style = styleOf({ kerbs: { outerStrip: '#2e8b57' } });
    const result = createKerbOuterStrips(
      withKerbs([KERB_LEFT], Array.from({ length: 100 }, () => 2)),
      style,
    );
    expect(result).not.toBeNull();
    const pos = positions(meshesOf(result!.group)[0]);
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeGreaterThanOrEqual(2);
      expect(pos.getY(i)).toBeLessThanOrEqual(2.1);
    }
  });

  it('AT6: dispose disposes every geometry and material and is idempotent', () => {
    const style = styleOf({ kerbs: { outerStrip: '#2e8b57' } });
    const result = createKerbOuterStrips(withKerbs([KERB_LEFT]), style);
    expect(result).not.toBeNull();
    const meshes = meshesOf(result!.group);
    expect(meshes.length).toBeGreaterThan(0);
    const geometries = meshes.map((m) => m.geometry);
    const materials = meshes.map((m) => m.material as THREE.Material);
    const spies = [...geometries, ...materials].map((r) => vi.spyOn(r, 'dispose'));
    result!.dispose();
    result!.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
