import { describe, expect, it } from 'vitest';
import { trafficDecision } from '../../../src/ai/traffic';
import { AI_GRIP_MARGIN } from '../../../src/game/raceGame';
import { BARRIER_GROUP } from '../../../src/physics/trackColliders';
import { WHEEL_RAY_FILTER_GROUPS } from '../../../src/physics/vehicleModel';

const CHASSIS_GROUP = 0x0002;
const SELF = { distance: 0, lateral: 0, speed: 40 };
const LAP = 6000;

describe('268 constants and traffic edge post-code gaps', () => {
  it('POST30: AI_GRIP_MARGIN stays inside the planner-allowed range', () => {
    expect(AI_GRIP_MARGIN, 'grip margin not below 0.70').toBeGreaterThanOrEqual(0.7);
    expect(AI_GRIP_MARGIN, 'grip margin not above 0.82').toBeLessThanOrEqual(0.82);
  });

  it('POST31: the wheel ray filter keeps every membership group but chassis and barrier', () => {
    expect(BARRIER_GROUP, 'barrier group is its own bit').toBe(0x0004);
    expect(WHEEL_RAY_FILTER_GROUPS & 0xffff, 'low bits clear the barrier group').toBe(
      0xffff & ~BARRIER_GROUP & ~CHASSIS_GROUP,
    );
    expect(WHEEL_RAY_FILTER_GROUPS >>> 16, 'high membership mask stays all ones').toBe(0xffff);
    expect(WHEEL_RAY_FILTER_GROUPS & BARRIER_GROUP, 'barrier bit filtered').toBe(0);
    expect(WHEEL_RAY_FILTER_GROUPS & CHASSIS_GROUP, 'chassis bit filtered').toBe(0);
  });

  it('POST32: one per-index half width only falls back to the symmetric band', () => {
    const clear = trafficDecision(SELF, [], LAP, 5, 4.5, -0.01, 2, undefined);
    expect(clear.offset, 'clear road keeps the historical zero offset').toBeCloseTo(0, 12);
    const blocked = trafficDecision(
      SELF,
      [{ distance: 15, lateral: 0, speed: 20 }],
      LAP,
      5,
      0,
      0.01,
      2,
      undefined,
    );
    expect(blocked.offset, 'pass inside the symmetric halfWidth - 1.0 band').toBeCloseTo(3, 12);
    expect(blocked.speedCap, 'pass fits the symmetric band').toBeNull();
    const onlyRight = trafficDecision(SELF, [], LAP, 5, 4.5, -0.01, undefined, 2);
    expect(onlyRight.offset, 'right-only width also falls back').toBeCloseTo(0, 12);
  });

  it('POST33: a per-side band narrower than the edge limit never allows a pass', () => {
    const d = trafficDecision(
      SELF,
      [{ distance: 15, lateral: 0, speed: 20 }],
      LAP,
      7,
      0,
      0.01,
      0.5,
      0.5,
    );
    expect(Number.isFinite(d.offset), 'offset stays finite').toBe(true);
    expect(d.speedCap, 'no side fits, so the pace is capped to the blocker').toBe(20);
  });

  it('POST34: a per-side band narrower than the edge limit keeps the offset finite on a clear road', () => {
    for (const [l, r] of [
      [0, 0],
      [0.5, 0.5],
      [-2, -2],
    ]) {
      const d = trafficDecision(SELF, [], LAP, 7, 3, -0.01, l, r);
      expect(Number.isFinite(d.offset), `finite offset for widths ${l}/${r}`).toBe(true);
      expect(d.speedCap, 'clear road never caps speed').toBeNull();
    }
  });
});
