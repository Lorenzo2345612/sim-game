import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type {
  DriverInput,
  SurfaceStrip,
  TrackDataV2,
  VehicleState,
} from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { addTrackColliders, registerSurface } from '../../../src/physics/trackColliders';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { VehicleModel } from '../../../src/physics/vehicleModel';
import { gridSlots } from '../../../src/race/grid';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const N = 72;
const R = 50;
const ELEV = 1.5;
// Membership bit the chassis collider carries; wheel rays filter it out.
const CHASSIS_GROUP = 0x0002;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(aiCount: number, over: Partial<RaceConfig> = {}): RaceConfig {
  return {
    trackId: 'post-093',
    carId: 'f4',
    laps: 1,
    aiCount,
    difficulty: 'medium',
    seed: 1,
    ...over,
  };
}

function circleTrack(): TrackDataV2 {
  const centerline: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N;
    centerline.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return {
    version: 2,
    id: 'post-093',
    name: 'Post 093 ring',
    widthMeters: 16,
    lengthMeters: 2 * Math.PI * R,
    officialLengthMeters: 2 * Math.PI * R,
    centerline,
    sectors: [0, N / 3, (2 * N) / 3],
    elevation: new Array<number>(N).fill(ELEV),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: {
      originX: 0,
      originZ: 0,
      sizeX: 240,
      sizeZ: 240,
      rows: 1,
      cols: 1,
      heights: [0, 0, 0, 0],
    },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 1, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com', dem: 'test.tif' },
  };
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function horiz(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function stepUntilGo(game: RaceGame, input: DriverInput, maxTicks: number): boolean {
  let prev = game.startLights();
  for (let i = 0; i < maxTicks; i++) {
    game.step(input);
    const lights = game.startLights();
    if (prev > 0 && lights === 0) return true;
    prev = lights;
  }
  return false;
}

// Flat grass terrain; empty strips so the only registered surface is the terrain.
function grassWorld(): ReturnType<typeof createPhysicsWorld> {
  const w = createPhysicsWorld();
  addTrackColliders(w, { ...fixture }, [] as SurfaceStrip[]);
  return w;
}

function settle(w: ReturnType<typeof createPhysicsWorld>, car: VehicleModel): void {
  for (let i = 0; i < steps(1.5); i++) {
    car.setInput(IDLE);
    car.prePhysicsStep(FIXED_DT);
    w.step();
  }
}

describe('093 race game post-code gaps (tune on every car and wheel-ray groups)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('GAPS6-1: the tune reaches every car, so a huge fuel burn starves the AI as well', async () => {
    const track = circleTrack();
    const travelled = async (fuel: number): Promise<number> => {
      const game = await RaceGame.create(track, loadSpec(), raceConfig(1), {
        compound: 'medium',
        wear: 1,
        fuel,
      });
      try {
        expect(stepUntilGo(game, IDLE, steps(12))).toBe(true);
        const buf = buffers(2);
        game.getStates(buf);
        const start = { x: buf[1].position.x, z: buf[1].position.z };
        for (let i = 0; i < steps(2); i++) game.step(IDLE);
        game.getStates(buf);
        return horiz(buf[1].position, start);
      } finally {
        game.dispose();
      }
    };
    const starved = await travelled(1e6);
    const normal = await travelled(1);
    expect(normal, 'the normally fuelled AI drives off its slot').toBeGreaterThan(5);
    expect(starved, 'the starved AI is left without power').toBeLessThan(1);
  }, 180000);

  it('GAPS6-2: the wheel-surface rays skip chassis-group colliders but hit other ones', async () => {
    const w = grassWorld();
    try {
      const car = new VehicleModel(w, loadSpec(), { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
      settle(w, car);
      expect([...car.getWheelSurfaces()]).toEqual(['grass', 'grass', 'grass', 'grass']);
      // Slabs top 0.5 mm above the ground, clear of the tyre colliders; in the wheel-ray path: z = -1.469 is the front axle, z = 1.251 the rear one.
      const front = w.createCollider(
        RAPIER.ColliderDesc.cuboid(1.2, 0.05, 0.4).setTranslation(0, -0.0495, -1.469),
      );
      registerSurface(front, 'gravel');
      const rear = w.createCollider(
        RAPIER.ColliderDesc.cuboid(1.2, 0.05, 0.4)
          .setTranslation(0, -0.0495, 1.251)
          .setCollisionGroups((CHASSIS_GROUP << 16) | 0xffff),
      );
      registerSurface(rear, 'gravel');
      // The ray query pipeline only knows about the slabs after a step.
      w.step();
      expect(
        [...car.getWheelSurfaces()],
        'front rays hit the ordinary slab, rear rays see through the chassis slab',
      ).toEqual(['gravel', 'gravel', 'grass', 'grass']);
    } finally {
      w.free();
    }
  }, 60000);

  it('GAPS6-3: a chassis still collides with barrier-like statics', async () => {
    const w = createPhysicsWorld();
    try {
      w.createCollider(RAPIER.ColliderDesc.cuboid(6, 2, 0.4).setTranslation(0, 2, -12));
      const car = new VehicleModel(w, loadSpec(), { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
      const s = createVehicleState(4);
      for (let i = 0; i < steps(3); i++) {
        car.setInput(FULL);
        car.prePhysicsStep(FIXED_DT);
        w.step();
      }
      car.getState(s);
      expect(s.position.z, 'the car drives at the wall').toBeLessThan(-2);
      expect(s.position.z, 'the wall stops the car').toBeGreaterThan(-11);
    } finally {
      w.free();
    }
  }, 60000);

  it('GAPS6-4: only step throws after dispose; the other accessors stay readable', async () => {
    const game = await RaceGame.create(circleTrack(), loadSpec(), raceConfig(2));
    try {
      game.dispose();
      expect(() => game.step(IDLE)).toThrow();
      expect(game.standings().length).toBe(3);
      expect(game.carCount).toBe(3);
      expect(game.simTime).toBeGreaterThanOrEqual(0);
      expect(game.startLights()).toBeGreaterThanOrEqual(0);
      expect(game.raceFinished).toBe(false);
      const buf = buffers(3);
      expect(game.getStates(buf)).toBe(buf);
      expect(game.getPrevStates().length).toBe(3);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAPS6-5: getStates with an empty buffer returns it untouched', async () => {
    const game = await RaceGame.create(circleTrack(), loadSpec(), raceConfig(2));
    try {
      const out: VehicleState[] = [];
      expect(game.getStates(out)).toBe(out);
      expect(out.length).toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAPS6-6: driving away after go is never a jump start', async () => {
    const track = circleTrack();
    const game = await RaceGame.create(track, loadSpec(), raceConfig(1));
    try {
      const slot = gridSlots(track, 2)[1];
      expect(stepUntilGo(game, IDLE, steps(12))).toBe(true);
      for (let i = 0; i < steps(3); i++) game.step(FULL);
      const buf = buffers(2);
      game.getStates(buf);
      expect(horiz(buf[0].position, slot.position), 'the player drove off').toBeGreaterThan(5);
      for (const s of game.standings()) expect(s.penalty, `car ${s.car}`).toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAPS6-7: a second race can be created while the first one is still alive', async () => {
    const track = circleTrack();
    const a = await RaceGame.create(track, loadSpec(), raceConfig(1));
    const b = await RaceGame.create(track, loadSpec(), raceConfig(1, { seed: 2 }));
    try {
      for (let i = 0; i < steps(1); i++) {
        a.step(IDLE);
        b.step(IDLE);
      }
      a.dispose();
      expect(stepUntilGo(b, IDLE, steps(12))).toBe(true);
      const buf = buffers(2);
      b.getStates(buf);
      expect(Number.isFinite(buf[0].position.x + buf[1].position.z), 'the survivor keeps running').toBe(
        true,
      );
      expect(b.carCount).toBe(2);
    } finally {
      a.dispose();
      b.dispose();
    }
  }, 120000);
});
