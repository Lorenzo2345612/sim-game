import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, Surface, TrackDataV2 } from '../../../src/core/types';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import * as vehicleModel from '../../../src/physics/vehicleModel';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { rightNormalAt, barrierRuns } from '../../../src/track/barrierPath';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { halfWidthAt } from '../../../src/track/surfaces';
import { computeRacingLine, type RacingLine } from '../../../src/ai/racingLine';
import { carLimitsFromSpec, speedProfile } from '../../../src/ai/speedProfile';
import {
  difficultyParams,
  trafficDecision,
  type CarTrafficState,
  type TrafficDecision,
} from '../../../src/ai/traffic';
import { AI_GRIP_MARGIN, RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import type { Standing } from '../../../src/race/classification';
import { TrackProgress } from '../../../src/track/trackProgress';

type World = ReturnType<typeof createPhysicsWorld>;

// Task 268 target signatures: per-index half widths on computeRacingLine and
// trafficDecision, and the exported wheel-ray filter. The casts keep this file
// typechecking before the implementation lands.
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

const computeRacingLineFn = computeRacingLine as unknown as ComputeRacingLineFn;
const trafficDecisionFn = trafficDecision as unknown as TrafficDecisionFn;
const WHEEL_RAY_FILTER_GROUPS = (
  vehicleModel as unknown as { WHEEL_RAY_FILTER_GROUPS: number }
).WHEEL_RAY_FILTER_GROUPS;

const ROOT = join(__dirname, '..', '..', '..');
const WALL_TOP = 1.0; // addBarrierWalls top extension above the barrier vertex
const IDX = 2504;
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(id: string): TrackDataV2 {
  return parseTrackData(readJson(`public/tracks/${id}.json`)) as TrackDataV2;
}

const SPEC: CarSpec = parseCarSpec(readJson('public/cars/f4.json'));

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function upY(q: RAPIER.Rotation): number {
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

interface WallPoint {
  x: number;
  z: number;
  ground: number;
  top: number;
}

function wallPointAt(track: TrackDataV2, index: number): WallPoint {
  for (const run of barrierRuns(track, 'left')) {
    for (const v of run) {
      if (v.index === index) {
        return { x: v.x, z: v.z, ground: v.ground, top: Math.max(v.y, v.ground) + WALL_TOP };
      }
    }
  }
  throw new Error(`no left barrier vertex at index ${index}`);
}

function headingYaw(track: TrackDataV2, index: number, towardLeftDeg: number): { yaw: number; fx: number; fz: number } {
  const n = track.centerline.length;
  const a = track.centerline[index];
  const b = track.centerline[(index + 1) % n];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tx = (b[0] - a[0]) / len;
  const tz = (b[1] - a[1]) / len;
  const [nx, nz] = rightNormalAt(track.centerline, index);
  const ang = (towardLeftDeg * Math.PI) / 180;
  const fx = Math.cos(ang) * tx - Math.sin(ang) * nx;
  const fz = Math.cos(ang) * tz - Math.sin(ang) * nz;
  return { yaw: Math.atan2(-fx, -fz), fx, fz };
}

function wheelRay(
  world: World,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxToi: number,
): ReturnType<World['castRay']> {
  return world.castRay(new RAPIER.Ray(origin, dir), maxToi, true, undefined, WHEEL_RAY_FILTER_GROUPS);
}

function findBarrier(world: World): RAPIER.Collider {
  const found: RAPIER.Collider[] = [];
  world.forEachCollider((c) => {
    if (found.length === 0 && surfaceOf(c) === null) found.push(c);
  });
  if (found.length === 0) throw new Error('barrier collider not found');
  return found[0];
}

function halfWidthArrays(track: TrackDataV2): { left: number[]; right: number[] } {
  const n = track.centerline.length;
  const left = new Array<number>(n);
  const right = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    left[i] = halfWidthAt(track, 'left', i);
    right[i] = halfWidthAt(track, 'right', i);
  }
  return { left, right };
}

function racingLineOf(track: TrackDataV2): RacingLine {
  const { left, right } = halfWidthArrays(track);
  return computeRacingLineFn(track.centerline, track.widthMeters / 2, undefined, undefined, left, right);
}

function profileLapS(track: TrackDataV2): number {
  const line = racingLineOf(track);
  const limits = carLimitsFromSpec(SPEC, SPEC.fuel.startL * SPEC.fuel.densityKgL);
  const speeds = speedProfile(line, {
    ...limits,
    muLat: limits.muLat * AI_GRIP_MARGIN,
    muLong: limits.muLong * AI_GRIP_MARGIN,
  });
  const pts = line.points;
  const n = speeds.length;
  let t = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    t += Math.hypot(pts[2 * j] - pts[2 * i], pts[2 * j + 1] - pts[2 * i + 1]) / speeds[i];
  }
  return t * difficultyParams('expert').speedScale;
}

interface RaceCarAccess {
  body: RAPIER.RigidBody;
  getWheelSurfaces(): Surface[];
  reset(spawn: SpawnPose): void;
}

interface RaceAccess {
  vehicles: RaceCarAccess[];
  traffic: { distance: number }[];
}

function access(g: RaceGame): RaceAccess {
  return g as unknown as RaceAccess;
}

function wrapResets(a: RaceAccess, aiCount: number): number[] {
  const counts = new Array<number>(aiCount).fill(0);
  for (let k = 0; k < aiCount; k++) {
    const car = a.vehicles[k + 1];
    const original = car.reset.bind(car);
    car.reset = (spawn: SpawnPose): void => {
      counts[k] += 1;
      original(spawn);
    };
  }
  return counts;
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

interface RaceReport {
  grassS: number[];
  resets: number[];
  standings: Standing[];
}

async function runRace(
  track: TrackDataV2,
  cfg: RaceConfig,
  budgetS: number,
  stopLap: number,
): Promise<RaceReport> {
  const game = await RaceGame.create(track, SPEC, cfg);
  try {
    const a = access(game);
    const aiCount = cfg.aiCount;
    const grassS = new Array<number>(aiCount).fill(0);
    const resets = wrapResets(a, aiCount);
    waitGo(game);
    const max = steps(budgetS);
    for (let s = 0; s < max; s++) {
      game.step(BRAKE);
      for (let k = 0; k < aiCount; k++) {
        let off = 0;
        for (const surf of a.vehicles[k + 1].getWheelSurfaces()) {
          if (surf === 'grass' || surf === 'gravel') off += 1;
        }
        if (off >= 2) grassS[k] += FIXED_DT;
      }
      if (stopLap < Infinity && s % 12 === 0) {
        const done = game.standings().every((st) => st.car === 0 || st.lap >= stopLap);
        if (done) break;
      }
    }
    return { grassS, resets, standings: game.standings().map((st) => ({ ...st })) };
  } finally {
    game.dispose();
  }
}

function total(resets: readonly number[]): number {
  return resets.reduce((a, b) => a + b, 0);
}

describe('268 AI driving regressions acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('AT1: wheel rays ignore the barrier collider and the chassis still collides with it', () => {
    const track = loadTrack('monza');
    const world = createPhysicsWorld(track);
    world.step();
    try {
      const barrier = findBarrier(world);
      const wall = wallPointAt(track, IDX);
      const [nx, nz] = rightNormalAt(track.centerline, IDX);
      const down = wheelRay(
        world,
        { x: wall.x, y: wall.top + 0.3, z: wall.z },
        { x: 0, y: -1, z: 0 },
        200,
      );
      expect(down === null || down.collider !== barrier, 'down wheel ray must not hit the barrier').toBe(true);
      const into = wheelRay(
        world,
        { x: wall.x + 2 * nx, y: wall.ground + SPEC.wheels.radius, z: wall.z + 2 * nz },
        { x: -nx, y: 0, z: -nz },
        4,
      );
      expect(into === null || into.collider !== barrier, 'wheel ray into the wall must not hit the barrier').toBe(true);
      const car = new vehicleModel.VehicleModel(world, SPEC, {
        position: { x: wall.x + 1.5 * nx, y: wall.ground + 0.5, z: wall.z + 1.5 * nz },
        yaw: Math.atan2(nx, nz),
      });
      let touched = false;
      for (let s = 0; s < steps(2) && !touched; s++) {
        const lv = car.body.linvel();
        car.body.setLinvel({ x: -8 * nx, y: lv.y, z: -8 * nz }, true);
        car.setInput(IDLE);
        car.prePhysicsStep(FIXED_DT);
        world.step();
        world.contactPair(car.chassisCollider, barrier, () => {
          touched = true;
        });
      }
      expect(touched, 'chassis must collide with the barrier').toBe(true);
    } finally {
      world.free();
    }
  });

  it('AT2: f4 aimed 25 degrees into the left armco does not climb the wall or flip', () => {
    const track = loadTrack('monza');
    const world = createPhysicsWorld(track);
    try {
      const [cx, cz] = track.centerline[IDX];
      const [nx, nz] = rightNormalAt(track.centerline, IDX);
      const sx = cx - 9 * nx;
      const sz = cz - 9 * nz;
      const { yaw, fx, fz } = headingYaw(track, IDX, 25);
      const car = new vehicleModel.VehicleModel(world, SPEC, {
        position: { x: sx, y: (track.elevation[IDX] ?? 0) + 0.6, z: sz },
        yaw,
      });
      car.body.setLinvel({ x: 30 * fx, y: 0, z: 30 * fz }, true);
      const elevation = track.elevation[IDX] ?? 0;
      let maxDy = -Infinity;
      let minUp = Infinity;
      for (let s = 0; s < steps(3); s++) {
        car.setInput(IDLE);
        car.prePhysicsStep(FIXED_DT);
        world.step();
        const p = car.body.translation();
        minUp = Math.min(minUp, upY(car.body.rotation()));
        maxDy = Math.max(maxDy, p.y - elevation);
        expect((p.x - cx) * nx + (p.z - cz) * nz, 'chassis centre stays inside the left wall').toBeGreaterThan(-12);
      }
      expect(minUp, 'up.y stayed above 0.5').toBeGreaterThan(0.5);
      expect(maxDy, 'max chassis y above the centerline elevation').toBeLessThanOrEqual(0.6);
    } finally {
      world.free();
    }
  });

  it('AT3: solo expert AI on monza finishes 3 laps with 0 resets and at most 1 s on grass', async () => {
    const track = loadTrack('monza');
    const r = await runRace(
      track,
      { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 1, difficulty: 'expert', seed: 3 },
      400,
      4,
    );
    const st = r.standings.find((s) => s.car === 1);
    expect(st, 'AI standing').toBeDefined();
    expect(st!.finished || st!.lap >= 4, 'AI finished 3 laps').toBe(true);
    expect(total(r.resets), 'resets').toBe(0);
    expect(r.grassS[0], 'time with 2+ wheels on grass/gravel').toBeLessThanOrEqual(1.0);
    expect(st!.bestLap, 'best lap recorded').not.toBeNull();
    const profileS = profileLapS(track);
    expect(st!.bestLap!, `best lap vs profile lap ${profileS}`).toBeLessThanOrEqual(1.07 * profileS);
  }, 600000);

  it('AT4: solo expert AI on spa and silverstone finishes 2 laps with 0 resets', async () => {
    for (const id of ['spa', 'silverstone'] as const) {
      const track = loadTrack(id);
      const r = await runRace(
        track,
        { trackId: id, carId: 'f4', laps: 2, aiCount: 1, difficulty: 'expert', seed: 3 },
        400,
        3,
      );
      const st = r.standings.find((s) => s.car === 1);
      expect(st, `${id}: AI standing`).toBeDefined();
      expect(st!.finished || st!.lap >= 3, `${id}: finished 2 laps`).toBe(true);
      expect(total(r.resets), `${id}: resets`).toBe(0);
      expect(r.grassS[0], `${id}: time with 2+ wheels on grass/gravel`).toBeLessThanOrEqual(5.0);
    }
  }, 600000);

  it('AT5: seven expert AIs on monza complete 2 laps within the grass and reset budgets', async () => {
    const track = loadTrack('monza');
    const r = await runRace(
      track,
      { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 7, difficulty: 'expert', seed: 3 },
      300,
      Infinity,
    );
    for (let k = 0; k < 7; k++) {
      const st = r.standings.find((s) => s.car === k + 1);
      expect(st, `AI ${k + 1} standing`).toBeDefined();
      expect(st!.lap, `AI ${k + 1} completed at least 2 laps`).toBeGreaterThanOrEqual(3);
    }
    expect(r.grassS.reduce((a, b) => a + b, 0), 'sum of grass/gravel time over AIs').toBeLessThanOrEqual(50);
    expect(total(r.resets), 'total resets').toBeLessThanOrEqual(1);
  }, 600000);

  it('AT6: a flipped or stuck AI resets to the nearest track pose', async () => {
    const track = loadTrack('monza');
    const cfg: RaceConfig = { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 1, difficulty: 'expert', seed: 3 };
    const cl = track.centerline;

    const gameA = await RaceGame.create(track, SPEC, cfg);
    try {
      const a = access(gameA);
      const resets = wrapResets(a, 1);
      const car = a.vehicles[1];
      const progress = new TrackProgress(cl);
      const sampleIndex = (): number => {
        const p = car.body.translation();
        return progress.update(p.x, p.z).index;
      };
      waitGo(gameA, () => {
        sampleIndex();
      });
      let prevIndex = sampleIndex();
      let firstResetS = -1;
      let offLine = Infinity;
      for (let s = 0; s < steps(1.6); s++) {
        car.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        gameA.step(BRAKE);
        const idx = sampleIndex();
        if (resets[0] > 0) {
          firstResetS = (s + 1) * FIXED_DT;
          const p = car.body.translation();
          offLine = Math.hypot(p.x - cl[prevIndex][0], p.z - cl[prevIndex][1]);
          break;
        }
        prevIndex = idx;
      }
      expect(resets[0], 'flipped car reset once').toBe(1);
      expect(firstResetS, 'reset after 1.5 s of holding the flip').toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(firstResetS, 'reset within 0.1 s after 1.5 s').toBeLessThanOrEqual(1.6 + 1e-9);
      expect(offLine, 'reset onto the nearest track pose').toBeLessThanOrEqual(0.5);
    } finally {
      gameA.dispose();
    }

    const gameB = await RaceGame.create(track, SPEC, cfg);
    try {
      const a = access(gameB);
      const resets = wrapResets(a, 1);
      const car = a.vehicles[1];
      const progress = new TrackProgress(cl);
      const sampleIndex = (): number => {
        const p = car.body.translation();
        return progress.update(p.x, p.z).index;
      };
      waitGo(gameB, () => {
        sampleIndex();
      });
      const pin = car.body.translation();
      let prevIndex = sampleIndex();
      let firstResetS = -1;
      let offLine = Infinity;
      for (let s = 0; s < steps(5.2); s++) {
        car.body.setTranslation(pin, true);
        const q = car.body.rotation();
        const fx = -2 * (q.w * q.y + q.x * q.z);
        const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
        car.body.setLinvel({ x: 30 * fx, y: 0, z: 30 * fz }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        gameB.step(BRAKE);
        const idx = sampleIndex();
        if (resets[0] > 0) {
          firstResetS = (s + 1) * FIXED_DT;
          const p = car.body.translation();
          offLine = Math.hypot(p.x - cl[prevIndex][0], p.z - cl[prevIndex][1]);
          break;
        }
        prevIndex = idx;
      }
      expect(resets[0], 'stationary-progress car reset once').toBe(1);
      expect(firstResetS, 'reset after 5 s of low progress at speed').toBeGreaterThanOrEqual(5.0 - 1e-9);
      expect(firstResetS, 'reset within 0.1 s after 5 s').toBeLessThanOrEqual(5.1 + 1e-9);
      expect(offLine, 'reset onto the nearest track pose').toBeLessThanOrEqual(0.5);
    } finally {
      gameB.dispose();
    }
  }, 600000);

  it('AT7: racing lines stay inside per-index half widths minus 1.4 m on every track', () => {
    const margin = 1.4;
    const files = readdirSync(join(ROOT, 'public', 'tracks')).filter(
      (f) => f.endsWith('.json') && f !== 'index.json' && !f.endsWith('.style.json') && !f.endsWith('-env.json'),
    );
    expect(files.length, 'track files found').toBeGreaterThan(0);
    const bad: string[] = [];
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      const track = loadTrack(id);
      const line = racingLineOf(track);
      const { left, right } = halfWidthArrays(track);
      for (let i = 0; i < track.centerline.length; i++) {
        const lo = -(left[i] - margin);
        const hi = right[i] - margin;
        const v = line.offsets[i];
        if (!(v >= lo && v <= hi)) {
          bad.push(`${id}[${i}] ${v.toFixed(3)} outside [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
          if (bad.length >= 12) break;
        }
      }
      if (bad.length >= 12) break;
    }
    expect(bad, 'lateral bound violations').toEqual([]);
  }, 300000);

  it('AT8: trafficDecision offset respects the half width minus 1.4 m', () => {
    const half = 4.0;
    const line = 0;
    const d = trafficDecisionFn(
      { distance: 0, lateral: 0, speed: 40 },
      [{ distance: 15, lateral: 0, speed: 20 }],
      6000,
      half,
      line,
      -0.01,
      half,
      half,
    );
    expect(Math.abs(line + d.offset), 'chosen lateral within half width minus 1.4 m').toBeLessThanOrEqual(
      half - 1.4,
    );
  });
});
