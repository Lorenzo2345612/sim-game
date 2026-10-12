import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { addTrackColliders } from '../../../src/physics/trackColliders';
import { Vehicle } from '../../../src/physics/vehicle';
import { PLACEHOLDER_CAR } from '../../../src/physics/vehicleConfig';
import { FIXED_DT, GRAVITY, SURFACE_DRAG, SURFACE_GRIP } from '../../../src/core/constants';
import type { DriverInput, Surface, SurfaceStrip, Terrain, TrackDataV2 } from '../../../src/core/types';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

type World = ReturnType<typeof createPhysicsWorld>;

// Flat grass terrain; zones are hand-built quads so boundaries are exact.
const CELLS = 40;
const terrain: Terrain = {
  originX: 0,
  originZ: -25,
  sizeX: 400,
  sizeZ: 400,
  rows: CELLS,
  cols: CELLS,
  heights: Array.from({ length: (CELLS + 1) * (CELLS + 1) }, () => 0),
};

const track: TrackDataV2 = {
  ...fixture,
  centerline: [
    [0, 0],
    [0, -2],
    [0, -4],
  ],
  lengthMeters: 4,
  elevation: [0, 0, 0],
  kerbs: [],
  runoffs: [],
  barriers: [],
  terrain,
};

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function rect(surface: Surface, x0: number, x1: number, zMin: number, zMax: number): SurfaceStrip {
  const y = 0.02;
  return {
    surface,
    positions: new Float32Array([x0, y, zMin, x1, y, zMin, x1, y, zMax, x0, y, zMax]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    uvs: new Float32Array(8),
  };
}

let world: World | null = null;
function zone(strips: SurfaceStrip[]): World {
  world?.free();
  const w = createPhysicsWorld();
  addTrackColliders(w, track, strips);
  world = w;
  return w;
}

function settle(w: World, x: number, z: number, yaw = 0): Vehicle {
  const car = new Vehicle(w, PLACEHOLDER_CAR, { position: { x, y: 0.6, z }, yaw });
  for (let i = 0; i < Math.round(1.5 / FIXED_DT); i++) {
    car.setInput(IDLE);
    car.prePhysicsStep(FIXED_DT);
    w.step();
  }
  return car;
}

function slipOf(car: Vehicle, i: number): number {
  const c = (car as unknown as { controller: { wheelFrictionSlip(i: number): number } }).controller;
  return c.wheelFrictionSlip(i);
}

describe('033 surface grip post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('scales frictionSlip by SURFACE_GRIP for kerb, runoff and gravel', () => {
    for (const surface of ['kerb', 'runoff', 'gravel'] as Surface[]) {
      const w = zone([rect(surface, -10, 10, -30, 10)]);
      const car = settle(w, 0, -10);
      expect(car.getWheelSurfaces()).toEqual([surface, surface, surface, surface]);
      car.prePhysicsStep(FIXED_DT);
      for (let i = 0; i < 4; i++) {
        expect(slipOf(car, i)).toBeCloseTo(
          PLACEHOLDER_CAR.frictionSlip * SURFACE_GRIP[surface],
          5,
        );
      }
    }
  }, 30000);

  it('drag opposes the actual horizontal direction (+X), not just -Z', () => {
    // Car faces +X and rolls along +X: tyre lateral force is zero, so the only
    // grip-dependent longitudinal deceleration is the surface drag itself.
    const yaw = -Math.PI / 2;
    const a = settle(zone([rect('asphalt', -6, 6, -60, 2)]), 0, -8, yaw);
    a.body.setLinvel({ x: 4, y: a.body.linvel().y, z: 0 }, true);
    a.prePhysicsStep(FIXED_DT);
    const xA = a.body.linvel().x; // read before zone() frees this world

    const gw = zone([rect('gravel', 6, 14, -60, 2)]);
    const gc = settle(gw, 10, -8, yaw);
    expect(gc.getWheelSurfaces()).toEqual(['gravel', 'gravel', 'gravel', 'gravel']);
    gc.body.setLinvel({ x: 4, y: gc.body.linvel().y, z: 0 }, true);
    gc.prePhysicsStep(FIXED_DT);
    const v = gc.body.linvel();

    // Pure-drag loss = SURFACE_DRAG x |g| x dt; aero acts equally on both cars.
    expect(xA - v.x).toBeCloseTo(SURFACE_DRAG.gravel * Math.abs(GRAVITY) * FIXED_DT, 3);
    // No spurious Z impulse: drag opposes v's (x, z), and here it is purely x.
    expect(Math.abs(v.z)).toBeLessThan(0.001);
  }, 20000);

  it('skips the drag impulse below 0.01 m/s horizontal speed', () => {
    const car = settle(zone([rect('gravel', -10, 10, -30, 10)]), 0, -10);
    expect(car.getWheelSurfaces()).toEqual(['gravel', 'gravel', 'gravel', 'gravel']);
    car.body.setLinvel({ x: 0, y: 0, z: -0.009 }, true);
    car.prePhysicsStep(FIXED_DT);
    const v = car.body.linvel();
    expect(v.z).toBeCloseTo(-0.009, 5); // not applied: un-skipped drag would cancel it
    expect(v.x).toBeCloseTo(0, 10);
  }, 20000);

  it('clamps the drag impulse so a large dt can cancel but never reverse the velocity', () => {
    const car = settle(zone([rect('gravel', -10, 10, -30, 10)]), 0, -10);
    car.body.setLinvel({ x: 0, y: 0, z: -0.02 }, true);
    car.prePhysicsStep(0.5);
    const v = car.body.linvel();
    // Uncamped drag over 0.5 s would reverse -0.02 m/s into about +2.9 m/s.
    expect(Math.abs(v.z)).toBeLessThan(0.001);
    expect(v.x).toBeCloseTo(0, 10);
  }, 20000);
});
