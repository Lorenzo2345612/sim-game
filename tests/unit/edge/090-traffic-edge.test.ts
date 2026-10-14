import { describe, expect, it } from 'vitest';
import { difficultyParams, trafficDecision } from '../../../src/ai/traffic';

describe('090 AI traffic edge', () => {
  it('EDGE1: pass offset subtracts lineOffsetAhead', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 0.5, speed: 25 }],
      1000,
      6,
      1.5,
      0.01,
    );
    expect(d.offset).toBeCloseTo(2, 9);
    expect(d.speedCap).toBeNull();
  });

  it('EDGE2: nearest blocking car decides the offset', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [
        { distance: 10, lateral: 0, speed: 25 },
        { distance: 20, lateral: 1, speed: 28 },
      ],
      1000,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(3, 9);
    expect(d.speedCap).toBeNull();
  });

  it('EDGE3: raw gap of -L/2 wraps to +L/2 and blocks', () => {
    const d = trafficDecision(
      { distance: 30, lateral: 0, speed: 30 },
      [{ distance: 10, lateral: 0, speed: 25 }],
      40,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(3, 9);
    expect(d.speedCap).toBeNull();
  });

  it('EDGE4: negative curvature prefers passing on the left', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 1, speed: 25 }],
      1000,
      6,
      0,
      -0.01,
    );
    expect(d.offset).toBeCloseTo(-2, 9);
    expect(d.speedCap).toBeNull();
  });

  it('EDGE5: zero curvature prefers passing on the left', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 0, speed: 25 }],
      1000,
      6,
      0,
      0,
    );
    expect(d.offset).toBeCloseTo(-3, 9);
    expect(d.speedCap).toBeNull();
  });

  it('EDGE6: a blocker suppresses the alongside rule', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [
        { distance: 15, lateral: 0, speed: 25 },
        { distance: 3, lateral: 1.5, speed: 30 },
      ],
      1000,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(3, 9);
    expect(d.speedCap).toBeNull();
  });

  it('EDGE7: nearest |gap| wins between two alongside cars', () => {
    const d = trafficDecision(
      { distance: 10, lateral: 0, speed: 30 },
      [
        { distance: 14, lateral: 1.5, speed: 30 },
        { distance: 9, lateral: -1.5, speed: 30 },
      ],
      1000,
      6,
      0,
      0,
    );
    expect(d.offset).toBeCloseTo(1, 9);
    expect(d.speedCap).toBeNull();
  });

  it('EDGE8: gap of exactly 25 is not a blocker (strict <)', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 25, lateral: 0, speed: 25 }],
      1000,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeNull();
  });

  it('EDGE9: difficultyParams returns a fresh object per call', () => {
    const a = difficultyParams('medium');
    const b = difficultyParams('medium');
    expect(a).not.toBe(b);
    a.speedScale = 1;
    a.mistakesPerLap = 1;
    const c = difficultyParams('medium');
    expect(c.speedScale).toBeCloseTo(0.93, 10);
    expect(c.mistakesPerLap).toBeCloseTo(0.2, 10);
  });

  it('EDGE10: trafficDecision never mutates others', () => {
    const others = [
      { distance: 10, lateral: 0, speed: 25 },
      { distance: 20, lateral: 1, speed: 28 },
    ];
    const snapshot = JSON.parse(JSON.stringify(others));
    trafficDecision({ distance: 0, lateral: 0, speed: 30 }, others, 1000, 6, 0, 0.01);
    expect(others).toEqual(snapshot);
  });
});
