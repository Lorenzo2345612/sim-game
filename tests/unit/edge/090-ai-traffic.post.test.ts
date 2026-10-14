import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { trafficDecision } from '../../../src/ai/traffic';

describe('090 AI traffic post gaps', () => {
  it('POST1: raw gap of exactly +L/2 maps to +L/2 and still blocks', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 20, lateral: 0, speed: 25 }],
      40,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(3, 9);
    expect(d.speedCap).toBeNull();
  });

  it('POST2: a car a few metres behind never blocks', () => {
    const d = trafficDecision(
      { distance: 10, lateral: 0, speed: 30 },
      [{ distance: 4, lateral: 0, speed: 25 }],
      1000,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeNull();
  });

  it('POST3: a car numerically ahead past half a lap counts as behind', () => {
    const d = trafficDecision(
      { distance: 10, lateral: 0, speed: 30 },
      [{ distance: 32, lateral: 0, speed: 25 }],
      40,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeNull();
  });

  it('POST4: a car at the same distance is not a blocker but is alongside', () => {
    const d = trafficDecision(
      { distance: 10, lateral: 0, speed: 30 },
      [{ distance: 10, lateral: 0, speed: 30 }],
      1000,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(-1, 10);
    expect(d.speedCap).toBeNull();
  });

  it('POST5: blocker lateral is compared to lineOffsetAhead, not self.lateral', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0.5, speed: 30 },
      [{ distance: 15, lateral: 0.5, speed: 25 }],
      1000,
      6,
      3,
      0.01,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeNull();
  });

  it('POST6: with negative curvature an infeasible left pass falls back to the right', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: -2.4, speed: 25 }],
      1000,
      6,
      0,
      -0.01,
    );
    expect(d.offset).toBeCloseTo(0.6, 9);
    expect(d.speedCap).toBeNull();
  });

  it('POST7: a preferred left pass exactly at -(halfWidth - 1) is feasible', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: -2, speed: 25 }],
      1000,
      6,
      0,
      0,
    );
    expect(d.offset).toBeCloseTo(-5, 9);
    expect(d.speedCap).toBeNull();
  });

  it('POST8: neither-feasible fallback keeps offset 0 even with lineOffsetAhead set, and speedCap 0 survives', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 1, speed: 0 }],
      1000,
      2.5,
      2,
      0,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeCloseTo(0, 10);
  });

  it('POST9: the default decision ignores lineOffsetAhead', () => {
    const d = trafficDecision({ distance: 0, lateral: 0, speed: 30 }, [], 1000, 6, 2, 0);
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeNull();
  });

  it('POST10: a car matching both blocker and alongside rules is handled as a blocker', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 2, lateral: 0, speed: 25 }],
      1000,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(3, 9);
    expect(d.speedCap).toBeNull();
  });

  it('POST11: source has no value imports and never calls Math.random', () => {
    const src = readFileSync(new URL('../../../src/ai/traffic.ts', import.meta.url), 'utf8');
    expect(src.match(/^\s*import\s+(?!type\b).*$/gm) ?? []).toEqual([]);
    expect(src).not.toMatch(/Math\.random/);
  });
});
