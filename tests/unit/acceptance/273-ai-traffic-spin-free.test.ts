import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame } from '../../../src/game/raceGame';
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

async function runSpins(track: TrackDataV2, spec: CarSpec, seed: number): Promise<boolean[]> {
  const aiCount = 3;
  const game = await RaceGame.create(track, spec, {
    trackId: track.id,
    carId: 'f4',
    laps: 3,
    aiCount,
    difficulty: 'expert',
    seed,
  });
  try {
    const out = game.getStates(
      Array.from({ length: aiCount + 1 }, () => createVehicleState(4)),
    );
    let hold = false;
    let wentGo = false;
    for (let i = 0; i < steps(20) && !wentGo; i++) {
      game.step(BRAKE);
      game.getStates(out);
      const lights = game.startLights();
      if (lights >= 5) hold = true;
      if (hold && lights === 0) wentGo = true;
    }
    if (!wentGo) throw new Error('start sequence never reached go');
    const progress = new TrackProgress(track.centerline);
    const spun = new Array<boolean>(aiCount).fill(false);
    for (let s = 0; s < steps(60); s++) {
      if (s > 0) {
        game.step(BRAKE);
        game.getStates(out);
      }
      for (let a = 1; a <= aiCount; a++) {
        if (isSpun(track, progress, out[a])) spun[a - 1] = true;
      }
    }
    return spun;
  } finally {
    game.dispose();
  }
}

describe('273 expert AI spin-free in 3-car traffic acceptance', () => {
  it(
    'AT4: silverstone three expert AIs never spin in 60 s on seeds 1-3',
    async () => {
      const track = loadTrack('silverstone');
      const spec = loadSpec();
      for (const seed of [1, 2, 3]) {
        const spun = await runSpins(track, spec, seed);
        for (let a = 0; a < 3; a++) {
          expect(spun[a], `seed ${seed} AI ${a + 1} never spins`).toBe(false);
        }
      }
    },
    1200000,
  );
});
