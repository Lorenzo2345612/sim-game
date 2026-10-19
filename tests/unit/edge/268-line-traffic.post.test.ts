import { describe, expect, it } from 'vitest';
import { computeRacingLine } from '../../../src/ai/racingLine';
import { trafficDecision } from '../../../src/ai/traffic';

type ComputeRacingLineFn = (
  centerline: [number, number][],
  halfWidth: number,
  margin?: number,
  iterations?: number,
  halfWidthLeft?: readonly number[],
  halfWidthRight?: readonly number[],
) => ReturnType<typeof computeRacingLine>;

type TrafficDecisionFn = (
  self: { distance: number; lateral: number; speed: number },
  others: readonly { distance: number; lateral: number; speed: number }[],
  lapLength: number,
  halfWidth: number,
  lineOffsetAhead: number,
  curvatureAhead: number,
  halfWidthLeft?: number,
  halfWidthRight?: number,
) => ReturnType<typeof trafficDecision>;

const lineFn = computeRacingLine as unknown as ComputeRacingLineFn;
const trafficFn = trafficDecision as unknown as TrafficDecisionFn;

// Two straights joined by 180 degree arcs: the optimizer saturates both lateral bounds.
function hairpin(): [number, number][] {
  const cl: [number, number][] = [];
  for (let z = 0; z >= -200; z -= 4) cl.push([0, z]);
  for (let k = 1; k < 24; k++) {
    const a = (k * Math.PI) / 24;
    cl.push([12 * (1 - Math.cos(a)), -200 - 12 * Math.sin(a)]);
  }
  for (let z = -196; z <= 0; z += 4) cl.push([24, z]);
  for (let k = 1; k < 24; k++) {
    const a = (k * Math.PI) / 24;
    cl.push([24 - 12 * (1 - Math.cos(a)), -12 * Math.sin(a)]);
  }
  return cl;
}

function extreme(line: { offsets: Float64Array }): { max: number; min: number } {
  let max = -Infinity;
  let min = Infinity;
  for (const o of line.offsets) {
    if (o > max) max = o;
    if (o < min) min = o;
  }
  return { max, min };
}

const SELF = { distance: 0, lateral: 0, speed: 40 };
const LAP = 6000;

describe('268 racing line and traffic post-code gaps', () => {
  it('POST7: without per-index arrays the default margin is 1.0 m', () => {
    const cl = hairpin();
    const { max, min } = extreme(lineFn(cl, 8));
    expect(max, 'right bound at halfWidth - 1.0').toBeCloseTo(7, 6);
    expect(min, 'left bound at halfWidth - 1.0').toBeCloseTo(-7, 6);
  });

  it('POST8: per-index arrays with no margin default to 1.4 m', () => {
    const cl = hairpin();
    const n = cl.length;
    const { max, min } = extreme(
      lineFn(cl, 8, undefined, undefined, new Array(n).fill(8), new Array(n).fill(8)),
    );
    expect(max, 'right bound at halfWidth - 1.4').toBeCloseTo(6.6, 6);
    expect(min, 'left bound at halfWidth - 1.4').toBeCloseTo(-6.6, 6);
  });

  it('POST9: an explicit margin overrides the per-index default', () => {
    const cl = hairpin();
    const n = cl.length;
    const { max, min } = extreme(
      lineFn(cl, 8, 2.0, undefined, new Array(n).fill(8), new Array(n).fill(8)),
    );
    expect(max, 'right bound at halfWidth - 2.0').toBeCloseTo(6, 6);
    expect(min, 'left bound at halfWidth - 2.0').toBeCloseTo(-6, 6);
  });

  it('POST10: per-index arrays of the wrong length fall back to the uniform bound', () => {
    const cl = hairpin();
    const n = cl.length;
    const huge = new Array(n - 1).fill(100);
    const { max, min } = extreme(lineFn(cl, 8, undefined, undefined, huge, huge));
    expect(max, 'uniform bound, not the huge array').toBeCloseTo(7, 6);
    expect(min, 'uniform bound, not the huge array').toBeCloseTo(-7, 6);
  });

  it('POST11: a single per-index array falls back to the uniform bound', () => {
    const cl = hairpin();
    const n = cl.length;
    const { max } = extreme(lineFn(cl, 8, undefined, undefined, new Array(n).fill(100), undefined));
    expect(max, 'uniform bound when only the left array is given').toBeCloseTo(7, 6);
  });

  it('POST12: zero and negative per-index half widths collapse the line to the centerline', () => {
    const cl = hairpin();
    const n = cl.length;
    for (const w of [0, -3]) {
      const { max, min } = extreme(
        lineFn(cl, 8, undefined, undefined, new Array(n).fill(w), new Array(n).fill(w)),
      );
      expect(max, `upper offset at half width ${w}`).toBeCloseTo(0, 12);
      expect(min, `lower offset at half width ${w}`).toBeCloseTo(0, 12);
    }
  });

  it('POST13: a clear road pulls a wide line offset back inside the side band', () => {
    const d = trafficFn(SELF, [], LAP, 7, 10, -0.01, 2, 8);
    expect(10 + d.offset, 'lateral clamped to right half width minus 1.4').toBeCloseTo(6.6, 12);
    expect(d.speedCap, 'no blocker').toBeNull();
  });

  it('POST14: a clear road pulls a narrow-side offset back to the left limit', () => {
    const d = trafficFn(SELF, [], LAP, 7, -10, -0.01, 2, 8);
    expect(-10 + d.offset, 'lateral clamped to left half width minus 1.4').toBeCloseTo(-0.6, 12);
  });

  it('POST15: an alongside step is clamped by the side band', () => {
    const d = trafficFn(SELF, [{ distance: 2, lateral: -1, speed: 40 }], LAP, 7, 6.5, -0.01, 2, 8);
    expect(6.5 + d.offset, 'step toward the line, clamped at the right limit').toBeCloseTo(6.6, 12);
  });

  it('POST16: a non-finite half width falls back to the symmetric band', () => {
    const clear = trafficFn(SELF, [], LAP, 5, 4.5, -0.01, Number.NaN, 2);
    expect(clear.offset, 'clear road keeps the historical zero offset').toBeCloseTo(0, 12);
    const blocked = trafficFn(
      SELF,
      [{ distance: 15, lateral: 0, speed: 20 }],
      LAP,
      5,
      0,
      0.01,
      Number.NaN,
      2,
    );
    expect(blocked.offset, 'pass lateral inside halfWidth - 1.0').toBeCloseTo(3, 12);
    expect(blocked.speedCap, 'pass fits the symmetric band').toBeNull();
  });

  it('POST17: a pass on the preferred side that does not fit takes the alternative', () => {
    const d = trafficFn(SELF, [{ distance: 15, lateral: 2, speed: 20 }], LAP, 7, 0, 0.01, 10, 3);
    expect(d.offset, 'left pass instead of the blocked right side').toBeCloseTo(-1, 12);
    expect(d.speedCap, 'pass found, no speed cap').toBeNull();
  });

  it('POST18: when no pass side fits the decision caps speed at the blocker pace', () => {
    const d = trafficFn(SELF, [{ distance: 15, lateral: 0, speed: 20 }], LAP, 7, 0, 0.01, 2, 2);
    expect(d.speedCap, 'speed capped to the blocker').toBe(20);
  });

  it('POST19a: a lower bound above zero keeps the whole interval on the wide side', () => {
    const cl = hairpin();
    const n = cl.length;
    const { max, min } = extreme(
      lineFn(cl, 8, undefined, undefined, new Array(n).fill(1), new Array(n).fill(8)),
    );
    expect(min, 'never left of -(left - margin)').toBeCloseTo(0.4, 6);
    expect(max, 'never right of right - margin').toBeCloseTo(6.6, 6);
  });

  it('POST19b: a centerline shorter than three points is rejected', () => {
    expect(() => lineFn([[0, 0], [1, 0]], 5)).toThrow(/at least 3/);
  });

  it('POST19: a band collapsed to the centerline pulls the car onto it', () => {
    const d = trafficFn(SELF, [], LAP, 7, 3, -0.01, 1.4, 1.4);
    expect(3 + d.offset, 'lateral collapses to 0').toBeCloseTo(0, 12);
  });

  it('POST47: an inverted per-side band never commands a lateral outside the track', () => {
    for (const [l, r] of [
      [0, 0],
      [0.5, 0.5],
    ]) {
      const edge = Math.max(0, Math.min(l, r));
      for (const line of [0, 3, -3]) {
        const d = trafficFn(SELF, [], LAP, 7, line, -0.01, l, r);
        expect(
          Math.abs(line + d.offset),
          `lateral stays inside the ${l}/${r} half widths`,
        ).toBeLessThanOrEqual(edge + 1e-9);
      }
    }
  });
});
