import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { engineTorque } from '../../../src/physics/powertrain';
import { Gearbox } from '../../../src/physics/gearbox';
import { absScale, tcScale } from '../../../src/physics/brakes';
import { aeroForces } from '../../../src/physics/aero';
import { applySetup, defaultSetup } from '../../../src/physics/setup';
import { FIXED_DT, GRAVITY } from '../../../src/core/constants';
import type { DriverInput, VehicleState } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function load(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'ow26.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

const labs: { world: ReturnType<typeof createPhysicsWorld>; vehicle: Vehicle }[] = [];

function build(): { world: ReturnType<typeof createPhysicsWorld>; vehicle: Vehicle; spec: CarSpec } {
  const world = createPhysicsWorld();
  const spec = load();
  const vehicle = new Vehicle(world, spec, {
    position: { x: 0, y: spec.chassis.cgHeight, z: 0 },
    yaw: 0,
  });
  labs.push({ world, vehicle });
  return { world, vehicle, spec };
}

function run(
  world: ReturnType<typeof createPhysicsWorld>,
  vehicle: Vehicle,
  input: DriverInput,
  seconds: number,
): void {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) {
    vehicle.setInput(input);
    vehicle.prePhysicsStep(FIXED_DT);
    world.step();
  }
}

function finiteState(state: VehicleState): boolean {
  return (
    Number.isFinite(state.position.x) &&
    Number.isFinite(state.position.y) &&
    Number.isFinite(state.position.z) &&
    Number.isFinite(state.forwardSpeed) &&
    Number.isFinite(state.rotation.w)
  );
}

describe('221 OW-26 post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    for (const lab of labs) lab.world.free();
    labs.length = 0;
  });

  it('GAP1: the spawn mass carries the 60 L fuel load and burns down under power', () => {
    const { world, vehicle, spec } = build();
    const fuel0 = spec.fuel.startL * spec.fuel.densityKgL;
    expect(vehicle.body.mass()).toBeCloseTo(spec.chassis.massKg + fuel0, 1);
    expect(vehicle.getTelemetry().fuelKg).toBeCloseTo(fuel0, 6);
    run(world, vehicle, FULL, 5);
    const tel = vehicle.getTelemetry();
    const used = fuel0 - tel.fuelKg;
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThan(0.5);
    expect(vehicle.body.mass()).toBeCloseTo(spec.chassis.massKg + tel.fuelKg, 1);
  }, 60000);

  it('GAP2: the shipped aids stay inert at any slip, as the regulations require', () => {
    const { aids } = load();
    expect(aids.tc.enabled).toBe(false);
    expect(aids.abs.enabled).toBe(false);
    expect(tcScale(aids.tc, [1])).toBe(1);
    expect(tcScale(aids.tc, [0.5, 0.9])).toBe(1);
    expect(absScale(aids.abs, -1, 50)).toBe(1);
    expect(absScale(aids.abs, -0.5, 3.1)).toBe(1);
  });

  it('GAP3: active aero at full blend scales the Z-mode aero by 0.7 drag and 0.6 downforce', () => {
    const spec = load();
    const q = 0.5 * 1.225 * 50 * 50;
    const base = aeroForces(spec, 50, 0, undefined, undefined, 0);
    expect(base.drag).toBeCloseTo(q * spec.aero.cda, 6);
    expect(base.front).toBeCloseTo(q * spec.aero.claFront, 6);
    expect(base.rear).toBeCloseTo(q * spec.aero.claRear, 6);
    const open = aeroForces(spec, 50, 0, undefined, undefined, 1);
    expect(open.drag).toBeCloseTo(q * spec.aero.cda * spec.activeAero!.dragScale, 6);
    expect(open.front).toBeCloseTo(q * spec.aero.claFront * spec.activeAero!.downforceScale, 6);
    expect(open.rear).toBeCloseTo(q * spec.aero.claRear * spec.activeAero!.downforceScale, 6);
  });

  it('GAP4: the limiter cuts all drive torque at 15000 rpm', () => {
    const { engine } = load();
    expect(engine.limiterRpm).toBe(15000);
    expect(engineTorque(engine, engine.limiterRpm, 1)).toBe(0);
    expect(engineTorque(engine, engine.limiterRpm + 500, 1)).toBe(0);
    expect(engineTorque(engine, engine.limiterRpm - 1, 1)).toBeGreaterThan(0);
  });

  it('GAP5: the box clamps at the 8th ratio and back to 1 while rolling', () => {
    const spec = load();
    const box = new Gearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    box.setMode('manual');
    for (let i = 0; i < 12; i++) box.shiftUp();
    expect(box.gear).toBe(8);
    box.update(10, FIXED_DT);
    for (let i = 0; i < 12; i++) box.shiftDown();
    expect(box.gear).toBe(1);
  });

  it('GAP6: the default setup is a no-op and the wing steps move the Z-mode aero', () => {
    const spec = load();
    expect(applySetup(spec, defaultSetup(spec))).toEqual(spec);
    const up = applySetup(spec, { ...defaultSetup(spec), rearWing: spec.setup.rearWing.default + 2 });
    expect(up.aero.claRear - spec.aero.claRear).toBeCloseTo(2 * spec.aero.wingStep.claRear, 9);
    expect(up.aero.cda - spec.aero.cda).toBeCloseTo(2 * spec.aero.wingStep.cda, 9);
    expect(up.aero.claFront).toBeCloseTo(spec.aero.claFront, 9);
  });

  it('GAP7: zero, negative and non-finite dt are no-ops; one large step stays finite and upright', () => {
    const { world, vehicle, spec } = build();
    run(world, vehicle, IDLE, 0.5);
    const before = vehicle.getState();
    const bx = before.position.x;
    const by = before.position.y;
    const bz = before.position.z;
    const bv = before.forwardSpeed;
    vehicle.prePhysicsStep(0);
    vehicle.prePhysicsStep(-FIXED_DT);
    vehicle.prePhysicsStep(Number.NaN);
    const after = vehicle.getState();
    expect(after.position.x).toBeCloseTo(bx, 12);
    expect(after.position.y).toBeCloseTo(by, 12);
    expect(after.position.z).toBeCloseTo(bz, 12);
    expect(after.forwardSpeed).toBeCloseTo(bv, 12);
    vehicle.prePhysicsStep(0.5);
    world.step();
    const end = vehicle.getState();
    expect(finiteState(end)).toBe(true);
    expect(end.position.y).toBeGreaterThan(spec.chassis.cgHeight - Math.abs(GRAVITY));
  }, 60000);
});
