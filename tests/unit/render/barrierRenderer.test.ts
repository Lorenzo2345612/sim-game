import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const POINTS = 60;

function circleTrack(barriers: BarrierSegment[]): TrackDataV2 {
  return {
    ...fixture,
    centerline: Array.from({ length: POINTS }, (_, i): [number, number] => {
      const a = (i / POINTS) * Math.PI * 2;
      return [Math.sin(a) * 50, -Math.cos(a) * 50];
    }),
    lengthMeters: 314,
    elevation: Array.from({ length: POINTS }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers,
  };
}

function allFinite(group: THREE.Group): boolean {
  let finite = true;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    for (let i = 0; i < position.array.length; i++) {
      if (!Number.isFinite(position.array[i])) finite = false;
    }
  });
  return finite;
}

describe('barrierRenderer edge cases', () => {
  it('no barriers gives an empty group', () => {
    const { group } = createBarrierObject(circleTrack([]));
    expect(group.children).toHaveLength(0);
  });

  it('a type without segments creates no mesh', () => {
    const { group } = createBarrierObject(
      circleTrack([{ start: 5, end: 15, side: 'right', type: 'armco', offsetMeters: 10 }]),
    );
    expect(group.children.map((c) => c.name).sort()).toEqual(['armco', 'armcoPosts']);
  });

  it('a wrapped segment (end < start) produces finite positions', () => {
    const { group } = createBarrierObject(
      circleTrack([{ start: 50, end: 10, side: 'right', type: 'wall', offsetMeters: 12 }]),
    );
    expect(group.children).toHaveLength(1);
    expect(allFinite(group)).toBe(true);
  });

  it('right and left sides are on opposite sides of the centerline', () => {
    const { group } = createBarrierObject(
      circleTrack([
        { start: 5, end: 25, side: 'right', type: 'wall', offsetMeters: 12 },
        { start: 5, end: 25, side: 'left', type: 'wall', offsetMeters: 12 },
      ]),
    );
    const wall = group.children[0] as THREE.Mesh;
    const position = wall.geometry.getAttribute('position');
    const radii: number[] = [];
    for (let i = 0; i < position.count; i++) {
      radii.push(Math.hypot(position.getX(i), position.getZ(i)));
    }
    // Centerline is a circle of radius 50 at the origin: the two walls sit near 38 and 62.
    expect(Math.min(...radii)).toBeLessThan(45);
    expect(Math.max(...radii)).toBeGreaterThan(55);
  });

  it('second dispose() does not throw', () => {
    const { dispose } = createBarrierObject(
      circleTrack([{ start: 5, end: 15, side: 'right', type: 'tyres', offsetMeters: 8 }]),
    );
    dispose();
    expect(() => dispose()).not.toThrow();
  });
});
