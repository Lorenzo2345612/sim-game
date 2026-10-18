import { describe, expect, it } from 'vitest';
import { LanePlanner, type PlanOutput } from '../../../src/ai/lanePlanner';
import type { CarView, Neighbour, PlanBias, TrackCorridor } from '../../../src/ai/raceView';

const EPS = 1e-9;
const HALF = 4.8;
const SIDE = 2.742857;

function fixtureS(lineD = 0): TrackCorridor {
  const lapLength = 2000;
  const ds = 2;
  const n = Math.ceil(lapLength / ds);
  return {
    lapLength,
    ds,
    halfLeft: new Float64Array(n).fill(6),
    halfRight: new Float64Array(n).fill(6),
    lineD: new Float64Array(n).fill(lineD),
    profileV: new Float64Array(n).fill(60),
    curv: new Float64Array(n),
  };
}

function selfCar(v: number): CarView {
  return { s: 100, d: 0, v, halfLen: 2, halfWid: 0.9, stopped: false, offTrack: false };
}

function other(gap: number, d: number, v: number, stopped = false): Neighbour {
  return {
    car: { s: 100 + gap, d, v, halfLen: 2, halfWid: 0.9, stopped, offTrack: false },
    gap,
  };
}

const NO_BIAS: PlanBias = { preferD: null, preferWeight: 0, speedCap: null };

function fresh(): PlanOutput {
  return { targetD: 0, speedCap: null, blocked: false };
}

describe('259 sampling lane planner acceptance', () => {
  it('AT1: empty track keeps the car on the racing line', () => {
    const p = new LanePlanner(fixtureS());
    const o = p.plan(selfCar(50), [], NO_BIAS, fresh());
    expect(Math.abs(o.targetD)).toBeLessThanOrEqual(EPS);
    expect(o.blocked).toBe(false);
    expect(o.speedCap).toBeNull();
  });

  it('AT2: side-steps the slower car and breaks the tie to the lower k', () => {
    const p = new LanePlanner(fixtureS());
    const o = p.plan(selfCar(50), [other(30, 0, 40)], NO_BIAS, fresh());
    expect(Math.abs(o.targetD + SIDE)).toBeLessThanOrEqual(1e-5);
    expect(o.blocked).toBe(false);
    expect(o.speedCap).toBeNull();
  });

  it('AT3: a car one lane left leaves the racing line free', () => {
    const p = new LanePlanner(fixtureS());
    const o = p.plan(selfCar(50), [other(30, -3, 40)], NO_BIAS, fresh());
    expect(Math.abs(o.targetD)).toBeLessThanOrEqual(EPS);
  });

  it('AT4: walls of cars report blocked with the hit car speed cap', () => {
    const p = new LanePlanner(fixtureS());
    const o = p.plan(
      selfCar(50),
      [other(30, -4, 40), other(30, 0, 40), other(30, 4, 40)],
      NO_BIAS,
      fresh(),
    );
    expect(o.blocked).toBe(true);
    expect(o.speedCap).toBe(40);
    expect(Number.isFinite(o.targetD)).toBe(true);
    expect(o.targetD).toBeGreaterThanOrEqual(-HALF);
    expect(o.targetD).toBeLessThanOrEqual(HALF);
  });

  it('AT5: a stopped car forces a lane change without blocking', () => {
    const p = new LanePlanner(fixtureS());
    const o = p.plan(selfCar(30), [other(80, 0, 0, true)], NO_BIAS, fresh());
    expect(Math.abs(o.targetD)).toBeGreaterThanOrEqual(2.4);
    expect(o.blocked).toBe(false);
  });

  it('AT6: racing room leaves a lateral gap to the car on the line', () => {
    const clear = new LanePlanner(fixtureS(3));
    const alone = clear.plan(selfCar(50), [], NO_BIAS, fresh());
    expect(Math.abs(alone.targetD - SIDE)).toBeLessThanOrEqual(1e-5);
    const p = new LanePlanner(fixtureS(3));
    const o = p.plan(selfCar(50), [other(0, 3, 50)], NO_BIAS, fresh());
    expect(o.targetD).toBeLessThanOrEqual(0.6 + EPS);
  });

  it('AT7: preference bias shifts the pick toward preferD', () => {
    const p = new LanePlanner(fixtureS());
    const bias: PlanBias = { preferD: 4, preferWeight: 2, speedCap: null };
    const o = p.plan(selfCar(50), [], bias, fresh());
    expect(Math.abs(o.targetD - 3.428571)).toBeLessThanOrEqual(1e-5);
  });

  it('AT8: hysteresis keeps the same side while the neighbour jitters', () => {
    const p = new LanePlanner(fixtureS());
    const signs: number[] = [];
    for (let i = 0; i < 10; i++) {
      const d = i % 2 === 0 ? 0.1 : -0.1;
      const o = p.plan(selfCar(50), [other(30, d, 40)], NO_BIAS, fresh());
      expect(o.targetD).not.toBe(0);
      signs.push(Math.sign(o.targetD));
    }
    for (const s of signs) expect(s).toBe(signs[0]);
  });

  it('AT9: 10 000 plans are deterministic and stay under 2 s', () => {
    const neighbours = [
      other(-50, 2, 40),
      other(-20, -3, 60),
      other(0, 1, 45),
      other(15, 0, 50),
      other(30, -1, 35),
      other(50, 4, 55),
      other(80, -2, 30),
      other(100, 3, 48),
    ];
    const targets: number[] = [];
    const caps: (number | null)[] = [];
    const blockedFlags: boolean[] = [];
    const a = new LanePlanner(fixtureS());
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      const o = a.plan(selfCar(50), neighbours, NO_BIAS, fresh());
      targets.push(o.targetD);
      caps.push(o.speedCap);
      blockedFlags.push(o.blocked);
    }
    expect(performance.now() - t0).toBeLessThanOrEqual(2000);
    const b = new LanePlanner(fixtureS());
    let mismatch = -1;
    for (let i = 0; i < 10000; i++) {
      const o = b.plan(selfCar(50), neighbours, NO_BIAS, fresh());
      if (o.targetD !== targets[i] || o.speedCap !== caps[i] || o.blocked !== blockedFlags[i]) {
        mismatch = i;
        break;
      }
    }
    expect(mismatch).toBe(-1);
  });

  it('AT10: bias speed cap is the min of the bias and the planner cap', () => {
    const bias: PlanBias = { preferD: null, preferWeight: 0, speedCap: 12 };
    const free = new LanePlanner(fixtureS());
    expect(free.plan(selfCar(50), [], bias, fresh()).speedCap).toBe(12);
    const walled = new LanePlanner(fixtureS());
    const cap = walled.plan(
      selfCar(50),
      [other(30, -4, 40), other(30, 0, 40), other(30, 4, 40)],
      bias,
      fresh(),
    ).speedCap;
    expect(cap).toBe(Math.min(12, 40));
    const parked = new LanePlanner(fixtureS());
    expect(parked.plan(selfCar(50), [other(0, 0, 0, true)], bias, fresh()).speedCap).toBe(0);
  });
});
