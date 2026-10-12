import { describe, it, expect } from 'vitest';
import {
  createVehicleState,
  interpolateVehicleState,
  lerpVec3,
  slerpQuat,
} from '../../../src/core/interpolation';
import type { Quat, VehicleState, Vec3, WheelState } from '../../../src/core/types';

function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function wheel(
  x: number,
  y: number,
  z: number,
  steering: number,
  rotation: number,
  inContact: boolean,
): WheelState {
  return { position: vec(x, y, z), steering, rotation, inContact };
}

function sampleStates(): [VehicleState, VehicleState] {
  const prev: VehicleState = {
    position: vec(1, 2, 3),
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    forwardSpeed: 4,
    wheels: [
      wheel(0.8, 0.3, -1.4, 0.1, 2.5, true),
      wheel(-0.8, 0.3, -1.4, -0.1, 3.5, false),
      wheel(0.8, 0.3, 1.4, 0.2, 4.5, true),
      wheel(-0.8, 0.3, 1.4, -0.2, 5.5, false),
    ],
  };
  const curr: VehicleState = {
    position: vec(5, 7, -2),
    rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    forwardSpeed: 10,
    wheels: [
      wheel(4.8, 0.4, -2.4, 0.3, 12.5, false),
      wheel(3.2, 0.4, -2.4, -0.3, 13.5, true),
      wheel(4.8, 0.4, 0.4, 0.4, 14.5, false),
      wheel(3.2, 0.4, 0.4, -0.4, 15.5, true),
    ],
  };
  return [prev, curr];
}

describe('interpolation', () => {
  it('interpolateVehicleState returns prev at t=0', () => {
    const [prev, curr] = sampleStates();
    const out = interpolateVehicleState(prev, curr, 0, createVehicleState(4));
    expect(out.position.x).toBeCloseTo(prev.position.x, 9);
    expect(out.position.y).toBeCloseTo(prev.position.y, 9);
    expect(out.position.z).toBeCloseTo(prev.position.z, 9);
    expect(out.forwardSpeed).toBeCloseTo(prev.forwardSpeed, 9);
    for (let i = 0; i < 4; i++) {
      expect(out.wheels[i].position.x).toBeCloseTo(prev.wheels[i].position.x, 9);
      expect(out.wheels[i].position.y).toBeCloseTo(prev.wheels[i].position.y, 9);
      expect(out.wheels[i].position.z).toBeCloseTo(prev.wheels[i].position.z, 9);
      expect(out.wheels[i].steering).toBeCloseTo(prev.wheels[i].steering, 9);
      expect(out.wheels[i].rotation).toBeCloseTo(prev.wheels[i].rotation, 9);
    }
    expect(out.rotation.x).toBeCloseTo(prev.rotation.x, 9);
    expect(out.rotation.y).toBeCloseTo(prev.rotation.y, 9);
    expect(out.rotation.z).toBeCloseTo(prev.rotation.z, 9);
    expect(out.rotation.w).toBeCloseTo(prev.rotation.w, 9);
  });

  it('interpolateVehicleState returns curr at t=1', () => {
    const [prev, curr] = sampleStates();
    const out = interpolateVehicleState(prev, curr, 1, createVehicleState(4));
    expect(out.position.x).toBeCloseTo(curr.position.x, 9);
    expect(out.position.y).toBeCloseTo(curr.position.y, 9);
    expect(out.position.z).toBeCloseTo(curr.position.z, 9);
    expect(out.forwardSpeed).toBeCloseTo(curr.forwardSpeed, 9);
    for (let i = 0; i < 4; i++) {
      expect(out.wheels[i].position.x).toBeCloseTo(curr.wheels[i].position.x, 9);
      expect(out.wheels[i].position.y).toBeCloseTo(curr.wheels[i].position.y, 9);
      expect(out.wheels[i].position.z).toBeCloseTo(curr.wheels[i].position.z, 9);
      expect(out.wheels[i].steering).toBeCloseTo(curr.wheels[i].steering, 9);
      expect(out.wheels[i].rotation).toBeCloseTo(curr.wheels[i].rotation, 9);
    }
  });

  it('interpolateVehicleState returns the position midpoint at t=0.5', () => {
    const [prev, curr] = sampleStates();
    const out = interpolateVehicleState(prev, curr, 0.5, createVehicleState(4));
    expect(out.position.x).toBeCloseTo((prev.position.x + curr.position.x) / 2, 9);
    expect(out.position.y).toBeCloseTo((prev.position.y + curr.position.y) / 2, 9);
    expect(out.position.z).toBeCloseTo((prev.position.z + curr.position.z) / 2, 9);
  });

  it('interpolateVehicleState takes inContact from curr', () => {
    const [prev, curr] = sampleStates();
    for (const t of [0, 0.5, 1]) {
      const out = interpolateVehicleState(prev, curr, t, createVehicleState(4));
      for (let i = 0; i < 4; i++) {
        expect(out.wheels[i].inContact).toBe(curr.wheels[i].inContact);
        expect(curr.wheels[i].inContact).not.toBe(prev.wheels[i].inContact);
      }
    }
  });

  it('slerpQuat output is normalized', () => {
    const a: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const b: Quat = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    const out: Quat = { x: 0, y: 0, z: 0, w: 0 };
    slerpQuat(a, b, 0.3, out);
    expect(Math.hypot(out.x, out.y, out.z, out.w)).toBeCloseTo(1, 6);
  });

  it('slerpQuat takes the short path for opposite quaternions', () => {
    const out: Quat = { x: 0, y: 0, z: 0, w: 0 };

    slerpQuat({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0, w: -1 }, 0.5, out);
    expect(Math.abs(out.w)).toBeCloseTo(1, 9);
    expect(Math.hypot(out.x, out.y, out.z, out.w)).toBeCloseTo(1, 9);

    const q: Quat = { x: 0, y: Math.sin(Math.PI / 6), z: 0, w: Math.cos(Math.PI / 6) };
    const neg: Quat = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
    slerpQuat(q, neg, 0.5, out);
    const len = Math.hypot(out.x, out.y, out.z, out.w);
    expect(Math.abs(len - 1)).toBeLessThanOrEqual(1e-9);
    const same = Math.hypot(out.x - q.x, out.y - q.y, out.z - q.z, out.w - q.w);
    const flipped = Math.hypot(out.x + q.x, out.y + q.y, out.z + q.z, out.w + q.w);
    expect(Math.min(same, flipped)).toBeLessThanOrEqual(1e-9);
  });

  it('lerpVec3 returns the midpoint at t=0.5', () => {
    const out = lerpVec3(vec(1, -2, 3), vec(-4, 5, 0.5), 0.5, vec(0, 0, 0));
    expect(out.x).toBeCloseTo(-1.5, 12);
    expect(out.y).toBeCloseTo(1.5, 12);
    expect(out.z).toBeCloseTo(1.75, 12);
  });
});
