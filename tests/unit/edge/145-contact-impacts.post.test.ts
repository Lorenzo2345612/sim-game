import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, Vec3 } from '../../../src/core/types';
import type { CarZones, DamageState } from '../../../src/physics/damage';
import {
  processContactEvents,
  toLocalPoint,
  type DamageCar,
  type DamageMode,
} from '../../../src/physics/contactEvents';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { barrierRuns } from '../../../src/track/barrierPath';
import type { TrackDataV2 } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const ROOT = join(__dirname, '..', '..', '..');
const WALL_Z = 8;
const WALL_FACE = WALL_Z + 0.5;
const SPAWN_Y = 0.35;
const GAP_M = 2;
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const ZERO_DAMAGE: DamageState = {
  frontWing: 0,
  rearWing: 0,
  suspension: [0, 0, 0, 0],
  puncture: [false, false, false, false],
  detached: [false, false, false, false],
};

interface ContactVehicle extends Vehicle {
  readonly chassisCollider: RAPIER.Collider;
  readonly zones: CarZones;
  readonly damage: DamageState;
  damageMode: DamageMode;
}
const VehicleCtor = Vehicle as unknown as new (
  world: World,
  spec: CarSpec,
  spawn: SpawnPose,
) => ContactVehicle;

function loadSpec(): CarSpec {
  return parseCarSpec(
    JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown,
  );
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(
    JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'), 'utf8')) as unknown,
  ) as TrackDataV2;
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function tick(car: ContactVehicle): void {
  car.setInput(IDLE);
  car.prePhysicsStep(FIXED_DT);
}

function damageCarOf(car: ContactVehicle): DamageCar {
  return {
    chassis: car.chassisCollider,
    body: car.body,
    zones: car.zones,
    damage: car.damage,
    damageMode: car.damageMode,
  };
}

function snapshotDamage(state: DamageState): DamageState {
  return {
    frontWing: state.frontWing,
    rearWing: state.rearWing,
    suspension: [...state.suspension] as [number, number, number, number],
    puncture: [...state.puncture] as [boolean, boolean, boolean, boolean],
    detached: [...state.detached] as [boolean, boolean, boolean, boolean],
  };
}

function wallSpawn(spec: CarSpec, x = 0): SpawnPose {
  return {
    position: { x, y: SPAWN_Y, z: WALL_FACE + spec.chassis.halfExtents.z + GAP_M },
    yaw: 0,
  };
}

function addWall(world: World, halfX = 5): void {
  world.createCollider(RAPIER.ColliderDesc.cuboid(halfX, 2, 0.5).setTranslation(0, 1, WALL_Z));
}

// Drive with a speed cap so the car stays stable on the flat ground plane.
function driveFlat(
  car: ContactVehicle,
  world: World,
  queue: RAPIER.EventQueue,
  seconds: number,
  cars: readonly DamageCar[],
  rng: () => number,
  maxSpeed = Infinity,
): void {
  for (let i = 0; i < steps(seconds); i++) {
    const v = car.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    car.setInput(speed < maxSpeed ? { throttle: 0.4, brake: 0, steer: 0, reset: false } : IDLE);
    car.prePhysicsStep(FIXED_DT);
    world.step(queue);
    processContactEvents(queue, world, cars, FIXED_DT, rng);
  }
}

// Local copy of the race-seeded generator (raceGame keeps its own private one).
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Independent forward rotation v + 2w(q×v) + 2q×(q×v) for the round-trip reference.
function rotateBy(q: { x: number; y: number; z: number; w: number }, v: Vec3): Vec3 {
  const cx = q.y * v.z - q.z * v.y;
  const cy = q.z * v.x - q.x * v.z;
  const cz = q.x * v.y - q.y * v.x;
  const tx = q.y * cz - q.z * cy;
  const ty = q.z * cx - q.x * cz;
  const tz = q.x * cy - q.y * cx;
  return {
    x: v.x + 2 * q.w * cx + 2 * tx,
    y: v.y + 2 * q.w * cy + 2 * ty,
    z: v.z + 2 * q.w * cz + 2 * tz,
  };
}

type RaceInternals = {
  vehicles: { body: RAPIER.RigidBody; damage: DamageState; damageMode: DamageMode }[];
};

describe('145 contact impacts post gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST1: toLocalPoint round-trips a combined yaw/pitch/roll quaternion', () => {
    const yaw = 0.3;
    const pitch = 0.2;
    const roll = -0.4;
    const cy = Math.cos(yaw / 2);
    const sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2);
    const sp = Math.sin(pitch / 2);
    const cr = Math.cos(roll / 2);
    const sr = Math.sin(roll / 2);
    const q = {
      x: sr * cp * cy + cr * sp * sy,
      y: cr * sp * cy - sr * cp * sy,
      z: cr * cp * sy + sr * sp * cy,
      w: cr * cp * cy - sr * sp * sy,
    };
    const carPos = { x: 3, y: -1, z: 7 };
    const worldPoint = { x: 1.2, y: 0.4, z: 2.5 };
    const out: Vec3 = { x: 0, y: 0, z: 0 };
    const returned = toLocalPoint(worldPoint, carPos, q, out);
    expect(returned).toBe(out);
    const back = rotateBy(q, out);
    expect(back.x).toBeCloseTo(worldPoint.x - carPos.x, 9);
    expect(back.y).toBeCloseTo(worldPoint.y - carPos.y, 9);
    expect(back.z).toBeCloseTo(worldPoint.z - carPos.z, 9);
  });

  it(
    'POST2: a chassis resting upside-down fires contact-force events but keeps damage at zero',
    () => {
      const spec = loadSpec();
      const world = createPhysicsWorld();
      try {
        const car = new VehicleCtor(world, spec, { position: { x: 0, y: 0.06, z: 0 }, yaw: 0 });
        car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        car.damageMode = 'full';
        const damageCar = damageCarOf(car);
        const queue = new RAPIER.EventQueue(true);
        for (let i = 0; i < steps(0.5); i++) {
          tick(car);
          world.step(queue);
          queue.drainContactForceEvents(() => {});
        }
        let events = 0;
        for (let i = 0; i < steps(0.5); i++) {
          tick(car);
          world.step(queue);
          queue.drainContactForceEvents(() => {
            events++;
          });
        }
        expect(events).toBeGreaterThan(0);
        for (let i = 0; i < steps(1); i++) {
          tick(car);
          world.step(queue);
          processContactEvents(queue, world, [damageCar], FIXED_DT, mulberry32(3));
        }
        expect(car.damage).toEqual(ZERO_DAMAGE);
      } finally {
        world.free();
      }
    },
    30000,
  );

  it(
    'POST3: an empty cars list ignores the crash; listing the car afterwards applies damage',
    () => {
      const spec = loadSpec();
      const world = createPhysicsWorld();
      try {
        addWall(world);
        const car = new VehicleCtor(world, spec, wallSpawn(spec));
        car.damageMode = 'full';
        const damageCar = damageCarOf(car);
        const queue = new RAPIER.EventQueue(true);
        const settle = () => {
          for (let i = 0; i < steps(0.5); i++) {
            tick(car);
            world.step(queue);
            queue.drainContactForceEvents(() => {});
          }
        };
        const crash = (cars: readonly DamageCar[]) => {
          car.body.setTranslation(wallSpawn(spec).position, true);
          car.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
          car.body.setLinvel({ x: 0, y: 0, z: -30 }, true);
          car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          for (let i = 0; i < steps(1); i++) {
            tick(car);
            world.step(queue);
            processContactEvents(queue, world, cars, FIXED_DT, mulberry32(5));
          }
        };
        settle();
        crash([]);
        expect(car.damage).toEqual(ZERO_DAMAGE);
        settle();
        crash([damageCar]);
        expect(car.damage.frontWing).toBeGreaterThan(0);
      } finally {
        world.free();
      }
    },
    30000,
  );

  it(
    'POST4: the handle map rebuilds when a new cars array is passed',
    () => {
      const spec = loadSpec();
      const world = createPhysicsWorld();
      try {
        addWall(world, 20);
        const a = new VehicleCtor(world, spec, wallSpawn(spec, 0));
        const b = new VehicleCtor(world, spec, wallSpawn(spec, 10));
        a.damageMode = 'full';
        b.damageMode = 'full';
        const carA = damageCarOf(a);
        const carB = damageCarOf(b);
        const queue = new RAPIER.EventQueue(true);
        const settle = () => {
          for (let i = 0; i < steps(0.5); i++) {
            tick(a);
            tick(b);
            world.step(queue);
            queue.drainContactForceEvents(() => {});
          }
        };
        const crash = (car: ContactVehicle, cars: readonly DamageCar[]) => {
          car.body.setLinvel({ x: 0, y: 0, z: -30 }, true);
          car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          for (let i = 0; i < steps(1); i++) {
            tick(a);
            tick(b);
            world.step(queue);
            processContactEvents(queue, world, cars, FIXED_DT, mulberry32(9));
          }
        };
        settle();
        crash(a, [carA]);
        expect(a.damage.frontWing).toBeGreaterThan(0);
        expect(b.damage).toEqual(ZERO_DAMAGE);
        settle();
        crash(b, [carB]);
        expect(b.damage.frontWing).toBeGreaterThan(0);
      } finally {
        world.free();
      }
    },
    30000,
  );

  it(
    'POST5: the same seed and scenario give identical damage states',
    () => {
      const spec = loadSpec();
      const run = (): DamageState => {
        const world = createPhysicsWorld();
        try {
          addWall(world);
          const car = new VehicleCtor(world, spec, wallSpawn(spec));
          car.damageMode = 'full';
          const damageCar = damageCarOf(car);
          const queue = new RAPIER.EventQueue(true);
          const rng = mulberry32(7);
          for (let i = 0; i < steps(0.5); i++) {
            tick(car);
            world.step(queue);
            queue.drainContactForceEvents(() => {});
          }
          car.body.setLinvel({ x: 0, y: 0, z: -30 }, true);
          car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          for (let i = 0; i < steps(2); i++) {
            tick(car);
            world.step(queue);
            processContactEvents(queue, world, [damageCar], FIXED_DT, rng);
          }
          return snapshotDamage(car.damage);
        } finally {
          world.free();
        }
      };
      const first = run();
      const second = run();
      expect(first.frontWing).toBeGreaterThan(0);
      expect(second).toEqual(first);
    },
    30000,
  );

  it(
    'POST6: free driving for 60 s without contacts keeps damage at zero',
    () => {
      const spec = loadSpec();
      const world = createPhysicsWorld();
      try {
        const car = new VehicleCtor(world, spec, { position: { x: 0, y: SPAWN_Y, z: 0 }, yaw: 0 });
        car.damageMode = 'full';
        const damageCar = damageCarOf(car);
        const queue = new RAPIER.EventQueue(true);
        driveFlat(car, world, queue, 60, [damageCar], mulberry32(1), 40);
        expect(car.damage).toEqual(ZERO_DAMAGE);
        const v = car.body.linvel();
        expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(5);
      } finally {
        world.free();
      }
    },
    180000,
  );

  it(
    'POST7: RaceGame.step turns a player barrier impact into wing damage',
    async () => {
      const track = loadTrack();
      const race = await RaceGame.create(
        track,
        loadSpec(),
        { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 1, difficulty: 'medium', seed: 1 } as RaceConfig,
      );
      try {
        const internals = race as unknown as RaceInternals;
        for (let i = 0; i < 10; i++) race.step(IDLE);
        const p0 = race.getPrevStates()[0].position;
        let nearest = { x: 0, z: 0, d: Infinity };
        for (const side of ['right', 'left'] as const) {
          for (const run of barrierRuns(track, side)) {
            for (const v of run) {
              const d = Math.hypot(v.x - p0.x, v.z - p0.z);
              if (d < nearest.d) nearest = { x: v.x, z: v.z, d };
            }
          }
        }
        expect(nearest.d).toBeLessThan(30);
        const ux = (nearest.x - p0.x) / nearest.d;
        const uz = (nearest.z - p0.z) / nearest.d;
        const theta = Math.atan2(-ux, -uz);
        const player = internals.vehicles[0];
        player.body.setTranslation(
          { x: p0.x + ux * (nearest.d - 2.9), y: p0.y, z: p0.z + uz * (nearest.d - 2.9) },
          true,
        );
        player.body.setRotation({ x: 0, y: Math.sin(theta / 2), z: 0, w: Math.cos(theta / 2) }, true);
        player.body.setLinvel({ x: ux * 20, y: 0, z: uz * 20 }, true);
        player.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        for (let i = 0; i < 60; i++) race.step(IDLE);
        expect(player.damage.frontWing).toBeGreaterThan(0);
      } finally {
        race.dispose();
      }
    },
    60000,
  );

  it(
    'POST9: a tiny positive dt keeps the calibrated impulse below zero and applies no damage',
    () => {
      const spec = loadSpec();
      const world = createPhysicsWorld();
      try {
        addWall(world);
        const car = new VehicleCtor(world, spec, wallSpawn(spec));
        car.damageMode = 'full';
        const damageCar = damageCarOf(car);
        const queue = new RAPIER.EventQueue(true);
        for (let i = 0; i < steps(0.5); i++) {
          tick(car);
          world.step(queue);
          queue.drainContactForceEvents(() => {});
        }
        car.body.setLinvel({ x: 0, y: 0, z: -30 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        for (let i = 0; i < steps(1); i++) {
          tick(car);
          world.step(queue);
          processContactEvents(queue, world, [damageCar], 1e-9, mulberry32(2));
        }
        expect(car.damage).toEqual(ZERO_DAMAGE);
      } finally {
        world.free();
      }
    },
    30000,
  );

  it(
    'POST8: a new RaceGame defaults every car to full damage and setDamageMode propagates',
    async () => {
      const race = await RaceGame.create(
        loadTrack(),
        loadSpec(),
        { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 2, difficulty: 'medium', seed: 1 } as RaceConfig,
      );
      try {
        const internals = race as unknown as RaceInternals;
        expect(internals.vehicles.map((v) => v.damageMode)).toEqual(['full', 'full', 'full']);
        race.setDamageMode('off');
        expect(internals.vehicles.map((v) => v.damageMode)).toEqual(['off', 'off', 'off']);
        race.setDamageMode('visual');
        expect(internals.vehicles.map((v) => v.damageMode)).toEqual(['visual', 'visual', 'visual']);
      } finally {
        race.dispose();
      }
    },
    60000,
  );
});
