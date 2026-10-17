import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { initPhysics } from '../../../src/physics/physicsWorld';
import type { Telemetry } from '../../../src/physics/vehicleModel';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const N = 72;
const R = 50;
const ELEV = 1.5;
const TARGET_SPEED = 12;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
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

// Flat raised ring: strips rest at ELEV over a flat terrain, so a spawn that
// ignores track.elevation lands at 0.6 instead of ELEV + 0.6 and is caught.
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

function posOf(s: VehicleState): { x: number; y: number; z: number } {
  return { x: s.position.x, y: s.position.y, z: s.position.z };
}

function yawOf(s: VehicleState): number {
  const q = s.rotation;
  const fx = -2 * (q.w * q.y + q.x * q.z);
  const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(-fx, -fz);
}

function horiz(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function nearestIndex(track: TrackDataV2, x: number, z: number): number {
  const cl = track.centerline;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < cl.length; i++) {
    const d = (x - cl[i][0]) * (x - cl[i][0]) + (z - cl[i][1]) * (z - cl[i][1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function targetAhead(track: TrackDataV2, x: number, z: number, meters: number): [number, number] {
  const cl = track.centerline;
  const n = cl.length;
  let i = nearestIndex(track, x, z);
  let acc = 0;
  while (acc < meters) {
    const a = cl[i];
    const b = cl[(i + 1) % n];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    i = (i + 1) % n;
  }
  return cl[i];
}

function controller(track: TrackDataV2, s: VehicleState): DriverInput {
  const [tx, tz] = targetAhead(track, s.position.x, s.position.z, 18);
  const des = Math.atan2(-(tx - s.position.x), -(tz - s.position.z));
  let err = des - yawOf(s);
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  const speed = s.forwardSpeed;
  return {
    throttle: speed < TARGET_SPEED ? 1 : 0.25,
    brake: speed > TARGET_SPEED + 3 ? 0.35 : 0,
    steer: Math.max(-1, Math.min(1, -1.8 * err)),
    reset: false,
  };
}

function penaltyOf(game: RaceGame, car: number): number {
  return game.standings().find((s) => s.car === car)?.penalty ?? 0;
}

function standingOf(game: RaceGame, car: number) {
  const row = game.standings().find((s) => s.car === car);
  expect(row, `standing of car ${car}`).toBeDefined();
  return row!;
}

interface RaceRun {
  goTicks: number;
  finished: boolean;
  maxLap: number;
  totalTime: number | null;
  distanceAt: number[];
}

// Drives the player around the ring until the race ends or the tick budget runs
// out. goTicks counts from the go tick (race time 0) to the finishing tick.
async function driveRing(
  track: TrackDataV2,
  laps: number,
  maxTicks: number,
  opts: { untilLap?: number; inputs?: (game: RaceGame, s: VehicleState) => DriverInput } = {},
): Promise<RaceRun> {
  const game = await RaceGame.create(track, loadSpec(), raceConfig(0, { laps }));
  try {
    const buf = buffers(1);
    const distanceAt: number[] = [];
    let prevLights = game.startLights();
    let went = false;
    let goTicks = 0;
    let maxLap = 0;
    for (let i = 0; i < maxTicks; i++) {
      game.getStates(buf);
      const input = opts.inputs ? opts.inputs(game, buf[0]) : controller(track, buf[0]);
      game.step(input);
      const lights = game.startLights();
      const go = !went && prevLights > 0 && lights === 0;
      prevLights = lights;
      if (go) went = true;
      else if (went) goTicks++;
      const row = standingOf(game, 0);
      maxLap = Math.max(maxLap, row.lap);
      distanceAt.push(row.distance);
      if (went && opts.untilLap !== undefined && row.lap >= opts.untilLap) {
        return { goTicks, finished: game.raceFinished, maxLap, totalTime: row.totalTime, distanceAt };
      }
      if (game.raceFinished) {
        return { goTicks, finished: true, maxLap, totalTime: row.totalTime, distanceAt };
      }
    }
    const row = standingOf(game, 0);
    return { goTicks, finished: game.raceFinished, maxLap, totalTime: row.totalTime, distanceAt };
  } finally {
    game.dispose();
  }
}

describe('093 race game post-code gaps (race end and wiring)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('GAPS2-1: the race finishes after config.laps and totalTime counts from go', async () => {
    const run = await driveRing(circleTrack(), 1, 15000);
    expect(run.finished, 'the race ends after the configured laps').toBe(true);
    expect(run.maxLap, 'the player crossed the line twice').toBeGreaterThanOrEqual(2);
    expect(run.totalTime, 'a finished car has a total time').not.toBeNull();
    const t = run.totalTime!;
    // The crossing is interpolated between the last two samples: race time at
    // the finishing tick is goTicks * FIXED_DT and the crossing is one tick earlier.
    expect(t, 'totalTime is at least the previous tick of race time').toBeGreaterThanOrEqual(
      (run.goTicks - 1) * FIXED_DT - 1e-9,
    );
    expect(t, 'totalTime never exceeds the finishing tick').toBeLessThanOrEqual(
      run.goTicks * FIXED_DT + 1e-9,
    );
  }, 120000);

  it('GAPS2-2: standings distance is negative behind the line and non-negative after the crossing', async () => {
    const track = circleTrack();
    const game = await RaceGame.create(track, loadSpec(), raceConfig(0));
    try {
      for (let i = 0; i < 30; i++) game.step(IDLE);
      const before = standingOf(game, 0);
      expect(before.lap, 'no lap before go').toBe(0);
      expect(before.distance, 'the grid sits behind the start line').toBeLessThan(0);
      expect(before.distance, 'behind the line by less than a lap').toBeGreaterThan(-track.lengthMeters);
    } finally {
      game.dispose();
    }
    const run = await driveRing(track, 1, 15000, { untilLap: 1 });
    expect(run.maxLap, 'the player crosses the line').toBeGreaterThanOrEqual(1);
    // The crossing sample is stored at the moment lap 1 is first reached.
    expect(run.distanceAt.some((d) => d >= 0), 'distance becomes non-negative after the crossing').toBe(
      true,
    );
    expect(
      run.distanceAt.every((d) => d < track.lengthMeters + 1e-6),
      'distance stays within one lap',
    ).toBe(true);
  }, 120000);

  it('GAPS2-3: a laps-2 race is still running where a laps-1 race has finished', async () => {
    const track = circleTrack();
    const one = await driveRing(track, 1, 15000, { untilLap: 2 });
    expect(one.finished, 'laps 1 finishes at the second crossing').toBe(true);
    const two = await driveRing(track, 2, 15000, { untilLap: 2 });
    expect(two.maxLap, 'laps 2 reaches the same crossing').toBeGreaterThanOrEqual(2);
    expect(two.finished, 'laps 2 needs one more crossing').toBe(false);
    expect(two.totalTime, 'an unfinished car has no total time').toBeNull();
    const done = await driveRing(track, 2, 15000);
    expect(done.finished, 'laps 2 finishes at the third crossing').toBe(true);
  }, 180000);

  it('GAPS2-4: non-positive laps never finish the race', async () => {
    for (const laps of [0, -3]) {
      const run = await driveRing(circleTrack(), laps, 15000, { untilLap: 2 });
      expect(run.maxLap, `laps ${laps} still counts crossings`).toBeGreaterThanOrEqual(2);
      expect(run.finished, `laps ${laps} does not finish`).toBe(false);
    }
  }, 180000);

  it('GAPS2-5: getTelemetry fills and returns the caller buffer', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1));
    try {
      for (let i = 0; i < 30; i++) game.step(IDLE);
      const out: Telemetry = {
        wheels: [null, null, null, null].map(() => ({
          fz: -1,
          kappa: -1,
          alpha: -1,
          tempC: -1,
          wear: -1,
          dirt: -1,
          surface: 'asphalt' as const,
        })),
        fuelKg: -1,
        rpm: -1,
        gear: 99,
      };
      const ret = game.getTelemetry(out);
      expect(ret, 'the race returns the caller telemetry object').toBe(out);
      expect(out.gear, 'the player gear is filled in').not.toBe(99);
      expect(out.rpm, 'the player rpm is filled in').toBeGreaterThanOrEqual(0);
      expect(out.fuelKg, 'the player fuel is filled in').toBeGreaterThan(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAPS2-6: a stuck AI is respawned at centerline elevation + 0.6', async () => {
    const track = circleTrack();
    const spec = loadSpec();
    spec.engine.torqueCurve = spec.engine.torqueCurve.map(([r]) => [r, 0] as [number, number]);
    const game = await RaceGame.create(track, spec, raceConfig(1));
    try {
      let prevLights = game.startLights();
      let went = false;
      const buf = buffers(2);
      game.getStates(buf);
      let prevA = posOf(buf[1]);
      let seen = 0;
      for (let i = 0; i < 120 * 15 && seen === 0; i++) {
        game.step(IDLE);
        const lights = game.startLights();
        if (!went && prevLights > 0 && lights === 0) went = true;
        prevLights = lights;
        if (!went) continue;
        game.getStates(buf);
        const p = posOf(buf[1]);
        if (horiz(p, prevA) > 1) {
          const idx = nearestIndex(track, p.x, p.z);
          const elev = track.elevation[idx] ?? 0;
          expect(p.y - elev, 'respawn height is SPAWN_HEIGHT over the road').toBeCloseTo(0.6, 1);
          expect(p.y, 'the raised ring is respected').toBeGreaterThan(1);
          seen = 1;
        }
        prevA = p;
      }
      expect(seen, 'the stuck AI is respawned within 15 s of go').toBe(1);
      expect(penaltyOf(game, 1), 'the respawn is not a jump-start penalty').toBe(0);
    } finally {
      game.dispose();
    }
  }, 120000);

});
