import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { AiDriver, type AiObservation } from '../../../src/ai/aiDriver';
import type { RacingLine } from '../../../src/ai/racingLine';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const DT = 1 / 120;
const SLIP_LIMIT = (6 * Math.PI) / 180;
const YAW_LIMIT = 0.25;
const WHEELBASE = 2.6;
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

function straightLine(): RacingLine {
  const n = 201;
  const points = new Float64Array(2 * n);
  const offsets = new Float64Array(n);
  const dist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    points[2 * i] = 0;
    points[2 * i + 1] = -2 * i;
    dist[i] = 2 * i;
  }
  return { offsets, points, dist, length: 2 * (n - 1) };
}

function flatSpeeds(n: number, v: number): Float64Array {
  return new Float64Array(n).fill(v);
}

function freshOut() {
  return { throttle: 0, brake: 0, steer: 0, reset: true };
}

function obs(extra: Partial<AiObservation> = {}): AiObservation {
  return { x: 0, z: -100, yaw: 0, speed: 20, ...extra };
}

function driver(): AiDriver {
  return new AiDriver(straightLine(), flatSpeeds(201, 30));
}

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8'));
}

interface ObsDynamics {
  rearSlip?: number;
  yawRate?: number;
  steerAngle?: number;
}

describe('225 AI stability aid post gaps', () => {
  it('at exactly the slip and yaw-rate limits the throttle is not reduced', () => {
    const drv = driver();
    const out = freshOut();
    drv.update(obs({ rearSlip: SLIP_LIMIT }), DT, out);
    expect(out.throttle).toBe(1);
    drv.update(obs({ yawRate: YAW_LIMIT }), DT, out);
    expect(out.throttle).toBe(1);
  });

  it('negative rear slip scales the throttle like its absolute value', () => {
    const drv = driver();
    const out = freshOut();
    drv.update(obs({ rearSlip: (-9 * Math.PI) / 180 }), DT, out);
    expect(out.throttle).toBeCloseTo(0.5, 10);
  });

  it('the throttle scale is the min of the slip and yaw-rate contributions', () => {
    const drv = driver();
    const out = freshOut();
    // slip 8 deg -> 2/3; yaw error 0.4 -> 0.4; min wins
    drv.update(obs({ rearSlip: (8 * Math.PI) / 180, yawRate: 0.4 }), DT, out);
    expect(out.throttle).toBeCloseTo(0.4, 10);
  });

  it('the yaw-rate error subtracts the commanded steer curvature', () => {
    const drv = driver();
    const out = freshOut();
    const steerAngle = 0.1;
    const matched = 20 * Math.tan(steerAngle) / WHEELBASE;
    drv.update(obs({ steerAngle, yawRate: matched }), DT, out);
    expect(out.throttle).toBe(1);

    // 0.375 rad/s error = limit + half the limit of excess -> scale 0.5
    drv.update(obs({ steerAngle, yawRate: matched + 1.5 * YAW_LIMIT }), DT, out);
    expect(out.throttle).toBeCloseTo(0.5, 10);
  });

  it('without yawRate the steerAngle alone does not engage the aid', () => {
    const drv = driver();
    const out = freshOut();
    drv.update(obs({ x: -2, steerAngle: 0.3 }), DT, out);
    expect(out.throttle).toBe(1);
    const calm = out.steer;
    drv.update(obs({ x: -4, steerAngle: 0.3 }), DT, out);
    expect(out.throttle).toBe(1);
    expect(out.steer).toBeGreaterThan(calm);
  });

  it('at exactly the yaw-rate limit the steering growth is still held', () => {
    const drv = driver();
    const out = freshOut();
    drv.update(obs({ x: -2 }), DT, out);
    const held = out.steer;
    drv.update(obs({ x: -4, rearSlip: (9 * Math.PI) / 180, yawRate: YAW_LIMIT }), DT, out);
    expect(out.steer).toBeCloseTo(held, 10);
  });

  it('past the yaw-rate limit the steering is free to grow', () => {
    const drv = driver();
    const out = freshOut();
    drv.update(obs({ x: -2 }), DT, out);
    const held = out.steer;
    drv.update(
      obs({ x: -4, rearSlip: (9 * Math.PI) / 180, yawRate: YAW_LIMIT + 0.05 }),
      DT,
      out,
    );
    expect(out.steer).toBeGreaterThan(held + 1e-6);
  });

  it('an opposite-sign catch keeps its sign and only the magnitude is held', () => {
    const drv = driver();
    const out = freshOut();
    drv.update(obs({ x: -2 }), DT, out);
    const held = out.steer;
    expect(held).toBeGreaterThan(0);
    drv.update(obs({ x: 4, rearSlip: (9 * Math.PI) / 180 }), DT, out);
    expect(out.steer).toBeCloseTo(-held, 10);
  });

  it('on a fresh driver an over-limit tick with no prior steer commands zero steer', () => {
    const drv = driver();
    const out = freshOut();
    drv.update(obs({ x: -2, rearSlip: (9 * Math.PI) / 180 }), DT, out);
    expect(out.steer).toBe(0);
    expect(out.throttle).toBeCloseTo(0.5, 10);
  });

  it('brake is not scaled when the aid engages', () => {
    const drv = driver();
    const out = freshOut();
    drv.update(obs({ speed: 33 }), DT, out);
    expect(out.brake).toBeCloseTo(0.75, 10);
    drv.update(obs({ speed: 33, rearSlip: (9 * Math.PI) / 180 }), DT, out);
    expect(out.brake).toBeCloseTo(0.75, 10);
    expect(out.throttle).toBe(0);
  });

  it(
    'pre-go the AI observation dynamics are finite, calm and steer-free',
    async () => {
      const track = parseTrackData(
        readJson('public/tracks/monza.json'),
      ) as TrackDataV2;
      const spec = parseCarSpec(readJson('public/cars/f4.json'));
      const config: RaceConfig = {
        trackId: 'monza',
        carId: 'f4',
        laps: 3,
        aiCount: 1,
        difficulty: 'expert',
        seed: 1,
      };
      const game = await RaceGame.create(track, spec, config);
      try {
        game.getStates([createVehicleState(4), createVehicleState(4)]);
        for (let i = 0; i < 5; i++) {
          game.step(BRAKE);
          game.getStates([createVehicleState(4), createVehicleState(4)]);
        }
        const dyn = (
          game as unknown as { observations: ObsDynamics[] }
        ).observations[0];
        expect(Number.isFinite(dyn.rearSlip), 'rearSlip finite').toBe(true);
        expect(Number.isFinite(dyn.yawRate), 'yawRate finite').toBe(true);
        expect(Math.abs(dyn.rearSlip as number), 'rearSlip calm').toBeLessThan(
          SLIP_LIMIT,
        );
        expect(Math.abs(dyn.yawRate as number), 'yawRate calm').toBeLessThan(2);
        expect(Math.abs(dyn.steerAngle as number), 'steer free').toBeLessThan(
          1e-9,
        );
      } finally {
        game.dispose();
      }
    },
    120000,
  );
});
