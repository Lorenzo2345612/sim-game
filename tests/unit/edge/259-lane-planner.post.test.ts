import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANNER_PARAMS,
  LanePlanner,
  type PlanOutput,
} from '../../../src/ai/lanePlanner';
import type { CarView, Neighbour, PlanBias, TrackCorridor } from '../../../src/ai/raceView';

const SIDE = 2.742857;

function fixtureS(): TrackCorridor {
  const lapLength = 2000;
  const ds = 2;
  const n = Math.ceil(lapLength / ds);
  return {
    lapLength,
    ds,
    halfLeft: new Float64Array(n).fill(6),
    halfRight: new Float64Array(n).fill(6),
    lineD: new Float64Array(n),
    profileV: new Float64Array(n).fill(60),
    curv: new Float64Array(n),
  };
}

function selfCar(v: number, s = 100, d = 0): CarView {
  return { s, d, v, halfLen: 2, halfWid: 0.9, stopped: false, offTrack: false };
}

function other(gap: number, d: number, v: number, stopped = false, s = 100 + gap): Neighbour {
  return { car: { s, d, v, halfLen: 2, halfWid: 0.9, stopped, offTrack: false }, gap };
}

const NO_BIAS: PlanBias = { preferD: null, preferWeight: 0, speedCap: null };

function fresh(): PlanOutput {
  return { targetD: 0, speedCap: null, blocked: false };
}

describe('259 lane planner post-code gaps', () => {
  it('POST1: DEFAULT_PLANNER_PARAMS matches the spec table', () => {
    expect(DEFAULT_PLANNER_PARAMS).toEqual({
      candidates: 15,
      margin: 0.3,
      horizon: 3,
      checkStep: 0.1,
      lateralTime: 1.2,
      longMargin: 2.0,
      latMargin: 0.6,
      wLine: 1,
      wLat: 0.4,
      wEdge: 3,
      edgeRange: 1.5,
      wHyst: 0.3,
    });
  });

  it('POST2: candidates 0 falls back to self.d; candidates 1 pins the single offset', () => {
    const none = new LanePlanner(fixtureS(), { candidates: 0 });
    const a = none.plan(selfCar(50, 100, 1.5), [], NO_BIAS, fresh());
    expect(Math.abs(a.targetD - 1.5)).toBeLessThanOrEqual(1e-9);
    expect(a.blocked).toBe(false);
    expect(a.speedCap).toBeNull();

    const one = new LanePlanner(fixtureS(), { candidates: 1 });
    const b = one.plan(selfCar(50), [], NO_BIAS, fresh());
    expect(Math.abs(b.targetD + 4.8)).toBeLessThanOrEqual(1e-9);
    expect(b.blocked).toBe(false);

    const oneBlocked = new LanePlanner(fixtureS(), { candidates: 1 });
    const c = oneBlocked.plan(selfCar(50), [other(30, -4.8, 40)], NO_BIAS, fresh());
    expect(Math.abs(c.targetD + 4.8)).toBeLessThanOrEqual(1e-9);
    expect(c.blocked).toBe(true);
    expect(c.speedCap).toBe(40);
  });

  it('POST3: blocked fallback picks the latest collision and caps at that car', () => {
    const wall: Neighbour[] = [
      other(20, -3, 0, true),
      other(80, 0, 0, true),
      other(50, 3, 30),
    ];
    const o = new LanePlanner(fixtureS()).plan(selfCar(50), wall, NO_BIAS, fresh());
    expect(o.blocked).toBe(true);
    expect(Math.abs(o.targetD - SIDE)).toBeLessThanOrEqual(1e-5);
    expect(o.speedCap).toBe(30);
  });

  it('POST4: a previous blocked choice still gets hysteresis on the next plan', () => {
    const p = new LanePlanner(fixtureS());
    p.plan(
      selfCar(50),
      [other(20, -3, 0, true), other(80, 0, 0, true), other(50, 3, 30)],
      NO_BIAS,
      fresh(),
    );
    const after = p.plan(selfCar(50), [other(30, 0, 40)], NO_BIAS, fresh());
    expect(after.blocked).toBe(false);
    expect(after.speedCap).toBeNull();
    expect(Math.abs(after.targetD - SIDE)).toBeLessThanOrEqual(1e-5);

    const freshP = new LanePlanner(fixtureS());
    const first = freshP.plan(selfCar(50), [other(30, 0, 40)], NO_BIAS, fresh());
    expect(Math.abs(first.targetD + SIDE)).toBeLessThanOrEqual(1e-5);
  });

  it('POST5: a coarser checkStep misses a collision window between samples', () => {
    const neighbour = [other(80, 0, 0, true)];
    const coarse = new LanePlanner(fixtureS(), { checkStep: 1 });
    const a = coarse.plan(selfCar(50), neighbour, NO_BIAS, fresh());
    expect(Math.abs(a.targetD)).toBeLessThanOrEqual(1e-9);
    expect(a.blocked).toBe(false);
    expect(a.speedCap).toBeNull();

    const fine = new LanePlanner(fixtureS());
    const b = fine.plan(selfCar(50), neighbour, NO_BIAS, fresh());
    expect(Math.abs(b.targetD + SIDE)).toBeLessThanOrEqual(1e-5);
    expect(b.blocked).toBe(false);
  });

  it('POST6: corridor sample wraps past lap end', () => {
    const c = fixtureS();
    c.lineD[35] = 4;
    c.lineD[36] = 4;
    const o = new LanePlanner(c).plan(selfCar(50, 1995), [], NO_BIAS, fresh());
    expect(Math.abs(o.targetD - 4.114286)).toBeLessThanOrEqual(1e-5);
    expect(o.blocked).toBe(false);
    expect(o.speedCap).toBeNull();
  });

  it('POST7: plan allocates no arrays', () => {
    const p = new LanePlanner(fixtureS());
    const neighbours = [other(30, 0, 40), other(-10, 2, 50)];
    const RealF64 = globalThis.Float64Array;
    const RealArr = globalThis.Array;
    let allocs = 0;
    globalThis.Float64Array = new Proxy(RealF64, {
      construct(t, a) {
        allocs++;
        return new t(...(a as ConstructorParameters<typeof RealF64>));
      },
    }) as typeof Float64Array;
    globalThis.Array = new Proxy(RealArr, {
      construct(t, a) {
        allocs++;
        return new t(...(a as unknown[]));
      },
    }) as typeof Array;
    try {
      p.plan(selfCar(50), neighbours, NO_BIAS, fresh());
      p.plan(selfCar(50), [], NO_BIAS, fresh());
    } finally {
      globalThis.Float64Array = RealF64;
      globalThis.Array = RealArr;
    }
    expect(allocs).toBe(0);
  });

  it('POST8: count above neighbours length clamps to the full list', () => {
    const neighbours = [other(30, 0, 40), other(30, -4, 40)];
    const p = new LanePlanner(fixtureS());
    const o = p.plan(selfCar(50), neighbours, NO_BIAS, fresh(), 99);
    expect(Math.abs(o.targetD - SIDE)).toBeLessThanOrEqual(1e-5);
    expect(o.blocked).toBe(false);
    expect(o.speedCap).toBeNull();
  });
});
