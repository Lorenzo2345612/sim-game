import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Racecraft } from '../../../src/ai/racecraft';
import type { CarView, Neighbour, PlanBias, TrackCorridor } from '../../../src/ai/raceView';

const EPS = 1e-9;
const DT = 0.1;
const AGG = 0.7;
const SRC = readFileSync(new URL('../../../src/ai/racecraft.ts', import.meta.url), 'utf8');

function corridor(profile: (s: number) => number, curv: (s: number) => number): TrackCorridor {
  const lapLength = 2000;
  const ds = 2;
  const n = Math.ceil(lapLength / ds);
  const halfLeft = new Float64Array(n).fill(6);
  const halfRight = new Float64Array(n).fill(6);
  const lineD = new Float64Array(n);
  const curva = new Float64Array(n);
  const profileV = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const s = k * ds;
    curva[k] = curv(s);
    profileV[k] = profile(s);
  }
  return { lapLength, ds, halfLeft, halfRight, lineD, profileV, curv: curva };
}

function fixtureC(): TrackCorridor {
  return corridor(
    (s) => {
      if (s <= 500) return 60;
      if (s < 600) return 60 + ((20 - 60) * (s - 500)) / 100;
      if (s < 700) return 20 + ((60 - 20) * (s - 600)) / 100;
      return 60;
    },
    (s) => (s >= 580 && s <= 620 ? 0.02 : 0),
  );
}

// gentle decline 500-600 plus a second corner at 800-900 for the moveUsed window
function profileW(s: number): number {
  if (s < 250) return 60;
  if (s < 350) return 60 - (40 * (s - 250)) / 100;
  if (s < 400) return 20 + (40 * (s - 350)) / 50;
  if (s < 500) return 60;
  if (s < 600) return 60 - (5 * (s - 500)) / 100;
  if (s < 800) return 55;
  if (s < 850) return 55 - (20 * (s - 800)) / 50;
  if (s < 900) return 35 + (20 * (s - 850)) / 50;
  return 55;
}

function fixtureW(): TrackCorridor {
  return corridor(
    profileW,
    (s) => ((s >= 250 && s <= 360) || (s >= 790 && s <= 910) ? 0.02 : 0),
  );
}

// halfRight grows 5 mm per meter so a refreshed bias differs along s
function fixtureTaper(): TrackCorridor {
  const c = fixtureC();
  for (let k = 0; k < c.halfRight.length; k++) c.halfRight[k] = 6 + 0.005 * (k * c.ds);
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

describe('260 racecraft intents post-code gaps', () => {
  it('POST1: racecraft.ts imports no three module', () => {
    expect(SRC).not.toMatch(/from\s+['"]three['"]/);
    expect(SRC).not.toMatch(/require\(\s*['"]three['"]\s*\)/);
  });

  it('POST2: update allocates nothing (no ctor, no closure, no literal)', () => {
    const body = SRC.slice(SRC.indexOf('  update('), SRC.indexOf('  private line('));
    expect(body).not.toMatch(/\bnew\s/);
    expect(body).not.toMatch(/=>/);
    expect(body).not.toMatch(/\bfunction\b/);
    expect(body).not.toMatch(/\{\s*[A-Za-z_$][\w$]*\s*:/);

    const self = car(300, 55);
    const off = car(100, 20, 7, false, true);
    const ahead = [nb(300, 20, 50)];
    const behind = [nb(300, -20, 58)];
    const outs = [bias(), bias(), bias(), bias(), bias()];
    const rcs = [
      new Racecraft(fixtureC(), AGG),
      new Racecraft(fixtureC(), AGG),
      new Racecraft(fixtureC(), AGG),
      new Racecraft(fixtureC(), AGG),
      new Racecraft(fixtureC(), AGG),
    ];
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
      rcs[0].update(self, ahead, DT, outs[0]);
      rcs[1].update(self, behind, DT, outs[1]);
      rcs[2].update(off, [], DT, outs[2]);
      rcs[3].update(self, [], DT, outs[3]);
      rcs[4].update(self, ahead, DT, outs[4], 0);
    } finally {
      globalThis.Float64Array = RealF64;
      globalThis.Array = RealArr;
    }
    expect(allocs).toBe(0);
  });

  it('POST3: no neighbours and zero speed start as follow with a zeroed bias', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    expect(rc.update(car(300, 0), [], DT, out)).toBe('follow');
    expect(out.preferD).toBeNull();
    expect(out.preferWeight).toBe(0);
    expect(out.speedCap).toBeNull();
    expect(rc.intent).toBe('follow');
  });

  it('POST4: a fresh attack needs braking distance > 30 (32 attacks, 30 follows)', () => {
    const ok = new Racecraft(fixtureC(), AGG);
    expect(ok.update(car(482, 55), [nb(482, 20, 50)], DT, bias())).toBe('attack');
    const edge = new Racecraft(fixtureC(), AGG);
    const out = bias();
    expect(edge.update(car(484, 55), [nb(484, 20, 50)], DT, out)).toBe('follow');
    expect(out.preferD).toBeNull();
  });

  it('POST5: a fresh defend needs braking distance > 60 (62 defends, 60 follows)', () => {
    const ok = new Racecraft(fixtureC(), AGG);
    expect(ok.update(car(452, 55), [nb(452, -20, 58)], DT, bias())).toBe('defend');
    const edge = new Racecraft(fixtureC(), AGG);
    const out = bias();
    expect(edge.update(car(454, 55), [nb(454, -20, 58)], DT, out)).toBe('follow');
    expect(out.preferD).toBeNull();
  });

  it('POST6: an ahead time gap of exactly 1.0 s blocks the attack', () => {
    const held = new Racecraft(fixtureC(), AGG);
    expect(held.update(car(300, 55), [nb(300, 55, 50)], DT, bias())).toBe('follow');
    const close = new Racecraft(fixtureC(), AGG);
    expect(close.update(car(300, 55), [nb(300, 54.9, 50)], DT, bias())).toBe('attack');
  });

  it('POST7: a behind time gap of exactly 0.8 s blocks the defend', () => {
    const held = new Racecraft(fixtureC(), AGG);
    expect(held.update(car(300, 40), [nb(300, -40, 50)], DT, bias())).toBe('follow');
    const close = new Racecraft(fixtureC(), AGG);
    expect(close.update(car(300, 40), [nb(300, -39.9, 50)], DT, bias())).toBe('defend');
  });

  it('POST8: the defend needs v_o > v strictly', () => {
    const equal = new Racecraft(fixtureC(), AGG);
    expect(equal.update(car(300, 55), [nb(300, -20, 55)], DT, bias())).toBe('follow');
    const faster = new Racecraft(fixtureC(), AGG);
    expect(faster.update(car(300, 55), [nb(300, -20, 55.0001)], DT, bias())).toBe('defend');
  });

  it('POST9: the profile pace edge is inclusive (profile >= v + 0.5 attacks)', () => {
    const onEdge = new Racecraft(fixtureC(), AGG);
    expect(onEdge.update(car(300, 55), [nb(300, 30, 59.5)], DT, bias())).toBe('attack');
    const over = new Racecraft(fixtureC(), AGG);
    expect(over.update(car(300, 55), [nb(300, 30, 59.5001)], DT, bias())).toBe('follow');
  });

  it('POST10: a gap of exactly 15 m is not the short-gap shortcut', () => {
    const exact = new Racecraft(fixtureC(), AGG);
    expect(exact.update(car(300, 55), [nb(300, 15, 59.8)], DT, bias())).toBe('follow');
    const short = new Racecraft(fixtureC(), AGG);
    expect(short.update(car(300, 55), [nb(300, 14.9, 59.8)], DT, bias())).toBe('attack');
  });

  it('POST11: rejoin clamps negative offsets to -halfLeft + 1.5 and passes zero through', () => {
    const far = new Racecraft(fixtureC(), AGG);
    const outFar = bias();
    expect(far.update(car(100, 20, -9, false, true), [], DT, outFar)).toBe('rejoin');
    expect(dist(outFar.preferD, -4.5)).toBeLessThanOrEqual(EPS);
    const zero = new Racecraft(fixtureC(), AGG);
    const outZero = bias();
    expect(zero.update(car(100, 20, 0, false, true), [], DT, outZero)).toBe('rejoin');
    expect(outZero.preferD).toBe(0);
    expect(outZero.speedCap).toBe(12);
  });

  it('POST12: rejoin yield needs |d_o - preferD| < 3 strictly', () => {
    const onLine = new Racecraft(fixtureC(), AGG);
    const outIn = bias();
    onLine.update(car(100, 20, 7, false, true), [nb(100, -40, 50, 7.4)], DT, outIn);
    expect(outIn.speedCap).toBe(0);
    const edge = new Racecraft(fixtureC(), AGG);
    const outOn = bias();
    edge.update(car(100, 20, 7, false, true), [nb(100, -40, 50, 7.5)], DT, outOn);
    expect(outOn.speedCap).toBe(12);
  });

  it('POST13: rejoin yield needs v_o > 0.1 strictly; a gap-0 neighbour never yields', () => {
    const slow = new Racecraft(fixtureC(), AGG);
    const outSlow = bias();
    slow.update(car(100, 20, 7, false, true), [nb(100, -2, 0.1, 4)], DT, outSlow);
    expect(outSlow.speedCap).toBe(12);
    const moving = new Racecraft(fixtureC(), AGG);
    const outMove = bias();
    moving.update(car(100, 20, 7, false, true), [nb(100, -2, 0.1001, 4)], DT, outMove);
    expect(outMove.speedCap).toBe(0);
    const zeroGap = new Racecraft(fixtureC(), AGG);
    const outGap = bias();
    zeroGap.update(car(100, 20, 7, false, true), [nb(100, 0, 50, 4)], DT, outGap);
    expect(outGap.speedCap).toBe(12);
  });

  it('POST14: a gap-0 neighbour is neither car ahead nor behind', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    expect(rc.update(car(300, 55), [nb(300, 0, 50)], DT, out)).toBe('follow');
    expect(out.preferD).toBeNull();
    expect(out.preferWeight).toBe(0);
  });

  it('POST15: a held defend cannot become attack before 0.5 s', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    const behind = [nb(300, -20, 58)];
    const both = [nb(300, 20, 50), nb(300, -20, 58)];
    expect(rc.update(car(300, 55), behind, DT, out)).toBe('defend');
    expect(rc.update(car(300, 55), both, DT, out)).toBe('defend');
    expect(rc.update(car(300, 55), both, DT, out)).toBe('defend');
    expect(rc.update(car(300, 55), both, DT, out)).toBe('defend');
    expect(rc.update(car(300, 55), both, DT, out)).toBe('defend');
    expect(Math.abs(out.preferWeight - 1.5)).toBeLessThanOrEqual(EPS);
    expect(rc.update(car(300, 55), both, DT, out)).toBe('attack');
    expect(Math.abs(out.preferWeight - 1.9)).toBeLessThanOrEqual(EPS);
  });

  it('POST16: rejoin bypasses the hold: a 0.1 s-old defend exits immediately', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    expect(rc.update(car(300, 55), [nb(300, -20, 58)], DT, out)).toBe('defend');
    expect(rc.update(car(300, 20, 7, false, true), [], DT, out)).toBe('rejoin');
    expect(out.speedCap).toBe(12);
    expect(rc.update(car(300, 55), [], DT, out)).toBe('follow');
    expect(out.preferD).toBeNull();
  });

  it('POST17: a large dt can leave a held intent in one update', () => {
    const big = new Racecraft(fixtureC(), AGG);
    const outBig = bias();
    expect(big.update(car(300, 55), [nb(300, 20, 50)], DT, outBig)).toBe('attack');
    expect(big.update(car(300, 55), [], 10, outBig)).toBe('follow');
    expect(outBig.preferWeight).toBe(0);
  });

  it('POST18: dt 0 never ages the hold, so the held attack stays and keeps its bias', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    expect(rc.update(car(300, 55), [nb(300, 20, 50)], DT, out)).toBe('attack');
    expect(rc.update(car(300, 55), [], 0, out)).toBe('attack');
    expect(rc.update(car(300, 55), [], 0, out)).toBe('attack');
    expect(dist(out.preferD, 4.5)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(out.preferWeight - 1.9)).toBeLessThanOrEqual(EPS);
  });

  it('POST19: the intent getter mirrors every returned intent', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    const self = car(300, 55);
    const ahead = [nb(300, 20, 50)];
    const empty: Neighbour[] = [];
    expect(rc.update(self, ahead, DT, out)).toBe('attack');
    expect(rc.intent).toBe('attack');
    for (let i = 0; i < 6; i++) rc.update(self, empty, DT, out);
    expect(rc.intent).toBe('follow');
    expect(rc.update(car(300, 0, 0, true), [], DT, out)).toBe('rejoin');
    expect(rc.intent).toBe('rejoin');
  });

  it('POST20: update leaves self and neighbours untouched', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const self = car(300, 55);
    const nbs = [nb(300, 20, 50), nb(300, -20, 58)];
    const snapSelf = JSON.stringify(self);
    const snapNbs = JSON.stringify(nbs);
    rc.update(self, nbs, DT, bias());
    rc.update(self, nbs, DT, bias());
    expect(JSON.stringify(self)).toBe(snapSelf);
    expect(JSON.stringify(nbs)).toBe(snapNbs);
  });

  it('POST21: the moveUsed window is (0, 400] m with the corner minimum passed', () => {
    const start = (): Racecraft => {
      const rc = new Racecraft(fixtureW(), AGG);
      const out = bias();
      const behind = [nb(100, -20, 58)];
      const empty: Neighbour[] = [];
      expect(rc.update(car(100, 55), behind, DT, out)).toBe('defend');
      for (let i = 0; i < 4; i++) expect(rc.update(car(100, 55), behind, DT, out)).toBe('defend');
      for (let i = 0; i < 6; i++) expect(rc.update(car(100, 55), empty, DT, out)).toBe('follow');
      return rc;
    };

    // travel 186, flat profile: cleared, so the move is free again
    const cleared = start();
    const outC = bias();
    expect(cleared.update(car(450, 55), [nb(450, -20, 58)], DT, outC)).toBe('defend');
    expect(dist(outC.preferD, 4.5)).toBeLessThanOrEqual(EPS);

    // travel 296 but the profile still falls: moveUsed stays
    const falling = start();
    const outF = bias();
    expect(falling.update(car(560, 55), [nb(560, -20, 58)], DT, outF)).toBe('follow');
    expect(outF.preferD).toBeNull();

    // travel exactly 400: still inside the window
    const edge = start();
    const outE = bias();
    expect(edge.update(car(664, 55), [nb(664, -20, 58)], DT, outE)).toBe('defend');
    expect(dist(outE.preferD, 4.5)).toBeLessThanOrEqual(EPS);

    // travel 401: past the window, the move is not renewed
    const past = start();
    const outP = bias();
    expect(past.update(car(665, 55), [nb(665, -20, 58)], DT, outP)).toBe('follow');
    expect(outP.preferD).toBeNull();
  });

  it('POST22: a running intent keeps its bias after the braking point is passed', () => {
    const atk = new Racecraft(fixtureC(), AGG);
    const outA = bias();
    expect(atk.update(car(300, 55), [nb(300, 20, 50)], DT, outA)).toBe('attack');
    expect(atk.update(car(700, 55), [nb(700, 20, 50)], DT, outA)).toBe('attack');
    expect(dist(outA.preferD, 4.5)).toBeLessThanOrEqual(EPS);

    const def = new Racecraft(fixtureC(), AGG);
    const outD = bias();
    expect(def.update(car(300, 55), [nb(300, -20, 58)], DT, outD)).toBe('defend');
    expect(def.update(car(700, 55), [nb(700, -20, 58)], DT, outD)).toBe('defend');
    expect(dist(outD.preferD, 4.5)).toBeLessThanOrEqual(EPS);
  });

  it('POST23: a running bias refreshes to the corridor at the current s while far from braking', () => {
    const atk = new Racecraft(fixtureTaper(), AGG);
    const outA = bias();
    expect(atk.update(car(300, 55), [nb(300, 20, 50)], DT, outA)).toBe('attack');
    expect(dist(outA.preferD, 6.0)).toBeLessThanOrEqual(EPS);
    expect(atk.update(car(400, 55), [nb(400, 20, 50)], DT, outA)).toBe('attack');
    expect(dist(outA.preferD, 6.5)).toBeLessThanOrEqual(EPS);

    const def = new Racecraft(fixtureTaper(), AGG);
    const outD = bias();
    expect(def.update(car(300, 55), [nb(300, -20, 58)], DT, outD)).toBe('defend');
    expect(dist(outD.preferD, 6.0)).toBeLessThanOrEqual(EPS);
    expect(def.update(car(400, 55), [nb(400, -20, 58)], DT, outD)).toBe('defend');
    expect(dist(outD.preferD, 6.5)).toBeLessThanOrEqual(EPS);
  });

  it('POST24: a negative count scans nothing and follows', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    expect(rc.update(car(300, 55), [nb(300, 20, 50), nb(300, -20, 58)], DT, out, -1)).toBe('follow');
    expect(out.preferD).toBeNull();
    expect(out.preferWeight).toBe(0);
  });

  it('POST25: rejoin yield clamps the time-gap denominator at 1 m/s', () => {
    const near = new Racecraft(fixtureC(), AGG);
    const outNear = bias();
    near.update(car(100, 20, 7, false, true), [nb(100, -2.4, 0.5, 4)], DT, outNear);
    expect(outNear.speedCap).toBe(0);
    const far = new Racecraft(fixtureC(), AGG);
    const outFar = bias();
    far.update(car(100, 20, 7, false, true), [nb(100, -2.6, 0.5, 4)], DT, outFar);
    expect(outFar.speedCap).toBe(12);
  });

  it('POST26: zero aggression gives attack preferWeight 0.5', () => {
    const rc = new Racecraft(fixtureC(), 0);
    const out = bias();
    expect(rc.update(car(300, 55), [nb(300, 20, 50)], DT, out)).toBe('attack');
    expect(Math.abs(out.preferWeight - 0.5)).toBeLessThanOrEqual(EPS);
  });
});
