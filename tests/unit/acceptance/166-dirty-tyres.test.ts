import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import type { WheelTelemetry } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import * as trackColliders from '../../../src/physics/trackColliders';
import { FIXED_DT, GRAVITY } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, Surface } from '../../../src/core/types';

// Task 166 lands src/physics/tyreDirt.ts; the variable specifier keeps typecheck
// green until the module exists (the 162 pattern).
const TYRE_DIRT_MODULE = '../../../src/physics/tyreDirt';
type UpdateDirt = (dirt: number, surface: Surface, speed: number, dt: number) => number;
type DirtGripFactor = (dirt: number, surface: Surface) => number;

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

async function loadUpdateDirt(): Promise<UpdateDirt> {
  const mod = (await import(TYRE_DIRT_MODULE)) as { updateDirt: UpdateDirt };
  return mod.updateDirt;
}

async function loadDirtGripFactor(): Promise<DirtGripFactor> {
  const mod = (await import(TYRE_DIRT_MODULE)) as { dirtGripFactor: DirtGripFactor };
  return mod.dirtGripFactor;
}

function input(throttle: number): DriverInput {
  return { throttle, brake: 0, steer: 0, reset: false };
}

function spawn(y: number): SpawnPose {
  return { position: { x: 0, y, z: 0 }, yaw: 0 };
}

function step(car: Vehicle, world: RAPIER.World, inp: DriverInput): void {
  car.setInput(inp);
  car.prePhysicsStep(FIXED_DT);
  world.step();
}

function run(car: Vehicle, world: RAPIER.World, seconds: number, inp: DriverInput): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) step(car, world, inp);
}

// The surface map is module-level, keyed by collider handle, and every fresh world
// reuses handle 0: the spacer holds handle 0 so any unregistered ground never
// reads a stale registration (same construction as the 162 tests).
function surfWorld(surface: Surface): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1).setTranslation(0, -100, 0));
  const ground = world.createCollider(
    RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0),
  );
  registerSurface(ground, surface);
  return world;
}

function wheelDirt(tel: WheelTelemetry): number {
  return (tel as WheelTelemetry & { dirt: number }).dirt;
}

describe('166 dirty tyres acceptance', () => {
  let world: RAPIER.World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: dirt 0 picks up 0.4 on gravel and 0.2 on grass at 10 m/s for 1 s', async () => {
    const updateDirt = await loadUpdateDirt();
    expect(updateDirt(0, 'gravel', 10, 1)).toBeCloseTo(0.2, 12);
    expect(updateDirt(0, 'grass', 10, 1)).toBeCloseTo(0.1, 12);
  });

  it('AT2: dirt 0.9 on gravel at 30 m/s for 1 s clamps to 1', async () => {
    const updateDirt = await loadUpdateDirt();
    expect(updateDirt(0.9, 'gravel', 30, 1)).toBeCloseTo(1, 12);
  });

  it('AT3: dirt 1 on asphalt, kerb and runoff decays by e^-1 over 150 m', async () => {
    const updateDirt = await loadUpdateDirt();
    const e = Math.exp(-1);
    for (const surface of ['asphalt', 'kerb', 'runoff'] as const) {
      expect(updateDirt(1, surface, 15, 10)).toBeCloseTo(e, 12);
    }
  });

  it('AT4: negative speed accumulates dirt by |speed|', async () => {
    const updateDirt = await loadUpdateDirt();
    expect(updateDirt(0, 'grass', -10, 1)).toBeCloseTo(0.1, 12);
  });

  it('AT5: non-finite dirt gives 0; non-finite speed or negative dt leaves dirt unchanged', async () => {
    const updateDirt = await loadUpdateDirt();
    expect(updateDirt(NaN, 'grass', 10, 1)).toBeCloseTo(0, 12);
    expect(updateDirt(0.5, 'grass', NaN, 1)).toBeCloseTo(0.5, 12);
    expect(updateDirt(0.5, 'grass', 10, -1)).toBeCloseTo(0.5, 12);
  });

  it('AT6: dirtGripFactor loses 10% grip on asphalt and kerb and stays 1 off-track', async () => {
    const dirtGripFactor = await loadDirtGripFactor();
    expect(dirtGripFactor(1, 'asphalt')).toBeCloseTo(0.9, 12);
    expect(dirtGripFactor(0.5, 'kerb')).toBeCloseTo(0.95, 12);
    expect(dirtGripFactor(1, 'grass')).toBeCloseTo(1, 12);
    expect(dirtGripFactor(1, 'gravel')).toBeCloseTo(1, 12);
    expect(dirtGripFactor(0, 'asphalt')).toBeCloseTo(1, 12);
    expect(dirtGripFactor(3, 'asphalt')).toBeCloseTo(0.9, 12);
  });

  it('AT7: F4 on gravel starts clean and rear wheels pick up dirt in 2 s of full throttle', () => {
    world = surfWorld('gravel');
    const car = new Vehicle(world, SPEC, spawn(STATIC_Y));
    for (const w of car.getTelemetry().wheels) {
      expect(wheelDirt(w)).toBeCloseTo(0, 12);
    }
    run(car, world, 2, input(1));
    const tel = car.getTelemetry();
    for (const w of tel.wheels) {
      expect(wheelDirt(w)).toBeLessThanOrEqual(1);
    }
    expect(wheelDirt(tel.wheels[2])).toBeGreaterThan(0);
    expect(wheelDirt(tel.wheels[3])).toBeGreaterThan(0);
  }, 30000);

  it('AT8: reset after a dirty gravel run zeroes every wheel dirt', () => {
    world = surfWorld('gravel');
    const car = new Vehicle(world, SPEC, spawn(STATIC_Y));
    run(car, world, 2, input(1));
    expect(wheelDirt(car.getTelemetry().wheels[2])).toBeGreaterThan(0);
    car.reset(spawn(STATIC_Y));
    for (const w of car.getTelemetry().wheels) {
      expect(wheelDirt(w)).toBeCloseTo(0, 12);
    }
  }, 30000);
});
