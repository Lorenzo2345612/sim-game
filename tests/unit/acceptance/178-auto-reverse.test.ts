import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';
import { Game } from '../../../src/game/game';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = new URL('../../..', import.meta.url);
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const THROTTLE: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8'));
}

const steps = (seconds: number): number => Math.round(seconds / FIXED_DT);

/** Elkhart + f4, auto gearbox, settled at rest after 1 s of no input. */
async function restingGame(): Promise<Game> {
  const game = await Game.create(
    parseTrackData(readJson('public/tracks/elkhart.json')),
    parseCarSpec(readJson('public/cars/f4.json')),
  );
  game.setGearMode('auto');
  for (let i = 0; i < steps(1); i++) game.step(IDLE);
  return game;
}

/** AT1 state: resting game plus 0.5 s of full brake. */
async function at1State(): Promise<Game> {
  const game = await restingGame();
  for (let i = 0; i < steps(0.5); i++) game.step(BRAKE);
  return game;
}

/** AT2 state: AT1 state plus 3 s more of full brake. */
async function at2State(): Promise<Game> {
  const game = await at1State();
  for (let i = 0; i < steps(3); i++) game.step(BRAKE);
  return game;
}

interface Pose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/** Current pose copied out: Game reuses its state object between steps. */
function pose(game: Game): Pose {
  const s = game.getCurrentState();
  return {
    x: s.position.x,
    y: s.position.y,
    z: s.position.z,
    qx: s.rotation.x,
    qy: s.rotation.y,
    qz: s.rotation.z,
    qw: s.rotation.w,
  };
}

/** Displacement from `from` to now, projected on local -Z rotated by the quaternion at `from`. */
function forwardDisp(from: Pose, game: Game): number {
  const s = game.getCurrentState();
  const fx = -2 * from.qw * from.qy - 2 * from.qx * from.qz;
  const fy = 2 * from.qw * from.qx - 2 * from.qy * from.qz;
  const fz = -1 + 2 * from.qx * from.qx + 2 * from.qy * from.qy;
  return (
    (s.position.x - from.x) * fx + (s.position.y - from.y) * fy + (s.position.z - from.z) * fz
  );
}

describe('178 auto reverse acceptance', () => {
  it(
    'AT1: 0.5 s of full brake at standstill in auto engages reverse',
    async () => {
      const game = await at1State();
      try {
        expect(game.gear()).toBe(-1);
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT2: 3 s more of full brake in reverse displaces at most -5 m along the forward axis',
    async () => {
      const game = await at1State();
      try {
        const start = pose(game);
        for (let i = 0; i < steps(3); i++) game.step(BRAKE);
        expect(forwardDisp(start, game)).toBeLessThanOrEqual(-5);
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT3: throttle stops the reverse within 4 s, selects gear 1 and drives at least 5 m forward',
    async () => {
      const game = await at2State();
      try {
        let stopped = false;
        for (let i = 0; i < steps(4); i++) {
          game.step(THROTTLE);
          if (Math.abs(game.getCurrentState().forwardSpeed) < 0.5) {
            stopped = true;
            break;
          }
        }
        expect(stopped).toBe(true);
        const stop = pose(game);
        for (let i = 0; i < 12 && game.gear() !== 1; i++) game.step(THROTTLE);
        expect(game.gear()).toBe(1);
        for (let i = 0; i < steps(3); i++) game.step(THROTTLE);
        expect(forwardDisp(stop, game)).toBeGreaterThanOrEqual(5);
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT4: braking from 15 m/s keeps the gear at 1 or higher on every step while |v| >= 0.5 m/s',
    async () => {
      const game = await restingGame();
      try {
        let launched = 0;
        while (game.getCurrentState().forwardSpeed < 15 && launched < steps(10)) {
          game.step(THROTTLE);
          launched++;
        }
        expect(game.getCurrentState().forwardSpeed).toBeGreaterThanOrEqual(15);
        for (let i = 0; i < steps(8); i++) {
          game.step(BRAKE);
          const v = game.getCurrentState().forwardSpeed;
          if (Math.abs(v) < 0.5) break;
          expect(game.gear()).toBeGreaterThanOrEqual(1);
        }
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT5: 2 s of full brake at standstill in manual keeps gear 1',
    async () => {
      const game = await restingGame();
      try {
        game.setGearMode('manual');
        for (let i = 0; i < steps(2); i++) game.step(BRAKE);
        expect(game.gear()).toBe(1);
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT6: manual shiftDown then 3 s of full brake gives reverse and at most -5 m displacement',
    async () => {
      const game = await restingGame();
      try {
        game.setGearMode('manual');
        game.shiftDown();
        const start = pose(game);
        for (let i = 0; i < steps(3); i++) game.step(BRAKE);
        expect(game.gear()).toBe(-1);
        expect(forwardDisp(start, game)).toBeLessThanOrEqual(-5);
      } finally {
        game.dispose();
      }
    },
    60000,
  );
});
