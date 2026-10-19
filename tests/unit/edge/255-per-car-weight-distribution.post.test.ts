import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT, GRAVITY } from '../../../src/core/constants';
import type { DriverInput, SpawnPose } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

const WEIGHT_FRONT: Record<string, number> = {
  'gt3-a': 0.48,
  'gt3-b': 0.4,
  'gt3-c': 0.44,
  'gt3-d': 0.43,
  'hyper-a': 0.47,
  'lmp2-a': 0.44,
  ow26: 0.455,
};

const worlds: World[] = [];

function readCar(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', `${id}.json`), 'utf8'));
}

function parse(json: unknown): CarSpec {
  return parseCarSpec(json);
}

function build(spec: CarSpec): { world: World; vehicle: Vehicle } {
  const world = createPhysicsWorld();
  worlds.push(world);
  const spawn: SpawnPose = { position: { x: 0, y: spec.chassis.cgHeight, z: 0 }, yaw: 0 };
  const vehicle = new Vehicle(world, spec, spawn);
  return { world, vehicle };
}

function step(vehicle: Vehicle, world: World, inp: DriverInput): void {
  vehicle.setInput(inp);
  vehicle.prePhysicsStep(FIXED_DT);
  world.step();
}

function run(vehicle: Vehicle, world: World, seconds: number, inp: DriverInput): void {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) step(vehicle, world, inp);
}

interface AxleLoads {
  front: number;
  rear: number;
  left: number;
  right: number;
  total: number;
}

function loads(vehicle: Vehicle): AxleLoads {
  const w = vehicle.getTelemetry().wheels;
  return {
    front: w[0].fz + w[1].fz,
    rear: w[2].fz + w[3].fz,
    left: w[0].fz + w[2].fz,
    right: w[1].fz + w[3].fz,
    total: w.reduce((a, x) => a + x.fz, 0),
  };
}

describe('255 per-car weight distribution post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    for (const w of worlds) w.free();
    worlds.length = 0;
  });

  it('POST1: settled total normal load equals (mass + fuel) g for every car', () => {
    for (const id of Object.keys(WEIGHT_FRONT)) {
      const spec = parse(readCar(id));
      const { world, vehicle } = build(spec);
      run(vehicle, world, 2, IDLE);
      const tel = vehicle.getTelemetry();
      const total = tel.wheels.reduce((a, w) => a + w.fz, 0);
      const expected = (spec.chassis.massKg + tel.fuelKg) * Math.abs(GRAVITY);
      expect(expected, `${id} expected load`).toBeGreaterThan(0);
      expect(Math.abs(total / expected - 1), `${id} total load ${total} vs ${expected}`).toBeLessThanOrEqual(0.01);
    }
  }, 60000);

  it('POST2: front load share does not depend on the starting fuel load', () => {
    for (const id of Object.keys(WEIGHT_FRONT)) {
      const raw = readCar(id);
      const fuel = raw.fuel as Record<string, number>;
      const shares: number[] = [];
      for (const startL of [0, fuel.capacityL]) {
        const spec = parse({
          ...raw,
          fuel: { ...fuel, startL },
        });
        const { world, vehicle } = build(spec);
        run(vehicle, world, 2, IDLE);
        const l = loads(vehicle);
        expect(l.total, `${id} startL=${startL} total`).toBeGreaterThan(0);
        shares.push(l.front / l.total);
      }
      expect(Math.abs(shares[0] - shares[1]), `${id} share empty vs full`).toBeLessThanOrEqual(0.002);
      expect(Math.abs(shares[0] - WEIGHT_FRONT[id]), `${id} empty-tank share`).toBeLessThanOrEqual(0.01);
    }
  }, 120000);

  it('POST3: left and right wheel loads are symmetric at rest on a flat plane', () => {
    for (const id of Object.keys(WEIGHT_FRONT)) {
      const spec = parse(readCar(id));
      const { world, vehicle } = build(spec);
      run(vehicle, world, 2, IDLE);
      const l = loads(vehicle);
      expect(l.total, `${id} total`).toBeGreaterThan(0);
      // Hub x/z are slightly asymmetric in the source models, so allow 0.5 % of total.
      expect(Math.abs(l.left - l.right) / l.total, `${id} left/right`).toBeLessThanOrEqual(0.005);
    }
  }, 60000);

  it('POST4: settled front share stays within 0.002 of weightFront (tighter than the AT1 contract)', () => {
    for (const id of Object.keys(WEIGHT_FRONT)) {
      const spec = parse(readCar(id));
      const { world, vehicle } = build(spec);
      run(vehicle, world, 3, IDLE);
      const l = loads(vehicle);
      expect(l.total, `${id} total`).toBeGreaterThan(0);
      expect(Math.abs(l.front / l.total - WEIGHT_FRONT[id]), `${id} front share`).toBeLessThanOrEqual(0.002);
    }
  }, 60000);

  it('POST5: front share is stable between 2 s and 6 s of settling', () => {
    for (const id of Object.keys(WEIGHT_FRONT)) {
      const spec = parse(readCar(id));
      const { world, vehicle } = build(spec);
      run(vehicle, world, 2, IDLE);
      const s1 = loads(vehicle);
      run(vehicle, world, 4, IDLE);
      const s2 = loads(vehicle);
      expect(s1.total, `${id} total`).toBeGreaterThan(0);
      expect(s2.total, `${id} total2`).toBeGreaterThan(0);
      expect(Math.abs(s1.front / s1.total - s2.front / s2.total), `${id} share drift`).toBeLessThanOrEqual(0.002);
    }
  }, 60000);

  it('POST6: braking shifts load forward and throttle shifts it rearward', () => {
    for (const id of Object.keys(WEIGHT_FRONT)) {
      const spec = parse(readCar(id));
      const { world, vehicle } = build(spec);
      vehicle.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
      run(vehicle, world, 1, IDLE);
      const rest = loads(vehicle);
      const shareRest = rest.front / rest.total;

      const b = build(spec);
      b.vehicle.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
      run(b.vehicle, b.world, 1, IDLE);
      run(b.vehicle, b.world, 0.2, { throttle: 0, brake: 1, steer: 0, reset: false });
      const braking = loads(b.vehicle);
      expect(braking.front / braking.total, `${id} braking share`).toBeGreaterThan(shareRest + 0.02);

      const t = build(spec);
      t.vehicle.setGearMode('manual');
      t.vehicle.shiftUp();
      t.vehicle.body.setLinvel({ x: 0, y: 0, z: -15 }, true);
      run(t.vehicle, t.world, 1, IDLE);
      const restT = loads(t.vehicle);
      run(t.vehicle, t.world, 0.2, { throttle: 1, brake: 0, steer: 0, reset: false });
      const accel = loads(t.vehicle);
      expect(accel.rear / accel.total, `${id} throttle rear share`).toBeGreaterThan(restT.rear / restT.total);
    }
  }, 120000);

  it('POST7: after a disturbed run and reset the car settles back to its weightFront share', () => {
    for (const id of Object.keys(WEIGHT_FRONT)) {
      const spec = parse(readCar(id));
      const { world, vehicle } = build(spec);
      const spawn: SpawnPose = { position: { x: 0, y: spec.chassis.cgHeight, z: 0 }, yaw: 0 };
      run(vehicle, world, 1, IDLE);
      const before = loads(vehicle);
      vehicle.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
      run(vehicle, world, 1, { throttle: 1, brake: 0, steer: 0.6, reset: false });
      vehicle.reset(spawn);
      run(vehicle, world, 2, IDLE);
      const after = loads(vehicle);
      expect(before.total, `${id} total before`).toBeGreaterThan(0);
      expect(after.total, `${id} total after`).toBeGreaterThan(0);
      expect(Math.abs(after.front / after.total - WEIGHT_FRONT[id]), `${id} share after reset`).toBeLessThanOrEqual(0.002);
      expect(Math.abs(after.front / after.total - before.front / before.total), `${id} share reset drift`).toBeLessThanOrEqual(0.002);
    }
  }, 120000);
});
