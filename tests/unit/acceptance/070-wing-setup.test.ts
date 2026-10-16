import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MS_TO_KMH } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';
import { Game } from '../../../src/game/game';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { applySetup, loadSetup } from '../../../src/physics/setup';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = new URL('../../..', import.meta.url);
const CAR_ID = 'f4';
const TRACK_ID = 'elkhart';
const FULL_THROTTLE: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const STEPS = 1200; // 10 s at 120 Hz

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8'));
}

/** Storage holding a full setup (defaults) with rearWing overridden, as the setup panel saves it. */
function storageWith(rearWing: number, spec: CarSpec): Pick<Storage, 'getItem' | 'setItem'> {
  const setup: Record<string, number> = {};
  for (const [k, r] of Object.entries(spec.setup)) setup[k] = r.default;
  setup.rearWing = rearWing;
  const raw = JSON.stringify(setup);
  return {
    getItem: (k: string) => (k === `setup:${CAR_ID}:${TRACK_ID}` ? raw : null),
    setItem: () => {},
  };
}

async function speedAfter10s(rearWing: number): Promise<number> {
  const baseSpec = parseCarSpec(readJson('public/cars/f4.json'));
  const track = parseTrackData(readJson('public/tracks/elkhart.json'));
  // Same boot-path calls as src/main.ts: applySetup(loadSetup(...)).
  const spec = applySetup(baseSpec, loadSetup(CAR_ID, TRACK_ID, baseSpec, storageWith(rearWing, baseSpec)));
  const game = await Game.create(track, spec);
  try {
    for (let i = 0; i < STEPS; i++) game.step(FULL_THROTTLE);
    return Math.abs(game.getCurrentState().forwardSpeed) * MS_TO_KMH;
  } finally {
    game.dispose();
  }
}

describe('070 wing setup', () => {
  it('AT2: rear wing 10 is more than 1.5 km/h slower than rear wing 0 after 10 s of full throttle on elkhart', async () => {
    const minWing = await speedAfter10s(0);
    const maxWing = await speedAfter10s(10);
    expect(minWing).toBeGreaterThan(100);
    expect(maxWing).toBeGreaterThan(100);
    expect(minWing - maxWing).toBeGreaterThan(1.5);
  }, 60000);
});
