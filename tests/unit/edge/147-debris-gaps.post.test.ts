import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { DebrisField } from '../../../src/physics/debris';
import { FIXED_DT } from '../../../src/core/constants';
import type { Vec3 } from '../../../src/core/types';

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const CAR: Vec3 = { x: 0, y: 0, z: 0 };

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

describe('147 debris post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST1: dispose() empties the field and frees every body from the Rapier world', () => {
    const world = createPhysicsWorld();
    try {
      const base = world.bodies.len();
      const field = new DebrisField(world, 1);
      for (let i = 0; i < 3; i++) {
        field.spawn('wheel', 0, i, { x: i * 4, y: 0.3, z: 0 }, ZERO);
      }
      expect(world.bodies.len()).toBe(base + 3);
      field.dispose();
      expect(field.count).toBe(0);
      expect(field.getBodies()).toHaveLength(0);
      expect(world.bodies.len()).toBe(base);
    } finally {
      world.free();
    }
  });

  it('POST2: step with zero, negative or NaN dt does not age the debris', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 2);
      field.spawn('wheel', 0, 0, { x: 0, y: 0.3, z: 0 }, ZERO);
      for (let i = 0; i < 10; i++) {
        field.step(0, [CAR]);
        field.step(-1, [CAR]);
        field.step(Number.NaN, [CAR]);
      }
      expect(field.count).toBe(1);
      for (let i = 0; i < steps(61); i++) field.step(FIXED_DT, [CAR]);
      expect(field.count).toBe(0);
    } finally {
      world.free();
    }
  });

  it('POST3: lifetime uses strict age > 60 s, so one 60 s step keeps and the next tick removes', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 3);
      field.spawn('rearWing', 0, -1, { x: 1, y: 0.3, z: 1 }, ZERO);
      field.step(60, [CAR]);
      expect(field.count).toBe(1);
      field.step(1e-6, [CAR]);
      expect(field.count).toBe(0);
    } finally {
      world.free();
    }
  });

  it('POST4: with no cars the 300 m removal is skipped', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 4);
      field.spawn('wheel', 0, 0, { x: 400, y: 0.3, z: 0 }, ZERO);
      for (let i = 0; i < steps(2); i++) field.step(FIXED_DT, []);
      expect(field.count).toBe(1);
    } finally {
      world.free();
    }
  });

  it('POST5: a non-finite car position is ignored in the distance check', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 5);
      field.spawn('frontWing', 0, -1, { x: 0, y: 0.3, z: 0 }, ZERO);
      const cars: Vec3[] = [{ x: Number.NaN, y: 0, z: 0 }, CAR];
      for (let i = 0; i < steps(0.5); i++) field.step(FIXED_DT, cars);
      expect(field.count).toBe(1);
    } finally {
      world.free();
    }
  });

  it('POST6: getKinds() stays index-aligned with getBodies() across an overflow', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 6);
      field.spawn('frontWing', 0, -1, { x: 0, y: 0.3, z: 0 }, ZERO);
      field.spawn('wheel', 0, 0, { x: 5, y: 0.3, z: 0 }, ZERO);
      field.spawn('rearWing', 0, -1, { x: 10, y: 0.3, z: 0 }, ZERO);
      expect([...field.getKinds()]).toEqual(['frontWing', 'wheel', 'rearWing']);
      for (let i = 0; i < 8; i++) {
        field.spawn('wheel', 0, i % 4, { x: 20 + i * 5, y: 0.3, z: 0 }, ZERO);
      }
      const kinds = field.getKinds();
      const bodies = field.getBodies();
      expect(kinds).toHaveLength(bodies.length);
      expect(bodies.length).toBeLessThanOrEqual(8);
      expect(kinds.every((k) => k === 'wheel')).toBe(true);
    } finally {
      world.free();
    }
  });

  it('POST7: an out-of-range wheel index spawns the body but hides nothing; wheelHidden rejects bad indices', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 7);
      field.spawn('wheel', 0, 4, { x: 0, y: 0.3, z: 0 }, ZERO);
      field.spawn('wheel', 0, -1, { x: 4, y: 0.3, z: 0 }, ZERO);
      expect(field.count).toBe(2);
      for (let w = 0; w < 4; w++) expect(field.wheelHidden(0, w)).toBe(false);
      expect(field.wheelHidden(0, 4)).toBe(false);
      expect(field.wheelHidden(0, -1)).toBe(false);
      expect(field.wheelHidden(9, 0)).toBe(false);
      expect(field.wheelHidden(Number.NaN, 0)).toBe(false);
    } finally {
      world.free();
    }
  });

  it('POST8: constructor wheelRadiusM is honoured when positive and falls back to 0.28 otherwise', () => {
    const world = createPhysicsWorld();
    try {
      const radii = [0.5, 0, -1, Number.NaN].map((r, i) => {
        const field = new DebrisField(world, 8, r);
        field.spawn('wheel', 0, 0, { x: i * 4, y: 0.3, z: 0 }, ZERO);
        return field.getBodies()[0].collider(0).radius();
      });
      expect(radii[0]).toBeCloseTo(0.5, 4);
      expect(radii[1]).toBeCloseTo(0.28, 4);
      expect(radii[2]).toBeCloseTo(0.28, 4);
      expect(radii[3]).toBeCloseTo(0.28, 4);
    } finally {
      world.free();
    }
  });

  it('POST9: spawn copies the position and linear velocity argument exactly', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 9);
      const vel: Vec3 = { x: 1.5, y: -2.25, z: 3 };
      field.spawn('rearWing', 0, -1, { x: 7, y: 0.5, z: -3 }, vel);
      const body = field.getBodies()[0];
      const t = body.translation();
      expect(t.x).toBeCloseTo(7, 9);
      expect(t.y).toBeCloseTo(0.5, 9);
      expect(t.z).toBeCloseTo(-3, 9);
      const v = body.linvel();
      expect(v.x).toBeCloseTo(1.5, 9);
      expect(v.y).toBeCloseTo(-2.25, 9);
      expect(v.z).toBeCloseTo(3, 9);
      const w = body.angvel();
      expect(Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.z)).toBe(true);
    } finally {
      world.free();
    }
  });

  it('POST10: a falling debris body rests on the ground instead of passing through', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 10);
      field.spawn('wheel', 0, 0, { x: 0, y: 10, z: 0 }, ZERO);
      const handle = field.getBodies()[0].collider(0).handle;
      const queue = new RAPIER.EventQueue(true);
      let hitGround = false;
      for (let i = 0; i < steps(2); i++) {
        world.step(queue);
        queue.drainContactForceEvents((event) => {
          if (event.collider1() === handle || event.collider2() === handle) hitGround = true;
        });
        field.step(FIXED_DT, [CAR]);
      }
      expect(hitGround).toBe(true);
      const t = field.getBodies()[0].translation();
      expect(Number.isFinite(t.y)).toBe(true);
      expect(t.y).toBeGreaterThan(-1);
      expect(t.y).toBeLessThan(1);
    } finally {
      world.free();
    }
  });
});
