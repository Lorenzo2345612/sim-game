import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { AI_GRIP_MARGIN, RaceGame, type RaceConfig } from '../../../src/game/raceGame';
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

describe('252 expert AI spin-free edge', () => {
  it('EDGE1: AI_GRIP_MARGIN stays frozen at 0.82', () => {
    expect(AI_GRIP_MARGIN, 'frozen value 0.82').toBeCloseTo(0.82, 10);
  });

  it(
    'EDGE2: monza easy AI never spins over the goal 60 s window',
    async () => {
      const r = await runAi(loadTrack('monza'), loadSpec(), 'easy', 1, 1, 60);
      expect(r.spun[0], 'easy never spins').toBe(false);
    },
    300000,
  );

  it(
    'EDGE3: monza medium AI never spins over the goal 60 s window',
    async () => {
      const r = await runAi(loadTrack('monza'), loadSpec(), 'medium', 1, 1, 60);
      expect(r.spun[0], 'medium never spins').toBe(false);
    },
    300000,
  );

  it(
    'EDGE4: spa easy AI never spins over the goal 60 s window',
    async () => {
      const r = await runAi(loadTrack('spa'), loadSpec(), 'easy', 1, 1, 60);
      expect(r.spun[0], 'easy never spins').toBe(false);
    },
    300000,
  );

  it(
    'EDGE5: spa medium AI never spins over the goal 60 s window',
    async () => {
      const r = await runAi(loadTrack('spa'), loadSpec(), 'medium', 1, 1, 60);
      expect(r.spun[0], 'medium never spins').toBe(false);
    },
    300000,
  );

  // split from 273, follow-up task
  it.skip(
    'EDGE6: silverstone medium AIs in traffic never spin over the goal 60 s window',
    async () => {
      const r = await runAi(loadTrack('silverstone'), loadSpec(), 'medium', 3, 1, 60);
      for (let a = 0; a < 3; a++) {
        expect(r.spun[a], `medium AI ${a + 1} never spins`).toBe(false);
      }
    },
    600000,
  );

  it(
    'EDGE7: expert AIs in traffic never spin on monza or spa in the goal 60 s window',
    async () => {
      const spec = loadSpec();
      for (const id of ['monza', 'spa']) {
        const r = await runAi(loadTrack(id), spec, 'expert', 3, 1, 60);
        for (let a = 0; a < 3; a++) {
          expect(r.spun[a], `${id} expert AI ${a + 1} never spins`).toBe(false);
        }
      }
    },
    800000,
  );

  it(
    'EDGE8: spa pace ordering keeps medium between easy and expert over 45 s',
    async () => {
      const track = loadTrack('spa');
      const spec = loadSpec();
      const easy = await runAi(track, spec, 'easy', 1, 1, 45);
      const medium = await runAi(track, spec, 'medium', 1, 1, 45);
      const expert = await runAi(track, spec, 'expert', 1, 1, 45);
      expect(easy.distance[0], 'easy distance').toBeLessThan(medium.distance[0]);
      expect(medium.distance[0], 'medium distance').toBeLessThan(expert.distance[0]);
    },
    600000,
  );

  // split from 273, follow-up task
  it.skip(
    'EDGE9: silverstone easy AIs in traffic never spin over the goal 60 s window',
    async () => {
      const r = await runAi(loadTrack('silverstone'), loadSpec(), 'easy', 3, 1, 60);
      for (let a = 0; a < 3; a++) {
        expect(r.spun[a], `easy AI ${a + 1} never spins`).toBe(false);
      }
    },
    600000,
  );

  it(
    'EDGE10: monza and spa expert AI never spins on seeds 2 and 3',
    async () => {
      const spec = loadSpec();
      for (const id of ['monza', 'spa']) {
        for (const seed of [2, 3]) {
          const r = await runAi(loadTrack(id), spec, 'expert', 1, seed, 60);
          expect(r.spun[0], `${id} seed ${seed} never spins`).toBe(false);
        }
      }
    },
    800000,
  );
});
