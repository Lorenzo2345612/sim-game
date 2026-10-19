import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, TrackDataV2 } from '../../../src/core/types';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import * as trackColliders from '../../../src/physics/trackColliders';
import * as vehicleModel from '../../../src/physics/vehicleModel';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { barrierRuns, rightNormalAt } from '../../../src/track/barrierPath';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { halfWidthAt } from '../../../src/track/surfaces';
import { TrackProgress } from '../../../src/track/trackProgress';
import { computeRacingLine, type RacingLine } from '../../../src/ai/racingLine';
import {
  trafficDecision,
  type CarTrafficState,
  type TrafficDecision,
} from '../../../src/ai/traffic';
import { AI_GRIP_MARGIN, RaceGame, type RaceConfig } from '../../../src/game/raceGame';

type World = ReturnType<typeof createPhysicsWorld>;

type ComputeRacingLineFn = (
  centerline: [number, number][],
  halfWidth: number,
  margin?: number,
  iterations?: number,
  halfWidthLeft?: readonly number[],
  halfWidthRight?: readonly number[],
) => RacingLine;

type TrafficDecisionFn = (
  self: CarTrafficState,
  others: readonly CarTrafficState[],
  lapLength: number,
  halfWidth: number,
  lineOffsetAhead: number,
  curvatureAhead: number,
  halfWidthLeft?: number,
  halfWidthRight?: number,
) => TrafficDecision;

const captured = vi.hoisted(() => ({
  lineArgs: [] as unknown[][],
  trafficArgs: [] as unknown[][],
}));

vi.mock('../../../src/ai/racingLine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ai/racingLine')>();
  const real = actual.computeRacingLine as unknown as ComputeRacingLineFn;
  return {
    ...actual,
    computeRacingLine: (...args: Parameters<ComputeRacingLineFn>): RacingLine => {
      captured.lineArgs.push(args as unknown[]);
      return real(...args);
    },
  };
});

vi.mock('../../../src/ai/traffic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ai/traffic')>();
  const real = actual.trafficDecision as unknown as TrafficDecisionFn;
  return {
    ...actual,
    trafficDecision: (...args: Parameters<TrafficDecisionFn>): TrafficDecision => {
      captured.trafficArgs.push(args as unknown[]);
      return real(...args);
    },
  };
});

const ROOT = join(__dirname, '..', '..', '..');
const WALL_TOP = 1.0;
const BARRIER_GROUP = 0x0004;
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const AI = 1;
const MARGIN = 1.4;
const WALK_SPEED = 3;
const FLIPPED: RAPIER.Rotation = { x: 1, y: 0, z: 0, w: 0 };
const TILTED: RAPIER.Rotation = (() => {
  const half = Math.acos(0.45) / 2;
  return { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) };
})();

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(id: string): TrackDataV2 {
  return parseTrackData(readJson(`public/tracks/${id}.json`)) as TrackDataV2;
}

const SPEC: CarSpec = parseCarSpec(readJson('public/cars/f4.json'));

const computeRacingLineFn = computeRacingLine as unknown as ComputeRacingLineFn;
const trafficDecisionFn = trafficDecision as unknown as TrafficDecisionFn;

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

interface RaceCarAccess {
  body: RAPIER.RigidBody;
  reset(spawn: SpawnPose): void;
}

function access(g: RaceGame): { vehicles: RaceCarAccess[] } {
  return g as unknown as { vehicles: RaceCarAccess[] };
}

function waitGo(game: RaceGame, onStep?: () => void): void {
  let hold = false;
  for (let i = 0; i < steps(30); i++) {
    game.step(BRAKE);
    if (onStep) onStep();
    const lights = game.startLights();
    if (lights >= 5) hold = true;
    if (hold && lights === 0) return;
  }
  throw new Error('start sequence never reached go');
}

function cumulative(cl: [number, number][]): Float64Array {
  const n = cl.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cum[i + 1] = cum[i] + Math.hypot(cl[j][0] - cl[i][0], cl[j][1] - cl[i][1]);
  }
  return cum;
}

function walkPose(
  cl: [number, number][],
  cum: Float64Array,
  s: number,
): { x: number; z: number; fx: number; fz: number } {
  const n = cl.length;
  const L = cum[n];
  const d = ((s % L) + L) % L;
  let i = 0;
  while (i < n - 1 && cum[i + 1] < d) i++;
  const j = (i + 1) % n;
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (d - cum[i]) / seg : 0;
  return {
    x: cl[i][0] + t * (cl[j][0] - cl[i][0]),
    z: cl[i][1] + t * (cl[j][1] - cl[i][1]),
    fx: seg > 0 ? (cl[j][0] - cl[i][0]) / seg : 1,
    fz: seg > 0 ? (cl[j][1] - cl[i][1]) / seg : 0,
  };
}

function upright(fx: number, fz: number): RAPIER.Rotation {
  const yaw = Math.atan2(-fx, -fz);
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

const CFG: RaceConfig = {
  trackId: 'monza',
  carId: 'f4',
  laps: 3,
  aiCount: 1,
  difficulty: 'expert',
  seed: 3,
};

interface Pin {
  game: RaceGame;
  car: RaceCarAccess;
  counter: { n: number };
  cl: [number, number][];
  cum: Float64Array;
  y: number;
  s0: number;
}

function openIn(game: RaceGame, track: TrackDataV2, parkS?: number): Pin {
  const car = access(game).vehicles[AI];
  const counter = { n: 0 };
  const original = car.reset.bind(car);
  car.reset = (spawn: SpawnPose): void => {
    counter.n += 1;
    original(spawn);
  };
  const cl = track.centerline;
  const cum = cumulative(cl);
  const y = car.body.translation().y;
  const park = (): void => {
    if (parkS === undefined) return;
    const p = walkPose(cl, cum, parkS);
    car.body.setTranslation({ x: p.x, y, z: p.z }, true);
    car.body.setRotation(upright(p.fx, p.fz), true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  };
  waitGo(game, park);
  const t = car.body.translation();
  const s0 = parkS ?? new TrackProgress(cl).update(t.x, t.z).distance;
  return { game, car, counter, cl, cum, y, s0 };
}

async function withRace(parkS: number | undefined, body: (p: Pin) => void): Promise<void> {
  const track = loadTrack('monza');
  const game = await RaceGame.create(track, SPEC, CFG);
  try {
    body(openIn(game, track, parkS));
  } finally {
    game.dispose();
  }
}

function holdPinned(p: Pin, rot: RAPIER.Rotation, seconds: number): void {
  const t0 = p.car.body.translation();
  for (let i = 0; i < steps(seconds); i++) {
    p.car.body.setTranslation({ x: t0.x, y: p.y, z: t0.z }, true);
    p.car.body.setRotation(rot, true);
    p.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.game.step(BRAKE);
  }
}

function walkPinned(
  p: Pin,
  fromS: number,
  seconds: number,
  rot: (fx: number, fz: number) => RAPIER.Rotation,
): void {
  for (let i = 0; i < steps(seconds); i++) {
    const s = fromS + WALK_SPEED * i * FIXED_DT;
    const q = walkPose(p.cl, p.cum, s);
    p.car.body.setTranslation({ x: q.x, y: p.y, z: q.z }, true);
    p.car.body.setRotation(rot(q.fx, q.fz), true);
    p.car.body.setLinvel({ x: WALK_SPEED * q.fx, y: 0, z: WALK_SPEED * q.fz }, true);
    p.car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.game.step(BRAKE);
  }
}

const vehicleModelExt = vehicleModel as unknown as { WHEEL_RAY_FILTER_GROUPS?: number };
const trackCollidersExt = trackColliders as unknown as { BARRIER_GROUP?: number };

function findBarrier(world: World): RAPIER.Collider {
  const found: RAPIER.Collider[] = [];
  world.forEachCollider((c) => {
    if (found.length === 0 && surfaceOf(c) === null) found.push(c);
  });
  if (found.length === 0) throw new Error('barrier collider not found');
  return found[0];
}

interface WallPoint {
  index: number;
  x: number;
  z: number;
  ground: number;
  top: number;
}

function wallPoint(track: TrackDataV2, side: 'left' | 'right'): WallPoint {
  for (const run of barrierRuns(track, side)) {
    const v = run[Math.floor(run.length / 2)];
    return {
      index: v.index,
      x: v.x,
      z: v.z,
      ground: v.ground,
      top: Math.max(v.y, v.ground) + WALL_TOP,
    };
  }
  throw new Error(`no ${side} barrier vertex`);
}

function roundedSquare(): [number, number][] {
  const R = 30;
  const straight = 200;
  const arcSteps = 24;
  const cl: [number, number][] = [];
  let x = 0;
  let z = 0;
  let phi = 0;
  cl.push([0, 0]);
  for (let corner = 0; corner < 4; corner++) {
    for (let t = 2; t <= straight; t += 2) {
      x += 2 * Math.cos(phi);
      z += 2 * Math.sin(phi);
      cl.push([x, z]);
    }
    const cx = x - R * Math.sin(phi);
    const cz = z + R * Math.cos(phi);
    const phi0 = phi;
    for (let k = 1; k <= arcSteps; k++) {
      const a = phi0 + (k * Math.PI) / (2 * arcSteps);
      x = cx + R * Math.sin(a);
      z = cz - R * Math.cos(a);
      phi = a;
      if (k === arcSteps && corner === 3) break;
      cl.push([x, z]);
    }
  }
  return cl;
}

function fill(n: number, v: number): number[] {
  return new Array<number>(n).fill(v);
}

describe('268 AI driving regressions edge', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('EDGE1: barrier colliders carry BARRIER_GROUP and wheel rays skip it', () => {
    expect(trackCollidersExt.BARRIER_GROUP, 'BARRIER_GROUP exported as 0x0004').toBe(BARRIER_GROUP);
    const track = loadTrack('monza');
    const world = createPhysicsWorld(track);
    world.step();
    try {
      const barrier = findBarrier(world);
      expect(barrier.collisionGroups(), 'barrier groups').toBe((BARRIER_GROUP << 16) | 0xffff);
      const filter = vehicleModelExt.WHEEL_RAY_FILTER_GROUPS;
      expect(typeof filter, 'WHEEL_RAY_FILTER_GROUPS exported').toBe('number');
      expect((filter as number) & 0xffff & BARRIER_GROUP, 'wheel ray filter clears BARRIER_GROUP').toBe(0);
      const wall = wallPoint(track, 'right');
      const [nx, nz] = rightNormalAt(track.centerline, wall.index);
      const origin = { x: wall.x - 2 * nx, y: wall.ground + SPEC.wheels.radius, z: wall.z - 2 * nz };
      const dir = { x: nx, y: 0, z: nz };
      const raw = world.castRay(new RAPIER.Ray(origin, dir), 4, true);
      expect(raw !== null && raw.collider === barrier, 'control ray into the right armco hits it').toBe(true);
      const filtered = world.castRay(new RAPIER.Ray(origin, dir), 4, true, undefined, filter as number);
      expect(
        filtered === null || filtered.collider !== barrier,
        'filtered wheel ray into the right armco misses it',
      ).toBe(true);
    } finally {
      world.free();
    }
  });

  it('EDGE2: a per-index bound that inverts collapses to lateral 0', () => {
    const cl = roundedSquare();
    const n = cl.length;
    const line = computeRacingLineFn(cl, 10, undefined, undefined, fill(n, 0.5), fill(n, 1.0));
    for (let i = 0; i < n; i++) {
      expect(line.offsets[i], `offset ${i}`).toBeCloseTo(0, 12);
    }
  });

  it('EDGE3: per-index arrays set the bound and stay unmutated', () => {
    const cl = roundedSquare();
    const n = cl.length;
    const left = fill(n, 2);
    const right = fill(n, 6);
    const leftCopy = left.slice();
    const rightCopy = right.slice();
    const line = computeRacingLineFn(cl, 50, 2.0, undefined, left, right);
    for (let i = 0; i < n; i++) {
      expect(line.offsets[i], `offset ${i} lower`).toBeGreaterThanOrEqual(0 - 1e-9);
      expect(line.offsets[i], `offset ${i} upper`).toBeLessThanOrEqual(4 + 1e-9);
    }
    expect(left, 'left array unmutated').toEqual(leftCopy);
    expect(right, 'right array unmutated').toEqual(rightCopy);
  });

  it('EDGE4: trafficDecision keeps the chosen offset inside the side half width minus 1.4', () => {
    const line = 0;
    const d = trafficDecisionFn(
      { distance: 0, lateral: 0, speed: 40 },
      [{ distance: 15, lateral: 0, speed: 20 }],
      6000,
      7,
      line,
      -0.01,
      2.0,
      8.0,
    );
    const lat = line + d.offset;
    const side = lat > 0 ? 8.0 : 2.0;
    expect(Math.abs(lat), 'lateral within the chosen side half width minus 1.4').toBeLessThanOrEqual(
      side - MARGIN + 1e-9,
    );
  });

  it('EDGE5: a flip held under 1.5 s does not reset the AI', async () => {
    await withRace(undefined, (p) => {
      holdPinned(p, FLIPPED, 1.4);
      walkPinned(p, p.s0, 4.0, upright);
      expect(p.counter.n, 'no reset after a brief flip').toBe(0);
    });
  }, 600000);

  it('EDGE6: the flip timer restarts on reset', async () => {
    await withRace(undefined, (p) => {
      holdPinned(p, FLIPPED, 1.6);
      expect(p.counter.n, 'first flip reset').toBe(1);
      holdPinned(p, FLIPPED, 1.2);
      expect(p.counter.n, 'no re-reset inside the fresh 1.5 s hold').toBe(1);
      holdPinned(p, FLIPPED, 0.6);
      expect(p.counter.n, 'second flip reset after a fresh 1.5 s hold').toBe(2);
    });
  }, 600000);

  it('EDGE7: forward progress across the lap wrap is not stuck', async () => {
    const cum = cumulative(loadTrack('monza').centerline);
    await withRace(cum[cum.length - 1] - 8, (p) => {
      walkPinned(p, p.s0, 5.4, upright);
      expect(p.counter.n, 'no reset while crossing the start line').toBe(0);
    });
  }, 600000);

  it('EDGE8: a tilted car above the flip threshold is not reset', async () => {
    await withRace(undefined, (p) => {
      walkPinned(p, p.s0, 5.4, () => TILTED);
      expect(p.counter.n, 'no reset while up.y is 0.45').toBe(0);
    });
  }, 600000);

  it('EDGE9: AI_GRIP_MARGIN stays inside the 0.70 to 0.82 tuning range', () => {
    expect(AI_GRIP_MARGIN, 'AI_GRIP_MARGIN lower bound').toBeGreaterThanOrEqual(0.7);
    expect(AI_GRIP_MARGIN, 'AI_GRIP_MARGIN upper bound').toBeLessThanOrEqual(0.82);
  });

  it('EDGE10: RaceGame passes per-index half widths into the line and traffic', async () => {
    const track = loadTrack('baku');
    const n = track.centerline.length;
    const cum = cumulative(track.centerline);
    let narrow = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const m = Math.min(halfWidthAt(track, 'left', i), halfWidthAt(track, 'right', i));
      if (m < best) {
        best = m;
        narrow = i;
      }
    }
    captured.lineArgs.length = 0;
    captured.trafficArgs.length = 0;
    const game = await RaceGame.create(track, SPEC, { ...CFG, trackId: 'baku' });
    try {
      expect(captured.lineArgs.length, 'computeRacingLine called').toBeGreaterThan(0);
      const args = captured.lineArgs[captured.lineArgs.length - 1];
      const left = args[4] as ArrayLike<number> | undefined;
      const right = args[5] as ArrayLike<number> | undefined;
      expect(
        left !== undefined && left.length === n,
        'per-index left half width array of full length',
      ).toBe(true);
      expect(
        right !== undefined && right.length === n,
        'per-index right half width array of full length',
      ).toBe(true);
      for (let i = 0; i < n; i++) {
        expect(left![i], `left half width ${i}`).toBeCloseTo(halfWidthAt(track, 'left', i), 12);
        expect(right![i], `right half width ${i}`).toBeCloseTo(halfWidthAt(track, 'right', i), 12);
      }
      const p = openIn(game, track, cum[narrow] - 5);
      holdPinned(p, upright(1, 0), 0.3);
      expect(captured.trafficArgs.length, 'trafficDecision called').toBeGreaterThan(0);
      let narrowSeen = false;
      for (const targs of captured.trafficArgs) {
        const l = targs[6] as number | undefined;
        const r = targs[7] as number | undefined;
        expect(typeof l, 'halfWidthLeft passed').toBe('number');
        expect(typeof r, 'halfWidthRight passed').toBe('number');
        let matched = false;
        for (let i = 0; i < n; i++) {
          if (
            Math.abs(l! - halfWidthAt(track, 'left', i)) < 1e-9 &&
            Math.abs(r! - halfWidthAt(track, 'right', i)) < 1e-9
          ) {
            matched = true;
            break;
          }
        }
        expect(matched, `(${l},${r}) is a per-index half width pair`).toBe(true);
        if (l! <= 5 + 1e-9) narrowSeen = true;
      }
      expect(narrowSeen, 'lookahead half widths reflect the narrow section').toBe(true);
    } finally {
      game.dispose();
    }
  }, 600000);
});
