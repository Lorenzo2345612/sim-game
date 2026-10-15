import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import * as trackColliders from '../../../src/physics/trackColliders';
import { FIXED_DT, GRAVITY, MS_TO_KMH } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, Surface } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

// Task 162 lands src/physics/surfaceDrag.ts; the variable specifier keeps typecheck
// green until the module exists (the 065/141 cast pattern cannot cover a missing file).
const SURFACE_DRAG_MODULE = '../../../src/physics/surfaceDrag';
type RollingDrag = (surface: Surface, vLong: number, fz: number) => number;

const registerSurface = (
  trackColliders as unknown as {
    registerSurface: (collider: RAPIER.Collider, surface: Surface) => void;
  }
).registerSurface;

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

async function loadRollingDrag(): Promise<RollingDrag> {
  const mod = (await import(SURFACE_DRAG_MODULE)) as { rollingDrag: RollingDrag };
  return mod.rollingDrag;
}

function input(throttle: number): DriverInput {
  return { throttle, brake: 0, steer: 0, reset: false };
}

function spawn(y: number): SpawnPose {
  return { position: { x: 0, y, z: 0 }, yaw: 0 };
}

function step(car: Vehicle, world: World, inp: DriverInput): void {
  car.setInput(inp);
  car.prePhysicsStep(FIXED_DT);
  world.step();
}

function run(car: Vehicle, world: World, seconds: number, inp: DriverInput): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) step(car, world, inp);
}

function forwardKmh(car: Vehicle): number {
  return car.getState().forwardSpeed * MS_TO_KMH;
}

function horizSpeed(car: Vehicle): number {
  const v = car.body.linvel();
  return Math.hypot(v.x, v.z);
}

// The surface map is module-level, keyed by collider handle, and every fresh world
// reuses handle 0: the spacer holds handle 0 so AT7's unregistered asphalt ground
// (createPhysicsWorld) never reads a stale registration from AT3-AT6.
function surfWorld(surface: Surface): World {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1).setTranslation(0, -100, 0));
  const ground = world.createCollider(
    RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0),
  );
  registerSurface(ground, surface);
  return world;
}

// Row Given: chassis at `kmh` forward (-Z at yaw 0) with wheel spin matched, omega = v/R.
function launch(car: Vehicle, kmh: number): void {
  const v = kmh / MS_TO_KMH;
  car.body.setLinvel({ x: 0, y: 0, z: -v }, true);
  const wheels = (car as unknown as { wheels: Array<{ omega: number }> }).wheels;
  for (const w of wheels) w.omega = v / SPEC.wheels.radius;
}

function coastDistance(car: Vehicle, world: World): number {
  const start = car.body.translation();
  const x0 = start.x;
  const y0 = start.y;
  const z0 = start.z;
  const limit = 5 / MS_TO_KMH;
  const maxSteps = Math.round(120 / FIXED_DT);
  for (let i = 0; i < maxSteps && horizSpeed(car) >= limit; i++) {
    step(car, world, IDLE);
  }
  const end = car.body.translation();
  return Math.hypot(end.x - x0, end.y - y0, end.z - z0);
}

describe('162 offtrack rolling drag acceptance', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: rollingDrag is (c0 + c1*|v|)*fz on grass and gravel and 0 on asphalt and kerb', async () => {
    const rollingDrag = await loadRollingDrag();
    expect(rollingDrag('grass', 20, 1500)).toBeCloseTo(270, 9);
    expect(rollingDrag('gravel', 20, 1500)).toBeCloseTo(1020, 9);
    expect(rollingDrag('gravel', -20, 1500)).toBeCloseTo(1020, 9);
    expect(rollingDrag('asphalt', 50, 1500)).toBeCloseTo(0, 9);
    expect(rollingDrag('kerb', 50, 1500)).toBeCloseTo(0, 9);
  });

  it('AT2: rollingDrag returns 0 for non-finite speed and for negative load', async () => {
    const rollingDrag = await loadRollingDrag();
    expect(rollingDrag('grass', NaN, 1500)).toBeCloseTo(0, 10);
    expect(rollingDrag('grass', 20, -5)).toBeCloseTo(0, 10);
  });

  it('AT3: flat out 20 s from standstill on flat grass ends between 90 and 130 km/h', () => {
    world = surfWorld('grass');
    const car = new Vehicle(world, SPEC, spawn(STATIC_Y));
    run(car, world, 20, input(1));
    const kmh = forwardKmh(car);
    expect(kmh).toBeGreaterThanOrEqual(90);
    expect(kmh).toBeLessThanOrEqual(130);
  }, 30000);

  it('AT4: flat out 20 s from standstill on flat gravel ends between 5 and 30 km/h', () => {
    world = surfWorld('gravel');
    const car = new Vehicle(world, SPEC, spawn(STATIC_Y));
    run(car, world, 20, input(1));
    const kmh = forwardKmh(car);
    expect(kmh).toBeGreaterThanOrEqual(5);
    expect(kmh).toBeLessThanOrEqual(30);
  }, 30000);

  it('AT5: coasting from 200 km/h on flat gravel stops under 5 km/h within 100-180 m', () => {
    world = surfWorld('gravel');
    const car = new Vehicle(world, SPEC, spawn(STATIC_Y));
    run(car, world, 2, IDLE);
    launch(car, 200);
    const d = coastDistance(car, world);
    expect(d).toBeGreaterThanOrEqual(100);
    expect(d).toBeLessThanOrEqual(180);
  }, 60000);

  it('AT6: coasting from 200 km/h on flat grass stops under 5 km/h within 300-520 m', () => {
    world = surfWorld('grass');
    const car = new Vehicle(world, SPEC, spawn(STATIC_Y));
    run(car, world, 2, IDLE);
    launch(car, 200);
    const d = coastDistance(car, world);
    expect(d).toBeGreaterThanOrEqual(300);
    expect(d).toBeLessThanOrEqual(520);
  }, 60000);

  it('AT7: full throttle 6 s on the unregistered asphalt ground exceeds 100 km/h', () => {
    world = createPhysicsWorld();
    const car = new Vehicle(world, SPEC, spawn(STATIC_Y));
    run(car, world, 6, input(1));
    expect(forwardKmh(car)).toBeGreaterThan(100);
  }, 30000);
});
