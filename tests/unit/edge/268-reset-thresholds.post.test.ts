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
}

function access(g: RaceGame): GameAccess {
  return g as unknown as GameAccess;
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

function upright(fx: number, fz: number): { x: number; y: number; z: number; w: number } {
  const yaw = Math.atan2(-fx, -fz);
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

// Rotation about x by acos(upY): the car's up.y is cos of that angle.
function tilt(upY: number): { x: number; y: number; z: number; w: number } {
  const half = Math.acos(upY) / 2;
  return { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) };
}

function upY(q: { x: number; y: number; z: number; w: number }): number {
  return 1 - 2 * (q.x * q.x + q.z * q.z);
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

async function withRace(
  body: (g: RaceGame, a: GameAccess) => void,
  onWaitGo?: (g: RaceGame, a: GameAccess) => void,
): Promise<void> {
  const game = await RaceGame.create(loadTrack('monza'), SPEC, CFG);
  try {
    const a = access(game);
    waitGo(game, onWaitGo ? () => onWaitGo(game, a) : undefined);
    body(game, a);
  } finally {
    game.dispose();
  }
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

function pinHigh(a: GameAccess, y: number, q: { x: number; y: number; z: number; w: number }): void {
  const car = a.vehicles[AI];
  const p = car.body.translation();
  car.body.setTranslation({ x: p.x, y, z: p.z }, true);
  car.body.setRotation(q, true);
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

describe('268 reset and edge thresholds post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST35: creeping 4.9 m forward over the window is still stuck', async () => {
    await withRace((g, a) => {
      const car = a.vehicles[AI];
      const t = { s: 0 };
      const c = counter(car, t);
      const cl = (loadTrack('monza')).centerline;
      const cum = cumulative(cl);
      let s = a.traffic[AI].distance;
      const v = 0.98;
      for (let i = 0; i < steps(5.2); i++) {
        t.s += FIXED_DT;
        const p = walkPose(cl, cum, s);
        const y = car.body.translation().y;
        car.body.setTranslation({ x: p.x, y, z: p.z }, true);
        car.body.setRotation(upright(p.fx, p.fz), true);
        car.body.setLinvel({ x: v * p.fx, y: 0, z: v * p.fz }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        g.step(BRAKE);
        s += v * FIXED_DT;
      }
      expect(c.n, 'reset once below 5 m per window').toBe(1);
      expect(c.at[0], 'reset at the 5 s window close').toBeGreaterThanOrEqual(5.0 - 1e-9);
      expect(c.at[0], 'reset within 0.1 s of the window close').toBeLessThanOrEqual(5.1 + 1e-9);
    });
  }, 600000);

  it('POST36: a car held just above the flip threshold is never reset', async () => {
    await withRace((g, a) => {
      const t = { s: 0 };
      const c = counter(a.vehicles[AI], t);
      let minUp = 1;
      const q = tilt(0.31);
      for (let i = 0; i < steps(1.6); i++) {
        t.s += FIXED_DT;
        pinHigh(a, 5, q);
        g.step(BRAKE);
        minUp = Math.min(minUp, upY(a.vehicles[AI].body.rotation()));
      }
      expect(minUp, 'up.y stayed above the 0.3 flip threshold').toBeGreaterThan(0.3);
      expect(c.n, 'no flip reset above the threshold').toBe(0);
    });
  }, 600000);

  it('POST37: a car held just below the flip threshold resets after 1.5 s', async () => {
    await withRace((g, a) => {
      const t = { s: 0 };
      const c = counter(a.vehicles[AI], t);
      let maxUp = -1;
      const q = tilt(0.29);
      for (let i = 0; i < steps(1.7); i++) {
        t.s += FIXED_DT;
        pinHigh(a, 5, q);
        g.step(BRAKE);
        if (c.n === 0) maxUp = Math.max(maxUp, upY(a.vehicles[AI].body.rotation()));
      }
      expect(maxUp, 'up.y stayed below the 0.3 flip threshold').toBeLessThan(0.3);
      expect(c.n, 'flip reset once below the threshold').toBe(1);
      expect(c.at[0], 'reset at 1.5 s').toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(c.at[0], 'reset within 0.1 s after 1.5 s').toBeLessThanOrEqual(1.6 + 1e-9);
    });
  }, 600000);

  it('POST38: a flipped AI is never reset before the go signal', async () => {
    const t = { s: 0 };
    let c: { n: number; at: number[] } | null = null;
    await withRace(
      () => {
        expect(c, 'reset counter installed').not.toBeNull();
        expect(c!.n, 'no reset during the start sequence').toBe(0);
      },
      (g, a) => {
        if (!c) c = counter(a.vehicles[AI], t);
        t.s += FIXED_DT;
        pinHigh(a, 5, tilt(-1));
        g.step(BRAKE);
      },
    );
  }, 600000);

  it('POST39: edge keeping scales throttle only outside the 1 m band', async () => {
    const track = loadTrack('monza');
    await withRace((g, a) => {
      const cl = track.centerline;
      const n = cl.length;
      let best = 0;
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
          best = i;
        }
      }
      const i = best;
      const [cx, cz] = cl[i];
      const [nx, nz] = rightNormalAt(cl, i);
      const j = (i + 1) % n;
      const dx = cl[j][0] - cx;
      const dz = cl[j][1] - cz;
      const len = Math.hypot(dx, dz) || 1;
      const pinAt = (lat: number): void => {
        const car = a.vehicles[AI];
        const y = car.body.translation().y;
        car.body.setTranslation({ x: cx + lat * nx, y, z: cz + lat * nz }, true);
        car.body.setRotation(upright(dx / len, dz / len), true);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      };
      const hold = (lat: number): number => {
        for (let k = 0; k < 3; k++) {
          pinAt(lat);
          g.step(BRAKE);
        }
        return a.aiCmd.throttle;
      };
      const right = halfWidthAt(track, 'right', i);
      const tIn = hold(right - 1.0);
      expect(tIn, 'full throttle on the band edge').toBeGreaterThan(0.5);
      const tEdge = hold(right - 1.0);
      expect(tEdge, 'band edge keeps the full throttle').toBeCloseTo(tIn, 6);
      const tOut = hold(right - 0.5);
      expect(tOut, '0.5 m outside scales throttle by 1 - 0.5 * 0.4').toBeCloseTo(tIn * 0.8, 3);
    });
  }, 600000);
});
