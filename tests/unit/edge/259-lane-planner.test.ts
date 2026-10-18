import { describe, expect, it } from 'vitest';
import { LanePlanner, type PlanOutput } from '../../../src/ai/lanePlanner';
import type { CarView, Neighbour, PlanBias, TrackCorridor } from '../../../src/ai/raceView';

const EPS = 1e-9;
const SIDE = 2.742857;

function fixtureS(lineD = 0, halfRight = 6): TrackCorridor {
  const lapLength = 2000;
  const ds = 2;
  const n = Math.ceil(lapLength / ds);
  return {
    lapLength,
    ds,
    halfLeft: new Float64Array(n).fill(6),
    halfRight: new Float64Array(n).fill(halfRight),
    lineD: new Float64Array(n).fill(lineD),
    profileV: new Float64Array(n).fill(60),
    curv: new Float64Array(n),
  };
}

function selfCar(v: number, s = 100, d = 0): CarView {
  return { s, d, v, halfLen: 2, halfWid: 0.9, stopped: false, offTrack: false };
}

function other(gap: number, d: number, v: number, stopped = false, s = 100 + gap): Neighbour {
  return {
    car: { s, d, v, halfLen: 2, halfWid: 0.9, stopped, offTrack: false },
    gap,
  };
}

const NO_BIAS: PlanBias = { preferD: null, preferWeight: 0, speedCap: null };

function fresh(): PlanOutput {
  return { targetD: 0, speedCap: null, blocked: false };
}

describe('259 lane planner edge', () => {
  it('EDGE1: count limits which neighbours are considered', () => {
    const neighbours = [other(30, 0, 40), other(30, -4, 40)];
    const one = new LanePlanner(fixtureS());
    const a = one.plan(selfCar(50), neighbours, NO_BIAS, fresh(), 1);
    expect(Math.abs(a.targetD + SIDE)).toBeLessThanOrEqual(1e-5);
    expect(a.blocked).toBe(false);

    const all = new LanePlanner(fixtureS());
    const b = all.plan(selfCar(50), neighbours, NO_BIAS, fresh());
    expect(Math.abs(b.targetD - SIDE)).toBeLessThanOrEqual(1e-5);
    expect(b.blocked).toBe(false);

    const none = new LanePlanner(fixtureS());
    const c = none.plan(selfCar(50), neighbours, NO_BIAS, fresh(), 0);
    expect(Math.abs(c.targetD)).toBeLessThanOrEqual(EPS);
    expect(c.blocked).toBe(false);
    expect(c.speedCap).toBeNull();
  });

  it('EDGE2: wrapped gap detects a collision across the lap seam', () => {
    const p = new LanePlanner(fixtureS());
    const o = p.plan(selfCar(0, 5), [other(-10, 0, 50, false, 1995)], NO_BIAS, fresh());
    expect(o.blocked).toBe(true);
    expect(o.speedCap).toBe(50);
    expect(Math.abs(o.targetD)).toBeLessThanOrEqual(EPS);
  });

  it('EDGE3: negative self speed is treated as zero', () => {
    const p = new LanePlanner(fixtureS());
    const o = p.plan(selfCar(-50), [other(5, 0, 0, true)], NO_BIAS, fresh());
    expect(o.blocked).toBe(true);
    expect(o.speedCap).toBe(0);
    expect(Math.abs(o.targetD)).toBeLessThanOrEqual(EPS);
  });

  it('EDGE4: stopped flag overrides a nonzero neighbour speed', () => {
    const p = new LanePlanner(fixtureS());
    const o = p.plan(selfCar(30), [other(80, 0, 60, true)], NO_BIAS, fresh());
    expect(Math.abs(o.targetD)).toBeGreaterThanOrEqual(2.4);
    expect(o.blocked).toBe(false);
    expect(o.speedCap).toBeNull();
  });

  it('EDGE5: a faster car behind blocks and caps at its speed', () => {
    const p = new LanePlanner(fixtureS());
    const o = p.plan(selfCar(30), [other(-10, 0, 50)], NO_BIAS, fresh());
    expect(o.blocked).toBe(true);
    expect(o.speedCap).toBe(50);
    expect(Math.abs(o.targetD)).toBeLessThanOrEqual(EPS);
  });

  it('EDGE6: cost samples the corridor ahead at s + max(v,0)·horizon/2', () => {
    const c = fixtureS();
    c.lineD[87] = 4;
    c.lineD[88] = 4;
    const p = new LanePlanner(c);
    const o = p.plan(selfCar(50), [], NO_BIAS, fresh());
    expect(Math.abs(o.targetD - 4.114286)).toBeLessThanOrEqual(1e-5);
    expect(o.blocked).toBe(false);
    expect(o.speedCap).toBeNull();
  });

  it('EDGE7: candidates param overrides the sampled offsets', () => {
    const p = new LanePlanner(fixtureS(3), { candidates: 3 });
    const o = p.plan(selfCar(50), [], NO_BIAS, fresh());
    expect(Math.abs(o.targetD)).toBeLessThanOrEqual(EPS);
    expect(o.blocked).toBe(false);
    expect(o.speedCap).toBeNull();
  });

  it('EDGE8: plan overwrites stale out fields and leaves inputs untouched', () => {
    const corridor = fixtureS();
    const halfLeftBefore = Array.from(corridor.halfLeft);
    const lineDBefore = Array.from(corridor.lineD);
    const self = Object.freeze(selfCar(50));
    const neighbour = Object.freeze({
      car: Object.freeze(other(30, 0, 40).car),
      gap: 30,
    });
    const neighbours: readonly Neighbour[] = Object.freeze([neighbour]);
    const bias: PlanBias = Object.freeze({ preferD: null, preferWeight: 0, speedCap: null });
    const out: PlanOutput = { targetD: 999, speedCap: 42, blocked: true };
    const p = new LanePlanner(corridor);
    const res = p.plan(self, neighbours, bias, out);
    expect(res).toEqual(out);
    expect(Math.abs(out.targetD + SIDE)).toBeLessThanOrEqual(1e-5);
    expect(out.speedCap).toBeNull();
    expect(out.blocked).toBe(false);
    expect(Array.from(corridor.halfLeft)).toEqual(halfLeftBefore);
    expect(Array.from(corridor.lineD)).toEqual(lineDBefore);
  });

  it('EDGE9: preferD null disables the bias term even with weight', () => {
    const bias: PlanBias = { preferD: null, preferWeight: 5, speedCap: null };
    const p = new LanePlanner(fixtureS(3));
    const o = p.plan(selfCar(50), [], bias, fresh());
    expect(Math.abs(o.targetD - SIDE)).toBeLessThanOrEqual(1e-5);
    expect(o.blocked).toBe(false);
    expect(o.speedCap).toBeNull();
  });

  it('EDGE10: edge term penalises the narrow side of an asymmetric corridor', () => {
    const p = new LanePlanner(fixtureS(3, 3));
    const o = p.plan(selfCar(50), [], NO_BIAS, fresh());
    expect(Math.abs(o.targetD - 1.328571)).toBeLessThanOrEqual(1e-5);
    expect(o.blocked).toBe(false);
    expect(o.speedCap).toBeNull();
  });
});
