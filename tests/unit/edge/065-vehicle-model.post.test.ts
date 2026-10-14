import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { VehicleModel, type Telemetry } from '../../../src/physics/vehicleModel';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT, GRAVITY, MS_TO_KMH } from '../../../src/core/constants';
import type {
  DriverInput,
  SpawnPose,
  Surface,
  Terrain,
  TrackDataV2,
  VehicleState,
} from '../../../src/core/types';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

type World = ReturnType<typeof createPhysicsWorld>;

const ROOT = join(__dirname, '..', '..', '..');

function loadF4(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();
const STATIC_Y = SPEC.chassis.cgHeight;
const FUEL0 = SPEC.fuel.startL * SPEC.fuel.densityKgL;
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function input(throttle: number, brake = 0, steer = 0): DriverInput {
  return { throttle, brake, steer, reset: false };
}

const worlds: World[] = [];

function makeVehicle(
  spawn: SpawnPose = { position: { x: 0, y: STATIC_Y, z: 0 }, yaw: 0 },
  world?: World,
): { v: VehicleModel; world: World } {
  const owned = world === undefined;
  const w = world ?? createPhysicsWorld();
  if (owned) worlds.push(w);
  return { v: new VehicleModel(w, SPEC, spawn), world: w };
}

function step(v: VehicleModel, world: World, inp: DriverInput): void {
  v.setInput(inp);
  v.prePhysicsStep(FIXED_DT);
  world.step();
}

function run(v: VehicleModel, world: World, seconds: number, inp: DriverInput): void {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) step(v, world, inp);
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

function allFinite(v: VehicleModel): boolean {
  const t = v.getTelemetry();
  return (
    stateNumbers(v.getState()).every((x) => Number.isFinite(x)) &&
    Number.isFinite(t.fuelKg) &&
    Number.isFinite(t.rpm) &&
    t.wheels.every(
      (w) =>
        Number.isFinite(w.fz) &&
        Number.isFinite(w.kappa) &&
        Number.isFinite(w.alpha) &&
        Number.isFinite(w.tempC) &&
        Number.isFinite(w.wear),
    )
  );
}

// Same 0.02 m-lift strip layout as the 033 fixture: asphalt x = -6..6 (y = 0.02),
// gravel runoff on the right x = 6..14 (y = 0.01), flat grass terrain at y = 0.
const CELLS = 40;
const CENTERLINE: [number, number][] = [];
for (let i = 0; i <= 75; i++) CENTERLINE.push([0, -2 * i]);
for (let i = 1; i <= 15; i++) CENTERLINE.push([2 * i, -150]);
for (let i = 1; i <= 75; i++) CENTERLINE.push([30, -150 + 2 * i]);
for (let i = 1; i <= 14; i++) CENTERLINE.push([30 - 2 * i, 0]);
const TERRAIN: Terrain = {
  originX: 0,
  originZ: -75,
  sizeX: 400,
  sizeZ: 400,
  rows: CELLS,
  cols: CELLS,
  heights: Array.from({ length: (CELLS + 1) * (CELLS + 1) }, () => 0),
};
const TRACK: TrackDataV2 = {
  ...fixture,
  centerline: CENTERLINE,
  lengthMeters: 360,
  elevation: CENTERLINE.map(() => 0),
  kerbs: [],
  runoffs: [{ start: 0, end: 75, side: 'right', surface: 'gravel', widthMeters: 8 }],
  barriers: [],
  terrain: TERRAIN,
};

describe('065 vehicle model post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    while (worlds.length > 0) worlds.pop()!.free();
  });

  it('POST1: setInput clamps out-of-range values and maps NaN to 0', () => {
    const a = makeVehicle();
    const b = makeVehicle();
    for (let i = 0; i < 240; i++) {
      step(a.v, a.world, input(1, 0, -1));
      b.v.setInput({ throttle: 4.5, brake: -2, steer: -9, reset: false });
      b.v.prePhysicsStep(FIXED_DT);
      b.world.step();
    }
    const na = stateNumbers(a.v.getState());
    const nb = stateNumbers(b.v.getState());
    for (let i = 0; i < na.length; i++) expect(nb[i]).toBeCloseTo(na[i], 6);
    expect(b.v.getTelemetry().fuelKg).toBeCloseTo(a.v.getTelemetry().fuelKg, 6);
    const c = makeVehicle();
    const d = makeVehicle();
    for (let i = 0; i < 120; i++) {
      step(c.v, c.world, IDLE);
      d.v.setInput({ throttle: NaN, brake: NaN, steer: NaN, reset: false });
      d.v.prePhysicsStep(FIXED_DT);
      d.world.step();
    }
    const nd = stateNumbers(d.v.getState());
    expect(nd.every((x) => Number.isFinite(x))).toBe(true);
    const nc = stateNumbers(c.v.getState());
    for (let i = 0; i < nc.length; i++) expect(nd[i]).toBeCloseTo(nc[i], 6);
    expect(Math.abs(d.v.getState().forwardSpeed)).toBeLessThan(0.01);
  }, 30000);

  it('POST2: held brake at standstill never flips the auto box into reverse', () => {
    const { v, world } = makeVehicle();
    run(v, world, 1, input(0, 1));
    expect(v.gear()).toBe(1);
    expect(v.getTelemetry().gear).toBe(1);
    expect(Math.abs(v.getState().forwardSpeed)).toBeLessThan(0.1);
    expect(Math.abs(v.body.translation().z)).toBeLessThan(0.05);
  }, 30000);

  it('POST3: manual shiftDown at rest selects reverse, brake drives backwards, shiftDown returns to 1', () => {
    const { v, world } = makeVehicle();
    run(v, world, 0.5, IDLE);
    v.setGearMode('manual');
    step(v, world, IDLE);
    v.shiftDown();
    expect(v.gear()).toBe(-1);
    run(v, world, 1, input(0, 1));
    const s = v.getState();
    expect(s.forwardSpeed).toBeLessThan(-0.5);
    expect(s.position.z).toBeGreaterThan(0.3);
    const t = v.getTelemetry();
    expect(t.gear).toBe(-1);
    expect(Number.isFinite(v.rpm())).toBe(true);
    expect(t.wheels.every((w) => Number.isFinite(w.kappa))).toBe(true);
    v.shiftDown();
    expect(v.gear()).toBe(1);
    run(v, world, 1, input(1));
    expect(v.getState().forwardSpeed).toBeGreaterThan(0.5);
  }, 30000);

  it('POST4: shiftUp/shiftDown only act in manual mode and clamp to the ratio count', () => {
    const auto = makeVehicle();
    auto.v.shiftUp();
    auto.v.shiftDown();
    expect(auto.v.gear()).toBe(1);
    const { v } = makeVehicle();
    v.setGearMode('manual');
    v.shiftUp();
    expect(v.gear()).toBe(2);
    for (let i = 0; i < 10; i++) v.shiftUp();
    expect(v.gear()).toBe(SPEC.gearbox.ratios.length);
    v.shiftDown();
    expect(v.gear()).toBe(SPEC.gearbox.ratios.length - 1);
    expect(v.getTelemetry().gear).toBe(v.gear());
    expect(v.rpm()).toBeCloseTo(SPEC.engine.idleRpm, 6);
  }, 30000);

  it('POST5: closed throttle decelerates monotonically and the auto box downshifts to 1', () => {
    const { v, world } = makeVehicle();
    run(v, world, 0.5, IDLE);
    run(v, world, 6, input(1));
    const v0 = v.getState().forwardSpeed;
    expect(v0 * MS_TO_KMH).toBeGreaterThan(100);
    expect(v.gear()).toBeGreaterThanOrEqual(2);
    const samples: number[] = [];
    for (let i = 0; i < 18; i++) {
      run(v, world, 1, IDLE);
      samples.push(v.getState().forwardSpeed);
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1] - 0.05);
    }
    expect(samples[samples.length - 1]).toBeLessThan(v0 - 10);
    expect(v.gear()).toBe(1);
    expect(allFinite(v)).toBe(true);
  }, 60000);

  it('POST6: at speed the wheel loads exceed static weight by aero downforce', () => {
    const { v, world } = makeVehicle();
    run(v, world, 6, input(1));
    const s = v.getState();
    expect(s.forwardSpeed * MS_TO_KMH).toBeGreaterThan(100);
    const t = v.getTelemetry();
    const weight = (SPEC.chassis.massKg + t.fuelKg) * Math.abs(GRAVITY);
    const sum = t.wheels.reduce((acc, w) => acc + w.fz, 0);
    expect(sum).toBeGreaterThan(weight * 1.08);
    expect(sum).toBeLessThan(weight * 1.6);
  }, 30000);

  it('POST7: the steering limit blends down with speed below the at-rest value', () => {
    const slow = makeVehicle();
    run(slow.v, slow.world, 1, IDLE);
    run(slow.v, slow.world, 0.7, input(0, 0, -0.1));
    const slowSteer = slow.v.getState().wheels[0].steering;
    expect(slowSteer).toBeCloseTo(0.1 * SPEC.steering.maxAngleLow, 3);
    const fast = makeVehicle();
    run(fast.v, fast.world, 6, input(1));
    run(fast.v, fast.world, 0.7, input(1, 0, -0.1));
    const fs = fast.v.getState();
    expect(fs.forwardSpeed).toBeGreaterThan(25);
    const fastSteer = fs.wheels[0].steering;
    expect(fastSteer).toBeGreaterThan(0.1 * SPEC.steering.maxAngleHigh);
    expect(fastSteer).toBeLessThan(slowSteer - 0.008);
    expect(fs.wheels[1].steering).toBeCloseTo(fastSteer, 6);
  }, 30000);

  it('POST8: soft wears faster than medium, hard slowest; default compound is medium', () => {
    const def = makeVehicle();
    const soft = makeVehicle();
    const hard = makeVehicle();
    const med = makeVehicle();
    soft.v.setCompound('soft');
    hard.v.setCompound('hard');
    med.v.setCompound('medium');
    for (const car of [def, soft, hard, med]) {
      run(car.v, car.world, 0.5, IDLE);
      run(car.v, car.world, 2, input(1));
    }
    const wd = maxWear(def.v.getTelemetry());
    const ws = maxWear(soft.v.getTelemetry());
    const wh = maxWear(hard.v.getTelemetry());
    const wm = maxWear(med.v.getTelemetry());
    expect(wd).toBeGreaterThan(0);
    expect(ws).toBeGreaterThan(wd * 1.3);
    expect(ws).toBeLessThan(wd * 3.2);
    expect(wh).toBeLessThan(wd / 1.3);
    expect(wh).toBeGreaterThan(wd / 3.2);
    expect(wm).toBeCloseTo(wd, 8);
    const nd = stateNumbers(def.v.getState());
    const nm = stateNumbers(med.v.getState());
    for (let i = 0; i < nd.length; i++) expect(nm[i]).toBeCloseTo(nd[i], 6);
  }, 30000);

  it('POST9: getTelemetry(out) replaces a wrong-length wheels array in place', () => {
    const { v, world } = makeVehicle();
    run(v, world, 0.5, IDLE);
    const tel: Telemetry = { wheels: [], fuelKg: 0, rpm: 0, gear: 0 };
    expect(v.getTelemetry(tel)).toBe(tel);
    expect(tel.wheels.length).toBe(4);
    for (const w of tel.wheels) {
      expect(w.fz).toBeGreaterThan(100);
      expect(w.surface).toBe('asphalt');
    }
    const two: Telemetry = {
      wheels: [
        { fz: 0, kappa: 0, alpha: 0, tempC: 0, wear: 0, surface: 'asphalt' },
        { fz: 0, kappa: 0, alpha: 0, tempC: 0, wear: 0, surface: 'asphalt' },
      ],
      fuelKg: 0,
      rpm: 0,
      gear: 0,
    };
    const kept = two.wheels;
    v.getTelemetry(two);
    expect(two.wheels).not.toBe(kept);
    expect(two.wheels.length).toBe(4);
    expect(two.wheels[3].fz).toBeGreaterThan(100);
  }, 30000);

  it('POST10: reset restores the spawn pose with yaw, zeroes velocities and wheel spin, clears inputs', () => {
    const { v, world } = makeVehicle();
    run(v, world, 0.5, IDLE);
    run(v, world, 2, input(1, 0, -0.3));
    const spawn: SpawnPose = { position: { x: 3, y: STATIC_Y, z: -7 }, yaw: Math.PI / 2 };
    v.reset(spawn);
    const t = v.body.translation();
    expect(t.x).toBeCloseTo(3, 6);
    expect(t.y).toBeCloseTo(STATIC_Y, 6);
    expect(t.z).toBeCloseTo(-7, 6);
    const q = v.body.rotation();
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    expect(q.z).toBeCloseTo(0, 6);
    expect(q.w).toBeCloseTo(Math.cos(Math.PI / 4), 6);
    const lv = v.body.linvel();
    const av = v.body.angvel();
    for (const c of [lv.x, lv.y, lv.z, av.x, av.y, av.z]) expect(Math.abs(c)).toBeLessThan(1e-6);
    const st = v.getState();
    expect(Math.abs(st.forwardSpeed)).toBeLessThan(1e-6);
    for (const w of st.wheels) expect(Math.abs(w.rotation)).toBeLessThan(1e-9);
    // Inputs were cleared: stepping without setInput must not drive or steer.
    for (let i = 0; i < 60; i++) {
      v.prePhysicsStep(FIXED_DT);
      world.step();
    }
    const st2 = v.getState();
    expect(Math.abs(st2.forwardSpeed)).toBeLessThan(0.1);
    expect(Math.abs(st2.position.y - STATIC_Y)).toBeLessThan(0.01);
    expect(st2.wheels.every((w) => Math.abs(w.steering) < 1e-9)).toBe(true);
  }, 30000);

  it('POST11: reset zeroes front-wheel steering immediately, like Vehicle.reset', () => {
    const { v, world } = makeVehicle();
    run(v, world, 0.5, IDLE);
    run(v, world, 2, input(1, 0, -0.3));
    expect(Math.abs(v.getState().wheels[0].steering)).toBeGreaterThan(0.01);
    v.reset({ position: { x: 0, y: STATIC_Y, z: 0 }, yaw: 0 });
    const st = v.getState();
    for (const w of st.wheels) expect(Math.abs(w.steering)).toBeLessThan(1e-9);
  }, 30000);

  it('POST12: a yawed spawn drives along the facing direction with positive forwardSpeed', () => {
    const { v, world } = makeVehicle({ position: { x: 0, y: STATIC_Y, z: 0 }, yaw: Math.PI / 2 });
    run(v, world, 0.5, IDLE);
    run(v, world, 1.5, input(1));
    const s = v.getState();
    expect(s.forwardSpeed).toBeGreaterThan(3);
    expect(s.position.x).toBeLessThan(-3);
    expect(Math.abs(s.position.z)).toBeLessThan(2);
    expect(s.rotation.y).toBeCloseTo(Math.sin(Math.PI / 4), 1);
  }, 30000);

  it('POST13: free fall keeps wheels unloaded and cool; throttle spins only the driven wheels', () => {
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    world.timestep = FIXED_DT;
    worlds.push(world);
    const v = new VehicleModel(world, SPEC, { position: { x: 0, y: 10, z: 0 }, yaw: 0 });
    run(v, world, 2, input(1));
    const st = v.getState();
    expect(st.wheels.every((w) => !w.inContact)).toBe(true);
    expect(Math.abs(st.wheels[0].rotation)).toBeLessThan(1e-6);
    expect(Math.abs(st.wheels[1].rotation)).toBeLessThan(1e-6);
    expect(st.wheels[2].rotation).toBeGreaterThan(10);
    expect(st.wheels[3].rotation).toBeGreaterThan(10);
    const t = v.getTelemetry();
    for (const w of t.wheels) {
      expect(w.fz).toBeCloseTo(0, 9);
      expect(w.kappa).toBeCloseTo(0, 9);
      expect(w.wear).toBeCloseTo(0, 9);
      expect(w.surface).toBe('asphalt');
      expect(w.tempC).toBeLessThan(70);
      expect(w.tempC).toBeGreaterThan(65);
    }
    expect(t.fuelKg).toBeLessThan(FUEL0);
    expect(t.fuelKg).toBeGreaterThan(FUEL0 - 0.1);
    expect(allFinite(v)).toBe(true);
  }, 30000);

  it('POST14: getState wheel positions track the spec mounts at static ride height', () => {
    const { v, world } = makeVehicle();
    run(v, world, 2, IDLE);
    const st = v.getState();
    expect(st.position.y).toBeCloseTo(STATIC_Y, 1);
    for (let i = 0; i < 4; i++) {
      const wp = SPEC.wheels.positions[i];
      expect(st.wheels[i].position.x).toBeCloseTo(st.position.x + wp[0], 1);
      expect(st.wheels[i].position.y).toBeCloseTo(st.position.y + wp[1], 1);
      expect(st.wheels[i].position.z).toBeCloseTo(st.position.z + wp[2], 1);
      expect(st.wheels[i].inContact).toBe(true);
    }
  }, 30000);

  it('POST15: a single large dt leaves state and telemetry finite and the car recoverable', () => {
    const { v, world } = makeVehicle();
    run(v, world, 0.5, IDLE);
    v.prePhysicsStep(10 * FIXED_DT);
    world.step();
    expect(allFinite(v)).toBe(true);
    run(v, world, 2, IDLE);
    expect(allFinite(v)).toBe(true);
    v.prePhysicsStep(0.5);
    world.step();
    expect(allFinite(v)).toBe(true);
    run(v, world, 3, IDLE);
    expect(allFinite(v)).toBe(true);
    expect(Math.abs(v.getState().position.y - STATIC_Y)).toBeLessThan(0.5);
  }, 30000);

  it('POST16: a left steer input yaws the car left with non-zero front slip angles', () => {
    const { v, world } = makeVehicle();
    run(v, world, 0.5, IDLE);
    run(v, world, 3, input(1));
    expect(v.getState().forwardSpeed).toBeGreaterThan(15);
    run(v, world, 1, input(0, 0, -0.5)); // closed throttle, half left lock
    const q = v.body.rotation();
    expect(v.body.angvel().y).toBeGreaterThan(0.05); // positive yaw = left
    const fwdX = -2 * (q.x * q.z + q.w * q.y);
    expect(fwdX).toBeLessThan(-0.1); // nose points left of -Z
    const s = v.getState();
    expect(s.position.x).toBeLessThan(-0.5);
    expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(0.8); // still upright
    const t = v.getTelemetry();
    expect(Math.abs(t.wheels[0].alpha)).toBeGreaterThan(0.002);
    expect(Math.abs(t.wheels[1].alpha)).toBeGreaterThan(0.002);
    expect(allFinite(v)).toBe(true);
  }, 30000);

  it('POST17: compound grip scales braking force: soft stops shortest, hard longest', () => {
    function brakeDistance(compound: 'soft' | 'medium' | 'hard'): number {
      const { v, world } = makeVehicle();
      v.setCompound(compound);
      run(v, world, 0.5, IDLE);
      run(v, world, 4, input(1));
      // Equalise the entry state: exactly 25 m/s along -Z, no yaw rate.
      v.body.setLinvel({ x: 0, y: v.body.linvel().y, z: -25 }, true);
      v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const p0 = v.body.translation();
      const x0 = p0.x;
      const z0 = p0.z;
      for (let i = 0; i < 600; i++) {
        step(v, world, input(0, 1));
        const lv = v.body.linvel();
        if (Math.hypot(lv.x, lv.z) < 0.5) break;
      }
      expect(allFinite(v)).toBe(true);
      const p1 = v.body.translation();
      return Math.hypot(p1.x - x0, p1.z - z0);
    }
    const dSoft = brakeDistance('soft');
    const dMed = brakeDistance('medium');
    const dHard = brakeDistance('hard');
    for (const d of [dSoft, dMed, dHard]) {
      expect(d).toBeGreaterThan(8);
      expect(d).toBeLessThan(40);
    }
    expect(dSoft).toBeLessThan(dMed);
    expect(dMed).toBeLessThan(dHard);
    expect(dSoft).toBeLessThan(dHard * 0.95); // mu0 1.749 vs 1.5675: ~10% apart
  }, 60000);

  // Runs last: addTrackColliders fills the module-global surface map of trackColliders,
  // and freed-world collider handles get reused by later plain worlds.
  it('POST18: rays report the gravel strip surface and its rolling drag slows the car', () => {
    const world = createPhysicsWorld(TRACK);
    worlds.push(world);
    function coastFrom(x: number): { speed: number; surfaces: Surface[]; tel: Surface[] } {
      const { v } = makeVehicle({ position: { x, y: STATIC_Y + 0.05, z: -50 }, yaw: 0 }, world);
      run(v, world, 1.5, IDLE);
      const surfaces = v.getWheelSurfaces().slice();
      const tel = v.getTelemetry().wheels.map((w) => w.surface);
      v.body.setLinvel({ x: 0, y: v.body.linvel().y, z: -30 }, true);
      run(v, world, 2, IDLE);
      const lv = v.body.linvel();
      return { speed: Math.hypot(lv.x, lv.z), surfaces, tel };
    }
    const asphalt = coastFrom(0);
    const gravel = coastFrom(10);
    const four = (s: Surface) => [s, s, s, s];
    expect(asphalt.surfaces).toEqual(four('asphalt'));
    expect(asphalt.tel).toEqual(four('asphalt'));
    expect(gravel.surfaces).toEqual(four('gravel'));
    expect(gravel.tel).toEqual(four('gravel'));
    expect(gravel.speed).toBeLessThan(asphalt.speed - 1);
  }, 30000);
});
