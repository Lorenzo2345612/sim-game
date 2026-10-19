import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import type { Difficulty } from '../../../src/ai/traffic';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { TrackProgress } from '../../../src/track/trackProgress';

const ROOT = join(__dirname, '..', '..', '..');
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const SPIN_RAD = (60 * Math.PI) / 180;

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

function config(
  trackId: string,
  difficulty: Difficulty,
  aiCount: number,
  seed: number,
): RaceConfig {
  return { trackId, carId: 'f4', laps: 3, aiCount, difficulty, seed };
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

interface RunResult {
  distance: number[];
  spun: boolean[];
}

async function runAi(
  track: TrackDataV2,
  spec: CarSpec,
  difficulty: Difficulty,
  aiCount: number,
  seed: number,
  seconds: number,
): Promise<RunResult> {
  const game = await RaceGame.create(track, spec, config(track.id, difficulty, aiCount, seed));
  try {
    const out = game.getStates(
      Array.from({ length: aiCount + 1 }, () => createVehicleState(4)),
    );
    const prevX = new Float64Array(aiCount + 1);
    const prevZ = new Float64Array(aiCount + 1);
    let hold = false;
    let wentGo = false;
    for (let i = 0; i < steps(20) && !wentGo; i++) {
      for (let a = 1; a <= aiCount; a++) {
        prevX[a] = out[a].position.x;
        prevZ[a] = out[a].position.z;
      }
      game.step(BRAKE);
      game.getStates(out);
      const lights = game.startLights();
      if (lights >= 5) hold = true;
      if (hold && lights === 0) wentGo = true;
    }
    if (!wentGo) throw new Error('start sequence never reached go');
    const progress = new TrackProgress(track.centerline);
    const distance = new Array<number>(aiCount).fill(0);
    const spun = new Array<boolean>(aiCount).fill(false);
    for (let s = 0; s < steps(seconds); s++) {
      if (s > 0) {
        game.step(BRAKE);
        game.getStates(out);
      }
      for (let a = 1; a <= aiCount; a++) {
        const ai = out[a];
        distance[a - 1] += Math.hypot(ai.position.x - prevX[a], ai.position.z - prevZ[a]);
        prevX[a] = ai.position.x;
        prevZ[a] = ai.position.z;
        if (isSpun(track, progress, ai)) spun[a - 1] = true;
      }
    }
    return { distance, spun };
  } finally {
    game.dispose();
  }
}

describe('252 expert AI spin-free acceptance', () => {
  it(
    'AT1: monza expert AI never spins in 60 s and covers more than 1500 m',
    async () => {
      const r = await runAi(loadTrack('monza'), loadSpec(), 'expert', 1, 1, 60);
      expect(r.spun[0], 'AI never spins').toBe(false);
      expect(r.distance[0], 'AI distance m').toBeGreaterThan(1500);
    },
    300000,
  );

  it(
    'AT2: spa expert AI never spins in 60 s and covers more than 1500 m',
    async () => {
      const r = await runAi(loadTrack('spa'), loadSpec(), 'expert', 1, 1, 60);
      expect(r.spun[0], 'AI never spins').toBe(false);
      expect(r.distance[0], 'AI distance m').toBeGreaterThan(1500);
    },
    300000,
  );

  it(
    'AT3: monza easy/medium/expert never spin in 45 s and order easy < medium < expert',
    async () => {
      const track = loadTrack('monza');
      const spec = loadSpec();
      const easy = await runAi(track, spec, 'easy', 1, 1, 45);
      const medium = await runAi(track, spec, 'medium', 1, 1, 45);
      const expert = await runAi(track, spec, 'expert', 1, 1, 45);
      expect(easy.spun[0], 'easy never spins').toBe(false);
      expect(medium.spun[0], 'medium never spins').toBe(false);
      expect(expert.spun[0], 'expert never spins').toBe(false);
      expect(easy.distance[0], 'easy distance').toBeLessThan(medium.distance[0]);
      expect(medium.distance[0], 'medium distance').toBeLessThan(expert.distance[0]);
    },
    900000,
  );

  // moved to task 273
  it.skip(
    'AT4: silverstone three expert AIs never spin in 60 s on seeds 1-3',
    async () => {
      const track = loadTrack('silverstone');
      const spec = loadSpec();
      for (const seed of [1, 2, 3]) {
        const r = await runAi(track, spec, 'expert', 3, seed, 60);
        for (let a = 0; a < 3; a++) {
          expect(r.spun[a], `seed ${seed} AI ${a + 1} never spins`).toBe(false);
        }
      }
    },
    1200000,
  );

  it(
    'AT5: spa easy covers less distance than expert over 45 s',
    async () => {
      const track = loadTrack('spa');
      const spec = loadSpec();
      const easy = await runAi(track, spec, 'easy', 1, 1, 45);
      const expert = await runAi(track, spec, 'expert', 1, 1, 45);
      expect(easy.distance[0], 'easy distance').toBeLessThan(expert.distance[0]);
    },
    600000,
  );
});
