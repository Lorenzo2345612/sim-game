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
  aiCmd: { throttle: number; brake: number; steer: number };
  ais: { driver: { p: { maxSteerAngle: number } } }[];
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

function pinAt(
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
  const car = a.vehicles[AI];
  const y = car.body.translation().y;
  car.body.setTranslation({ x: cx + lateral * nx, y, z: cz + lateral * nz }, true);
  car.body.setRotation(upright(dx / len, dz / len), true);
  car.body.setLinvel({ x: speed * (dx / len), y: 0, z: speed * (dz / len) }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function hold(
  g: RaceGame,
  a: GameAccess,
  track: TrackDataV2,
  index: number,
  lateral: number,
  speed: number,
): void {
  for (let k = 0; k < 3; k++) {
    pinAt(a, track, index, lateral, speed);
    g.step(BRAKE);
  }
}

async function withRace(
  track: TrackDataV2,
  body: (g: RaceGame, a: GameAccess) => void,
  cfg: RaceConfig = CFG,
): Promise<void> {
  const game = await RaceGame.create(track, SPEC, cfg);
  try {
    waitGo(game);
    body(game, access(game));
  } finally {
    game.dispose();
  }
}

describe('268 edge band and reset interaction post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST51: edge keeping measures the excess against the half width of the car own side', async () => {
    const base = loadTrack('monza');
    const n = base.centerline.length;
    const track: TrackDataV2 = {
      ...base,
      halfWidthLeft: new Array<number>(n).fill(3),
      halfWidthRight: new Array<number>(n).fill(8),
    };
    await withRace(track, (g, a) => {
      const i = straightestIndex(track);
      hold(g, a, track, i, 0, 0);
      expect(a.aiCmd.throttle, 'centre throttle from a standstill').toBeGreaterThan(0.5);

      hold(g, a, track, i, 2.0, 0);
      const tRightIn = a.aiCmd.throttle;
      hold(g, a, track, i, 2.5, 0);
      expect(a.aiCmd.throttle, 'wide right band: no cut at the same |lat| that cuts on the left').toBeCloseTo(
        tRightIn,
        3,
      );

      hold(g, a, track, i, -2.0, 0);
      const tLeftIn = a.aiCmd.throttle;
      expect(tLeftIn, 'left band edge keeps a strong throttle').toBeGreaterThan(0.5);
      hold(g, a, track, i, -2.5, 0);
      expect(a.aiCmd.throttle, 'narrow left band: 0.5 m excess scales by 1 - 0.5 * 0.4').toBeCloseTo(
        tLeftIn * 0.8,
        3,
      );
    });
  }, 600000);

  it('POST52: a stuck reset restarts the flip timer', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const car = a.vehicles[AI];
      const t = { s: 0 };
      const c = counter(car, t);
      const p0 = car.body.translation();
      const park = (): void => {
        car.body.setTranslation({ x: p0.x, y: p0.y, z: p0.z }, true);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      };
      for (let i = 0; i < steps(4); i++) {
        t.s += FIXED_DT;
        park();
        car.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        g.step(BRAKE);
      }
      expect(c.n, 'no reset before the window closes').toBe(0);
      for (let i = 0; i < steps(1.2); i++) {
        t.s += FIXED_DT;
        park();
        car.body.setRotation(FLIPPED, true);
        g.step(BRAKE);
      }
      expect(c.n, 'the window close at 5 s resets once even though the car is flipped').toBe(1);
      expect(c.at[0], 'reset at the window close').toBeGreaterThanOrEqual(5.0 - 1e-9);
      for (let i = 0; i < steps(1.2); i++) {
        t.s += FIXED_DT;
        park();
        car.body.setRotation(FLIPPED, true);
        g.step(BRAKE);
      }
      expect(c.n, 'no flip reset 1.5 s after the flip onset').toBe(1);
      for (let i = 0; i < steps(0.5); i++) {
        t.s += FIXED_DT;
        park();
        car.body.setRotation(FLIPPED, true);
        g.step(BRAKE);
      }
      expect(c.n, 'flip reset 1.5 s after the stuck reset').toBe(2);
      expect(c.at[1] - c.at[0], 'flip timer measured from the stuck reset').toBeCloseTo(1.5, 1);
    });
  }, 600000);

  it('POST53: the edge-keeping steer correction saturates at full lock', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const i = straightestIndex(track);
      const right = halfWidthAt(track, 'right', i);
      const left = halfWidthAt(track, 'left', i);
      hold(g, a, track, i, right + 3, 0);
      expect(a.aiCmd.steer, 'far outside the right edge saturates at full left lock').toBeCloseTo(
        -1,
        6,
      );
      hold(g, a, track, i, -(left + 3), 0);
      expect(a.aiCmd.steer, 'far outside the left edge saturates at full right lock').toBeCloseTo(
        1,
        6,
      );
    });
  }, 600000);

  it('POST54: the left-side throttle scale matches the right-side one', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const i = straightestIndex(track);
      const left = halfWidthAt(track, 'left', i);
      hold(g, a, track, i, -(left - 1.0), 0);
      const tEdge = a.aiCmd.throttle;
      expect(tEdge, 'left band edge keeps a strong throttle').toBeGreaterThan(0.5);
      hold(g, a, track, i, -(left - 0.5), 0);
      expect(a.aiCmd.throttle, 'left side scales by 1 - 0.5 * 0.4 like the right side').toBeCloseTo(
        tEdge * 0.8,
        3,
      );
    });
  }, 600000);

  it('POST56: far outside the band the throttle scale clamps at zero', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const i = straightestIndex(track);
      const right = halfWidthAt(track, 'right', i);
      hold(g, a, track, i, right + 3, 0);
      expect(a.aiCmd.throttle, 'excess 4 scales by max(0, 1 - 1.6)').toBe(0);
    });
  }, 600000);

  it('POST57: rolling backward uses the same steering lock as rolling forward', async () => {
    const track = loadTrack('monza');
    await withRace(track, (g, a) => {
      const i = straightestIndex(track);
      const st = SPEC.steering;
      hold(g, a, track, i, 0, 2 * st.fullSpeed);
      const forward = a.ais[0].driver.p.maxSteerAngle;
      hold(g, a, track, i, 0, -2 * st.fullSpeed);
      const backward = a.ais[0].driver.p.maxSteerAngle;
      expect(forward, 'lock at twice the full speed forward').toBeCloseTo(st.maxAngleHigh, 3);
      expect(backward, 'lock ignores the sign of the speed').toBeCloseTo(forward, 12);
    });
  }, 600000);
});
