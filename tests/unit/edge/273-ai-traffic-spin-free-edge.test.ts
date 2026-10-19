import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import type { Difficulty } from '../../../src/ai/traffic';
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

function isFiniteState(s: VehicleState): boolean {
  return (
    Number.isFinite(s.position.x) &&
    Number.isFinite(s.position.y) &&
    Number.isFinite(s.position.z) &&
    Number.isFinite(s.rotation.x) &&
    Number.isFinite(s.rotation.y) &&
    Number.isFinite(s.rotation.z) &&
    Number.isFinite(s.rotation.w) &&
    Number.isFinite(s.forwardSpeed)
  );
}

interface TrafficRun {
  spun: boolean[];
  finite: boolean[];
}

async function runTraffic(
  track: TrackDataV2,
  spec: CarSpec,
  difficulty: Difficulty,
  aiCount: number,
  seed: number,
  seconds: number,
): Promise<TrafficRun> {
  const game = await RaceGame.create(track, spec, {
    trackId: track.id,
    carId: 'f4',
    laps: 3,
    aiCount,
    difficulty,
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
    const progress = Array.from({ length: aiCount }, () => new TrackProgress(track.centerline));
    const spun = new Array<boolean>(aiCount).fill(false);
    const finite = new Array<boolean>(aiCount).fill(true);
    for (let s = 0; s < steps(seconds); s++) {
      if (s > 0) {
        game.step(BRAKE);
        game.getStates(out);
      }
      for (let a = 1; a <= aiCount; a++) {
        const st = out[a];
        if (!isFiniteState(st)) finite[a - 1] = false;
        if (isSpun(track, progress[a - 1], st)) spun[a - 1] = true;
      }
    }
    return { spun, finite };
  } finally {
    game.dispose();
  }
}

describe('273 expert AI spin-free in 3-car traffic edge', () => {
  it(
    'EDGE1: silverstone easy AIs in 3-car traffic never spin on seeds 2 and 3',
    async () => {
      const track = loadTrack('silverstone');
      const spec = loadSpec();
      for (const seed of [2, 3]) {
        const r = await runTraffic(track, spec, 'easy', 3, seed, 60);
        for (let a = 0; a < 3; a++) {
          expect(r.spun[a], `seed ${seed} easy AI ${a + 1} never spins`).toBe(false);
        }
      }
    },
    900000,
  );

  it(
    'EDGE2: silverstone medium AIs in 3-car traffic never spin on seeds 2 and 3',
    async () => {
      const track = loadTrack('silverstone');
      const spec = loadSpec();
      for (const seed of [2, 3]) {
        const r = await runTraffic(track, spec, 'medium', 3, seed, 60);
        for (let a = 0; a < 3; a++) {
          expect(r.spun[a], `seed ${seed} medium AI ${a + 1} never spins`).toBe(false);
        }
      }
    },
    900000,
  );

  it(
    'EDGE3: AI vehicle states stay finite over the goal 60 s window in 3-car traffic',
    async () => {
      const r = await runTraffic(loadTrack('silverstone'), loadSpec(), 'expert', 3, 1, 60);
      for (let a = 0; a < 3; a++) {
        expect(r.finite[a], `AI ${a + 1} state stays finite`).toBe(true);
      }
    },
    600000,
  );
});
