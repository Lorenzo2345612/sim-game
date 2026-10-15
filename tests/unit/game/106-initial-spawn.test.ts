import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Game } from '../../../src/game/game';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { FIXED_DT, MS_TO_KMH } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';
import { parseTrackData } from '../../../src/track/parseTrackData';

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL_THROTTLE: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const STEPS_3S = Math.round(3 / FIXED_DT);

function mexicoTrack(): ReturnType<typeof parseTrackData> {
  const json = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../public/tracks/mexico.json', import.meta.url)),
      'utf8',
    ),
  );
  return parseTrackData(json);
}

function speedKmh(game: Game): number {
  return Math.abs(game.getCurrentState().forwardSpeed) * MS_TO_KMH;
}

describe('106 initial spawn (task 106)', () => {
  let game: Game | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('mexico moves from its initial spawn under 3 s of full throttle', async () => {
    game = await Game.create(mexicoTrack());
    for (let i = 0; i < STEPS_3S; i++) game.step(FULL_THROTTLE);
    expect(speedKmh(game)).toBeGreaterThan(30);
  }, 60000);

  // The game loop steps with zero input while the scene loads: on mexico's uphill
  // spawn the car creeps backwards, which used to deadlock the launch.
  it('mexico launches after 2 s of idle at the initial spawn', async () => {
    game = await Game.create(mexicoTrack());
    for (let i = 0; i < Math.round(2 / FIXED_DT); i++) game.step(IDLE);
    for (let i = 0; i < STEPS_3S; i++) game.step(FULL_THROTTLE);
    expect(speedKmh(game)).toBeGreaterThan(30);
  }, 60000);
});
