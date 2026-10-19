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
const MAX_SIM_S = 120;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

interface OffOutcome {
  firstOffS: number | null;
  offCount: number;
}

/** 120 s from standstill on monza: full throttle + AiDriver steering (speedScale 1.15), auto gearbox forced in both legs. */
async function runMonza120s(level: 'beginner' | 'pro'): Promise<OffOutcome> {
  const track = loadTrack();
  const spec = loadSpec();
  const line = computeRacingLine(track.centerline, 6, 1);
  const fuelKg = spec.fuel.startL * spec.fuel.densityKgL;
  const speeds = speedProfile(line, carLimitsFromSpec(spec, fuelKg));
  const ai = new AiDriver(line, speeds, { speedScale: 1.15 });
  const game = await Game.create(track, spec, undefined, level);
  try {
    // The pro preset selects a manual box; force auto so gears are not part of this test.
    game.setGearMode('auto');
    const obs = { x: 0, z: 0, yaw: 0, speed: 0 };
    const aiOut: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
    const input: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
    let firstOffS: number | null = null;
    let offCount = 0;
    let wasOff = false;
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
      const surfaces = game.getWheelSurfaces();
      const off = !surfaces.some((s) => s === 'asphalt' || s === 'kerb');
      if (off && !wasOff) {
        offCount++;
        if (firstOffS === null) firstOffS = game.simTime;
      }
      wasOff = off;
    }
    return { firstOffS, offCount };
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
    'AT5: beginner leaves the track later and no more often than pro over 120 s of monza',
    async () => {
      const beginner = await runMonza120s('beginner');
      const pro = await runMonza120s('pro');
      if (beginner.firstOffS !== null) {
        expect(pro.firstOffS, 'pro first all-4-off time').not.toBeNull();
        expect(
          beginner.firstOffS,
          'beginner first all-4-off time ≥ pro + 3 s',
        ).toBeGreaterThanOrEqual((pro.firstOffS as number) + 3);
      }
      expect(beginner.offCount, 'beginner all-4-off episodes ≤ pro').toBeLessThanOrEqual(pro.offCount);
      expect(pro.firstOffS, 'pro leaves the track at least once').not.toBeNull();
    },
    600000,
  );
});
