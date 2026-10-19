import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AiDriver, type AiObservation } from '../../../src/ai/aiDriver';
import type { RacingLine } from '../../../src/ai/racingLine';
import type { CarTrafficState } from '../../../src/ai/traffic';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

// lazy so the driver cases still run when raceGame.ts cannot be parsed
type RaceGameCtor = typeof import('../../../src/game/raceGame').RaceGame;
async function loadRaceGame(): Promise<RaceGameCtor> {
  return (await import('../../../src/game/raceGame')).RaceGame;
}

const DT = 1 / 120;
const STEER_LIMIT = 0.6;
const THROTTLE_LIMIT = 0.4;
const REAR_SLIP_LIMIT = (6 * Math.PI) / 180;

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

function freshOut(): DriverInput {
  return { throttle: 0, brake: 0, steer: 0, reset: true };
}

function obs(extra: Partial<AiObservation> = {}): AiObservation {
  return { x: 0, z: -100, yaw: 0, speed: 20, ...extra };
}

function driver(): AiDriver {
  return new AiDriver(straightLine(), flatSpeeds(201, 30), { maxSteerAngle: 0.1 });
}

describe('273 traffic caution driver gaps', () => {
  it('POST1: rear slip exactly at the 6° limit is still settled, so steer stays clamped', () => {
    const drv = driver();
    const out = freshOut();
    drv.setTrafficNear(true);
    drv.update(obs({ x: -8, rearSlip: REAR_SLIP_LIMIT }), DT, out);
    expect(out.steer).toBeCloseTo(STEER_LIMIT, 10);
  });

  it('POST2: zero rear slip is settled too, so the clamp applies', () => {
    const drv = driver();
    const out = freshOut();
    drv.setTrafficNear(true);
    drv.update(obs({ x: -8, rearSlip: 0 }), DT, out);
    expect(out.steer).toBeCloseTo(STEER_LIMIT, 10);
    expect(out.throttle).toBe(THROTTLE_LIMIT);
  });

  it('POST3: negative rear slip past the limit frees steer to full authority', () => {
    const drv = driver();
    const out = freshOut();
    // settle first so the stability growth hold does not pin steer at 0
    drv.update(obs({ x: -8 }), DT, out);
    expect(out.steer).toBe(1);
    drv.setTrafficNear(true);
    const slipping = -REAR_SLIP_LIMIT * 1.01;
    drv.update(obs({ x: -8, rearSlip: slipping }), DT, out);
    expect(out.steer).toBe(1);
    drv.update(obs({ x: 8, rearSlip: slipping }), DT, out);
    expect(out.steer).toBe(-1);
  });

  it('POST4: in a slide the throttle demand is still clamped to exactly 0.4', () => {
    const drv = driver();
    const out = freshOut();
    drv.setTrafficNear(true);
    // slip just past the limit: the stability scale is 0.99, the demand 1
    drv.update(obs({ rearSlip: REAR_SLIP_LIMIT * 1.01 }), DT, out);
    expect(out.throttle).toBe(THROTTLE_LIMIT);
  });

  it('POST5: traffic caution never limits the brake', () => {
    const free = driver();
    const near = driver();
    const a = freshOut();
    const b = freshOut();
    near.setTrafficNear(true);
    free.update(obs({ speed: 80 }), DT, a);
    near.update(obs({ speed: 80 }), DT, b);
    expect(a.brake).toBe(1);
    expect(b.brake).toBeCloseTo(a.brake, 10);
    expect(b.throttle).toBe(0);
  });

  it('POST6: a zero throttle demand under traffic stays exactly zero', () => {
    const drv = driver();
    const out = freshOut();
    drv.setTrafficNear(true);
    drv.update(obs({ speed: 30 }), DT, out);
    expect(out.throttle).toBe(0);
  });

  it('POST7: the clamp holds on a large dt update', () => {
    const drv = driver();
    const out = freshOut();
    drv.setTrafficNear(true);
    drv.update(obs({ x: -8 }), 10, out);
    expect(out.throttle).toBe(THROTTLE_LIMIT);
    expect(out.steer).toBeCloseTo(STEER_LIMIT, 10);
    const settled = freshOut();
    drv.update(obs({ x: -8 }), 1e6, settled);
    expect(settled.steer).toBeCloseTo(STEER_LIMIT, 10);
    expect(settled.throttle).toBe(THROTTLE_LIMIT);
  });

  it('POST8: a speed cap and the traffic throttle clamp stack', () => {
    const drv = driver();
    const out = freshOut();
    drv.setSpeedCap(25);
    drv.setTrafficNear(true);
    drv.update(obs({ speed: 12 }), DT, out);
    expect(out.throttle).toBe(THROTTLE_LIMIT);
    expect(out.brake).toBe(0);
    const same = freshOut();
    drv.setTrafficNear(false);
    drv.update(obs({ speed: 12 }), DT, same);
    expect(same.throttle).toBeCloseTo(1, 10);
  });

  it('POST9: a hard zero cap under traffic still brakes at full authority', () => {
    const drv = driver();
    const out = freshOut();
    drv.setSpeedCap(0);
    drv.setTrafficNear(true);
    drv.update(obs({ speed: 12 }), DT, out);
    expect(out.throttle).toBe(0);
    expect(out.brake).toBe(1);
  });

  it('POST10: a yaw-rate slide without rear slip is still settled, so steer stays clamped', () => {
    const drv = driver();
    const out = freshOut();
    drv.setTrafficNear(true);
    // yawError 20·(tan(0.1)/2.6) ≫ 0.25: stability is unsettled, rear slip is not
    drv.update(obs({ x: -8, yawRate: 20, steerAngle: 0.1 }), DT, out);
    expect(out.steer).toBeCloseTo(STEER_LIMIT, 10);
    expect(out.throttle).toBeLessThanOrEqual(THROTTLE_LIMIT);
  });

  it('POST11: NaN rear slip is treated as settled, so the clamp applies', () => {
    const drv = driver();
    const out = freshOut();
    drv.setTrafficNear(true);
    drv.update(obs({ x: -8, rearSlip: NaN }), DT, out);
    expect(out.steer).toBeCloseTo(STEER_LIMIT, 10);
    expect(out.throttle).toBe(THROTTLE_LIMIT);
  });
});

// updateTrafficCaution is private and mutates only this.nearTraffic and
// this.aheadSpeedCap; a prototype host runs the real method without a race.
type CautionFields = {
  traffic: CarTrafficState[];
  othersByCar: CarTrafficState[][];
  lapLength: number;
  nearTraffic: boolean;
  aheadSpeedCap: number | null;
};
type CautionHost = CautionFields & { updateTrafficCaution(i: number): void };

function car(distance: number, lateral: number, speed: number): CarTrafficState {
  return { distance, lateral, speed };
}

let raceGameProto: object;

function host(self: CarTrafficState, others: CarTrafficState[], lapLength = 4000): CautionHost {
  const h = Object.create(raceGameProto) as CautionHost;
  h.lapLength = lapLength;
  h.traffic = [self];
  h.othersByCar = [others];
  h.nearTraffic = false;
  h.aheadSpeedCap = null;
  return h;
}

function caution(self: CarTrafficState, others: CarTrafficState[], lapLength = 4000): CautionFields {
  const h = host(self, others, lapLength);
  h.updateTrafficCaution(0);
  return h;
}

describe('273 updateTrafficCaution gaps', () => {
  beforeAll(async () => {
    raceGameProto = (await loadRaceGame()).prototype;
  });

  it('POST20: a car ahead within 20 m on line sets near and caps to its speed', () => {
    const h = caution(car(100, 1, 30), [car(112, 1, 18)]);
    expect(h.nearTraffic).toBe(true);
    expect(h.aheadSpeedCap).toBeCloseTo(18, 10);
  });

  it('POST21: a car ahead at exactly 20 m is outside the close-ahead band', () => {
    expect(caution(car(100, 0, 30), [car(120, 0, 18)]).nearTraffic).toBe(false);
    expect(caution(car(100, 0, 30), [car(120, 0, 18)]).aheadSpeedCap).toBeNull();
    const justIn = caution(car(100, 0, 30), [car(119.99, 0, 18)]);
    expect(justIn.nearTraffic).toBe(true);
    expect(justIn.aheadSpeedCap).toBeCloseTo(18, 10);
  });

  it('POST22: a car behind within 6 m is alongside: near without a cap', () => {
    const h = caution(car(100, 0, 30), [car(95, 0, 40)]);
    expect(h.nearTraffic).toBe(true);
    expect(h.aheadSpeedCap).toBeNull();
  });

  it('POST23: a car behind at exactly 6 m is no longer alongside', () => {
    expect(caution(car(100, 0, 30), [car(94, 0, 40)]).nearTraffic).toBe(false);
    const justIn = caution(car(100, 0, 30), [car(94.01, 0, 40)]);
    expect(justIn.nearTraffic).toBe(true);
    expect(justIn.aheadSpeedCap).toBeNull();
  });

  it('POST24: two cars abreast (zero gap) count as nearby without a cap', () => {
    const h = caution(car(100, 2, 30), [car(100, -1, 40)]);
    expect(h.nearTraffic).toBe(true);
    expect(h.aheadSpeedCap).toBeNull();
  });

  it('POST25: the lateral band is 3 m: exactly 3 counts, beyond it is ignored', () => {
    const on = caution(car(100, 1, 30), [car(105, 4, 10)]);
    expect(on.nearTraffic).toBe(true);
    expect(on.aheadSpeedCap).toBeCloseTo(10, 10);
    const off = caution(car(100, 1, 30), [car(105, 4.01, 10)]);
    expect(off.nearTraffic).toBe(false);
    expect(off.aheadSpeedCap).toBeNull();
  });

  it('POST26: a far side car is ignored even a metre ahead', () => {
    const h = caution(car(100, 0, 30), [car(101, 3.5, 50)]);
    expect(h.nearTraffic).toBe(false);
    expect(h.aheadSpeedCap).toBeNull();
  });

  it('POST27: the closest car ahead caps, not the slowest one', () => {
    const h = caution(car(100, 0, 30), [car(115, 0, 12), car(104, 0, 27)]);
    expect(h.aheadSpeedCap).toBeCloseTo(27, 10);
  });

  it('POST28: a stopped car ahead yields cap 0, not null', () => {
    const h = caution(car(100, 0, 30), [car(110, 0, 0)]);
    expect(h.nearTraffic).toBe(true);
    expect(h.aheadSpeedCap).toBe(0);
  });

  it('POST29: gaps wrap across the start line', () => {
    const ahead = caution(car(3995, 0, 30), [car(8, 0, 22)]);
    expect(ahead.nearTraffic).toBe(true);
    expect(ahead.aheadSpeedCap).toBeCloseTo(22, 10);
    const behind = caution(car(5, 0, 30), [car(3998, 0, 22)]);
    expect(behind.nearTraffic).toBe(false);
    const wrappedAlongside = caution(car(5, 0, 30), [car(0, 0, 22)]);
    expect(wrappedAlongside.nearTraffic).toBe(true);
    expect(wrappedAlongside.aheadSpeedCap).toBeNull();
  });

  it('POST30: empty others clears the flags instead of keeping stale state', () => {
    const h = host(car(100, 0, 30), [car(105, 0, 10)]);
    h.updateTrafficCaution(0);
    expect(h.nearTraffic).toBe(true);
    h.othersByCar = [[]];
    h.updateTrafficCaution(0);
    expect(h.nearTraffic).toBe(false);
    expect(h.aheadSpeedCap).toBeNull();
    expect(caution(car(100, 0, 30), []).nearTraffic).toBe(false);
  });

  it('POST31: a zero speed of the self car does not change detection', () => {
    const h = caution(car(100, 0, 0), [car(112, 0, 25)]);
    expect(h.nearTraffic).toBe(true);
    expect(h.aheadSpeedCap).toBeCloseTo(25, 10);
  });

  it('POST33: a neighbour alongside and one close ahead set near and the follow cap', () => {
    const h = caution(car(100, 0, 30), [car(97, 1, 40), car(110, -1, 12)]);
    expect(h.nearTraffic).toBe(true);
    expect(h.aheadSpeedCap).toBeCloseTo(12, 10);
  });

  it('POST34: a close-ahead car outside the lateral band does not cap', () => {
    const h = caution(car(100, 0, 30), [car(108, 3.5, 5)]);
    expect(h.nearTraffic).toBe(false);
    expect(h.aheadSpeedCap).toBeNull();
    const mixed = caution(car(100, 0, 30), [car(103, 3.5, 5), car(112, 2, 17)]);
    expect(mixed.nearTraffic).toBe(true);
    expect(mixed.aheadSpeedCap).toBeCloseTo(17, 10);
  });

  it('POST35: a reversing car ahead caps to its negative speed', () => {
    const h = caution(car(100, 0, 30), [car(108, 0, -4)]);
    expect(h.nearTraffic).toBe(true);
    expect(h.aheadSpeedCap).toBe(-4);
  });
});

describe('273 traffic caution wiring', () => {
  function readJson(rel: string): unknown {
    return JSON.parse(readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8'));
  }

  it(
    'POST32: the grid car 16 m behind a same-line rival is cautioned and follow-capped',
    async () => {
      const track = parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
      const spec = parseCarSpec(readJson('public/cars/f4.json'));
      const RaceGame = await loadRaceGame();
      const nearSpy = vi.spyOn(AiDriver.prototype, 'setTrafficNear');
      const capSpy = vi.spyOn(AiDriver.prototype, 'setFollowCap');
      const game = await RaceGame.create(track, spec, {
        trackId: 'monza',
        carId: 'f4',
        laps: 3,
        aiCount: 2,
        difficulty: 'expert',
        seed: 1,
        // slot order: AI1 pole, player 8 m back on the other side, AI2 16 m
        // back on the pole side (grid spacing 8 m, sides ±width/4)
        gridOrder: [1, 0, 2],
      });
      try {
        const holdInput: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
        let hold = false;
        let wentGo = false;
        for (let i = 0; i < Math.round(20 / FIXED_DT) && !wentGo; i++) {
          game.step(holdInput);
          const lights = game.startLights();
          if (lights >= 5) hold = true;
          if (hold && lights === 0) wentGo = true;
        }
        expect(wentGo, 'start sequence reached go').toBe(true);
        nearSpy.mockClear();
        capSpy.mockClear();
        game.step(holdInput);
        // one caution and one cap call per AI tick, pole car first
        expect(nearSpy.mock.calls.map((c) => c[0] as boolean)).toEqual([false, true]);
        const caps = capSpy.mock.calls.map((c) => c[0] as number | null);
        expect(caps).toHaveLength(2);
        expect(caps[0], 'the unblocked pole AI keeps no cap').toBeNull();
        expect(typeof caps[1], 'the following AI gets a number cap').toBe('number');
        expect(caps[1] as number, 'cap is the stationary pole car speed').toBeLessThan(1);
        expect(caps[1] as number).toBeGreaterThan(-0.01);
      } finally {
        nearSpy.mockRestore();
        capSpy.mockRestore();
        game.dispose();
      }
    },
    180000,
  );
});
