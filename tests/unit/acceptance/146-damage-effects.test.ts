import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT, GRAVITY } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, VehicleState } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

interface Downforce {
  front: number;
  rear: number;
}
interface VehicleModel extends Vehicle {
  getDownforce(out?: Downforce): Downforce;
}
const VehicleCtor = Vehicle as unknown as new (
  world: World,
  spec: CarSpec,
  spawn: SpawnPose,
) => VehicleModel;

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

const SKID_RADIUS = 100;
const SKID_CX = -SKID_RADIUS;

function input(throttle: number, brake = 0, steer = 0): DriverInput {
  return { throttle, brake, steer, reset: false };
}

function spawn(y: number): SpawnPose {
  return { position: { x: 0, y, z: 0 }, yaw: 0 };
}

function step(vehicle: Vehicle, world: World, inp: DriverInput): void {
  vehicle.setInput(inp);
  vehicle.prePhysicsStep(FIXED_DT);
  world.step();
}

function run(vehicle: Vehicle, world: World, seconds: number, inp: DriverInput): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) step(vehicle, world, inp);
}

function runHold(
  vehicle: Vehicle,
  world: World,
  seconds: number,
  target: number,
): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const speed = vehicle.getState().forwardSpeed;
    step(vehicle, world, input(Math.min(1, Math.max(0, 0.3 + 0.2 * (target - speed)))));
  }
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

describe('146 damage effects acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('AT1: frontWing 1 at 60 m/s gives front downforce 0.3 × undamaged within 1 %', () => {
    const frontAt = (frontWing: number): number => {
      const world = createPhysicsWorld();
      const vehicle = new VehicleCtor(world, SPEC, spawn(STATIC_Y));
      vehicle.damage.frontWing = frontWing;
      run(vehicle, world, 2, IDLE);
      vehicle.body.setLinvel({ x: 0, y: 0, z: -60 }, true);
      vehicle.prePhysicsStep(FIXED_DT);
      const out = vehicle.getDownforce({ front: 0, rear: 0 });
      world.free();
      return out.front;
    };
    const undamaged = frontAt(0);
    const damaged = frontAt(1);
    const target = 0.3 * undamaged;
    expect(Math.abs(damaged - target)).toBeLessThanOrEqual(0.01 * Math.abs(target));
  }, 30000);

  it('AT2: suspension[0] 1 pulls heading ≥ 1° in 3 s at 30 m/s; undamaged drifts < 0.1°', () => {
    const driftDeg = (suspension: number): number => {
      const world = createPhysicsWorld();
      const vehicle = new VehicleCtor(world, SPEC, spawn(STATIC_Y));
      vehicle.damage.suspension[0] = suspension;
      run(vehicle, world, 2, IDLE);
      vehicle.body.setLinvel({ x: 0, y: 0, z: -30 }, true);
      const before = headingRad(vehicle.getState());
      runHold(vehicle, world, 3, 30);
      const d = headingRad(vehicle.getState()) - before;
      world.free();
      return (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180) / Math.PI;
    };
    expect(driftDeg(1)).toBeGreaterThanOrEqual(1);
    expect(driftDeg(0)).toBeLessThan(0.1);
  }, 60000);

  it('AT3: detached[1] full throttle 10 s: vmax < 0.92 × undamaged, finite, chassis y ≥ −0.05', () => {
    const runFt = (detached: boolean): { vmax: number; minY: number; ok: boolean } => {
      const world = createPhysicsWorld();
      const vehicle = new VehicleCtor(world, SPEC, spawn(STATIC_Y));
      if (detached) vehicle.damage.detached[1] = true;
      run(vehicle, world, 2, IDLE);
      let vmax = 0;
      let minY = Infinity;
      let ok = true;
      const steps = Math.round(10 / FIXED_DT);
      for (let i = 0; i < steps; i++) {
        step(vehicle, world, input(1));
        const s = vehicle.getState();
        vmax = Math.max(vmax, s.forwardSpeed);
        minY = Math.min(minY, s.position.y);
        if (!finiteState(s)) ok = false;
      }
      world.free();
      return { vmax, minY, ok };
    };
    const damaged = runFt(true);
    const undamaged = runFt(false);
    expect(damaged.ok).toBe(true);
    expect(damaged.vmax).toBeLessThan(0.92 * undamaged.vmax);
    expect(damaged.minY).toBeGreaterThanOrEqual(-0.05);
  }, 120000);

  it('AT4: puncture[3] skidpad max lateral g is < 0.85 × undamaged (066 setup)', () => {
    const skidpadBest = (punctured: boolean): number => {
      const world = createPhysicsWorld();
      const vehicle = new VehicleCtor(world, SPEC, spawn(STATIC_Y));
      if (punctured) vehicle.damage.puncture[3] = true;
      vehicle.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
      const wheelbase = SPEC.wheels.positions[2][2] - SPEC.wheels.positions[0][2];
      let vt = 12;
      let integral = 0;
      let best = 0;
      let lost = false;
      const script = (state: VehicleState): DriverInput => {
        const dx = state.position.x - SKID_CX;
        const dz = state.position.z;
        const radius = Math.hypot(dx, dz);
        const error = radius - SKID_RADIUS;
        if (Math.abs(error) > 8) lost = true;
        const tanX = dz / radius;
        const tanZ = -dx / radius;
        const q = state.rotation;
        const fwdX = -2 * (q.w * q.y + q.z * q.x);
        const fwdZ = -1 + 2 * (q.x * q.x + q.y * q.y);
        const headingErr = Math.atan2(fwdZ * tanX - fwdX * tanZ, fwdX * tanX + fwdZ * tanZ);
        integral = clamp(integral + error * FIXED_DT, -3, 3);
        const delta =
          Math.atan(wheelbase / SKID_RADIUS) + 0.04 * error + 0.01 * integral + headingErr;
        const v = vehicle.body.linvel();
        const speed = Math.hypot(v.x, v.z);
        vt += 0.25 * FIXED_DT;
        const st = SPEC.steering;
        const maxAngle =
          st.maxAngleLow + (st.maxAngleHigh - st.maxAngleLow) * Math.min(1, speed / st.fullSpeed);
        const ay = (speed * speed) / SKID_RADIUS / Math.abs(GRAVITY);
        if (Math.abs(error) < 4 && ay > best) best = ay;
        return {
          throttle: clamp(0.3 + 0.2 * (vt - speed), 0, 1),
          brake: 0,
          steer: -delta / maxAngle,
          reset: false,
        };
      };
      for (let i = 0; i < 200 && !lost; i++) {
        const steps = Math.round(1 / FIXED_DT);
        for (let s = 0; s < steps; s++) {
          vehicle.setInput(script(vehicle.getState()));
          vehicle.prePhysicsStep(FIXED_DT);
          world.step();
        }
      }
      world.free();
      return best;
    };
    const undamaged = skidpadBest(false);
    const damaged = skidpadBest(true);
    expect(damaged).toBeLessThan(0.85 * undamaged);
  }, 240000);
});
