import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import { magic } from '../../../src/physics/tyre';
import { FIXED_DT, MS_TO_KMH } from '../../../src/core/constants';
import type { DriverInput, Quat, SpawnPose, VehicleState } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const RAD_30 = (30 * Math.PI) / 180;

// weightFront/width/widthRear from the task table; baseAy (m/s^2) and baseT (s) are
// baselines B recorded from master at test-writing time (acceptance worker, task 255).
const CARS: {
  id: string;
  weightFront: number;
  width: number;
  widthRear: number;
  vTargetKmh: number;
  baseAy: number;
  baseT: number;
}[] = [
  { id: 'f4', weightFront: 0.43, width: 0.2, widthRear: 0.25, vTargetKmh: 150, baseAy: 18.378288679459626, baseT: 8.508333333333491 },
  { id: 'gt3-a', weightFront: 0.48, width: 0.3, widthRear: 0.31, vTargetKmh: 200, baseAy: 15.932190992208854, baseT: 9.81666666666675 },
  { id: 'gt3-b', weightFront: 0.4, width: 0.3, widthRear: 0.31, vTargetKmh: 200, baseAy: 15.731699115305931, baseT: 9.683333333333424 },
  { id: 'gt3-c', weightFront: 0.44, width: 0.3, widthRear: 0.31, vTargetKmh: 200, baseAy: 16.020256259084725, baseT: 9.766666666666753 },
  { id: 'gt3-d', weightFront: 0.43, width: 0.3, widthRear: 0.31, vTargetKmh: 200, baseAy: 15.946970334310404, baseT: 9.800000000000084 },
  { id: 'hyper-a', weightFront: 0.47, width: 0.29, widthRear: 0.34, vTargetKmh: 200, baseAy: 20.90397901757744, baseT: 7.083333333333475 },
  { id: 'lmp2-a', weightFront: 0.44, width: 0.3, widthRear: 0.31, vTargetKmh: 200, baseAy: 22.459256811010782, baseT: 6.71666666666679 },
  { id: 'ow26', weightFront: 0.455, width: 0.275, widthRear: 0.375, vTargetKmh: 200, baseAy: 22.97769049822971, baseT: 5.100000000000043 },
];

function readCar(id: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', `${id}.json`), 'utf8'));
}

function parse(json: unknown): CarSpec {
  return parseCarSpec(json);
}

function spawn(y: number): SpawnPose {
  return { position: { x: 0, y, z: 0 }, yaw: 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
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

function forwardOf(q: Quat): { x: number; z: number } {
  return {
    x: -2 * (q.w * q.y + q.z * q.x),
    z: -1 + 2 * (q.x * q.x + q.y * q.y),
  };
}

function sideslipOf(state: VehicleState, vx: number, vz: number): number {
  const f = forwardOf(state.rotation);
  return Math.atan2(f.z * vx - f.x * vz, f.x * vx + f.z * vz);
}

function maxAngleAt(spec: CarSpec, speed: number): number {
  const st = spec.steering;
  return st.maxAngleLow + (st.maxAngleHigh - st.maxAngleLow) * Math.min(1, speed / st.fullSpeed);
}

function steerInput(spec: CarSpec, speed: number, rad: number): number {
  const a = maxAngleAt(spec, speed);
  return a > 0 ? Math.max(-1, Math.min(1, -rad / a)) : 0;
}

function peakSlipAngle(c: TyreCompound): number {
  let bestA = 0;
  let best = -1;
  for (let i = 1; i <= 1200; i++) {
    const a = (i * 0.5) / 1200;
    const y = Math.abs(magic(c.By, c.Cy, c.Ey, 1, a));
    if (y > best) {
      best = y;
      bestA = a;
    }
  }
  return bestA;
}

const worlds: World[] = [];

function build(spec: CarSpec): { world: World; vehicle: Vehicle } {
  const world = createPhysicsWorld();
  worlds.push(world);
  const vehicle = new Vehicle(world, spec, spawn(spec.chassis.cgHeight));
  return { world, vehicle };
}

// Rolling start at 15 m/s in 2nd gear, held 0.08 rad road-wheel angle, 3 s full throttle.
function maxAbsSideslip(spec: CarSpec): number {
  const { world, vehicle } = build(spec);
  vehicle.setGearMode('manual');
  vehicle.shiftUp();
  vehicle.body.setLinvel({ x: 0, y: 0, z: -15 }, true);
  let max = 0;
  const n = Math.round(3 / FIXED_DT);
  for (let i = 0; i < n; i++) {
    const lv = vehicle.body.linvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    step(vehicle, world, {
      throttle: 1,
      brake: 0,
      steer: steerInput(spec, speed, 0.08),
      reset: false,
    });
    const lv2 = vehicle.body.linvel();
    const beta = Math.abs(sideslipOf(vehicle.getState(), lv2.x, lv2.z));
    if (beta > max) max = beta;
  }
  return max;
}

interface CircleRun {
  lost: boolean;
  tFront: number | undefined;
  tRear: number | undefined;
  maxAy: number;
}

// 50 m constant-radius circle, lateral accel ramped until the car slides.
function circleRun(spec: CarSpec): CircleRun {
  const alphaPeak = peakSlipAngle(spec.tyres.compounds.medium);
  const { world, vehicle } = build(spec);
  const wheelbase = spec.wheels.positions[2][2] - spec.wheels.positions[0][2];
  const R = 50;
  const cx = -R;
  vehicle.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
  let vt = 12;
  let integral = 0;
  let t = 0;
  let tFront: number | undefined;
  let tRear: number | undefined;
  let lost = false;
  let maxAy = 0;
  while (t < 120 && !lost) {
    const state = vehicle.getState();
    const dx = state.position.x - cx;
    const dz = state.position.z;
    const radius = Math.hypot(dx, dz) || 1;
    const error = radius - R;
    const tanX = dz / radius;
    const tanZ = -dx / radius;
    const q = state.rotation;
    const fwdX = -2 * (q.w * q.y + q.z * q.x);
    const fwdZ = -1 + 2 * (q.x * q.x + q.y * q.y);
    const headingErr = Math.atan2(fwdZ * tanX - fwdX * tanZ, fwdX * tanX + fwdZ * tanZ);
    integral = clamp(integral + error * FIXED_DT, -3, 3);
    const delta = Math.atan(wheelbase / R) + 0.04 * error + 0.01 * integral + headingErr;
    const lv = vehicle.body.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    const beta = Math.abs(sideslipOf(state, lv.x, lv.z));
    if (Math.abs(error) > 6 || beta > RAD_30) {
      lost = true;
      break;
    }
    const ay = (speed * speed) / R;
    if (Math.abs(error) < 4 && ay > maxAy) maxAy = ay;
    vt += 0.25 * FIXED_DT;
    step(vehicle, world, {
      throttle: Math.min(1, Math.max(0, 0.3 + 0.2 * (vt - speed))),
      brake: 0,
      steer: steerInput(spec, speed, delta),
      reset: false,
    });
    const tel = vehicle.getTelemetry();
    const frontA = (Math.abs(tel.wheels[0].alpha) + Math.abs(tel.wheels[1].alpha)) / 2;
    const rearA = (Math.abs(tel.wheels[2].alpha) + Math.abs(tel.wheels[3].alpha)) / 2;
    if (tFront === undefined && frontA >= alphaPeak) tFront = t;
    if (tRear === undefined && rearA >= alphaPeak) tRear = t;
    t += FIXED_DT;
  }
  return { lost, tFront, tRear, maxAy };
}

function accelTime(spec: CarSpec, targetKmh: number): number {
  const { world, vehicle } = build(spec);
  const target = targetKmh / MS_TO_KMH;
  const n = Math.round(30 / FIXED_DT);
  let t = 0;
  for (let i = 0; i < n; i++) {
    step(vehicle, world, FULL);
    t += FIXED_DT;
    if (vehicle.getState().forwardSpeed >= target) return t;
  }
  return -1;
}

describe('255 per-car weight distribution and tyre widths acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    for (const w of worlds) w.free();
    worlds.length = 0;
  });

  it('AT1: each car at rest settles to its weightFront target on the front axle', () => {
    for (const car of CARS) {
      const spec = parse(readCar(car.id));
      const { world, vehicle } = build(spec);
      run(vehicle, world, 2, IDLE);
      const wheels = vehicle.getTelemetry().wheels;
      const front = wheels[0].fz + wheels[1].fz;
      const total = wheels.reduce((a, w) => a + w.fz, 0);
      expect(total, car.id).toBeGreaterThan(0);
      expect(Math.abs(front / total - car.weightFront), car.id).toBeLessThanOrEqual(0.01);
    }
  }, 300000);

  it('AT2: every car parses the table tyre widths and widthRear >= width', () => {
    for (const car of CARS) {
      const spec = parse(readCar(car.id));
      expect(Math.abs(spec.wheels.width - car.width), `${car.id}.wheels.width`).toBeLessThanOrEqual(1e-9);
      expect(
        Math.abs(spec.wheels.widthRear - car.widthRear),
        `${car.id}.wheels.widthRear`,
      ).toBeLessThanOrEqual(1e-9);
      expect(spec.wheels.widthRear, car.id).toBeGreaterThanOrEqual(spec.wheels.width);
    }
  });

  it('AT3: no car spins on a full-throttle step steer from 15 m/s in 2nd gear', () => {
    for (const car of CARS) {
      const max = maxAbsSideslip(parse(readCar(car.id)));
      expect(max, car.id).toBeLessThan(RAD_30);
    }
  }, 600000);

  it('AT4: on the 50 m limit circle each car peaks its front slip angle first', () => {
    for (const car of CARS) {
      const r = circleRun(parse(readCar(car.id)));
      expect(r.lost, `${car.id} never slid on the circle`).toBe(true);
      expect(r.tFront, `${car.id} front axle never reached its peak slip angle`).toBeDefined();
      if (r.tRear !== undefined) {
        expect(r.tFront as number, car.id).toBeLessThanOrEqual(r.tRear + 0.1);
      }
    }
  }, 600000);

  it('AT5: max steady lateral accel on the same circle stays within 8 % of master baseline', () => {
    for (const car of CARS) {
      const r = circleRun(parse(readCar(car.id)));
      expect(Math.abs(r.maxAy / car.baseAy - 1), car.id).toBeLessThanOrEqual(0.08);
    }
  }, 600000);

  it('AT6: time to 200 km/h (150 km/h for f4) stays within 3 % of master baseline', () => {
    for (const car of CARS) {
      const t = accelTime(parse(readCar(car.id)), car.vTargetKmh);
      expect(t, `${car.id} never reached ${car.vTargetKmh} km/h`).toBeGreaterThan(0);
      expect(Math.abs(t / car.baseT - 1), car.id).toBeLessThanOrEqual(0.03);
    }
  }, 300000);

  it('AT7: tests/unit/calibration/f4.test.ts and ow26.test.ts pass', () => {
    let code = 0;
    try {
      execFileSync(
        'npx',
        ['vitest', 'run', 'tests/unit/calibration/f4.test.ts', 'tests/unit/calibration/ow26.test.ts'],
        { cwd: ROOT, stdio: 'pipe' },
      );
    } catch (e) {
      code = (e as { status?: number }).status ?? 1;
    }
    expect(code, 'calibration suites exit code').toBe(0);
  }, 600000);
});
