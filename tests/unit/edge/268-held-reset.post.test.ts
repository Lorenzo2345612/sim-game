import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, TrackDataV2 } from '../../../src/core/types';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';

const ROOT = join(__dirname, '..', '..', '..');
const SPEC: CarSpec = parseCarSpec(
  JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')),
);
const BRAKE: DriverInput = { throttle: 0, brake: 0.4, steer: 0, reset: false };
const AI = 1;
const RUN_SPEED = 8;
const FLIPPED: { x: number; y: number; z: number; w: number } = { x: 1, y: 0, z: 0, w: 0 };

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

interface GameAccess {
  vehicles: CarAccess[];
  traffic: { distance: number; lateral: number; speed: number }[];
  ruleCap: Float64Array;
  aheadSpeedCap: number | null;
}

function access(g: RaceGame): GameAccess {
  return g as unknown as GameAccess;
}

interface Walk {
  x: number;
  z: number;
  fx: number;
  fz: number;
}

function makeWalk(track: TrackDataV2): (s: number) => Walk {
  const cl = track.centerline;
  const n = cl.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cum[i + 1] = cum[i] + Math.hypot(cl[j][0] - cl[i][0], cl[j][1] - cl[i][1]);
  }
  return (s: number): Walk => {
    const d = ((s % cum[n]) + cum[n]) % cum[n];
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
  };
}

function upright(fx: number, fz: number): { x: number; y: number; z: number; w: number } {
  const yaw = Math.atan2(-fx, -fz);
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
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

function pin(
  a: GameAccess,
  walk: (s: number) => Walk,
  index: number,
  s: number,
  speed: number,
  flipped = false,
): void {
  const p = walk(s);
  const car = a.vehicles[index];
  const y = car.body.translation().y;
  car.body.setTranslation({ x: p.x, y, z: p.z }, true);
  car.body.setRotation(flipped ? FLIPPED : upright(p.fx, p.fz), true);
  car.body.setLinvel({ x: speed * p.fx, y: 0, z: speed * p.fz }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

interface Ctx {
  g: RaceGame;
  a: GameAccess;
  walk: (s: number) => Walk;
  t: { s: number };
}

// Player 10 m ahead of the AI and moving at RUN_SPEED: the AI is held by the
// follow cap only (no yellow/VSC cap, since every car keeps speed >= CAUSE_SPEED).
async function withHeldRace(body: (c: Ctx) => void): Promise<void> {
  const track = loadTrack('monza');
  const game = await RaceGame.create(track, SPEC, {
    trackId: 'monza',
    carId: 'f4',
    laps: 3,
    aiCount: 1,
    difficulty: 'expert',
    seed: 3,
    scenario: {
      starts: [
        { s: 1010, d: 0, v: RUN_SPEED },
        { s: 1000, d: 0, v: RUN_SPEED },
      ],
    },
  } as RaceConfig);
  try {
    body({ g: game, a: access(game), walk: makeWalk(track), t: { s: 0 } });
  } finally {
    game.dispose();
  }
}

function stepPinned(c: Ctx, sAi: number, sPlayer: number, speed: number, flipped = false): void {
  c.t.s += FIXED_DT;
  pin(c.a, c.walk, AI, sAi, speed, flipped);
  pin(c.a, c.walk, 0, sPlayer, RUN_SPEED);
  c.g.step(BRAKE);
}

describe('268 held-AI progress reset post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST80: an AI held by the follow cap is not progress-reset over a 5.5 s window', async () => {
    await withHeldRace((c) => {
      const n = counter(c.a.vehicles[AI], c.t);
      const sAi = c.a.traffic[AI].distance;
      const sPlayer = c.a.traffic[0].distance;
      for (let i = 0; i < steps(5.5); i++) stepPinned(c, sAi, sPlayer, RUN_SPEED);
      expect(c.a.aheadSpeedCap, 'follow cap from the player 10 m ahead').not.toBeNull();
      expect(Number.isNaN(c.a.ruleCap[AI]), 'no VSC/yellow cap in the first 5.5 s').toBe(true);
      expect(n.n, 'no progress reset while the follow cap holds the AI').toBe(0);
    });
  }, 600000);

  it('POST81: the progress window restarts on the step the hold is released', async () => {
    await withHeldRace((c) => {
      const n = counter(c.a.vehicles[AI], c.t);
      const sAi = c.a.traffic[AI].distance;
      let sPlayer = c.a.traffic[0].distance;
      for (let i = 0; i < steps(6); i++) stepPinned(c, sAi, sPlayer, RUN_SPEED);
      expect(n.n, 'no reset during a 6 s hold').toBe(0);
      const releaseAt = c.t.s;
      sPlayer = sAi + 200;
      for (let i = 0; i < steps(5.5); i++) stepPinned(c, sAi, sPlayer, RUN_SPEED);
      expect(c.a.aheadSpeedCap, 'player moved out of the follow window').toBeNull();
      expect(n.n, 'exactly one reset after the hold is released').toBe(1);
      expect(n.at[0] - releaseAt, 'reset ~5 s after release, not on the old window').toBeCloseTo(
        5,
        1,
      );
    });
  }, 600000);

  it('POST82: an AI held by the VSC rule cap is not progress-reset', async () => {
    const track = loadTrack('monza');
    const game = await RaceGame.create(track, SPEC, {
      trackId: 'monza',
      carId: 'f4',
      laps: 3,
      aiCount: 2,
      difficulty: 'expert',
      seed: 3,
      scenario: {
        starts: [
          { s: 3000, d: -20, v: RUN_SPEED },
          { s: 1000, d: 0, v: RUN_SPEED },
          { s: 2000, d: 0, v: 0 },
        ],
      },
    } as RaceConfig);
    try {
      const a = access(game);
      const t = { s: 0 };
      const walk = makeWalk(track);
      const n = counter(a.vehicles[AI], t);
      game.debugStopCar(2);
      const sAi = a.traffic[AI].distance;
      for (let i = 0; i < steps(11); i++) {
        t.s += FIXED_DT;
        pin(a, walk, AI, sAi, RUN_SPEED);
        pin(a, walk, 0, a.traffic[0].distance, RUN_SPEED);
        game.step(BRAKE);
      }
      expect(Number.isFinite(a.ruleCap[AI]), 'VSC rule cap is active after 11 s').toBe(true);
      expect(a.aheadSpeedCap, 'no car within the follow window').toBeNull();
      const from = n.n;
      for (let i = 0; i < steps(5.5); i++) {
        t.s += FIXED_DT;
        pin(a, walk, AI, sAi, RUN_SPEED);
        pin(a, walk, 0, a.traffic[0].distance, RUN_SPEED);
        game.step(BRAKE);
      }
      expect(n.n - from, 'no progress reset while the VSC rule cap holds the AI').toBe(0);
    } finally {
      game.dispose();
    }
  }, 600000);

  it('POST83: the flip reset still applies while the follow cap holds the AI', async () => {
    await withHeldRace((c) => {
      const n = counter(c.a.vehicles[AI], c.t);
      const sAi = c.a.traffic[AI].distance;
      const sPlayer = c.a.traffic[0].distance;
      for (let i = 0; i < steps(1.6); i++) stepPinned(c, sAi, sPlayer, RUN_SPEED, true);
      expect(c.a.aheadSpeedCap, 'still held by the follow cap').not.toBeNull();
      expect(n.n, 'flip reset fires at 1.5 s even while held').toBe(1);
      expect(n.at[0], 'flip reset within 0.1 s after 1.5 s').toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(n.at[0], 'flip reset within 0.1 s after 1.5 s').toBeLessThanOrEqual(1.6 + 1e-9);
    });
  }, 600000);
});
