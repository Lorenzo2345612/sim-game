import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';
import { Game } from '../../../src/game/game';
import * as gearbox from '../../../src/physics/gearbox';
import { parseCarSpec } from '../../../src/physics/carSpec';
import * as gamepad from '../../../src/input/gamepad';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = new URL('../../..', import.meta.url);
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const CAP_MS = -(30 / 3.6 + 0.5);

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8'));
}

const steps = (seconds: number): number => Math.round(seconds / FIXED_DT);

/** Elkhart + f4, auto gearbox, settled at rest after 1 s of no input (178 harness). */
async function restingGame(): Promise<Game> {
  const game = await Game.create(
    parseTrackData(readJson('public/tracks/elkhart.json')),
    parseCarSpec(readJson('public/cars/f4.json')),
  );
  game.setGearMode('auto');
  for (let i = 0; i < steps(1); i++) game.step(IDLE);
  return game;
}

/** AT1 end state: resting game plus 10 s of full brake. */
async function at1State(): Promise<Game> {
  const game = await restingGame();
  for (let i = 0; i < steps(10); i++) game.step(BRAKE);
  return game;
}

interface FakeButton {
  pressed: boolean;
  touched: boolean;
  value: number;
}

interface FakePad {
  axes: number[];
  buttons: FakeButton[];
}

function fakePad(axes: number[] = [0, 0]): FakePad {
  return {
    axes,
    buttons: Array.from({ length: 8 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
}

function gamepads(pads: Array<FakePad | null>): () => ArrayLike<Gamepad | null> {
  return () => pads as unknown as Array<Gamepad | null>;
}

describe('210 reverse cap and trigger deadzone acceptance', () => {
  it(
    'AT1: 10 s of full brake at standstill in auto engages reverse and holds speed above -(30/3.6 + 0.5) every step, ending below -5 m/s',
    async () => {
      const game = await restingGame();
      try {
        for (let i = 0; i < steps(10); i++) {
          game.step(BRAKE);
          expect(game.getCurrentState().forwardSpeed).toBeGreaterThanOrEqual(CAP_MS);
        }
        expect(game.gear()).toBe(-1);
        expect(game.getCurrentState().forwardSpeed).toBeLessThan(-5);
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT2: 5 s more of full brake from the AT1 end state keeps forwardSpeed in [-(30/3.6 + 0.5), -5]',
    async () => {
      const game = await at1State();
      try {
        for (let i = 0; i < steps(5); i++) {
          game.step(BRAKE);
          const v = game.getCurrentState().forwardSpeed;
          expect(v).toBeGreaterThanOrEqual(CAP_MS);
          expect(v).toBeLessThanOrEqual(-5);
        }
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it('AT3: trigger values 0.08 throttle and 0.09 brake below the deadzone read as 0', () => {
    const pad = fakePad();
    pad.buttons[7].value = 0.08;
    pad.buttons[6].value = 0.09;
    const input = new gamepad.GamepadInput(gamepads([pad]));
    input.update(FIXED_DT);
    const out = input.getInput();
    expect(out.throttle).toBe(0);
    expect(out.brake).toBe(0);
  });

  it('AT4: trigger values 0.1 throttle and 0.8 brake at or above the deadzone pass unchanged', () => {
    const pad = fakePad();
    pad.buttons[7].value = 0.1;
    pad.buttons[6].value = 0.8;
    const input = new gamepad.GamepadInput(gamepads([pad]));
    input.update(FIXED_DT);
    const out = input.getInput();
    expect(out.throttle).toBeCloseTo(0.1, 9);
    expect(out.brake).toBeCloseTo(0.8, 9);
  });

  it(
    'AT5: 1.5 s of brake 1 merged with gamepad throttle 0.08 engages reverse',
    async () => {
      const game = await restingGame();
      const pad = fakePad();
      pad.buttons[7].value = 0.08;
      const padInput = new gamepad.GamepadInput(gamepads([pad]));
      try {
        for (let i = 0; i < steps(1.5); i++) {
          padInput.update(FIXED_DT);
          game.step(gamepad.mergeInputs(BRAKE, padInput.getInput()));
        }
        expect(game.gear()).toBe(-1);
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it('AT6: REVERSE_MAX_SPEED_MS is 30/3.6 and TRIGGER_DEADZONE is 0.1', () => {
    // Namespace + cast: the constants are not exported yet (test-first).
    const reverseMax = (gearbox as unknown as Record<string, number>).REVERSE_MAX_SPEED_MS;
    const triggerDeadzone = (gamepad as unknown as Record<string, number>).TRIGGER_DEADZONE;
    expect(reverseMax).toBeCloseTo(30 / 3.6, 12);
    expect(triggerDeadzone).toBeCloseTo(0.1, 12);
  });
});
