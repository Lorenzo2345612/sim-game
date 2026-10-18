import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { aeroForces } from '../../../src/physics/aero';
import { damageEffects, type DamageState } from '../../../src/physics/damage';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, VehicleState } from '../../../src/core/types';
import type { Telemetry } from '../../../src/physics/vehicleModel';

type World = ReturnType<typeof createPhysicsWorld>;

interface Downforce {
  front: number;
  rear: number;
}
interface DamageVehicle extends Vehicle {
  readonly damage: DamageState;
  damageMode: 'off' | 'visual' | 'full';
  getDownforce(out?: Downforce): Downforce;
  getTelemetry(out?: Telemetry): Telemetry;
  reset(spawn: SpawnPose): void;
}
const VehicleCtor = Vehicle as unknown as new (
  world: World,
  spec: CarSpec,
  spawn: SpawnPose,
) => DamageVehicle;

const ROOT = join(__dirname, '..', '..', '..');

function loadF4(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();
const STATIC_Y = SPEC.chassis.cgHeight;
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function input(throttle: number, brake = 0, steer = 0): DriverInput {
  return { throttle, brake, steer, reset: false };
}

function spawn(y: number): SpawnPose {
  return { position: { x: 0, y, z: 0 }, yaw: 0 };
}

function makeVehicle(y = STATIC_Y): { vehicle: DamageVehicle; world: World } {
  const world = createPhysicsWorld();
  return { vehicle: new VehicleCtor(world, SPEC, spawn(y)), world };
}

function step(vehicle: DamageVehicle, world: World, inp: DriverInput): void {
  vehicle.setInput(inp);
  vehicle.prePhysicsStep(FIXED_DT);
  world.step();
}

function run(vehicle: DamageVehicle, world: World, seconds: number, inp: DriverInput): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) step(vehicle, world, inp);
}

function expectRel(actual: number, expected: number, rel: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.abs(expected));
}

function finiteState(s: VehicleState): boolean {
  const n = [
    s.position.x,
    s.position.y,
    s.position.z,
    s.rotation.x,
    s.rotation.y,
    s.rotation.z,
    s.rotation.w,
    s.forwardSpeed,
  ];
  return (
    n.every((v) => Number.isFinite(v)) &&
    s.wheels.every((w) =>
      [w.position.x, w.position.y, w.position.z, w.rotation, w.steering].every((v) =>
        Number.isFinite(v),
      ),
    )
  );
}

function headingRad(s: VehicleState): number {
  const q = s.rotation;
  const fwdX = -2 * (q.w * q.y + q.z * q.x);
  const fwdZ = -1 + 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(-fwdX, -fwdZ);
}

describe('146 damage effects edge', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('EDGE1: rearWing 1 scales rear downforce to 0.5x and leaves front unchanged', () => {
    const rearAt = (rearWing: number): Downforce => {
      const { vehicle, world } = makeVehicle();
      vehicle.damage.rearWing = rearWing;
      run(vehicle, world, 2, IDLE);
      vehicle.body.setLinvel({ x: 0, y: 0, z: -60 }, true);
      vehicle.prePhysicsStep(FIXED_DT);
      const out = vehicle.getDownforce({ front: 0, rear: 0 });
      world.free();
      return out;
    };
    const undamaged = rearAt(0);
    const damaged = rearAt(1);
    expectRel(damaged.rear, 0.5 * undamaged.rear, 0.01);
    expectRel(damaged.front, undamaged.front, 1e-6);
  }, 30000);

  it('EDGE2: zero damage getDownforce equals the raw aeroForces output', () => {
    const { vehicle, world } = makeVehicle();
    run(vehicle, world, 3, IDLE);
    vehicle.body.setLinvel({ x: 0, y: 0, z: -60 }, true);
    vehicle.prePhysicsStep(FIXED_DT);
    const out = vehicle.getDownforce({ front: 0, rear: 0 });
    const raw = aeroForces(SPEC, 60, 0);
    expectRel(out.front, raw.front, 0.01);
    expectRel(out.rear, raw.rear, 0.01);
    world.free();
  }, 30000);

  it('EDGE3: wing damage scales front downforce and leaves the drag impulse unchanged', () => {
    const shot = (frontWing: number): { dv: number; front: number } => {
      const { vehicle, world } = makeVehicle(50);
      vehicle.damage.frontWing = frontWing;
      vehicle.body.setLinvel({ x: 0, y: 0, z: -60 }, true);
      const v0 = vehicle.body.linvel().z;
      vehicle.prePhysicsStep(FIXED_DT);
      world.step();
      const dv = Math.abs(vehicle.body.linvel().z - v0);
      const front = vehicle.getDownforce({ front: 0, rear: 0 }).front;
      world.free();
      return { dv, front };
    };
    const clean = shot(0);
    const broken = shot(1);
    expectRel(broken.front, 0.3 * clean.front, 0.001);
    expect(Math.abs(broken.dv - clean.dv)).toBeLessThanOrEqual(1e-6);
  }, 30000);

  it('EDGE4: per-wheel toe is added after the driver steer and does not accumulate', () => {
    const { vehicle, world } = makeVehicle();
    vehicle.damage.suspension = [1, 1, 1, 1];
    const toe = damageEffects(vehicle.damage).toe;
    run(vehicle, world, 2, IDLE);
    step(vehicle, world, IDLE);
    for (let i = 0; i < 4; i++) {
      expect(vehicle.getState().wheels[i].steering).toBeCloseTo(toe[i], 6);
    }
    run(vehicle, world, 1, input(0, 0, 0.2));
    const st = vehicle.getState();
    expect(st.wheels[0].steering - st.wheels[1].steering).toBeCloseTo(toe[0] - toe[1], 6);
    expect(st.wheels[2].steering).toBeCloseTo(toe[2], 6);
    expect(st.wheels[3].steering).toBeCloseTo(toe[3], 6);
    world.free();
  }, 30000);

  it('EDGE5: damageMode off/visual skips effects while the damage state stays tracked', () => {
    for (const mode of ['off', 'visual'] as const) {
      const { vehicle, world } = makeVehicle();
      vehicle.damageMode = mode;
      vehicle.damage.frontWing = 1;
      vehicle.damage.suspension[0] = 1;
      vehicle.damage.detached[1] = true;
      run(vehicle, world, 2, IDLE);
      vehicle.body.setLinvel({ x: 0, y: 0, z: -60 }, true);
      vehicle.prePhysicsStep(FIXED_DT);
      const out = vehicle.getDownforce({ front: 0, rear: 0 });
      expectRel(out.front, aeroForces(SPEC, 60, 0).front, 0.01);
      expect(vehicle.damage.frontWing).toBe(1);
      expect(vehicle.damage.suspension[0]).toBe(1);
      expect(vehicle.body.numColliders()).toBe(1);
      world.free();
    }
    const { vehicle, world } = makeVehicle();
    vehicle.damageMode = 'visual';
    vehicle.damage.suspension[0] = 1;
    run(vehicle, world, 2, IDLE);
    vehicle.body.setLinvel({ x: 0, y: 0, z: -30 }, true);
    const before = headingRad(vehicle.getState());
    run(vehicle, world, 3, IDLE);
    const d = headingRad(vehicle.getState()) - before;
    const driftDeg = (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180) / Math.PI;
    expect(driftDeg).toBeLessThan(0.1);
    world.free();
  }, 60000);

  it('EDGE6: a detached wheel carries no suspension load and reports no contact', () => {
    const { vehicle, world } = makeVehicle();
    vehicle.damage.detached[1] = true;
    run(vehicle, world, 2, IDLE);
    const tel = vehicle.getTelemetry();
    expect(tel.wheels[1].fz).toBe(0);
    expect(tel.wheels[0].fz).toBeGreaterThan(100);
    expect(tel.wheels[2].fz).toBeGreaterThan(100);
    expect(tel.wheels[3].fz).toBeGreaterThan(100);
    const st = vehicle.getState();
    expect(st.wheels[1].inContact).toBe(false);
    expect(st.wheels[0].inContact).toBe(true);
    world.free();
  }, 30000);

  it('EDGE7: each detached wheel gets one 0.12 m friction-0.8 ball collider, created once', () => {
    const { vehicle, world } = makeVehicle();
    vehicle.damage.detached[0] = true;
    vehicle.damage.detached[3] = true;
    run(vehicle, world, 2, IDLE);
    expect(vehicle.body.numColliders()).toBe(3);
    run(vehicle, world, 1, IDLE);
    expect(vehicle.body.numColliders()).toBe(3);
    const seen: boolean[] = [false, false];
    for (let i = 1; i < vehicle.body.numColliders(); i++) {
      const c = vehicle.body.collider(i);
      expect(c.radius()).toBeCloseTo(0.12, 6);
      expect(c.friction()).toBeCloseTo(0.8, 6);
      expect(c.density()).toBeCloseTo(0, 6);
      const local = c.translationWrtParent();
      expect(local).not.toBeNull();
      const lp = local as { x: number; y: number; z: number };
      for (const w of [0, 3]) {
        const hub = SPEC.wheels.positions[w];
        if (
          Math.abs(lp.x - hub[0]) < 0.01 &&
          Math.abs(lp.y - (hub[1] - SPEC.wheels.radius + 0.12)) < 0.01 &&
          Math.abs(lp.z - hub[2]) < 0.01
        ) {
          seen[w === 0 ? 0 : 1] = true;
        }
      }
    }
    expect(seen).toEqual([true, true]);
    world.free();
  }, 30000);

  it('EDGE8: reset clears damage in place and removes the detach colliders', () => {
    const { vehicle, world } = makeVehicle();
    const ref = vehicle.damage;
    vehicle.damage.frontWing = 1;
    vehicle.damage.suspension[0] = 1;
    vehicle.damage.puncture[2] = true;
    vehicle.damage.detached[1] = true;
    run(vehicle, world, 2, IDLE);
    expect(vehicle.body.numColliders()).toBe(2);
    vehicle.reset(spawn(STATIC_Y));
    expect(vehicle.damage).toBe(ref);
    expect(vehicle.damage.frontWing).toBe(0);
    expect(vehicle.damage.suspension[0]).toBe(0);
    expect(vehicle.damage.puncture[2]).toBe(false);
    expect(vehicle.damage.detached[1]).toBe(false);
    expect(vehicle.body.numColliders()).toBe(1);
    world.free();
  }, 30000);

  it('EDGE9: a corrupt DamageState still yields finite downforce and state', () => {
    const { vehicle, world } = makeVehicle();
    vehicle.damage.frontWing = NaN;
    vehicle.damage.rearWing = NaN;
    vehicle.damage.suspension = [NaN, NaN, NaN, NaN];
    vehicle.damage.puncture = [true, false, true, false];
    vehicle.damage.detached = [false, true, false, true];
    run(vehicle, world, 3, input(0.5, 0, 0.2));
    const out = vehicle.getDownforce({ front: 0, rear: 0 });
    expect(Number.isFinite(out.front)).toBe(true);
    expect(Number.isFinite(out.rear)).toBe(true);
    expect(finiteState(vehicle.getState())).toBe(true);
    world.free();
  }, 30000);

  it('EDGE10: rear punctures cut full-throttle speed below 0.75x of undamaged', () => {
    const speedAt = (punctured: boolean): number => {
      const { vehicle, world } = makeVehicle();
      if (punctured) {
        vehicle.damage.puncture[2] = true;
        vehicle.damage.puncture[3] = true;
      }
      run(vehicle, world, 2, IDLE);
      run(vehicle, world, 4, input(1));
      const v = vehicle.getState().forwardSpeed;
      world.free();
      return v;
    };
    const undamaged = speedAt(false);
    const damaged = speedAt(true);
    expect(undamaged).toBeGreaterThan(15);
    expect(damaged).toBeLessThan(0.75 * undamaged);
    expect(Number.isFinite(damaged)).toBe(true);
  }, 60000);
});
