import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT, GRAVITY, MS_TO_KMH } from '../../../src/core/constants';
import type { DriverInput, VehicleState } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;
type Script = (t: number, state: VehicleState) => DriverInput;

// Lab model reference for AT8; refresh with `node ai/lab/vehicle-model.mjs stint`
// (ai/lab/f4-carspec.json mirrors public/cars/f4.json): stint 90 s tyre temp
// FL/FR/RL/RR 79/83/96/102 C, stint 90 s fuel used 0.484 kg.
const LAB_TIRE_TEMP_C = [79, 83, 96, 102];
const LAB_FUEL_USED_KG = 0.484;

const STINT_SEED = 20260066;
const STINT_SEGMENT_S = 3;
const SKID_RADIUS = 100;
const SKID_CX = -SKID_RADIUS;

const ROOT = join(__dirname, '..', '..', '..');

function loadSpec(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

let world: World;
let vehicle: Vehicle;

function buildScenario(mutate?: (spec: CarSpec) => void): CarSpec {
  world = createPhysicsWorld();
  const spec = loadSpec();
  mutate?.(spec);
  vehicle = new Vehicle(world, spec, {
    position: { x: 0, y: spec.chassis.cgHeight, z: 0 },
    yaw: 0,
  });
  return spec;
}

function setSpeed(ms: number): void {
  vehicle.body.setLinvel({ x: 0, y: 0, z: -ms }, true);
}

function runScenario(script: Script, seconds: number): VehicleState {
  const steps = Math.round(seconds / FIXED_DT);
  const state = vehicle.getState();
  for (let i = 0; i < steps; i++) {
    vehicle.setInput(script(i * FIXED_DT, state));
    vehicle.prePhysicsStep(FIXED_DT);
    world.step();
    vehicle.getState(state);
  }
  return vehicle.getState();
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Segment {
  throttle: number;
  brake: number;
  steer: number;
  target: number; // speed-hold target in m/s; < 0 keeps the fixed throttle
}

// Seeded 90 s mixed stint: full throttle, braking, left/right corners, cruise.
function stintScript(seed: number): Script {
  const rand = mulberry32(seed);
  const plan: Segment[] = [];
  for (let i = 0; i < 30; i++) {
    const kind = i % 5;
    if (kind === 0) plan.push({ throttle: 1, brake: 0, steer: 0, target: -1 });
    else if (kind === 1) plan.push({ throttle: 0, brake: 0.7, steer: 0, target: -1 });
    else if (kind === 2) plan.push({ throttle: 0, brake: 0, steer: -(0.3 + 0.15 * rand()), target: 18 + 8 * rand() });
    else if (kind === 3) plan.push({ throttle: 0, brake: 0, steer: 0.3 + 0.15 * rand(), target: 18 + 8 * rand() });
    else plan.push({ throttle: 0, brake: 0, steer: (rand() * 2 - 1) * 0.15, target: 24 + 6 * rand() });
  }
  return (t, state) => {
    const seg = plan[Math.min(plan.length - 1, Math.floor(t / STINT_SEGMENT_S))];
    const throttle = seg.target >= 0 ? clamp(0.3 + 0.2 * (seg.target - state.forwardSpeed), 0, 1) : seg.throttle;
    return { throttle, brake: seg.brake, steer: seg.steer, reset: false };
  };
}

// ai/lab/vehicle-model.mjs tStint, with steer sign flipped (input -1 = full left).
function labStintScript(t: number, state: VehicleState): DriverInput {
  const speed = state.forwardSpeed;
  const phase = t % 15;
  if (phase < 5) return { throttle: 1, brake: 0, steer: 0, reset: false };
  if (phase < 7.5) return { throttle: 0, brake: 0.8, steer: 0, reset: false };
  if (phase < 12) {
    return {
      throttle: clamp(0.3 + 0.2 * (22 - speed), 0, 1),
      brake: 0,
      steer: -0.45 * Math.sign(Math.sin((t / 15) * 4)),
      reset: false,
    };
  }
  return { throttle: clamp(0.3 + 0.2 * (30 - speed), 0, 1), brake: 0, steer: 0.2, reset: false };
}

describe('066 F4 calibration acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world.free();
  });

  it('AT1: 0-100 km/h takes 3.4-4.2 s at full throttle with TC on', () => {
    buildScenario((spec) => {
      spec.aids.tc.enabled = true;
    });
    let t100 = -1;
    runScenario((t, state) => {
      if (t100 < 0 && state.forwardSpeed >= 100 / MS_TO_KMH) t100 = t;
      return { throttle: 1, brake: 0, steer: 0, reset: false };
    }, 6);
    expect(t100).toBeGreaterThanOrEqual(3.4);
    expect(t100).toBeLessThanOrEqual(4.2);
  }, 60000);

  it('AT2: vmax after 30 s full throttle is 215-235 km/h', () => {
    buildScenario();
    let vmax = 0;
    const end = runScenario((t, state) => {
      vmax = Math.max(vmax, state.forwardSpeed * MS_TO_KMH);
      return { throttle: 1, brake: 0, steer: 0, reset: false };
    }, 30);
    vmax = Math.max(vmax, end.forwardSpeed * MS_TO_KMH);
    expect(vmax).toBeGreaterThanOrEqual(215);
    expect(vmax).toBeLessThanOrEqual(235);
  }, 60000);

  it('AT3: braking from 150 km/h to a stop with ABS covers at most 60 m', () => {
    buildScenario((spec) => {
      spec.aids.abs.enabled = true;
    });
    const target = 150 / MS_TO_KMH;
    let braking = false;
    let brakeX = Number.NaN;
    let brakeY = Number.NaN;
    let brakeZ = Number.NaN;
    let stopped = false;
    const end = runScenario((t, state) => {
      if (!braking) {
        if (state.forwardSpeed < target) return { throttle: 1, brake: 0, steer: 0, reset: false };
        braking = true;
        brakeX = state.position.x;
        brakeY = state.position.y;
        brakeZ = state.position.z;
      } else if (state.forwardSpeed <= 0.3) {
        stopped = true;
      }
      return { throttle: 0, brake: 1, steer: 0, reset: false };
    }, 25);
    expect(braking, 'never reached 150 km/h').toBe(true);
    expect(stopped, 'never stopped within the scenario').toBe(true);
    const distance = Math.hypot(end.position.x - brakeX, end.position.y - brakeY, end.position.z - brakeZ);
    expect(distance).toBeLessThanOrEqual(60);
  }, 60000);

  it('AT4: max steady lateral accel on a 100 m constant radius is 1.5-2.2 g', () => {
    const spec = buildScenario();
    setSpeed(12);
    const wheelbase = spec.wheels.positions[2][2] - spec.wheels.positions[0][2];
    let vt = 12;
    let integral = 0;
    let best = 0;
    let lost = false;
    const script: Script = (t, state) => {
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
      const delta = Math.atan(wheelbase / SKID_RADIUS) + 0.04 * error + 0.01 * integral + headingErr;
      const v = vehicle.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      vt += 0.25 * FIXED_DT;
      const st = spec.steering;
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
    for (let i = 0; i < 200 && !lost; i++) runScenario(script, 1);
    expect(best).toBeGreaterThanOrEqual(1.5);
    expect(best).toBeLessThanOrEqual(2.2);
  }, 120000);

  it('AT5: heading vs velocity stays under 30 deg braking with full left steer at 150 km/h', () => {
    buildScenario((spec) => {
      spec.aids.abs.enabled = true;
      spec.brakes.bias = 0.6;
    });
    const target = 150 / MS_TO_KMH;
    runScenario((t, state) => {
      if (state.forwardSpeed < target) return { throttle: 1, brake: 0, steer: 0, reset: false };
      return {
        throttle: clamp(0.3 + 0.15 * (target - state.forwardSpeed), 0, 1),
        brake: state.forwardSpeed > target + 2 ? 0.3 : 0,
        steer: 0,
        reset: false,
      };
    }, 20);
    let maxBetaDeg = 0;
    runScenario((t, state) => {
      const v = vehicle.body.linvel();
      if (Math.hypot(v.x, v.z) > 3) {
        const q = state.rotation;
        const fwdX = -2 * (q.w * q.y + q.z * q.x);
        const fwdZ = -1 + 2 * (q.x * q.x + q.y * q.y);
        const heading = Math.atan2(-fwdX, -fwdZ);
        const course = Math.atan2(-v.x, -v.z);
        const beta = Math.atan2(Math.sin(heading - course), Math.cos(heading - course));
        maxBetaDeg = Math.max(maxBetaDeg, (Math.abs(beta) * 180) / Math.PI);
      }
      return { throttle: 0, brake: 1, steer: -1, reset: false };
    }, 2);
    expect(maxBetaDeg).toBeLessThan(30);
  }, 60000);

  it('AT6: yaw-rate second-difference RMS stays below 0.05 rad/s^3 at 5 km/h full lock', () => {
    buildScenario();
    setSpeed(5 / MS_TO_KMH);
    const yaw: number[] = [];
    runScenario((t, state) => {
      yaw.push(vehicle.body.angvel().y);
      const throttle = clamp(0.15 + 0.3 * (5 / MS_TO_KMH - state.forwardSpeed), 0, 1);
      return { throttle, brake: 0, steer: -1, reset: false };
    }, 5);
    const settle = 240; // skip the first 2 s of steering transient (lab reference)
    let sum = 0;
    let count = 0;
    for (let i = settle + 2; i < yaw.length; i++) {
      const d2 = (yaw[i] - 2 * yaw[i - 1] + yaw[i - 2]) / (FIXED_DT * FIXED_DT);
      sum += d2 * d2;
      count++;
    }
    expect(Math.sqrt(sum / count)).toBeLessThan(0.05);
  }, 60000);

  it('AT7: after a 90 s seeded stint tyres are 60-120 C, wear 0.5-5 %, fuel decreased', () => {
    buildScenario();
    const fuel0 = vehicle.getTelemetry().fuelKg;
    runScenario(stintScript(STINT_SEED), 90);
    const tel = vehicle.getTelemetry();
    for (const wheel of tel.wheels) {
      expect(wheel.tempC).toBeGreaterThanOrEqual(60);
      expect(wheel.tempC).toBeLessThanOrEqual(120);
      expect(wheel.wear).toBeGreaterThanOrEqual(0.005);
      expect(wheel.wear).toBeLessThanOrEqual(0.05);
    }
    expect(tel.fuelKg).toBeLessThan(fuel0);
  }, 120000);

  it('AT8: lab stint metrics stay within 15 % of the lab model results', () => {
    buildScenario();
    setSpeed(20);
    const fuel0 = vehicle.getTelemetry().fuelKg;
    runScenario(labStintScript, 90);
    const tel = vehicle.getTelemetry();
    for (let i = 0; i < LAB_TIRE_TEMP_C.length; i++) {
      const ref = LAB_TIRE_TEMP_C[i];
      expect(tel.wheels[i].tempC).toBeGreaterThanOrEqual(ref * 0.85);
      expect(tel.wheels[i].tempC).toBeLessThanOrEqual(ref * 1.15);
    }
    const used = fuel0 - tel.fuelKg;
    expect(used).toBeGreaterThanOrEqual(LAB_FUEL_USED_KG * 0.85);
    expect(used).toBeLessThanOrEqual(LAB_FUEL_USED_KG * 1.15);
  }, 120000);
});
