import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, TrackDataV2 } from '../../../src/core/types';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { WHEEL_RAY_FILTER_GROUPS } from '../../../src/physics/vehicleModel';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { barrierRuns, rightNormalAt } from '../../../src/track/barrierPath';
import { parseTrackData } from '../../../src/track/parseTrackData';
import {
  trafficDecision,
  type CarTrafficState,
  type TrafficDecision,
} from '../../../src/ai/traffic';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';

const ROOT = join(__dirname, '..', '..', '..');
const SPEC: CarSpec = parseCarSpec(
  JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')),
);
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const AI = 1;

function loadTrack(id: string): TrackDataV2 {
  return parseTrackData(
    JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')),
  ) as TrackDataV2;
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

interface CarAccess {
  body: {
    translation(): { x: number; y: number; z: number };
    setTranslation(t: { x: number; y: number; z: number }, wake: boolean): void;
    setRotation(q: { x: number; y: number; z: number; w: number }, wake: boolean): void;
    setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
    setAngvel(v: { x: number; y: number; z: number }, wake: boolean): void;
  };
  reset(spawn: SpawnPose): void;
}

function access(g: RaceGame): { vehicles: CarAccess[] } {
  return g as unknown as { vehicles: CarAccess[] };
}

const ZERO = { x: 0, y: 0, z: 0 };
const FLIPPED: { x: number; y: number; z: number; w: number } = { x: 1, y: 0, z: 0, w: 0 };

const SELF: CarTrafficState = { distance: 0, lateral: 0, speed: 30 };

describe('268 post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST60: a mid-run armco point is solid for a raw ray and invisible to the wheel filter', () => {
    const track = loadTrack('monza');
    const world = createPhysicsWorld(track);
    world.step();
    try {
      const barriers: RAPIER.Collider[] = [];
      world.forEachCollider((c) => {
        if (surfaceOf(c) === null) barriers.push(c);
      });
      expect(barriers, 'one barrier trimesh').toHaveLength(1);
      const barrier = barriers[0];
      expect(barrier.collisionGroups(), 'membership BARRIER_GROUP').toBe(0x00040000 | 0xffff);
      const run = barrierRuns(track, 'right')[0];
      const v = run[Math.floor(run.length / 2)];
      const [nx, nz] = rightNormalAt(track.centerline, v.index);
      const origin = {
        x: v.x - 2 * nx,
        y: v.ground + SPEC.wheels.radius,
        z: v.z - 2 * nz,
      };
      const dir = { x: nx, y: 0, z: nz };
      const raw = world.castRay(new RAPIER.Ray(origin, dir), 4, true);
      expect(raw !== null && raw.collider === barrier, 'raw ray hits the mid-run armco').toBe(true);
      const filtered = world.castRay(
        new RAPIER.Ray(origin, dir),
        4,
        true,
        undefined,
        WHEEL_RAY_FILTER_GROUPS,
      );
      expect(
        filtered === null || filtered.collider !== barrier,
        'wheel ray skips the mid-run armco',
      ).toBe(true);
    } finally {
      world.free();
    }
  });

  it('POST61: a scenario-frozen AI is never flip- or progress-reset', async () => {
    const track = loadTrack('monza');
    const cfg: RaceConfig = {
      trackId: 'monza',
      carId: 'f4',
      laps: 3,
      aiCount: 1,
      difficulty: 'expert',
      seed: 3,
      scenario: {
        starts: [
          { s: 2000, d: -8, v: 0 },
          { s: 100, d: 0, v: 0 },
        ],
        frozen: [AI],
      },
    };
    const game = await RaceGame.create(track, SPEC, cfg);
    try {
      const a = access(game);
      let n = 0;
      const original = a.vehicles[AI].reset.bind(a.vehicles[AI]);
      a.vehicles[AI].reset = (spawn: SpawnPose): void => {
        n += 1;
        original(spawn);
      };
      const y = a.vehicles[AI].body.translation().y;
      for (let i = 0; i < steps(5.2); i++) {
        const p = a.vehicles[AI].body.translation();
        a.vehicles[AI].body.setTranslation({ x: p.x, y, z: p.z }, true);
        a.vehicles[AI].body.setRotation(FLIPPED, true);
        a.vehicles[AI].body.setLinvel(ZERO, true);
        a.vehicles[AI].body.setAngvel(ZERO, true);
        game.step(BRAKE);
      }
      expect(n, 'frozen car stays out of the flip and progress resets').toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST62: a reused decision object is filled in place and loses its stale speed cap', () => {
    const lap = 1000;
    const legacy: TrafficDecision = { offset: 99, speedCap: 12 };
    const got = trafficDecision(SELF, [], lap, 6, 0, 0, legacy);
    expect(got, 'the 7th argument is the out object').toBe(legacy);
    expect(got.offset, 'clear road recentres the offset').toBe(0);
    expect(got.speedCap, 'stale speed cap is cleared').toBeNull();
    const perSide: TrafficDecision = { offset: -7, speedCap: 3 };
    const got2 = trafficDecision(SELF, [], lap, 6, 4.5, 0, 2, 2, perSide);
    expect(got2, 'the 9th argument is the out object').toBe(perSide);
    expect(got2.offset, 'side band pulls the wide line offset back').toBeCloseTo(-3.9, 10);
    expect(got2.speedCap, 'stale speed cap is cleared on the per-side path').toBeNull();
  });
});
