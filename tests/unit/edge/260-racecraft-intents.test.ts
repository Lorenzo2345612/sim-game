import { describe, expect, it } from 'vitest';
import { Racecraft } from '../../../src/ai/racecraft';
import type { CarView, Neighbour, PlanBias, TrackCorridor } from '../../../src/ai/raceView';

const EPS = 1e-9;
const DT = 0.1;
const AGG = 0.7;

function corridor(overrides?: Partial<TrackCorridor>): TrackCorridor {
  const lapLength = 2000;
  const ds = 2;
  const n = Math.ceil(lapLength / ds);
  const halfLeft = new Float64Array(n).fill(6);
  const halfRight = new Float64Array(n).fill(6);
  const lineD = new Float64Array(n);
  const curv = new Float64Array(n);
  const profileV = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const s = k * ds;
    if (s >= 580 && s <= 620) curv[k] = 0.02;
    if (s <= 500) profileV[k] = 60;
    else if (s < 600) profileV[k] = 60 + ((20 - 60) * (s - 500)) / 100;
    else if (s < 700) profileV[k] = 20 + ((60 - 20) * (s - 600)) / 100;
    else profileV[k] = 60;
  }
  return { lapLength, ds, halfLeft, halfRight, lineD, profileV, curv, ...overrides };
}

function fixtureC(): TrackCorridor {
  return corridor();
}

function fixtureL(): TrackCorridor {
  const c = corridor();
  c.halfLeft.fill(8);
  for (let k = 0; k < c.curv.length; k++) {
    const s = k * c.ds;
    if (s >= 580 && s <= 620) c.curv[k] = -0.02;
  }
  return c;
}

function fixtureFlat(): TrackCorridor {
  const c = corridor();
  c.curv.fill(0);
  c.profileV.fill(60);
  return c;
}

function car(s: number, v: number, d = 0, stopped = false, offTrack = false): CarView {
  return { s, d, v, halfLen: 2, halfWid: 0.9, stopped, offTrack };
}

function nb(selfS: number, gap: number, v: number, d = 0, stopped = false): Neighbour {
  return { car: car(selfS + gap, v, d, stopped), gap };
}

function bias(): PlanBias {
  return { preferD: null, preferWeight: 0, speedCap: null };
}

function dist(a: number | null, b: number): number {
  return a === null ? Number.POSITIVE_INFINITY : Math.abs(a - b);
}

describe('260 racecraft intents edge', () => {
  it('EDGE1: priority order rejoin > attack > defend', () => {
    const off = new Racecraft(fixtureC(), AGG);
    const a = off.update(car(100, 55, 7, false, true), [nb(100, 20, 50)], DT, bias());
    expect(a).toBe('rejoin');

    const both = new Racecraft(fixtureC(), AGG);
    const b = both.update(car(300, 55), [nb(300, 20, 50), nb(300, -20, 58)], DT, bias());
    expect(b).toBe('attack');

    const st = new Racecraft(fixtureC(), AGG);
    const c = st.update(car(300, 55, 0, true), [nb(300, -20, 58)], DT, bias());
    expect(c).toBe('rejoin');
  });

  it('EDGE2: a left corner picks the inside line -halfLeft + 1.5', () => {
    const atk = new Racecraft(fixtureL(), AGG);
    const outA = bias();
    const intentA = atk.update(car(300, 55), [nb(300, 20, 50)], DT, outA);
    expect(intentA).toBe('attack');
    expect(dist(outA.preferD, -6.5)).toBeLessThanOrEqual(EPS);

    const def = new Racecraft(fixtureL(), AGG);
    const outD = bias();
    const intentD = def.update(car(300, 55), [nb(300, -20, 58)], DT, outD);
    expect(intentD).toBe('defend');
    expect(dist(outD.preferD, -6.5)).toBeLessThanOrEqual(EPS);
  });

  it('EDGE3: unsorted neighbours use smallest positive gap ahead, largest negative behind', () => {
    const ahead = new Racecraft(fixtureC(), AGG);
    const iA = ahead.update(car(300, 55), [nb(300, 60, 50), nb(300, 20, 50)], DT, bias());
    expect(iA).toBe('attack');

    const behind = new Racecraft(fixtureC(), AGG);
    const iB = behind.update(car(300, 55), [nb(300, -10, 54), nb(300, -30, 58)], DT, bias());
    expect(iB).toBe('defend');
  });

  it('EDGE4: count limits which neighbours are scanned', () => {
    const zero = new Racecraft(fixtureC(), AGG);
    const out0 = bias();
    const i0 = zero.update(car(300, 55), [nb(300, 20, 50)], DT, out0, 0);
    expect(i0).toBe('follow');
    expect(out0.preferD).toBeNull();
    expect(out0.preferWeight).toBe(0);

    const one = new Racecraft(fixtureC(), AGG);
    const i1 = one.update(car(300, 55), [nb(300, -20, 58), nb(300, 20, 50)], DT, bias(), 1);
    expect(i1).toBe('defend');
  });

  it('EDGE5: rejoin speedCap 0 needs gap < 0, time gap < 2.5 s, v_o > 0.1; weight is 2', () => {
    const self = (): CarView => car(100, 20, 7, false, true);

    const base = new Racecraft(fixtureC(), AGG);
    const outB = bias();
    base.update(self(), [], DT, outB);
    expect(outB.preferWeight).toBeCloseTo(2, 12);
    expect(outB.speedCap).toBe(12);

    const ahead = new Racecraft(fixtureC(), AGG);
    const outA = bias();
    ahead.update(self(), [nb(100, 10, 50, 4)], DT, outA);
    expect(outA.speedCap).toBe(12);

    const near = new Racecraft(fixtureC(), AGG);
    const outN = bias();
    near.update(self(), [nb(100, -124, 50, 4)], DT, outN);
    expect(outN.speedCap).toBe(0);

    const far = new Racecraft(fixtureC(), AGG);
    const outF = bias();
    far.update(self(), [nb(100, -125, 50, 4)], DT, outF);
    expect(outF.speedCap).toBe(12);

    const slow = new Racecraft(fixtureC(), AGG);
    const outS = bias();
    slow.update(self(), [nb(100, -2, 0.05, 4)], DT, outS);
    expect(outS.speedCap).toBe(12);
  });

  it('EDGE6: rejoin is left immediately, no 0.5 s minimum hold', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    const first = rc.update(car(100, 20, 7, false, true), [], DT, out);
    expect(first).toBe('rejoin');
    const second = rc.update(car(100, 55), [], DT, out);
    expect(second).toBe('follow');
    expect(out.preferD).toBeNull();
    expect(out.preferWeight).toBe(0);
    expect(out.speedCap).toBeNull();
  });

  it('EDGE7: a held attack outputs its stored bias, follow then zeroes it', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    const self = car(300, 55);
    const ahead = [nb(300, 20, 50)];
    const empty: Neighbour[] = [];
    rc.update(self, ahead, DT, out);
    rc.update(self, ahead, DT, out);
    rc.update(self, empty, DT, out);
    rc.update(self, empty, DT, out);
    rc.update(self, empty, DT, out);
    expect(dist(out.preferD, 4.5)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(out.preferWeight - 1.9)).toBeLessThanOrEqual(EPS);
    rc.update(self, empty, DT, out);
    expect(out.preferD).toBeNull();
    expect(out.preferWeight).toBe(0);
    expect(out.speedCap).toBeNull();
  });

  it('EDGE8: no braking point within 400 m means no defend and no attack', () => {
    const def = new Racecraft(fixtureFlat(), AGG);
    const outD = bias();
    const iD = def.update(car(100, 55), [nb(100, -20, 58)], DT, outD);
    expect(iD).toBe('follow');
    expect(outD.preferD).toBeNull();
    expect(outD.preferWeight).toBe(0);

    const atk = new Racecraft(fixtureFlat(), AGG);
    const outA = bias();
    const iA = atk.update(car(100, 55), [nb(100, 20, 50)], DT, outA);
    expect(iA).toBe('follow');
    expect(outA.preferD).toBeNull();
  });

  it('EDGE9: defend weight stays 1.5 at low aggression and a running defend keeps preferD inside 60 m', () => {
    const rc = new Racecraft(fixtureC(), 0.2);
    const out = bias();
    const behind = (s: number): Neighbour[] => [nb(s, -20, 58)];
    const first = rc.update(car(300, 55), behind(300), DT, out);
    expect(first).toBe('defend');
    expect(Math.abs(out.preferWeight - 1.5)).toBeLessThanOrEqual(EPS);
    for (let i = 0; i < 5; i++) rc.update(car(300, 55), behind(300), DT, out);
    const held = rc.update(car(460, 55), behind(460), DT, out);
    expect(held).toBe('defend');
    expect(dist(out.preferD, 4.5)).toBeLessThanOrEqual(EPS);
  });

  it('EDGE10: time gaps clamp the denominator with max(v, 1)', () => {
    const atk = new Racecraft(fixtureC(), AGG);
    const iA = atk.update(car(300, 0.5), [nb(300, 0.9, 0.5)], DT, bias());
    expect(iA).toBe('attack');

    const def = new Racecraft(fixtureC(), AGG);
    const iD = def.update(car(300, 0.1), [nb(300, -0.6, 0.5)], DT, bias());
    expect(iD).toBe('defend');
  });
});
