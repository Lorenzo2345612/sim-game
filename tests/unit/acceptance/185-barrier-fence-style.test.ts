import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
import { createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { fixture } from './022-fixture-trackdatav2';

const POINTS = 100;
const BARRIERS: BarrierSegment[] = [
  { start: 0, end: 20, side: 'left', type: 'armco', offsetMeters: 8 },
  { start: 30, end: 50, side: 'left', type: 'wall', offsetMeters: 8 },
  { start: 60, end: 80, side: 'right', type: 'tyres', offsetMeters: 8 },
  { start: 85, end: 95, side: 'right', type: 'foam', offsetMeters: 8 },
];

const track: TrackDataV2 = {
  ...fixture,
  widthMeters: 12,
  centerline: Array.from({ length: POINTS }, (_, i): [number, number] => [i * 10, 0]),
  lengthMeters: 990,
  elevation: Array.from({ length: POINTS }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: BARRIERS,
  pit: { start: 10, end: 30, side: 'right' },
};

function stubTexture(url: string): THREE.Texture {
  const texture = new THREE.Texture();
  texture.name = url;
  return texture;
}

function styleWith(patch: (barriers: ResolvedTrackStyle['barriers']) => void): ResolvedTrackStyle {
  const style = structuredClone(DEFAULT_TRACK_STYLE) as ResolvedTrackStyle;
  patch(style.barriers);
  return style;
}

function build(style?: ResolvedTrackStyle): ReturnType<typeof createBarrierObject> {
  return createBarrierObject(track, stubTexture, style);
}

function mesh(group: THREE.Group, name: string): THREE.Mesh {
  const found = group.getObjectByName(name);
  if (!(found instanceof THREE.Mesh)) throw new Error(`missing mesh ${name}`);
  return found;
}

function box(m: THREE.Mesh): THREE.Box3 {
  m.geometry.computeBoundingBox();
  const b = m.geometry.boundingBox;
  if (!b) throw new Error('missing bounding box');
  return b;
}

function hex(m: THREE.Mesh): string {
  return `#${(m.material as THREE.MeshStandardMaterial).color.getHexString()}`;
}

function fenceMeters(group: THREE.Group): number {
  return group.userData.fenceMeters as number;
}

function foamMeshes(group: THREE.Group): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh && o.name.startsWith('foam')) out.push(o);
  });
  return out;
}

function summary(group: THREE.Group): string[] {
  const out: string[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const material = o.material as THREE.MeshStandardMaterial;
    const count = o instanceof THREE.InstancedMesh ? o.count : 0;
    out.push(`${o.name}|${count}|${material.color.getHexString()}|${o.geometry.getAttribute('position').count}`);
  });
  return out;
}

describe('185 barrier fence style acceptance', () => {
  it('AT1: default style keeps a 3 m fence on armco only, 200 m long', () => {
    const { group, dispose } = build(DEFAULT_TRACK_STYLE);
    const fence = mesh(group, 'fence');
    expect(fenceMeters(group)).toBeGreaterThan(190);
    expect(fenceMeters(group)).toBeLessThan(210);
    const b = box(fence);
    expect(b.max.y - b.min.y).toBeCloseTo(3, 2);
    dispose();
  });

  it('AT2: fence 5 m on armco and wall gives 400 m with top 5 m above base', () => {
    const { group, dispose } = build(
      styleWith((b) => {
        b.fence.heightMeters = 5;
        b.fence.types = ['armco', 'wall'];
      }),
    );
    expect(Math.abs(fenceMeters(group) - 400)).toBeLessThanOrEqual(10);
    const b = box(mesh(group, 'fence'));
    expect(b.max.y - b.min.y).toBeCloseTo(5, 2);
    dispose();
  });

  it('AT3: fence height 0 creates no fence mesh and 0 metres', () => {
    const { group, dispose } = build(
      styleWith((b) => {
        b.fence.heightMeters = 0;
      }),
    );
    expect(group.getObjectByName('fence')).toBeUndefined();
    expect(fenceMeters(group)).toBe(0);
    dispose();
  });

  it('AT4: range gives the tyres segment a 4 m fence on top of the armco fence', () => {
    const { group, dispose } = build(
      styleWith((b) => {
        b.ranges = [{ start: 60, end: 80, side: 'right', fenceHeightMeters: 4 }];
      }),
    );
    expect(Math.abs(fenceMeters(group) - 400)).toBeLessThanOrEqual(10);
    dispose();
  });

  it('AT5: range with fence height 0 removes the armco fence', () => {
    const { group, dispose } = build(
      styleWith((b) => {
        b.ranges = [{ start: 0, end: 20, side: 'left', fenceHeightMeters: 0 }];
      }),
    );
    expect(fenceMeters(group)).toBe(0);
    dispose();
  });

  it('AT6: fence colour comes from the style', () => {
    const { group, dispose } = build(
      styleWith((b) => {
        b.fence.color = '#2e8b57';
      }),
    );
    expect(hex(mesh(group, 'fence'))).toBe('#2e8b57');
    dispose();
  });

  it('AT7: concrete colour and a 0.3 m wall band along the 200 m wall only', () => {
    const { group, dispose } = build(
      styleWith((b) => {
        b.concrete.color = '#dadada';
        b.concrete.bandColor = '#dac400';
      }),
    );
    expect(hex(mesh(group, 'wall'))).toBe('#dadada');
    const band = mesh(group, 'wallBand');
    expect(hex(band)).toBe('#dac400');
    const b = box(band);
    expect(Math.abs(b.max.y - b.min.y - 0.3)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(b.max.x - b.min.x - 200)).toBeLessThanOrEqual(1);
    dispose();
  });

  it('AT8: armco colour comes from the style', () => {
    const { group, dispose } = build(
      styleWith((b) => {
        b.armco.color = '#9aa0a6';
      }),
    );
    expect(hex(mesh(group, 'armco'))).toBe('#9aa0a6');
    dispose();
  });

  it('AT9: tyre instances alternate the existing white with the belt colour', () => {
    const { group, dispose } = build(
      styleWith((b) => {
        b.tyres.beltColor = '#1f4fbf';
      }),
    );
    const tyres = group.getObjectByName('tyres');
    if (!(tyres instanceof THREE.InstancedMesh)) throw new Error('tyres is not an InstancedMesh');
    const expectedA = new THREE.Color(0.9, 0.9, 0.9);
    const expectedB = new THREE.Color('#1f4fbf');
    const c = new THREE.Color();
    expect(tyres.count).toBeGreaterThan(1);
    for (let i = 0; i < tyres.count; i++) {
      tyres.getColorAt(i, c);
      const expected = i % 2 === 0 ? expectedA : expectedB;
      expect(Math.abs(c.r - expected.r)).toBeLessThan(1e-3);
      expect(Math.abs(c.g - expected.g)).toBeLessThan(1e-3);
      expect(Math.abs(c.b - expected.b)).toBeLessThan(1e-3);
    }
    dispose();
  });

  it('AT10: foam blocks use only the two style colours, both present', () => {
    const { group, dispose } = build(
      styleWith((b) => {
        b.foam.colors = ['#d0432d', '#dadada'];
      }),
    );
    const colours = foamMeshes(group).map((m) => hex(m));
    expect(colours.sort()).toEqual(['#d0432d', '#dadada']);
    dispose();
  });

  it('AT11: default style output equals the output without a style', () => {
    const withStyle = build(DEFAULT_TRACK_STYLE);
    const without = build();
    expect(summary(withStyle.group)).toEqual(summary(without.group));
    expect(withStyle.foamBlocks).toBe(without.foamBlocks);
    expect(fenceMeters(withStyle.group)).toBeCloseTo(fenceMeters(without.group), 6);
    withStyle.dispose();
    without.dispose();
  });

  describe('AT12', () => {
    beforeAll(async () => {
      await initPhysics();
    });

    it('barrier colliders are identical before and after any style', () => {
      const before = createPhysicsWorld(track).colliders.len();
      const { dispose } = build(
        styleWith((b) => {
          b.fence.heightMeters = 8;
          b.concrete.bandColor = '#dac400';
        }),
      );
      const after = createPhysicsWorld(track).colliders.len();
      expect(after).toBe(before);
      dispose();
    });
  });
});
