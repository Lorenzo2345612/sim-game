import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, Surface, VehicleState } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

// Target API per task 065 (the coder lands it in src/physics/vehicle.ts). Declared
// here and cast so typecheck stays green pre-implementation; calls still fail at
// runtime until the methods exist.
interface WheelTelemetry {
  fz: number;
  kappa: number;
  alpha: number;
  tempC: number;
  wear: number;
  surface: Surface;
}
interface Telemetry {
  wheels: WheelTelemetry[];
  fuelKg: number;
  rpm: number;
  gear: number;
}
interface VehicleModel extends Vehicle {
  getTelemetry(out?: Telemetry): Telemetry;
  setCompound(name: 'soft' | 'medium' | 'hard'): void;
  setMultipliers(wear: number, fuel: number): void;
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
const FUEL0 = SPEC.fuel.startL * SPEC.fuel.densityKgL; // 14.9 kg
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function input(throttle: number, brake = 0, steer = 0): DriverInput {
  return { throttle, brake, steer, reset: false };
}

const worlds: World[] = [];

function makeVehicle(y = STATIC_Y): { v: VehicleModel; world: World } {
  const world = createPhysicsWorld();
  worlds.push(world);
  const v = new VehicleCtor(world, SPEC, { position: { x: 0, y, z: 0 }, yaw: 0 });
  return { v, world };
}

function step(v: Vehicle, world: World, inp: DriverInput): void {
  v.setInput(inp);
  v.prePhysicsStep(FIXED_DT);
  world.step();
}

function run(v: Vehicle, world: World, seconds: number, inp: DriverInput): void {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) step(v, world, inp);
}

// Settle 0.5 s, then 2 s full throttle straight (still 1st gear: no shift transients).
function launchRun(car: { v: Vehicle; world: World }): void {
  run(car.v, car.world, 0.5, IDLE);
  run(car.v, car.world, 2, input(1));
}

function stateNumbers(s: VehicleState): number[] {
  return [
    s.position.x,
    s.position.y,
    s.position.z,
    s.rotation.x,
    s.rotation.y,
    s.rotation.z,
    s.rotation.w,
    s.forwardSpeed,
  ];
}

function maxWear(t: Telemetry): number {
  return Math.max(...t.wheels.map((w) => w.wear));
}

function maxTemp(t: Telemetry): number {
  return Math.max(...t.wheels.map((w) => w.tempC));
}

describe('065 vehicle model edge cases', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    while (worlds.length > 0) worlds.pop()!.free();
  });

  it('EDGE1: prePhysicsStep ignores dt <= 0 and non-finite dt (run matches one without those calls)', () => {
    const a = makeVehicle();
    const b = makeVehicle();
    run(a.v, a.world, 0.5, IDLE);
    run(b.v, b.world, 0.5, IDLE);
    const bad = [0, -FIXED_DT, NaN, Infinity, -Infinity];
    for (let i = 0; i < 120; i++) {
      step(a.v, a.world, input(1, 0, 0.3));
      for (const dt of bad) b.v.prePhysicsStep(dt);
      step(b.v, b.world, input(1, 0, 0.3));
    }
    const na = stateNumbers(a.v.getState());
    const nb = stateNumbers(b.v.getState());
    expect(nb.every((x) => Number.isFinite(x))).toBe(true);
    for (let i = 0; i < na.length; i++) expect(nb[i]).toBeCloseTo(na[i], 6);
    const ta = a.v.getTelemetry();
    const tb = b.v.getTelemetry();
    expect(tb.fuelKg).toBeCloseTo(ta.fuelKg, 6);
    expect(tb.rpm).toBeCloseTo(ta.rpm, 6);
    expect(tb.gear).toBe(ta.gear);
    for (let i = 0; i < 4; i++) {
      expect(tb.wheels[i].fz).toBeCloseTo(ta.wheels[i].fz, 6);
      expect(tb.wheels[i].kappa).toBeCloseTo(ta.wheels[i].kappa, 6);
      expect(tb.wheels[i].tempC).toBeCloseTo(ta.wheels[i].tempC, 6);
      expect(tb.wheels[i].wear).toBeCloseTo(ta.wheels[i].wear, 6);
    }
  }, 30000);

  it('EDGE2: idle telemetry defaults: full fuel at closed throttle, gear 1, idle rpm, tyres cooling from 70 C with zero wear, asphalt surface', () => {
    const { v, world } = makeVehicle();
    const fresh = v.getTelemetry();
    expect(fresh.fuelKg).toBeCloseTo(FUEL0, 6);
    for (const w of fresh.wheels) {
      expect(w.tempC).toBeCloseTo(70, 6);
      expect(w.wear).toBeCloseTo(0, 9);
    }
    run(v, world, 2, IDLE);
    const t = v.getTelemetry();
    expect(t.fuelKg).toBeCloseTo(FUEL0, 6);
    expect(t.gear).toBe(1);
    expect(t.gear).toBe(v.gear());
    expect(Math.abs(t.rpm - SPEC.engine.idleRpm)).toBeLessThan(100);
    expect(Math.abs(t.rpm - v.rpm())).toBeLessThan(1);
    for (const w of t.wheels) {
      expect(w.wear).toBeLessThan(1e-5);
      expect(w.tempC).toBeLessThan(70);
      expect(w.tempC).toBeGreaterThan(68);
      expect(w.surface).toBe('asphalt');
    }
    expect(v.getWheelSurfaces()).toEqual(['asphalt', 'asphalt', 'asphalt', 'asphalt']);
  }, 30000);

  it('EDGE3: setMultipliers with non-finite or <= 0 values behaves as the default 1', () => {
    const a = makeVehicle();
    const c = makeVehicle();
    const d = makeVehicle();
    c.v.setMultipliers(NaN, -3);
    d.v.setMultipliers(Infinity, 0);
    for (const car of [a, c, d]) launchRun(car);
    const ta = a.v.getTelemetry();
    expect(ta.fuelKg).toBeLessThan(FUEL0);
    expect(maxWear(ta)).toBeGreaterThan(0);
    for (const car of [c, d]) {
      const t = car.v.getTelemetry();
      expect(t.fuelKg).toBeCloseTo(ta.fuelKg, 6);
      expect(maxWear(t)).toBeCloseTo(maxWear(ta), 8);
    }
  }, 30000);

  it('EDGE4: valid multipliers scale wear (~3x) and fuel burn (~2x); driven-wheel kappa is positive under throttle', () => {
    const a = makeVehicle();
    const b = makeVehicle();
    b.v.setMultipliers(3, 2);
    launchRun(a);
    launchRun(b);
    const ta = a.v.getTelemetry();
    const tb = b.v.getTelemetry();
    const wa = maxWear(ta);
    const wb = maxWear(tb);
    expect(wa).toBeGreaterThan(0);
    expect(wb).toBeGreaterThan(wa * 1.8);
    expect(wb).toBeLessThan(wa * 4.5);
    const burnA = FUEL0 - ta.fuelKg;
    const burnB = FUEL0 - tb.fuelKg;
    expect(burnA).toBeGreaterThan(0);
    expect(burnB).toBeGreaterThan(burnA * 1.6);
    expect(burnB).toBeLessThan(burnA * 2.6);
    // kappa = (omega*r - vx)/max(|vx|, V_LOW): positive on driven rears, below the free-rolling fronts' slip demand.
    expect(ta.wheels[2].kappa).toBeGreaterThan(0.01);
    expect(ta.wheels[2].kappa).toBeGreaterThan(ta.wheels[0].kappa);
  }, 30000);

  it('EDGE5: empty tank cuts drive torque (speed stops growing at full throttle)', () => {
    const { v, world } = makeVehicle();
    v.setMultipliers(1, 2000); // ~14.7 kg/s at full throttle: the 14.9 kg tank empties in ~1 s
    let ticks = 0;
    while (v.getTelemetry().fuelKg > 0 && ticks < 600) {
      step(v, world, input(1));
      ticks++;
    }
    expect(ticks).toBeLessThan(600);
    expect(v.getTelemetry().fuelKg).toBeCloseTo(0, 9);
    const vEmpty = v.getState().forwardSpeed;
    expect(vEmpty).toBeGreaterThan(2);
    run(v, world, 1, input(1));
    const after = v.getState();
    expect(Number.isFinite(after.forwardSpeed)).toBe(true);
    expect(after.forwardSpeed).toBeLessThanOrEqual(vEmpty + 0.01);
    expect(v.getTelemetry().fuelKg).toBeCloseTo(0, 9);
  }, 30000);

  it('EDGE6: chassis body mass equals massKg + fuelKg and follows the fuel burn', () => {
    const { v, world } = makeVehicle();
    expect(v.body.mass()).toBeCloseTo(SPEC.chassis.massKg + FUEL0, 1);
    v.setMultipliers(1, 100); // ~0.74 kg/s at full throttle
    run(v, world, 2, input(1));
    const fuel = v.getTelemetry().fuelKg;
    expect(fuel).toBeLessThan(FUEL0 - 0.5);
    expect(Math.abs(v.body.mass() - (SPEC.chassis.massKg + fuel))).toBeLessThan(0.15);
  }, 30000);

  it('EDGE7: setCompound resets tyre state to the warmers start (70 C, zero wear)', () => {
    const { v, world } = makeVehicle();
    run(v, world, 0.5, IDLE);
    run(v, world, 3, input(1));
    const hot = v.getTelemetry();
    expect(maxTemp(hot)).toBeGreaterThan(70.05);
    expect(maxWear(hot)).toBeGreaterThan(1e-6);
    v.setCompound('hard');
    for (const w of v.getTelemetry().wheels) {
      expect(w.tempC).toBeCloseTo(70, 6);
      expect(w.wear).toBeCloseTo(0, 9);
    }
  }, 30000);

  it('EDGE8: airborne wheels report fz = 0 and inContact false; contact returns after settling', () => {
    // Ray length restLength + radius = 0.41 m; at +0.5 m the ray cannot reach the ground.
    const { v, world } = makeVehicle(STATIC_Y + 0.5);
    v.setInput(IDLE);
    v.prePhysicsStep(FIXED_DT);
    for (const w of v.getTelemetry().wheels) {
      expect(w.fz).toBeCloseTo(0, 9);
      expect(Number.isFinite(w.kappa)).toBe(true);
    }
    expect(v.getState().wheels.every((w) => !w.inContact)).toBe(true);
    run(v, world, 3, IDLE);
    expect(v.getState().wheels.every((w) => w.inContact)).toBe(true);
    for (const w of v.getTelemetry().wheels) expect(w.fz).toBeGreaterThan(100);
  }, 30000);

  it('EDGE9: getState(out) and getTelemetry(out) reuse the passed objects and wheel arrays in place', () => {
    const { v, world } = makeVehicle(STATIC_Y + 0.05);
    run(v, world, 0.25, IDLE);
    const st = v.getState();
    const tel = v.getTelemetry();
    const telWheels = tel.wheels;
    const telW0 = tel.wheels[0];
    const stWheels = st.wheels;
    const stW0 = st.wheels[0];
    const yBefore = st.position.y;
    run(v, world, 10 / 120, IDLE);
    expect(v.getState(st)).toBe(st);
    expect(v.getTelemetry(tel)).toBe(tel);
    expect(tel.wheels).toBe(telWheels);
    expect(tel.wheels[0]).toBe(telW0);
    expect(st.wheels).toBe(stWheels);
    expect(st.wheels[0]).toBe(stW0);
    expect(Math.abs(st.position.y - yBefore)).toBeGreaterThan(1e-5);
  }, 30000);

  it('EDGE10: steering is front-only, slew-limited by steering.rate, positive = left, converging to maxAngleLow at rest', () => {
    const { v, world } = makeVehicle();
    run(v, world, 0.5, IDLE);
    const maxSlew = SPEC.steering.rate * FIXED_DT;
    // DriverInput steer -1 = full left; WheelState.steering positive = left.
    step(v, world, input(0, 0, -1));
    const first = v.getState();
    for (const i of [0, 1]) {
      expect(first.wheels[i].steering).toBeGreaterThan(0);
      expect(first.wheels[i].steering).toBeLessThanOrEqual(maxSlew + 1e-9);
    }
    expect(Math.abs(first.wheels[2].steering)).toBeLessThan(1e-9);
    expect(Math.abs(first.wheels[3].steering)).toBeLessThan(1e-9);
    run(v, world, 0.5, input(0, 0, -1));
    const settled = v.getState();
    expect(settled.wheels[0].steering).toBeCloseTo(SPEC.steering.maxAngleLow, 2);
    expect(settled.wheels[1].steering).toBeCloseTo(SPEC.steering.maxAngleLow, 2);
    expect(Math.abs(settled.forwardSpeed)).toBeLessThan(0.5);
  }, 30000);
});
