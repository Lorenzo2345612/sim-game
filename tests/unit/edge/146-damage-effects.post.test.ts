import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { CAR_CONTACT_COLLISION_GROUPS } from '../../../src/physics/vehicleModel';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { aeroForces } from '../../../src/physics/aero';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, VehicleState } from '../../../src/core/types';
import type { Telemetry } from '../../../src/physics/vehicleModel';

type World = ReturnType<typeof createPhysicsWorld>;

interface Downforce {
  front: number;
  rear: number;
}
interface DamageVehicle extends Vehicle {
  readonly damage: {
    frontWing: number;
    rearWing: number;
    suspension: [number, number, number, number];
    puncture: [boolean, boolean, boolean, boolean];
    detached: [boolean, boolean, boolean, boolean];
  };
  damageMode: 'off' | 'visual' | 'full';
  getDownforce(out?: Downforce): Downforce;
  getTelemetry(out?: Telemetry): Telemetry;
}
const VehicleCtor = Vehicle as unknown as new (
  world: World,
  spec: CarSpec,
  spawn: SpawnPose,
) => DamageVehicle;

function bodyCols(body: RAPIER.RigidBody): RAPIER.Collider[] {
  const out: RAPIER.Collider[] = [];
  for (let i = 0; i < body.numColliders(); i++) {
    const c = body.collider(i);
    if (c.collisionGroups() !== CAR_CONTACT_COLLISION_GROUPS) out.push(c);
  }
  return out;
}

const ROOT = join(__dirname, '..', '..', '..');

function loadF4(mutate?: (spec: CarSpec) => void): CarSpec {
  const json = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  const spec = parseCarSpec(json);
  mutate?.(spec);
  return spec;
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

function makeVehicle(spec: CarSpec = SPEC): { vehicle: DamageVehicle; world: World } {
  const world = createPhysicsWorld();
  return { vehicle: new VehicleCtor(world, spec, spawn(STATIC_Y)), world };
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
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.abs(expected) + 1e-12);
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

describe('146 damage effects post gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST1: non-full mode keeps a detached wheel loaded and in contact', () => {
    const { vehicle, world } = makeVehicle();
    vehicle.damageMode = 'off';
    vehicle.damage.detached[1] = true;
    run(vehicle, world, 2, IDLE);
    const tel = vehicle.getTelemetry();
    expect(tel.wheels[1].fz).toBeGreaterThan(100);
    expect(vehicle.getState().wheels[1].inContact).toBe(true);
    expect(bodyCols(vehicle.body).length).toBe(1);
    world.free();
  }, 30000);

  it('POST2: flipping mode off→full creates the detach collider on the next step', () => {
    const { vehicle, world } = makeVehicle();
    vehicle.damageMode = 'off';
    vehicle.damage.detached[2] = true;
    run(vehicle, world, 1, IDLE);
    expect(bodyCols(vehicle.body).length).toBe(1);
    vehicle.damageMode = 'full';
    step(vehicle, world, IDLE);
    expect(bodyCols(vehicle.body).length).toBe(2);
    run(vehicle, world, 1, IDLE);
    expect(bodyCols(vehicle.body).length).toBe(2);
    world.free();
  }, 30000);

  it('POST3: damageMode off with a full damage state matches the pristine run', () => {
    const probe = (damaged: boolean): { s: VehicleState; df: Downforce } => {
      const { vehicle, world } = makeVehicle();
      if (damaged) {
        vehicle.damageMode = 'off';
        vehicle.damage.frontWing = 1;
        vehicle.damage.rearWing = 1;
        vehicle.damage.suspension = [1, 0.5, 0.25, 1];
        vehicle.damage.puncture = [true, false, true, false];
        vehicle.damage.detached = [false, true, false, false];
      }
      run(vehicle, world, 2.5, input(0.4, 0, 0.15));
      const s = vehicle.getState();
      const df = vehicle.getDownforce({ front: 0, rear: 0 });
      world.free();
      return { s, df };
    };
    const clean = probe(false);
    const damaged = probe(true);
    expectRel(damaged.s.forwardSpeed, clean.s.forwardSpeed, 1e-9);
    expectRel(damaged.s.position.x, clean.s.position.x, 1e-9);
    expectRel(damaged.s.position.y, clean.s.position.y, 1e-9);
    expectRel(damaged.s.position.z, clean.s.position.z, 1e-9);
    expectRel(damaged.s.wheels[0].steering, clean.s.wheels[0].steering, 1e-9);
    expectRel(damaged.s.wheels[0].position.y, clean.s.wheels[0].position.y, 1e-9);
    expectRel(damaged.df.front, clean.df.front, 1e-9);
    expectRel(damaged.df.rear, clean.df.rear, 1e-9);
  }, 30000);

  it('POST4: getDownforce returns the caller object and tracks the latest step', () => {
    const { vehicle, world } = makeVehicle();
    run(vehicle, world, 2, IDLE);
    vehicle.body.setLinvel({ x: 0, y: 0, z: -60 }, true);
    vehicle.prePhysicsStep(FIXED_DT);
    const out = { front: 0, rear: 0 };
    expect(vehicle.getDownforce(out)).toBe(out);
    const cleanFront = out.front;
    expectRel(cleanFront, aeroForces(SPEC, 60, 0).front, 0.01);
    vehicle.damage.frontWing = 1;
    vehicle.body.setLinvel({ x: 0, y: 0, z: -60 }, true);
    vehicle.prePhysicsStep(FIXED_DT);
    expect(vehicle.getDownforce(out)).toBe(out);
    expectRel(out.front, 0.3 * cleanFront, 1e-3);
    world.free();
  }, 30000);

  it('POST5: non-positive and non-finite dt skip the step and create no detach collider', () => {
    const { vehicle, world } = makeVehicle();
    vehicle.damage.frontWing = 1;
    vehicle.damage.detached = [true, true, true, true];
    for (const dt of [0, -1, NaN, Infinity]) {
      vehicle.prePhysicsStep(dt);
    }
    expect(bodyCols(vehicle.body).length).toBe(1);
    expect(finiteState(vehicle.getState())).toBe(true);
    step(vehicle, world, input(0.3));
    expect(bodyCols(vehicle.body).length).toBe(5);
    expect(finiteState(vehicle.getState())).toBe(true);
    world.free();
  }, 30000);

  it('POST6: out-of-range damage values keep outputs finite', () => {
    const { vehicle, world } = makeVehicle();
    vehicle.damage.frontWing = 5;
    vehicle.damage.rearWing = -2;
    vehicle.damage.suspension = [2, -1, 3, 0.5];
    vehicle.damage.puncture = [true, true, false, false];
    vehicle.damage.detached = [false, false, false, true];
    run(vehicle, world, 1, input(0.3, 0, 0.2));
    const out = vehicle.getDownforce({ front: 0, rear: 0 });
    expect(Number.isFinite(out.front)).toBe(true);
    expect(Number.isFinite(out.rear)).toBe(true);
    expect(finiteState(vehicle.getState())).toBe(true);
    world.free();
  }, 30000);

  it('POST7: the front anti-roll bar is disabled while a front wheel is detached', () => {
    const arb0 = loadF4((s) => {
      s.suspension.front.arb = 0;
    });
    const runY = (spec: CarSpec): { y: number; hubY: number; fz0: number } => {
      const { vehicle, world } = makeVehicle(spec);
      vehicle.damage.detached[1] = true;
      run(vehicle, world, 2.5, IDLE);
      const s = vehicle.getState();
      const tel = vehicle.getTelemetry();
      const y = s.position.y;
      const hubY = s.wheels[0].position.y;
      const fz0 = tel.wheels[0].fz;
      world.free();
      return { y, hubY, fz0 };
    };
    const base = runY(SPEC);
    const noBar = runY(arb0);
    expect(base.y).toBeCloseTo(noBar.y, 3);
    expect(base.hubY).toBeCloseTo(noBar.hubY, 3);
    expectRel(base.fz0, noBar.fz0, 1e-6);
  }, 30000);

  it('POST8: control — the front bar changes wheel loads when no wheel is detached', () => {
    const arb0 = loadF4((s) => {
      s.suspension.front.arb = 0;
    });
    const fz0With = (spec: CarSpec): number => {
      const { vehicle, world } = makeVehicle(spec);
      vehicle.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
      run(vehicle, world, 1, input(0.3, 0, 0.5));
      const fz0 = vehicle.getTelemetry().wheels[0].fz;
      world.free();
      return fz0;
    };
    expect(Math.abs(fz0With(SPEC) - fz0With(arb0))).toBeGreaterThan(50);
  }, 30000);

  it('POST9: a single rear puncture makes only that wheel slip more under full throttle', () => {
    const kappas = (punctured: boolean): [number, number] => {
      const { vehicle, world } = makeVehicle();
      if (punctured) vehicle.damage.puncture[3] = true;
      run(vehicle, world, 2, IDLE);
      run(vehicle, world, 2, input(1));
      const tel = vehicle.getTelemetry();
      const k: [number, number] = [tel.wheels[2].kappa, tel.wheels[3].kappa];
      world.free();
      return k;
    };
    const [c2, c3] = kappas(false);
    expect(Math.abs(c3 - c2)).toBeLessThan(0.01);
    const [d2, d3] = kappas(true);
    expect(d3).toBeGreaterThan(d2 + 0.02);
  }, 60000);
});
