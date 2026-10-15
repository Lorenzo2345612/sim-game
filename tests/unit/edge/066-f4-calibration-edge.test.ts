import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { PHASE0_GROUND_HALF_EXTENTS } from '../../../src/physics/trackColliders';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT, GRAVITY, MS_TO_KMH } from '../../../src/core/constants';
import type { DriverInput, VehicleState } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;
type Script = (t: number, state: VehicleState) => DriverInput;

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL_BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

// Lab stint references from `node ai/lab/vehicle-model.mjs stint` (tStint, 90 s, v0 20 m/s):
// wear % FL/FR/RL/RR 1.17/1.42/1.88/2.20, peak speed 158 km/h.
const LAB_STINT_WEAR_PCT = [1.17, 1.42, 1.88, 2.2];
const LAB_STINT_VMAX_KMH = 158;

function loadSpec(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

let world: World;
let vehicle: Vehicle;

function makeWorld(slope: boolean): World {
  if (!slope) return createPhysicsWorld();
  // 5 % grade: top face through the origin with height y = -z * tan(theta).
  const theta = Math.atan(0.05);
  const w = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  w.timestep = FIXED_DT;
  const he = PHASE0_GROUND_HALF_EXTENTS;
  w.createCollider(
    RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setRotation({ x: Math.sin(theta / 2), y: 0, z: 0, w: Math.cos(theta / 2) })
      .setTranslation(0, -he.y / Math.cos(theta), 0),
  );
  return w;
}

function buildScenario(opts?: { slope?: boolean; spawnOffset?: number }): CarSpec {
  world = makeWorld(opts?.slope ?? false);
  const spec = loadSpec();
  vehicle = new Vehicle(world, spec, {
    position: { x: 0, y: spec.chassis.cgHeight + (opts?.spawnOffset ?? 0), z: 0 },
    yaw: 0,
  });
  return spec;
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

function setSpeed(ms: number): void {
  vehicle.body.setLinvel({ x: 0, y: 0, z: -ms }, true);
}

function driftFrom(p0: { x: number; y: number; z: number }): number {
  const p = vehicle.getState().position;
  return Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z);
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

describe('066 F4 calibration edge cases', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world.free();
  });

  it('EDGE1: standstill on flat ground drifts less than 1 cm over 10 s after a 2 s settle', () => {
    buildScenario();
    runScenario(() => IDLE, 2);
    const p0 = vehicle.getState().position;
    runScenario(() => IDLE, 10);
    expect(driftFrom(p0)).toBeLessThan(0.01);
  }, 60000);

  it('EDGE2: on a 5 % slope with full brake the car drifts less than 5 cm over 10 s after a 2 s settle', () => {
    buildScenario({ slope: true });
    runScenario(() => FULL_BRAKE, 2);
    const p0 = vehicle.getState().position;
    runScenario(() => FULL_BRAKE, 10);
    expect(driftFrom(p0)).toBeLessThan(0.05);
  }, 60000);

  it('EDGE3: static ride height after 2 s settling is within 5 mm of the spec cgHeight', () => {
    const spec = buildScenario({ spawnOffset: 0.02 });
    runScenario(() => IDLE, 2);
    const y = vehicle.getState().position.y;
    expect(Math.abs(y - spec.chassis.cgHeight)).toBeLessThanOrEqual(0.005);
  }, 60000);

  it('EDGE4: tyre compounds keep the grip order soft > medium > hard', () => {
    const spec = buildScenario();
    const compounds = spec.tyres.compounds;
    expect(compounds.soft.mu0).toBeGreaterThan(compounds.medium.mu0);
    expect(compounds.medium.mu0).toBeGreaterThan(compounds.hard.mu0);
  });

  it('EDGE5: lab stint wear per wheel and peak speed stay within 15 % of the lab results', () => {
    buildScenario();
    setSpeed(20);
    let vmax = 0;
    runScenario((t, state) => {
      const v = vehicle.body.linvel();
      vmax = Math.max(vmax, Math.hypot(v.x, v.z) * MS_TO_KMH);
      return labStintScript(t, state);
    }, 90);
    const tel = vehicle.getTelemetry();
    for (let i = 0; i < LAB_STINT_WEAR_PCT.length; i++) {
      const ref = LAB_STINT_WEAR_PCT[i];
      const pct = tel.wheels[i].wear * 100;
      expect(pct, `wear FL/FR/RL/RR[${i}]`).toBeGreaterThanOrEqual(ref * 0.85);
      expect(pct, `wear FL/FR/RL/RR[${i}]`).toBeLessThanOrEqual(ref * 1.15);
    }
    expect(vmax).toBeGreaterThanOrEqual(LAB_STINT_VMAX_KMH * 0.85);
    expect(vmax).toBeLessThanOrEqual(LAB_STINT_VMAX_KMH * 1.15);
  }, 120000);

  it('EDGE6: setInput leaves the caller DriverInput unchanged over a 1 s run', () => {
    buildScenario();
    const inp: DriverInput = { throttle: 0.7, brake: 0.4, steer: -0.9, reset: false };
    const before = { ...inp };
    vehicle.setInput(inp);
    for (let i = 0; i < 120; i++) {
      vehicle.prePhysicsStep(FIXED_DT);
      world.step();
    }
    expect(inp).toEqual(before);
  }, 30000);
});
