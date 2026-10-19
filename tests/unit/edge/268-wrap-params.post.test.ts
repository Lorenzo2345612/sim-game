import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, TrackDataV2 } from '../../../src/core/types';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { computeRacingLine } from '../../../src/ai/racingLine';
import { trafficDecision } from '../../../src/ai/traffic';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';

const ROOT = join(__dirname, '..', '..', '..');
const SPEC: CarSpec = parseCarSpec(
  JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')),
);
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const AI = 1;
const UPRIGHT = { x: 0, y: 0, z: 0, w: 1 };
const FLIPPED = { x: 1, y: 0, z: 0, w: 0 };

function loadTrack(id: string): TrackDataV2 {
  return parseTrackData(
    JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')),
  ) as TrackDataV2;
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

const CFG: RaceConfig = {
  trackId: 'monza',
  carId: 'f4',
  laps: 3,
  aiCount: 1,
  difficulty: 'expert',
  seed: 3,
};

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

interface GameAccess {
  vehicles: CarAccess[];
  traffic: { distance: number; lateral: number }[];
  ais: { driver: { p: { maxSteerAngle: number; kp: number; kb: number } } }[];
}

function access(g: RaceGame): GameAccess {
  return g as unknown as GameAccess;
}

function waitGo(game: RaceGame): void {
  let hold = false;
  for (let i = 0; i < steps(30); i++) {
    game.step(BRAKE);
    const lights = game.startLights();
    if (lights >= 5) hold = true;
    if (hold && lights === 0) return;
  }
  throw new Error('start sequence never reached go');
}

function upright(fx: number, fz: number): { x: number; y: number; z: number; w: number } {
  const yaw = Math.atan2(-fx, -fz);
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
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

interface Spawns {
  n: number;
  poses: SpawnPose[];
}

function counter(car: CarAccess): Spawns {
  const c: Spawns = { n: 0, poses: [] };
  const original = car.reset.bind(car);
  car.reset = (spawn: SpawnPose): void => {
    c.n += 1;
    c.poses.push({
      position: { ...spawn.position },
      yaw: spawn.yaw,
    });
    original(spawn);
  };
  return c;
}

function pinPose(
  car: CarAccess,
  cl: [number, number][],
  cum: Float64Array,
  s: number,
  y: number,
  dir: number,
  speed = 1,
): void {
  const p = walkPose(cl, cum, s);
  car.body.setTranslation({ x: p.x, y, z: p.z }, true);
  car.body.setRotation(upright(dir * p.fx, dir * p.fz), true);
  car.body.setLinvel({ x: dir * speed * p.fx, y: 0, z: dir * speed * p.fz }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function pinRot(car: CarAccess, y: number, q: { x: number; y: number; z: number; w: number }): void {
  const p = car.body.translation();
  car.body.setTranslation({ x: p.x, y, z: p.z }, true);
  car.body.setRotation(q, true);
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

async function withRace(body: (g: RaceGame, a: GameAccess) => void): Promise<void> {
  const game = await RaceGame.create(loadTrack('monza'), SPEC, CFG);
  try {
    waitGo(game);
    body(game, access(game));
  } finally {
    game.dispose();
  }
}

describe('268 lap-wrap and tuned-parameter post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST40: backward progress across the lap wrap is stuck', async () => {
    await withRace((g, a) => {
      const track = loadTrack('monza');
      const cl = track.centerline;
      const cum = cumulative(cl);
      const car = a.vehicles[AI];
      const c = counter(car);
      const y = car.body.translation().y;
      for (let i = 0; i < steps(5.2); i++) {
        pinPose(car, cl, cum, 4 - 1.05 * i * FIXED_DT, y, -1);
        g.step(BRAKE);
      }
      expect(c.n, 'reset once on wrapped backward progress').toBe(1);
    });
  }, 600000);

  it('POST41: flip episodes separated by upright steps do not add up', async () => {
    await withRace((g, a) => {
      const car = a.vehicles[AI];
      const c = counter(car);
      const y = car.body.translation().y;
      for (let i = 0; i < steps(1.4); i++) {
        pinRot(car, y, FLIPPED);
        g.step(BRAKE);
      }
      expect(c.n, 'no reset inside the first 1.4 s flip').toBe(0);
      for (let i = 0; i < steps(0.2); i++) {
        pinRot(car, y, UPRIGHT);
        g.step(BRAKE);
      }
      for (let i = 0; i < steps(1.4); i++) {
        pinRot(car, y, FLIPPED);
        g.step(BRAKE);
      }
      expect(c.n, 'second 1.4 s flip episode restarts from zero').toBe(0);
    });
  }, 600000);

  it('POST42: one inverted per-index bound collapses only that index', () => {
    const cl: [number, number][] = [];
    for (let z = 0; z >= -200; z -= 4) cl.push([0, z]);
    for (let k = 1; k < 24; k++) {
      const a = (k * Math.PI) / 24;
      cl.push([12 * (1 - Math.cos(a)), -200 - 12 * Math.sin(a)]);
    }
    for (let z = -196; z <= 0; z += 4) cl.push([24, z]);
    for (let k = 1; k < 24; k++) {
      const a = (k * Math.PI) / 24;
      cl.push([24 - 12 * (1 - Math.cos(a)), -12 * Math.sin(a)]);
    }
    const n = cl.length;
    const left = new Array<number>(n).fill(8);
    const right = new Array<number>(n).fill(8);
    left[10] = 1;
    right[10] = 1;
    const line = computeRacingLine(cl, 8, undefined, undefined, left, right);
    expect(line.offsets[10], 'narrow index collapses to the centerline').toBeCloseTo(0, 12);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      if (i !== 10 && Math.abs(line.offsets[i]) > 1e-6) moved += 1;
    }
    expect(moved, 'wide indices still move off the centerline').toBeGreaterThan(0);
    expect(line.offsets[10], 'collapse stays exact after smoothing').toBeCloseTo(0, 12);
  });

  it('POST43: the AI driver gets the tuned throttle and brake gains', async () => {
    await withRace((_g, a) => {
      const p = a.ais[0].driver.p;
      expect(p.kp, 'throttle gain 1.5').toBeCloseTo(1.5, 12);
      expect(p.kb, 'brake gain 0.07').toBeCloseTo(0.07, 12);
    });
  }, 600000);

  it('POST44: the steering lock clamps at the high-speed value above fullSpeed', async () => {
    await withRace((g, a) => {
      const st = SPEC.steering;
      const track = loadTrack('monza');
      const cl = track.centerline;
      const cum = cumulative(cl);
      const car = a.vehicles[AI];
      const y = car.body.translation().y;
      for (let k = 0; k < 3; k++) {
        pinPose(car, cl, cum, 0, y, 1, 2 * st.fullSpeed);
        g.step(BRAKE);
      }
      expect(a.ais[0].driver.p.maxSteerAngle, 'lock equals maxAngleHigh').toBeCloseTo(
        st.maxAngleHigh,
        3,
      );
    });
  }, 600000);

  it('POST45: a left-side pass under negative curvature respects the left band', () => {
    const self = { distance: 0, lateral: 0, speed: 40 };
    const d = trafficDecision(
      self,
      [{ distance: 15, lateral: 0, speed: 20 }],
      6000,
      7,
      0,
      -0.01,
      5,
      2,
    );
    expect(d.offset, 'left pass at blocker lateral minus 3 m').toBeCloseTo(-3, 12);
    expect(0 + d.offset, 'lateral inside the left half width minus 1.4').toBeGreaterThanOrEqual(
      -(5 - 1.4) - 1e-9,
    );
    expect(d.speedCap, 'pass fits, no cap').toBeNull();
  });

  it('POST46: a stuck reset spawns on the centerline at elevation + 0.6 m along the track', async () => {
    const track = loadTrack('monza');
    const cl = track.centerline;
    const n = cl.length;
    const cum = cumulative(cl);
    let idx = 0;
    let bestK = Infinity;
    for (let i = 0; i < n; i++) {
      const p3 = cl[(i - 3 + n) % n];
      const b = cl[i];
      const q3 = cl[(i + 3) % n];
      const abx = b[0] - p3[0];
      const abz = b[1] - p3[1];
      const bcx = q3[0] - b[0];
      const bcz = q3[1] - b[1];
      const k = Math.abs(abx * bcz - abz * bcx) / (Math.hypot(abx, abz) * Math.hypot(bcx, bcz) || 1);
      if (k < bestK) {
        bestK = k;
        idx = i;
      }
    }
    const game = await RaceGame.create(track, SPEC, CFG);
    try {
      const a = access(game);
      const car = a.vehicles[AI];
      const c = counter(car);
      const y = car.body.translation().y;
      let hold = false;
      for (let i = 0; i < steps(30); i++) {
        pinPose(car, cl, cum, cum[idx], y, 1, 0);
        game.step(BRAKE);
        const lights = game.startLights();
        if (lights >= 5) hold = true;
        if (hold && lights === 0) break;
      }
      for (let i = 0; i < steps(5.2); i++) {
        pinPose(car, cl, cum, cum[idx], y, 1, 0);
        game.step(BRAKE);
      }
      expect(c.n, 'stuck reset once').toBe(1);
      const spawn = c.poses[0];
      let near = 0;
      let nearD = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(spawn.position.x - cl[i][0], spawn.position.z - cl[i][1]);
        if (d < nearD) {
          nearD = d;
          near = i;
        }
      }
      expect(nearD, 'spawn sits on a centerline point').toBeLessThan(1);
      expect(spawn.position.y, 'spawn at centerline elevation + 0.6 m').toBeCloseTo(
        (track.elevation[near] ?? 0) + 0.6,
        6,
      );
      const next = cl[(near + 1) % n];
      const yaw = Math.atan2(-(next[0] - cl[near][0]), -(next[1] - cl[near][1]));
      expect(spawn.yaw, 'spawn heading along the track').toBeCloseTo(yaw, 6);
    } finally {
      game.dispose();
    }
  }, 600000);
});
