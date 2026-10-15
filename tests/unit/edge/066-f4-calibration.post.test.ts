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

// Lab model references; refresh with
//   node ai/lab/vehicle-model.mjs accel brake skid brakesteer stint
// run against ai/lab/f4-carspec.json mirroring public/cars/f4.json (058 AT4).
// The acceptance constants in tests/unit/calibration/f4.test.ts predate the final
// tuning; these are the lab's current output.
const LAB_T100_S = 4.0;
const LAB_VMAX_KMH = 223.5; // final speed after 80 s full throttle
const LAB_BRAKE_M = 44.8; // 150 km/h -> stop, ABS on
const LAB_SKID_G = 1.89; // R = 100 m constant radius
const LAB_BETA_DEG = 4.7; // full brake + full steer 2 s, ABS on, bias 0.6
const LAB_STINT_TEMP_C = [72, 79, 83, 94];
const LAB_STINT_FUEL_USED_KG = 0.472;
const LAB_STINT_WEAR_PCT = [1.15, 1.63, 1.8, 2.42];
const LAB_STINT_VMAX_KMH = 158;

const SKID_RADIUS = 100;
const SKID_CX = -SKID_RADIUS;

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL_THROTTLE: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const FULL_BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

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

// ai/lab/vehicle-model.mjs holdSpeed.
function holdSpeed(target: number): Script {
  return (t, state) => ({
    throttle: clamp(0.3 + 0.15 * (target - state.forwardSpeed), 0, 1),
    brake: state.forwardSpeed > target + 2 ? 0.3 : 0,
    steer: 0,
    reset: false,
  });
}

function betaDeg(state: VehicleState): number {
  const v = vehicle.body.linvel();
  const q = state.rotation;
  const fwdX = -2 * (q.w * q.y + q.z * q.x);
  const fwdZ = -1 + 2 * (q.x * q.x + q.y * q.y);
  const heading = Math.atan2(-fwdX, -fwdZ);
  const course = Math.atan2(-v.x, -v.z);
  return (Math.abs(Math.atan2(Math.sin(heading - course), Math.cos(heading - course))) * 180) / Math.PI;
}

// ai/lab/vehicle-model.mjs tStint, steer sign flipped (input -1 = full left).
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

describe('066 F4 calibration post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world.free();
  });

  it('POST1: 0-100 km/h time is within 15% of the lab 4.00 s', () => {
    buildScenario();
    let t100 = -1;
    runScenario((t, state) => {
      if (t100 < 0 && state.forwardSpeed >= 100 / MS_TO_KMH) t100 = t;
      return FULL_THROTTLE;
    }, 10);
    expect(t100, `t100=${t100.toFixed(3)} s`).toBeGreaterThanOrEqual(LAB_T100_S * 0.85);
    expect(t100, `t100=${t100.toFixed(3)} s`).toBeLessThanOrEqual(LAB_T100_S * 1.15);
  }, 60000);

  // Lab tAccel reports the final speed after 80 s; the world is re-centred every
  // 10 s because the flat test ground is only ±5000 m.
  it('POST2: terminal speed after 80 s full throttle is within 15% of the lab 223.5 km/h', () => {
    buildScenario();
    const state = vehicle.getState();
    for (let i = 0; i < Math.round(80 / FIXED_DT); i++) {
      vehicle.setInput(FULL_THROTTLE);
      vehicle.prePhysicsStep(FIXED_DT);
      world.step();
      vehicle.getState(state);
      if (i > 0 && i % 1200 === 0) {
        const p = vehicle.body.translation();
        vehicle.body.setTranslation({ x: 0, y: p.y, z: 0 }, true);
      }
    }
    const final = state.forwardSpeed * MS_TO_KMH;
    expect(final, `final=${final.toFixed(1)} km/h`).toBeGreaterThanOrEqual(LAB_VMAX_KMH * 0.85);
    expect(final, `final=${final.toFixed(1)} km/h`).toBeLessThanOrEqual(LAB_VMAX_KMH * 1.15);
  }, 180000);

  it('POST3: ABS braking from 150 km/h is within 15% of the lab 44.8 m', () => {
    buildScenario();
    setSpeed(150 / MS_TO_KMH);
    runScenario(holdSpeed(150 / MS_TO_KMH), 1);
    const p0 = vehicle.getState().position;
    let end = vehicle.getState();
    for (let i = 0; i < Math.round(20 / FIXED_DT); i++) {
      vehicle.setInput(FULL_BRAKE);
      vehicle.prePhysicsStep(FIXED_DT);
      world.step();
      end = vehicle.getState(end);
      if (end.forwardSpeed <= 0.3) break;
    }
    const d = Math.hypot(end.position.x - p0.x, end.position.y - p0.y, end.position.z - p0.z);
    expect(d, `distance=${d.toFixed(2)} m`).toBeGreaterThanOrEqual(LAB_BRAKE_M * 0.85);
    expect(d, `distance=${d.toFixed(2)} m`).toBeLessThanOrEqual(LAB_BRAKE_M * 1.15);
  }, 60000);

  it('POST4: constant-radius skidpad peak is within 15% of the lab 1.89 g', () => {
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
    expect(best, `best=${best.toFixed(3)} g`).toBeGreaterThanOrEqual(LAB_SKID_G * 0.85);
    expect(best, `best=${best.toFixed(3)} g`).toBeLessThanOrEqual(LAB_SKID_G * 1.15);
  }, 120000);

  // Lab perf scenarios start tyres at T0 = 90 C; the real Vehicle starts at 70 C,
  // so warm the tyres first to compare against the lab on equal footing.
  // Full brake from 32 down to 10 m/s, full throttle back up, with a slalom
  // so lateral slip heats both axles.
  function warmTyres(minMeanC: number, maxSeconds: number): number {
    const state = vehicle.getState();
    let braking = false;
    let mean = 70;
    for (let i = 0; i < Math.round(maxSeconds / FIXED_DT); i++) {
      const spd = Math.abs(state.forwardSpeed);
      if (spd >= 32) braking = true;
      else if (spd <= 10) braking = false;
      vehicle.setInput({
        throttle: braking ? 0 : 1,
        brake: braking ? 1 : 0,
        steer: Math.sin(i * FIXED_DT * 2) * 0.5,
        reset: false,
      });
      vehicle.prePhysicsStep(FIXED_DT);
      world.step();
      vehicle.getState(state);
      if (i % 60 === 59) {
        const tel = vehicle.getTelemetry();
        mean = (tel.wheels[0].tempC + tel.wheels[1].tempC + tel.wheels[2].tempC + tel.wheels[3].tempC) / 4;
        if (mean >= minMeanC) return mean;
      }
    }
    return mean;
  }

  it('POST5: brake + full steer peak slip angle is within 15% of the lab 4.7 deg', () => {
    buildScenario();
    const warmC = warmTyres(80, 90);
    // Lab entry: straight and yaw-aligned at 150 km/h (the slalom leaves yaw).
    setSpeed(150 / MS_TO_KMH);
    vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    vehicle.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    runScenario(holdSpeed(150 / MS_TO_KMH), 1);
    let maxBeta = 0;
    runScenario((t, state) => {
      const v = vehicle.body.linvel();
      if (Math.hypot(v.x, v.z) > 3) maxBeta = Math.max(maxBeta, betaDeg(state));
      return { throttle: 0, brake: 1, steer: -1, reset: false };
    }, 2);
    expect(warmC, `warm mean temp=${warmC.toFixed(1)} C`).toBeGreaterThanOrEqual(80);
    expect(maxBeta, `maxBeta=${maxBeta.toFixed(2)} deg at warm ${warmC.toFixed(1)} C`).toBeGreaterThanOrEqual(
      LAB_BETA_DEG * 0.85,
    );
    expect(maxBeta, `maxBeta=${maxBeta.toFixed(2)} deg at warm ${warmC.toFixed(1)} C`).toBeLessThanOrEqual(
      LAB_BETA_DEG * 1.15,
    );
  }, 120000);

  it('POST6: lab stint metrics agree with the current lab output within 15%', () => {
    buildScenario();
    setSpeed(20);
    const fuel0 = vehicle.getTelemetry().fuelKg;
    let vmax = 0;
    runScenario((t, state) => {
      const v = vehicle.body.linvel();
      vmax = Math.max(vmax, Math.hypot(v.x, v.z) * MS_TO_KMH);
      return labStintScript(t, state);
    }, 90);
    const tel = vehicle.getTelemetry();
    for (let i = 0; i < LAB_STINT_TEMP_C.length; i++) {
      const ref = LAB_STINT_TEMP_C[i];
      const temp = tel.wheels[i].tempC;
      expect(temp, `temp[${i}]=${temp.toFixed(1)} C vs ${ref}`).toBeGreaterThanOrEqual(ref * 0.85);
      expect(temp, `temp[${i}]=${temp.toFixed(1)} C vs ${ref}`).toBeLessThanOrEqual(ref * 1.15);
      const refPct = LAB_STINT_WEAR_PCT[i];
      const pct = tel.wheels[i].wear * 100;
      expect(pct, `wear[${i}]=${pct.toFixed(2)}% vs ${refPct}`).toBeGreaterThanOrEqual(refPct * 0.85);
      expect(pct, `wear[${i}]=${pct.toFixed(2)}% vs ${refPct}`).toBeLessThanOrEqual(refPct * 1.15);
    }
    const used = fuel0 - tel.fuelKg;
    expect(used, `fuel used=${used.toFixed(3)} kg`).toBeGreaterThanOrEqual(LAB_STINT_FUEL_USED_KG * 0.85);
    expect(used, `fuel used=${used.toFixed(3)} kg`).toBeLessThanOrEqual(LAB_STINT_FUEL_USED_KG * 1.15);
    expect(vmax, `vmax=${vmax.toFixed(1)} km/h`).toBeGreaterThanOrEqual(LAB_STINT_VMAX_KMH * 0.85);
    expect(vmax, `vmax=${vmax.toFixed(1)} km/h`).toBeLessThanOrEqual(LAB_STINT_VMAX_KMH * 1.15);
  }, 120000);

  it('POST7: 40 s stress chirp with throttle/brake stays finite and upright', () => {
    buildScenario();
    setSpeed(200 / MS_TO_KMH);
    let phase = 0;
    let bad = false;
    let flipped = false;
    for (let k = 0; k < Math.round(40 / FIXED_DT); k++) {
      const t = k * FIXED_DT;
      phase += 2 * Math.PI * (0.5 + 3 * (t / 40)) * FIXED_DT;
      const braking = Math.sin(t * 0.7) > 0.7;
      const steer =
        -Math.sign(Math.sin(phase)) * (t < 20 ? 1 : 0.5) * (Math.sin(t) > 0 ? 1 : 0.4);
      vehicle.setInput({
        throttle: braking ? 0 : 1,
        brake: braking ? 1 : 0,
        steer,
        reset: false,
      });
      vehicle.prePhysicsStep(FIXED_DT);
      world.step();
      const p = vehicle.body.translation();
      const lv = vehicle.body.linvel();
      const av = vehicle.body.angvel();
      const q = vehicle.body.rotation();
      const nums = [p.x, p.y, p.z, lv.x, lv.y, lv.z, av.x, av.y, av.z, q.x, q.y, q.z, q.w];
      if (!nums.every(Number.isFinite)) bad = true;
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      if (upY < 0.7) flipped = true;
      if (bad || flipped) break;
    }
    expect(bad, 'non-finite state during stress chirp').toBe(false);
    expect(flipped, 'car rolled over during stress chirp').toBe(false);
  }, 120000);

  it('POST8: tuned f4.json values stay in physically plausible bands', () => {
    buildScenario(); // uniform world lifecycle for afterEach
    const spec = loadSpec();
    for (const name of ['soft', 'medium', 'hard'] as const) {
      const c = spec.tyres.compounds[name];
      expect(c.mu0, `mu0 ${name}=${c.mu0}`).toBeGreaterThanOrEqual(1.2);
      expect(c.mu0, `mu0 ${name}=${c.mu0}`).toBeLessThanOrEqual(2.2);
      expect(c.Fz0, `Fz0 ${name}`).toBeGreaterThan(0);
      expect(c.loadSens, `loadSens ${name}`).toBeGreaterThanOrEqual(0);
      expect(c.loadSens, `loadSens ${name}`).toBeLessThanOrEqual(0.3);
      expect(c.wearRate, `wearRate ${name}=${c.wearRate}`).toBeGreaterThan(0);
      expect(c.wearRate, `wearRate ${name}=${c.wearRate}`).toBeLessThanOrEqual(1e-6);
      expect(c.tempWindowC, `tempWindowC ${name}`).toBeGreaterThan(0);
      expect(c.heatCoef, `heatCoef ${name}`).toBeGreaterThan(0);
      expect(c.coolCoef, `coolCoef ${name}`).toBeGreaterThan(0);
      expect(c.wearGripLoss, `wearGripLoss ${name}`).toBeGreaterThan(0);
      expect(c.wearGripLoss, `wearGripLoss ${name}`).toBeLessThan(1);
    }
    expect(spec.brakes.maxTorque, `maxTorque=${spec.brakes.maxTorque}`).toBeGreaterThanOrEqual(2000);
    expect(spec.brakes.maxTorque, `maxTorque=${spec.brakes.maxTorque}`).toBeLessThanOrEqual(8000);
    expect(spec.brakes.bias, `bias=${spec.brakes.bias}`).toBeGreaterThan(0);
    expect(spec.brakes.bias, `bias=${spec.brakes.bias}`).toBeLessThan(1);
    for (const axle of [spec.suspension.front, spec.suspension.rear]) {
      expect(axle.springRate).toBeGreaterThan(0);
      expect(axle.bumpDamping).toBeGreaterThan(0);
      expect(axle.reboundDamping).toBeGreaterThan(0);
      expect(axle.travel).toBeGreaterThan(0);
    }
    expect(spec.aero.cda).toBeGreaterThan(0);
    expect(spec.aero.claFront + spec.aero.claRear).toBeGreaterThan(0);
    expect(spec.aids.abs.slip).toBeGreaterThan(0);
    expect(spec.aids.tc.slip).toBeGreaterThan(0);
  });

  it('POST9: a zero or negative scenario duration runs no steps and leaves state unchanged', () => {
    buildScenario();
    runScenario(() => IDLE, 1);
    const before = vehicle.getState();
    expect(runScenario(() => FULL_THROTTLE, 0)).toEqual(before);
    expect(runScenario(() => FULL_THROTTLE, -5)).toEqual(before);
  }, 30000);
});
