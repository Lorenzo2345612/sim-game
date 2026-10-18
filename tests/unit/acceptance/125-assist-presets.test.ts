import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AiDriver } from '../../../src/ai/aiDriver';
import { computeRacingLine } from '../../../src/ai/racingLine';
import { carLimitsFromSpec, speedProfile } from '../../../src/ai/speedProfile';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { assistPreset, brakeAssist, steerAssist } from '../../../src/game/assists';
import { Game } from '../../../src/game/game';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const MAX_SIM_S = 200;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

interface LapOutcome {
  invalidations: number;
  completed: number;
}

/** One monza lap with scripted full throttle and AiDriver steering (speedScale 1.15). */
async function runMonzaLap(level: 'beginner' | 'pro'): Promise<LapOutcome> {
  const track = loadTrack();
  const spec = loadSpec();
  const line = computeRacingLine(track.centerline, 6, 1);
  const fuelKg = spec.fuel.startL * spec.fuel.densityKgL;
  const speeds = speedProfile(line, carLimitsFromSpec(spec, fuelKg));
  const ai = new AiDriver(line, speeds, { speedScale: 1.15 });
  const game = await Game.create(track, spec, undefined, level);
  try {
    const obs = { x: 0, z: 0, yaw: 0, speed: 0 };
    const aiOut: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
    const input: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
    let invalidations = 0;
    let completed = 0;
    const maxSteps = Math.ceil(MAX_SIM_S / FIXED_DT);
    for (let i = 0; i < maxSteps; i++) {
      const st = game.getCurrentState();
      obs.x = st.position.x;
      obs.z = st.position.z;
      obs.yaw = game.heading();
      obs.speed = st.forwardSpeed;
      ai.update(obs, FIXED_DT, aiOut);
      input.steer = aiOut.steer;
      game.step(input);
      for (const ev of game.drainEvents()) {
        if (ev.type === 'lapInvalidated') invalidations++;
        else if (ev.type === 'lapCompleted') completed++;
      }
      if (completed > 0 || invalidations > 0) break;
    }
    return { invalidations, completed };
  } finally {
    game.dispose();
  }
}

describe('125 assist presets and braking assist', () => {
  it('AT1: assistPreset returns the table values for beginner, intermediate and pro', () => {
    const beginner = assistPreset('beginner');
    expect(beginner).toEqual({
      abs: true,
      tc: true,
      autoGear: true,
      brakeAssist: true,
      steerAssist: 0.5,
      drivingLine: 'full',
    });
    const intermediate = assistPreset('intermediate');
    expect(intermediate).toEqual({
      abs: true,
      tc: true,
      autoGear: true,
      brakeAssist: false,
      steerAssist: 0.2,
      drivingLine: 'braking',
    });
    const pro = assistPreset('pro');
    expect(pro).toEqual({
      abs: false,
      tc: false,
      autoGear: false,
      brakeAssist: false,
      steerAssist: 0,
      drivingLine: 'off',
    });
  });

  it('AT2: brakeAssist(60, 30, 100, 30) is 0.45 ± 1e-9', () => {
    expect(brakeAssist(60, 30, 100, 30)).toBeCloseTo(0.45, 9);
  });

  it('AT3: brakeAssist(30.5, 30, 50, 30) is 0 and brakeAssist(80, 20, 10, 30) is 1', () => {
    expect(brakeAssist(30.5, 30, 50, 30)).toBeCloseTo(0, 10);
    expect(brakeAssist(80, 20, 10, 30)).toBeCloseTo(1, 10);
  });

  it('AT4: steerAssist(0.2, 0.5, 0.5) is −0.05 and steerAssist(0.9, −2, 0.5) is 1', () => {
    expect(steerAssist(0.2, 0.5, 0.5)).toBeCloseTo(-0.05, 10);
    expect(steerAssist(0.9, -2, 0.5)).toBeCloseTo(1, 10);
  });

  it(
    'AT5: beginner preset completes a monza lap with no invalidation; pro leaves the track at least once',
    async () => {
      const beginner = await runMonzaLap('beginner');
      expect(beginner.invalidations, 'beginner lap invalidations').toBe(0);
      expect(beginner.completed, 'beginner completed laps').toBeGreaterThanOrEqual(1);
      const pro = await runMonzaLap('pro');
      expect(pro.invalidations, 'pro lap invalidations').toBeGreaterThanOrEqual(1);
    },
    600000,
  );
});
