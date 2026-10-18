import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { DebrisField } from '../../../src/physics/debris';
import { FIXED_DT } from '../../../src/core/constants';
import type { Vec3 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function loadSpec(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

describe('147 debris edge cases', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('EDGE1: spawn with non-finite position or velocity is ignored and leaves the field usable', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 1);
      field.spawn('wheel', 0, 1, { x: Number.NaN, y: 0.3, z: 0 }, ZERO);
      field.spawn('frontWing', 0, -1, { x: 0, y: 0.3, z: 0 }, { x: Infinity, y: 0, z: 0 });
      field.spawn('rearWing', 0, -1, { x: 0, y: 0.3, z: 0 }, { x: 0, y: Number.NaN, z: 0 });
      field.spawn('wheel', 0, 0, { x: 0, y: 0.3, z: Number.POSITIVE_INFINITY }, ZERO);
      expect(field.count).toBe(0);
      expect(field.getBodies()).toHaveLength(0);
      field.spawn('wheel', 0, 1, { x: 1, y: 0.3, z: 2 }, ZERO);
      expect(field.count).toBe(1);
      expect(field.getBodies()).toHaveLength(1);
    } finally {
      world.free();
    }
  });

  it('EDGE2: debris younger than 60 s is kept and removed once past 60 s', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 2);
      field.spawn('wheel', 0, 0, { x: 0, y: 0.3, z: 0 }, ZERO);
      const car: Vec3 = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < steps(59); i++) {
        field.step(FIXED_DT, [car]);
      }
      expect(field.count).toBe(1);
      for (let i = 0; i < steps(2); i++) {
        field.step(FIXED_DT, [car]);
      }
      expect(field.count).toBe(0);
    } finally {
      world.free();
    }
  });

  it('EDGE3: distance removal is strict: 300 m XZ kept, just beyond 300 m removed', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 3);
      field.spawn('wheel', 0, 0, { x: 300, y: 0.3, z: 0 }, ZERO);
      field.spawn('wheel', 0, 1, { x: 300.5, y: 0.3, z: 0 }, ZERO);
      const car: Vec3 = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < steps(0.5); i++) {
        field.step(FIXED_DT, [car]);
      }
      expect(field.count).toBe(1);
      const bodies = field.getBodies();
      expect(bodies).toHaveLength(1);
      expect(bodies[0].translation().x).toBeCloseTo(300, 3);
    } finally {
      world.free();
    }
  });

  it('EDGE4: removal needs XZ distance > 300 from every car, ignoring height', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 4);
      field.spawn('rearWing', 0, -1, { x: 0, y: 1000, z: 0 }, ZERO);
      field.spawn('rearWing', 1, -1, { x: 400, y: 0.3, z: 0 }, ZERO);
      const carA: Vec3 = { x: 0, y: 0, z: 0 };
      const carB: Vec3 = { x: 50, y: 0, z: 0 };
      for (let i = 0; i < steps(0.5); i++) {
        field.step(FIXED_DT, [carA, carB]);
      }
      expect(field.count).toBe(1);
      expect(field.getBodies()[0].translation().y).toBeGreaterThan(500);
    } finally {
      world.free();
    }
  });

  it('EDGE5: wheelHidden stays true after the debris body itself was removed', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 5);
      field.spawn('wheel', 0, 2, { x: 500, y: 0.3, z: 0 }, ZERO);
      expect(field.wheelHidden(0, 2)).toBe(true);
      const car: Vec3 = { x: 0, y: 0, z: 0 };
      field.step(FIXED_DT, [car]);
      expect(field.count).toBe(0);
      expect(field.wheelHidden(0, 2)).toBe(true);
    } finally {
      world.free();
    }
  });

  it('EDGE6: wing spawns hide no wheels; a wheel debris hides only that car/wheel', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 6);
      field.spawn('frontWing', 0, -1, { x: 0, y: 0.3, z: 0 }, ZERO);
      field.spawn('rearWing', 1, -1, { x: 5, y: 0.3, z: 0 }, ZERO);
      for (let w = 0; w < 4; w++) {
        expect(field.wheelHidden(0, w)).toBe(false);
        expect(field.wheelHidden(1, w)).toBe(false);
      }
      field.spawn('wheel', 1, 1, { x: 10, y: 0.3, z: 0 }, ZERO);
      expect(field.wheelHidden(1, 1)).toBe(true);
      expect(field.wheelHidden(0, 1)).toBe(false);
      expect(field.wheelHidden(1, 0)).toBe(false);
      expect(field.wheelHidden(1, 2)).toBe(false);
    } finally {
      world.free();
    }
  });

  it('EDGE7: angular velocity components are within ±15 rad/s and length ≤ 15', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 11);
      const seen = new Set<number>();
      const samples: Array<{ x: number; y: number; z: number }> = [];
      for (let i = 0; i < 32; i++) {
        field.spawn('wheel', 0, i % 4, { x: i, y: 0.3, z: 0 }, ZERO);
        for (const b of field.getBodies()) {
          if (seen.has(b.handle)) continue;
          seen.add(b.handle);
          const w = b.angvel();
          samples.push({ x: w.x, y: w.y, z: w.z });
        }
      }
      expect(samples.length).toBe(32);
      for (const w of samples) {
        expect(Math.abs(w.x)).toBeLessThanOrEqual(15 + 1e-6);
        expect(Math.abs(w.y)).toBeLessThanOrEqual(15 + 1e-6);
        expect(Math.abs(w.z)).toBeLessThanOrEqual(15 + 1e-6);
        expect(Math.hypot(w.x, w.y, w.z)).toBeLessThanOrEqual(15 + 1e-6);
      }
    } finally {
      world.free();
    }
  });

  it('EDGE8: the same seed yields identical angular velocities; a different seed differs', () => {
    const world = createPhysicsWorld();
    try {
      const angvelsFor = (seed: number): Array<[number, number, number]> => {
        const field = new DebrisField(world, seed);
        for (let i = 0; i < 5; i++) {
          field.spawn('wheel', 0, i % 4, { x: i * 3, y: 0.3, z: i }, ZERO);
        }
        return field
          .getBodies()
          .slice()
          .sort((a: RAPIER.RigidBody, b: RAPIER.RigidBody) => a.handle - b.handle)
          .map((b: RAPIER.RigidBody) => {
            const w = b.angvel();
            return [w.x, w.y, w.z] as [number, number, number];
          });
      };
      const a = angvelsFor(42);
      const b = angvelsFor(42);
      const c = angvelsFor(43);
      expect(a).toHaveLength(5);
      expect(b).toHaveLength(5);
      expect(c).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(a[i][0]).toBeCloseTo(b[i][0], 9);
        expect(a[i][1]).toBeCloseTo(b[i][1], 9);
        expect(a[i][2]).toBeCloseTo(b[i][2], 9);
      }
      const anyDiffers = a.some(
        (wa, i) =>
          Math.abs(wa[0] - c[i][0]) > 1e-6 ||
          Math.abs(wa[1] - c[i][1]) > 1e-6 ||
          Math.abs(wa[2] - c[i][2]) > 1e-6,
      );
      expect(anyDiffers).toBe(true);
    } finally {
      world.free();
    }
  });

  it('EDGE9: wheel is a cylinder of spec radius/width and masses match 12/6/5 kg', () => {
    const spec = loadSpec();
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 9);
      field.spawn('wheel', 0, 0, { x: 0, y: spec.wheels.radius, z: 0 }, ZERO);
      field.spawn('frontWing', 0, -1, { x: 4, y: 0.3, z: 0 }, ZERO);
      field.spawn('rearWing', 0, -1, { x: 8, y: 0.3, z: 0 }, ZERO);
      const byX = (x: number) => {
        const b = field
          .getBodies()
          .find((bd: RAPIER.RigidBody) => Math.abs(bd.translation().x - x) < 1e-6);
        if (!b) throw new Error(`debris at x=${x} missing`);
        return b.collider();
      };
      const wheel = byX(0);
      const front = byX(4);
      const rear = byX(8);
      expect(wheel.mass()).toBeCloseTo(12, 3);
      expect(wheel.radius()).toBeCloseTo(spec.wheels.radius, 4);
      expect(wheel.halfHeight()).toBeCloseTo(0.15, 4);
      expect(front.mass()).toBeCloseTo(6, 3);
      expect(rear.mass()).toBeCloseTo(5, 3);
      const he = rear.halfExtents();
      expect(he).not.toBeNull();
      if (!he) throw new Error('rear wing collider must be a cuboid');
      expect(he.x).toBeCloseTo(0.5, 4);
      expect(he.y).toBeCloseTo(0.15, 4);
      expect(he.z).toBeCloseTo(0.15, 4);
    } finally {
      world.free();
    }
  });

  it('EDGE10: the overflow spawn deletes the oldest body from the Rapier world', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 10);
      const base = world.bodies.len();
      for (let i = 0; i < 8; i++) {
        field.spawn('wheel', 0, i % 4, { x: i * 10, y: 0.3, z: 0 }, ZERO);
      }
      expect(field.count).toBe(8);
      expect(world.bodies.len()).toBe(base + 8);
      const oldest = field
        .getBodies()
        .find((b: RAPIER.RigidBody) => Math.abs(b.translation().x) < 1e-6);
      if (!oldest) throw new Error('first-spawned debris still alive before overflow');
      const oldestHandle = oldest.handle;
      const oldestX = oldest.translation().x;
      field.spawn('frontWing', 0, -1, { x: 90, y: 0.3, z: 0 }, ZERO);
      expect(field.count).toBe(8);
      expect(world.bodies.len()).toBe(base + 8);
      expect(world.getRigidBody(oldestHandle)).toBeFalsy();
      const xs = field.getBodies().map((b: RAPIER.RigidBody) => b.translation().x);
      expect(xs).not.toContain(oldestX);
      expect(xs).toContain(90);
    } finally {
      world.free();
    }
  });
});
