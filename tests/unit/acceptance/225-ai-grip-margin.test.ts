import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import * as raceGame from '../../../src/game/raceGame';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import type { Difficulty } from '../../../src/ai/traffic';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { TrackProgress } from '../../../src/track/trackProgress';

const ROOT = join(__dirname, '..', '..', '..');
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const SPIN_RAD = (60 * Math.PI) / 180;
const AI = 1;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(id: string): TrackDataV2 {
  return parseTrackData(readJson(`public/tracks/${id}.json`)) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function config(trackId: string, difficulty: Difficulty): RaceConfig {
  return { trackId, carId: 'f4', laps: 3, aiCount: 1, difficulty, seed: 1 };
}

function isSpun(track: TrackDataV2, progress: TrackProgress, state: VehicleState): boolean {
  const sample = progress.update(state.position.x, state.position.z);
  const pts = track.centerline;
  const a = pts[sample.index];
  const b = pts[(sample.index + 1) % pts.length];
  const tx = b[0] - a[0];
  const tz = b[1] - a[1];
  const q = state.rotation;
  const fx = -2 * (q.w * q.y + q.x * q.z);
  const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
  return Math.abs(Math.atan2(fx * tz - fz * tx, fx * tx + fz * tz)) > SPIN_RAD;
}

async function runAi(
  track: TrackDataV2,
  spec: CarSpec,
  difficulty: Difficulty,
  seconds: number,
): Promise<{ distance: number; spun: boolean }> {
  const game = await RaceGame.create(track, spec, config(track.id, difficulty));
  try {
    const out = game.getStates([createVehicleState(4), createVehicleState(4)]);
    let hold = false;
    let wentGo = false;
    let goPrevX = out[AI].position.x;
    let goPrevZ = out[AI].position.z;
    for (let i = 0; i < steps(20) && !wentGo; i++) {
      const px = out[AI].position.x;
      const pz = out[AI].position.z;
      game.step(BRAKE);
      game.getStates(out);
      const lights = game.startLights();
      if (lights >= 5) hold = true;
      if (hold && lights === 0) {
        wentGo = true;
        goPrevX = px;
        goPrevZ = pz;
      }
    }
    if (!wentGo) throw new Error('start sequence never reached go');
    const progress = new TrackProgress(track.centerline);
    let distance = 0;
    let spunFlag = false;
    let px = goPrevX;
    let pz = goPrevZ;
    for (let s = 0; s < steps(seconds); s++) {
      if (s > 0) {
        game.step(BRAKE);
        game.getStates(out);
      }
      const ai = out[AI];
      distance += Math.hypot(ai.position.x - px, ai.position.z - pz);
      px = ai.position.x;
      pz = ai.position.z;
      if (isSpun(track, progress, ai)) spunFlag = true;
    }
    return { distance, spun: spunFlag };
  } finally {
    game.dispose();
  }
}

describe('225 AI grip margin acceptance', () => {
  it(
    'AT1: monza expert AI over 60 s after go never spins and covers more than 1500 m',
    async () => {
      const r = await runAi(loadTrack('monza'), loadSpec(), 'expert', 60);
      expect(r.spun, 'spin').toBe(false);
      expect(r.distance, 'distance m').toBeGreaterThan(1500);
    },
    300000,
  );

  it(
    'AT2: spa expert AI over 60 s after go never spins and covers more than 1500 m',
    async () => {
      const r = await runAi(loadTrack('spa'), loadSpec(), 'expert', 60);
      expect(r.spun, 'spin').toBe(false);
      expect(r.distance, 'distance m').toBeGreaterThan(1500);
    },
    300000,
  );

  it(
    'AT3: monza expert covers more than easy + 5 m over 45 s and neither spins',
    async () => {
      const track = loadTrack('monza');
      const spec = loadSpec();
      const easy = await runAi(track, spec, 'easy', 45);
      const expert = await runAi(track, spec, 'expert', 45);
      expect(easy.spun, 'easy spin').toBe(false);
      expect(expert.spun, 'expert spin').toBe(false);
      expect(expert.distance, 'expert distance').toBeGreaterThan(easy.distance + 5);
    },
    600000,
  );

  it(
    'AT4: monza distances over 45 s order easy < medium < expert',
    async () => {
      const track = loadTrack('monza');
      const spec = loadSpec();
      const easy = await runAi(track, spec, 'easy', 45);
      const medium = await runAi(track, spec, 'medium', 45);
      const expert = await runAi(track, spec, 'expert', 45);
      expect(easy.distance, 'easy distance').toBeLessThan(medium.distance);
      expect(medium.distance, 'medium distance').toBeLessThan(expert.distance);
    },
    900000,
  );

  it('AT5: raceGame exports AI_GRIP_MARGIN with a value in [0.75, 1.0]', () => {
    const margin: unknown = Reflect.get(raceGame, 'AI_GRIP_MARGIN');
    expect(typeof margin, 'AI_GRIP_MARGIN is a number').toBe('number');
    expect(margin as number, 'AI_GRIP_MARGIN >= 0.75').toBeGreaterThanOrEqual(0.75);
    expect(margin as number, 'AI_GRIP_MARGIN <= 1.0').toBeLessThanOrEqual(1.0);
  });
});
