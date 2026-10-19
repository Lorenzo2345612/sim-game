import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, TrackDataV2 } from '../../../src/core/types';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { halfWidthAt } from '../../../src/track/surfaces';
import { rightNormalAt } from '../../../src/track/barrierPath';
import { computeRacingLine } from '../../../src/ai/racingLine';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';

const ROOT = join(__dirname, '..', '..', '..');
const SPEC: CarSpec = parseCarSpec(
  JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')),
);
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const AI = 1;
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
    rotation(): { x: number; y: number; z: number; w: number };
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
  aiCmd: { throttle: number; brake: number; steer: number };
  ais: { driver: { p: { maxSteerAngle: number } } }[];
  line: { offsets: Float64Array };
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

async function withRace(track: TrackDataV2, body: (g: RaceGame, a: GameAccess) => void): Promise<void> {
  const game = await RaceGame.create(track, SPEC, CFG);
  try {
    waitGo(game);
    body(game, access(game));
  } finally {
    game.dispose();
  }
}

function pin(
  a: GameAccess,
  track: TrackDataV2,
  index: number,
  lateral: number,
  speed: number,
): void {
  const n = track.centerline.length;
  const i = ((index % n) + n) % n;
  const [cx, cz] = track.centerline[i];
  const [nx, nz] = rightNormalAt(track.centerline, i);
  const j = (i + 1) % n;
  const dx = track.centerline[j][0] - cx;
  const dz = track.centerline[j][1] - cz;
  const len = Math.hypot(dx, dz) || 1;
  const fx = dx / len;
  const fz = dz / len;
  const car = a.vehicles[AI];
  const y = car.body.translation().y;
  car.body.setTranslation({ x: cx + lateral * nx, y, z: cz + lateral * nz }, true);
  car.body.setRotation(upright(fx, fz), true);
  car.body.setLinvel({ x: speed * fx, y: 0, z: speed * fz }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function straightestIndex(track: TrackDataV2): number {
  const cl = track.centerline;
  const n = cl.length;
  let best = 0;
  let bestK = Infinity;
  for (let i = 0; i < n; i++) {
    const a = cl[(i - 3 + n) % n];
    const b = cl[i];
    const c = cl[(i + 3) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const bcx = c[0] - b[0];
    const bcz = c[1] - b[1];
    const k = Math.abs(abx * bcz - abz * bcx) / (Math.hypot(abx, abz) * Math.hypot(bcx, bcz) || 1);
    if (k < bestK) {
      bestK = k;
      best = i;
    }
  }
  return best;
}

function counter(car: CarAccess, t: { s: number }): { n: number; at: number[] } {
  const c = { n: 0, at: [] as number[] };
  const original = car.reset.bind(car);
  car.reset = (spawn: SpawnPose): void => {
    c.n += 1;
    c.at.push(t.s);
    original(spawn);
  };
  return c;
}

// The AI observation carries rear slip and yaw rate from the previous step, so a
// pinned configuration needs three steps before the command is clean.
function hold(
  g: RaceGame,
  a: GameAccess,
  track: TrackDataV2,
  index: number,
  lateral: number,
  speed: number,
  t: { s: number },
): void {
  for (let k = 0; k < 3; k++) {
    pin(a, track, index, lateral, speed);
    t.s += FIXED_DT;
    g.step(BRAKE);
  }
}

describe('268 racegame AI post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST20: edge keeping cuts throttle and steers back outside the edge band', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const t = { s: 0 };
      const i = straightestIndex(track);
      hold(g, a, track, i, 0, 0, t);
      const inThrottle = a.aiCmd.throttle;
      expect(inThrottle, 'in-band throttle from a standstill').toBeGreaterThan(0.5);

      hold(g, a, track, i, halfWidthAt(track, 'right', i) + 3, 0, t);
      expect(a.aiCmd.throttle, 'throttle cut outside the right edge').toBeCloseTo(0, 12);
      expect(a.aiCmd.steer, 'steer biased back toward the track').toBeLessThanOrEqual(0);

      hold(g, a, track, i, -(halfWidthAt(track, 'left', i) + 3), 0, t);
      expect(a.aiCmd.throttle, 'throttle cut outside the left edge').toBeCloseTo(0, 12);
      expect(a.aiCmd.steer, 'steer biased back from the left edge').toBeGreaterThanOrEqual(0);
    });
  }, 600000);

  it('POST21: edge keeping does not cut throttle just inside the edge band', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const t = { s: 0 };
      const i = straightestIndex(track);
      hold(g, a, track, i, halfWidthAt(track, 'right', i) - 1.6, 0, t);
      expect(a.aiCmd.throttle, 'no throttle cut inside the band').toBeGreaterThan(0.5);
    });
  }, 600000);

  it('POST22: the AI steering limit interpolates from low-speed to high-speed lock', async () => {
    const track = loadTrack('monza');
    const st = SPEC.steering;
    await withRace(track, (g, a) => {
      const i = straightestIndex(track);
      for (let k = 0; k < 3; k++) {
        pin(a, track, i, 0, 0);
        g.step(BRAKE);
      }
      expect(a.ais[0].driver.p.maxSteerAngle, 'low-speed lock').toBeCloseTo(st.maxAngleLow, 2);
      for (let k = 0; k < 3; k++) {
        pin(a, track, i, 0, st.fullSpeed);
        g.step(BRAKE);
      }
      expect(a.ais[0].driver.p.maxSteerAngle, 'high-speed lock').toBeCloseTo(st.maxAngleHigh, 2);
      for (let k = 0; k < 3; k++) {
        pin(a, track, i, 0, st.fullSpeed / 2);
        g.step(BRAKE);
      }
      const mid = st.maxAngleLow + (st.maxAngleHigh - st.maxAngleLow) * 0.5;
      expect(a.ais[0].driver.p.maxSteerAngle, 'half-speed lock').toBeCloseTo(mid, 2);
    });
  }, 600000);

  it('POST23: backward progress over the window is treated as stuck', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const car = a.vehicles[AI];
      const t = { s: 0 };
      const c = counter(car, t);
      const cl = track.centerline;
      const cum = cumulative(cl);
      let s = a.traffic[AI].distance;
      for (let i = 0; i < steps(5.2); i++) {
        t.s += FIXED_DT;
        const p = walkPose(cl, cum, s);
        const y = car.body.translation().y;
        car.body.setTranslation({ x: p.x, y, z: p.z }, true);
        car.body.setRotation(upright(-p.fx, -p.fz), true);
        car.body.setLinvel({ x: -p.fx, y: 0, z: -p.fz }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        g.step(BRAKE);
        s -= FIXED_DT;
      }
      expect(c.n, 'reset once on backward progress').toBe(1);
      expect(c.at[0], 'reset at the 5 s window close').toBeGreaterThanOrEqual(5.0 - 1e-9);
      expect(c.at[0], 'reset within 0.1 s of the window close').toBeLessThanOrEqual(5.1 + 1e-9);
    });
  }, 600000);

  it('POST24: forward progress of at least 5 m over the window is not stuck', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const car = a.vehicles[AI];
      const t = { s: 0 };
      const c = counter(car, t);
      const cl = track.centerline;
      const cum = cumulative(cl);
      let s = a.traffic[AI].distance;
      for (let i = 0; i < steps(5.4); i++) {
        t.s += FIXED_DT;
        const p = walkPose(cl, cum, s);
        const y = car.body.translation().y;
        car.body.setTranslation({ x: p.x, y, z: p.z }, true);
        car.body.setRotation(upright(p.fx, p.fz), true);
        car.body.setLinvel({ x: 1.05 * p.fx, y: 0, z: 1.05 * p.fz }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        g.step(BRAKE);
        s += 1.05 * FIXED_DT;
      }
      expect(c.n, 'no reset while covering 5.25 m per window').toBe(0);
    });
  }, 600000);

  it('POST26: the game racing line uses the 2.4 m per-index margin, not the profile default', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const n = track.centerline.length;
      const left = new Array<number>(n);
      const right = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        left[i] = halfWidthAt(track, 'left', i);
        right[i] = halfWidthAt(track, 'right', i);
      }
      const expected = computeRacingLine(
        track.centerline,
        track.widthMeters / 2,
        2.4,
        undefined,
        left,
        right,
      );
      const profile = computeRacingLine(
        track.centerline,
        track.widthMeters / 2,
        undefined,
        undefined,
        left,
        right,
      );
      let matchesProfile = 0;
      for (let i = 0; i < n; i++) {
        expect(a.line.offsets[i], `line offset ${i}`).toBeCloseTo(expected.offsets[i], 6);
        if (Math.abs(a.line.offsets[i] - profile.offsets[i]) < 1e-6) matchesProfile += 1;
      }
      expect(matchesProfile, 'game line is not the 1.4 m profile line').toBeLessThan(n);
    });
  }, 600000);

  it('POST25: a flip reset restarts the progress window', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const car = a.vehicles[AI];
      const t = { s: 0 };
      const c = counter(car, t);
      const t0 = car.body.translation();
      for (let i = 0; i < steps(1.6); i++) {
        t.s += FIXED_DT;
        car.body.setTranslation({ x: t0.x, y: t0.y, z: t0.z }, true);
        car.body.setRotation(FLIPPED, true);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        g.step(BRAKE);
      }
      expect(c.n, 'flip reset after 1.5 s').toBe(1);
      for (let i = 0; i < steps(5.4); i++) {
        t.s += FIXED_DT;
        car.body.setTranslation({ x: t0.x, y: t0.y, z: t0.z }, true);
        car.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        g.step(BRAKE);
      }
      expect(c.n, 'progress reset after the restarted window').toBe(2);
      expect(c.at[1] - c.at[0], 'window measured from the flip reset').toBeCloseTo(5.0, 1);
    });
  }, 600000);
});
