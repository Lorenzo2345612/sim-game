import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AiDriver, type AiObservation } from '../../../src/ai/aiDriver';
import type { RacingLine } from '../../../src/ai/racingLine';
import type { TrackDataV2 } from '../../../src/core/types';
import { RaceGame } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const DT = 1 / 120;
// VehicleModel steering curve of f4.json.
const LOW = 0.38;
const HIGH = 0.09;
const FULL = 60;

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

function speeds(n: number, v: number): Float64Array {
  return new Float64Array(n).fill(v);
}

function out() {
  return { throttle: 0, brake: 0, steer: 0, reset: true };
}

function obs(x: number, speed: number, yaw = 0): AiObservation {
  return { x, z: -100, yaw, speed };
}

// demanded steering angle (rad) via a driver normalised by lock 1
function demand(x: number, speed: number, yaw = 0): number {
  const ref = new AiDriver(straightLine(), speeds(201, 30), { maxSteerAngle: 1 });
  const o = out();
  ref.update(obs(x, speed, yaw), DT, o);
  return o.steer;
}

function curved(steer: (d: AiDriver) => void, x: number, speed: number, yaw = 0): number {
  const drv = new AiDriver(straightLine(), speeds(201, 30));
  steer(drv);
  const o = out();
  drv.update(obs(x, speed, yaw), DT, o);
  return o.steer;
}

function f4Curve(drv: AiDriver): void {
  drv.setSteerCurve(LOW, HIGH, FULL);
}

describe('252 expert AI spin-free post-code gaps', () => {
  it('POST1: speed 0 takes the low-speed lock exactly', () => {
    const d = demand(-2, 0);
    expect(curved(f4Curve, -2, 0)).toBeCloseTo(d / LOW, 6);
  });

  it('POST2: speed equal to fullSpeed takes the high-speed lock exactly', () => {
    const d = demand(-2, FULL);
    expect(curved(f4Curve, -2, FULL)).toBeCloseTo(d / HIGH, 6);
  });

  it('POST3: speed far above fullSpeed stays at the high-speed lock', () => {
    const d = demand(-2, 250);
    expect(curved(f4Curve, -2, 250)).toBeCloseTo(d / HIGH, 6);
  });

  it('POST4: negative speed clamps the blend to the low-speed lock', () => {
    const d = demand(-2, -30);
    expect(curved(f4Curve, -2, -30)).toBeCloseTo(d / LOW, 6);
  });

  it('POST5: half of fullSpeed blends the lock linearly to the midpoint', () => {
    const mid = (LOW + HIGH) / 2;
    const d = demand(-2, FULL / 2);
    expect(curved(f4Curve, -2, FULL / 2)).toBeCloseTo(d / mid, 6);
  });

  it('POST6: fullSpeed 0 or negative never divides by zero and uses the high lock', () => {
    for (const fs of [0, -60]) {
      const d = demand(-2, 30);
      const c = curved((drv) => drv.setSteerCurve(LOW, HIGH, fs), -2, 30);
      expect(Number.isFinite(c), `fullSpeed ${fs} stays finite`).toBe(true);
      expect(c, `fullSpeed ${fs}`).toBeCloseTo(d / HIGH, 6);
    }
  });

  it('POST7: equal low and high locks give a speed-independent command', () => {
    const lock = 0.2;
    for (const speed of [0, 20, 60, 200]) {
      const d = demand(-2, speed);
      const c = curved((drv) => drv.setSteerCurve(lock, lock, FULL), -2, speed);
      expect(c, `speed ${speed}`).toBeCloseTo(d / lock, 6);
    }
  });

  it('POST8: a rising curve (high > low) interpolates the same linear blend', () => {
    const lo = 0.05;
    const hi = 0.4;
    const d = demand(-2, FULL / 2);
    const c = curved((drv) => drv.setSteerCurve(lo, hi, FULL), -2, FULL / 2);
    expect(c).toBeCloseTo(d / ((lo + hi) / 2), 6);
  });

  it('POST9: a second setSteerCurve call replaces the first', () => {
    const d = demand(-2, 20);
    const c = curved((drv) => {
      drv.setSteerCurve(0.5, 0.5, FULL);
      drv.setSteerCurve(LOW, HIGH, FULL);
    }, -2, 20);
    const lock = LOW + (HIGH - LOW) * (20 / FULL);
    expect(c).toBeCloseTo(d / lock, 6);
  });

  it('POST10: the steer curve does not change throttle or brake', () => {
    const plain = new AiDriver(straightLine(), speeds(201, 30));
    const curvedDrv = new AiDriver(straightLine(), speeds(201, 30));
    curvedDrv.setSteerCurve(LOW, HIGH, FULL);
    for (const speed of [5, 25, 70]) {
      const a = out();
      const b = out();
      plain.update(obs(-2, speed), DT, a);
      curvedDrv.update(obs(-2, speed), DT, b);
      expect(b.throttle, `throttle ${speed}`).toBeCloseTo(a.throttle, 10);
      expect(b.brake, `brake ${speed}`).toBeCloseTo(a.brake, 10);
    }
  });

  it('POST11: a zero lock saturates the command on a lateral error, never NaN', () => {
    for (const speed of [0, 30, 60]) {
      const c = curved((drv) => drv.setSteerCurve(0, 0, FULL), -2, speed);
      expect(Number.isFinite(c), `speed ${speed} finite`).toBe(true);
      expect(Math.abs(c), `speed ${speed} saturates`).toBe(1);
    }
  });

  it('POST12: a zero lock keeps the command finite when the car is exactly on the line', () => {
    const c = curved((drv) => drv.setSteerCurve(0, 0, FULL), 0, 30);
    expect(Number.isFinite(c), 'on-line demand with zero lock stays finite').toBe(true);
  });

  it('POST13: the command is independent of dt', () => {
    const drv = new AiDriver(straightLine(), speeds(201, 30));
    drv.setSteerCurve(LOW, HIGH, FULL);
    const a = out();
    const b = out();
    drv.update(obs(-2, 20), 0, a);
    drv.update(obs(-2, 20), 10, b);
    expect(b.steer).toBeCloseTo(a.steer, 10);
  });

  it('POST15: infinite speed stays at the high-speed lock', () => {
    const d = demand(-2, Infinity);
    expect(curved(f4Curve, -2, Infinity)).toBeCloseTo(d / HIGH, 6);
  });

  it('POST16: an infinite fullSpeed pins the lock at the low-speed value', () => {
    const lo = 0.5;
    const d = demand(-2, 30);
    const c = curved((drv) => drv.setSteerCurve(lo, 0.1, Infinity), -2, 30);
    expect(c).toBeCloseTo(d / lo, 6);
  });

  it('POST17: a negative lock saturates like a zero lock on a demand', () => {
    for (const speed of [0, 30, 60]) {
      const c = curved((drv) => drv.setSteerCurve(-0.2, -0.1, FULL), -2, speed);
      expect(Number.isFinite(c), `speed ${speed} finite`).toBe(true);
      expect(c, `speed ${speed} saturates`).toBe(1);
    }
  });

  it('POST18: a zero lock with zero demand stays at exactly zero', () => {
    const c = curved((drv) => drv.setSteerCurve(0, 0, FULL), 0, 30);
    expect(c).toBe(0);
  });

  it('POST19: throttle and brake do not depend on dt under the blended lock', () => {
    const a = out();
    const b = out();
    const drvA = new AiDriver(straightLine(), speeds(201, 30));
    drvA.setSteerCurve(LOW, HIGH, FULL);
    const drvB = new AiDriver(straightLine(), speeds(201, 30));
    drvB.setSteerCurve(LOW, HIGH, FULL);
    drvA.update(obs(-2, 25), 0, a);
    drvB.update(obs(-2, 25), 1e6, b);
    expect(b.throttle).toBeCloseTo(a.throttle, 10);
    expect(b.brake).toBeCloseTo(a.brake, 10);
  });

  it('POST14: the stability hold still freezes steer growth under the speed-blended lock', () => {
    const drv = new AiDriver(straightLine(), speeds(201, 30));
    drv.setSteerCurve(LOW, HIGH, FULL);
    const calm = out();
    drv.update(obs(-2, 20), DT, calm);
    expect(Math.abs(calm.steer)).toBeGreaterThan(0);
    const free = out();
    drv.update(obs(-4, 20), DT, free);
    expect(Math.abs(free.steer), 'the demand alone would grow').toBeGreaterThan(
      Math.abs(calm.steer),
    );
    const drv2 = new AiDriver(straightLine(), speeds(201, 30));
    drv2.setSteerCurve(LOW, HIGH, FULL);
    const first = out();
    drv2.update(obs(-2, 20), DT, first);
    const held = out();
    // rear slip past 6° forces the growth hold on the next tick
    drv2.update({ ...obs(-4, 20), rearSlip: 0.2, yawRate: 0 }, DT, held);
    expect(held.steer).toBeCloseTo(first.steer, 10);
  });
});

describe('252 raceGame steer curve wiring', () => {
  function readJson(rel: string): unknown {
    return JSON.parse(readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8'));
  }

  it(
    'POST20: every AI driver is created with the car spec steering curve',
    async () => {
      const track = parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
      const base = parseCarSpec(readJson('public/cars/f4.json'));
      const spec: CarSpec = {
        ...base,
        steering: {
          ...base.steering,
          maxAngleLow: 0.5,
          maxAngleHigh: 0.25,
          fullSpeed: 40,
        },
      };
      const spy = vi.spyOn(AiDriver.prototype, 'setSteerCurve');
      const game = await RaceGame.create(track, spec, {
        trackId: 'monza',
        carId: 'f4',
        laps: 3,
        aiCount: 2,
        difficulty: 'expert',
        seed: 1,
      });
      try {
        expect(spy, 'one call per AI').toHaveBeenCalledTimes(2);
        for (const call of spy.mock.calls) {
          expect(call[0]).toBeCloseTo(0.5, 10);
          expect(call[1]).toBeCloseTo(0.25, 10);
          expect(call[2]).toBeCloseTo(40, 10);
        }
      } finally {
        spy.mockRestore();
        game.dispose();
      }
    },
    120000,
  );
});
