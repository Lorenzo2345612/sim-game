import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import { magic } from '../../../src/physics/tyre';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, Quat, SpawnPose, VehicleState } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

// New fields of task 254, declared here so typecheck stays green pre-implementation.
interface Spec254 extends CarSpec {
  chassis: CarSpec['chassis'] & { weightFront: number };
  tyres: CarSpec['tyres'] & { rearMuScale: number };
  wheels: CarSpec['wheels'] & { widthRear: number };
}

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const RAD_30 = (30 * Math.PI) / 180;

function readCar(id: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', `${id}.json`), 'utf8'));
}

function parse(json: unknown): Spec254 {
  return parseCarSpec(json) as unknown as Spec254;
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

function yawOf(q: Quat): number {
  const f = forwardOf(q);
  return Math.atan2(f.x, -f.z);
}

function sideslipOf(state: VehicleState, vx: number, vz: number): number {
  const f = forwardOf(state.rotation);
  return Math.atan2(f.z * vx - f.x * vz, f.x * vx + f.z * vz);
}

function maxAngleAt(spec: Spec254, speed: number): number {
  const st = spec.steering;
  return st.maxAngleLow + (st.maxAngleHigh - st.maxAngleLow) * Math.min(1, speed / st.fullSpeed);
}

// Road-wheel angle `rad` (positive = left): input.steer = -rad / maxAngle.
function steerInput(spec: Spec254, speed: number, rad: number): number {
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

function build(spec: Spec254): { world: World; vehicle: Vehicle } {
  const world = createPhysicsWorld();
  worlds.push(world);
  const vehicle = new Vehicle(world, spec, spawn(spec.chassis.cgHeight));
  return { world, vehicle };
}

describe('254 weight distribution and rear grip acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    for (const w of worlds) w.free();
    worlds.length = 0;
  });

  it('AT1: f4 without the new fields parses to weightFront 0.5, rearMuScale 1, widthRear = width', () => {
    const spec = parse(readCar('f4'));
    expect(spec.chassis.weightFront).toBeCloseTo(0.5, 10);
    expect(spec.tyres.rearMuScale).toBeCloseTo(1, 10);
    expect(spec.wheels.widthRear).toBeCloseTo(spec.wheels.width, 10);
  });

  // Scenario: 3 s full throttle, then 3 s full throttle with a held 0.1 rad road-wheel angle.
  it('AT2: f4 6 s scripted run ends bit-identical to the master baseline', () => {
    // Baselines recorded on master at test-writing time (acceptance worker, task 254).
    const BASE: Record<string, { px: number; py: number; pz: number; vx: number; vy: number; vz: number; yaw: number }> = {
      f4: {
        px: -50.53156661987305,
        py: 0.2664341330528259,
        pz: -84.34928894042969,
        vx: -22.587812423706055,
        vy: -0.048482734709978104,
        vz: 2.274357557296753,
        yaw: -2.517884875940575,
      },
      'gt3-a': {
        px: -49.1705322265625,
        py: 0.39768898487091064,
        pz: -74.67395782470703,
        vx: -29.053192138671875,
        vy: -0.03747045248746872,
        vz: -0.710335910320282,
        yaw: -1.66886982537661,
      },
    };
    const gotById: Record<string, Record<string, number>> = {};
    for (const id of ['f4']) {
      const spec = parse(readCar(id));
      const { world, vehicle } = build(spec);
      const n = Math.round(6 / FIXED_DT);
      for (let i = 0; i < n; i++) {
        const lv = vehicle.body.linvel();
        const speed = Math.hypot(lv.x, lv.y, lv.z);
        const t = i * FIXED_DT;
        const inp: DriverInput =
          t < 3 ? FULL : { throttle: 1, brake: 0, steer: steerInput(spec, speed, 0.1), reset: false };
        step(vehicle, world, inp);
      }
      const p = vehicle.body.translation();
      const lv = vehicle.body.linvel();
      gotById[id] = {
        px: p.x,
        py: p.y,
        pz: p.z,
        vx: lv.x,
        vy: lv.y,
        vz: lv.z,
        yaw: yawOf(vehicle.getState().rotation),
      };
    }
    for (const id of ['f4']) {
      const got = gotById[id];
      const b = BASE[id];
      for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'yaw'] as const) {
        expect(Math.abs(got[k] - b[k]), `${id}.${k}`).toBeLessThanOrEqual(1e-9);
      }
    }
  }, 60000);

  it('AT3: ow26 at rest settles to 0.455 front normal-load share within 0.01', () => {
    const spec = parse(readCar('ow26'));
    const { world, vehicle } = build(spec);
    run(vehicle, world, 2, IDLE);
    const wheels = vehicle.getTelemetry().wheels;
    const front = wheels[0].fz + wheels[1].fz;
    const total = wheels.reduce((a, w) => a + w.fz, 0);
    expect(total).toBeGreaterThan(0);
    expect(Math.abs(front / total - 0.455)).toBeLessThanOrEqual(0.01);
  }, 30000);

  // Rolling start at 15 m/s in 2nd gear, held 0.08 rad road-wheel angle, 3 s full throttle.
  function maxAbsSideslip(spec: Spec254): number {
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

  it('AT4: ow26 sideslip under a full-throttle step steer is ≤ 0.7x the neutral-spec run and never spins', () => {
    const json = readCar('ow26') as Record<string, unknown>;
    const neutral = parse({
      ...json,
      chassis: { ...(json.chassis as Record<string, unknown>), weightFront: 0.5 },
      tyres: { ...(json.tyres as Record<string, unknown>), rearMuScale: 1 },
    });
    const maxNew = maxAbsSideslip(parse(json));
    const maxNeutral = maxAbsSideslip(neutral);
    expect(maxNew).toBeLessThanOrEqual(0.7 * maxNeutral);
    expect(maxNew).toBeLessThan(RAD_30);
  }, 60000);

  it('AT5: on a 50 m limit circle the ow26 front slip-angle peak is reached first (no limit oversteer)', () => {
    const spec = parse(readCar('ow26'));
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
    expect(lost, 'never slid on the circle').toBe(true);
    expect(tFront, 'front axle never reached its peak slip angle').toBeDefined();
    if (tRear !== undefined) {
      expect(tFront as number).toBeLessThanOrEqual(tRear + 0.1);
    }
  }, 120000);

  it('AT6: tests/unit/calibration/ow26.test.ts passes', () => {
    let code = 0;
    try {
      execFileSync('npx', ['vitest', 'run', 'tests/unit/calibration/ow26.test.ts'], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    } catch (e) {
      code = (e as { status?: number }).status ?? 1;
    }
    expect(code, 'calibration ow26 suite exit code').toBe(0);
  }, 600000);

  it('AT7: weightFront 0.9 and rearMuScale 2 are rejected with a field-path error', () => {
    const base = readCar('f4') as Record<string, unknown>;
    const badFront = {
      ...base,
      chassis: { ...(base.chassis as Record<string, unknown>), weightFront: 0.9 },
    };
    const badRear = {
      ...base,
      tyres: { ...(base.tyres as Record<string, unknown>), rearMuScale: 2 },
    };
    expect(() => parseCarSpec(badFront)).toThrow(/Invalid car spec: chassis\.weightFront/);
    expect(() => parseCarSpec(badRear)).toThrow(/Invalid car spec: tyres\.rearMuScale/);
  });
});
