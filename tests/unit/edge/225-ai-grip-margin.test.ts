import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import * as raceGame from '../../../src/game/raceGame';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import type { Difficulty } from '../../../src/ai/traffic';
import { carLimitsFromSpec } from '../../../src/ai/speedProfile';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { TrackProgress } from '../../../src/track/trackProgress';

const captured = vi.hoisted(() => ({
  limitCalls: [] as { spec: CarSpec; fuelKg: number }[],
  profileCalls: [] as {
    muLat: number;
    muLong: number;
    aeroK: number;
    dragK: number;
    powerPerMass: number;
    vMax: number;
  }[],
}));

vi.mock('../../../src/ai/speedProfile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ai/speedProfile')>();
  return {
    ...actual,
    carLimitsFromSpec: (
      spec: import('../../../src/physics/carSpec').CarSpec,
      fuelKg: number,
    ) => {
      captured.limitCalls.push({ spec, fuelKg });
      return actual.carLimitsFromSpec(spec, fuelKg);
    },
    speedProfile: (
      line: import('../../../src/ai/racingLine').RacingLine,
      lim: import('../../../src/ai/speedProfile').CarLimits,
    ) => {
      captured.profileCalls.push({
        muLat: lim.muLat,
        muLong: lim.muLong,
        aeroK: lim.aeroK,
        dragK: lim.dragK,
        powerPerMass: lim.powerPerMass,
        vMax: lim.vMax,
      });
      return actual.speedProfile(line, lim);
    },
  };
});

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

describe('225 AI grip margin edge', () => {
  it('EDGE1: AI_GRIP_MARGIN lies on the 0.01 calibration grid', () => {
    const margin: unknown = Reflect.get(raceGame, 'AI_GRIP_MARGIN');
    expect(typeof margin, 'AI_GRIP_MARGIN is a number').toBe('number');
    expect(Math.round((margin as number) * 100) / 100, 'multiple of 0.01').toBeCloseTo(
      margin as number,
      9,
    );
  });

  it(
    'EDGE2: speedProfile receives muLat/muLong scaled by AI_GRIP_MARGIN, other limits unchanged',
    async () => {
      captured.limitCalls.length = 0;
      captured.profileCalls.length = 0;
      const track = loadTrack('monza');
      const spec = loadSpec();
      const game = await RaceGame.create(track, spec, config('monza', 'expert'));
      try {
        expect(captured.limitCalls.length, 'carLimitsFromSpec called').toBeGreaterThan(0);
        expect(captured.profileCalls.length, 'speedProfile called').toBeGreaterThan(0);
        const margin = Reflect.get(raceGame, 'AI_GRIP_MARGIN') as number;
        expect(typeof margin, 'AI_GRIP_MARGIN is a number').toBe('number');
        const { spec: usedSpec, fuelKg } = captured.limitCalls[0];
        const base = carLimitsFromSpec(usedSpec, fuelKg);
        for (const lim of captured.profileCalls) {
          expect(lim.muLat, 'muLat scaled').toBeCloseTo(base.muLat * margin, 9);
          expect(lim.muLong, 'muLong scaled').toBeCloseTo(base.muLong * margin, 9);
          expect(lim.aeroK, 'aeroK unchanged').toBeCloseTo(base.aeroK, 12);
          expect(lim.dragK, 'dragK unchanged').toBeCloseTo(base.dragK, 12);
          expect(lim.powerPerMass, 'powerPerMass unchanged').toBeCloseTo(base.powerPerMass, 12);
          expect(lim.vMax, 'vMax unchanged').toBeCloseTo(base.vMax, 12);
        }
      } finally {
        game.dispose();
      }
    },
    120000,
  );

  it(
    'EDGE3: monza medium and hard AIs over 45 s after go order medium < hard < expert',
    async () => {
      const track = loadTrack('monza');
      const spec = loadSpec();
      const medium = await runAi(track, spec, 'medium', 45);
      const hard = await runAi(track, spec, 'hard', 45);
      const expert = await runAi(track, spec, 'expert', 45);
      expect(medium.distance, 'medium distance').toBeLessThan(hard.distance);
      expect(hard.distance, 'hard distance').toBeLessThan(expert.distance);
    },
    900000,
  );
});
