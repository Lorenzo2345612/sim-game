import { describe, expect, it } from 'vitest';
import { difficultyParams, trafficDecision } from '../../../src/ai/traffic';

describe('090 traffic decision', () => {
  it('needs strictly more than 0.5 m/s speed advantage to count as blocker', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 0, speed: 29.5 }],
      1000,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeNull();
  });

  it('needs a lateral difference strictly below 2.5 to count as blocker', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 2.5, speed: 25 }],
      1000,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeNull();
  });

  it('treats a pass side exactly at halfWidth - 1 as feasible', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 0, speed: 25 }],
      1000,
      4,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(3, 9);
    expect(d.speedCap).toBeNull();
  });

  it('ignores an alongside car at exactly 2.2 lateral', () => {
    const d = trafficDecision(
      { distance: 10, lateral: 0, speed: 30 },
      [{ distance: 10, lateral: 2.2, speed: 30 }],
      1000,
      6,
      0,
      0,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeNull();
  });

  it('ignores an alongside car at exactly 5 m gap', () => {
    const d = trafficDecision(
      { distance: 10, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 0, speed: 30 }],
      1000,
      6,
      0,
      0,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeNull();
  });

  it('moves left on an alongside lateral tie', () => {
    const d = trafficDecision(
      { distance: 10, lateral: 0.7, speed: 30 },
      [{ distance: 8, lateral: 0.7, speed: 30 }],
      1000,
      6,
      0,
      0,
    );
    expect(d.offset).toBeCloseTo(-1, 10);
    expect(d.speedCap).toBeNull();
  });

  it('speed-caps at the blocker speed when both pass sides are infeasible', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 1.5, speed: 22 }],
      1000,
      2.4,
      0,
      -0.01,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeCloseTo(22, 10);
  });

  it('keeps difficultyParams values stable after mutation of a previous result', () => {
    const first = difficultyParams('hard');
    first.speedScale = 0;
    const second = difficultyParams('hard');
    expect(second.speedScale).toBeCloseTo(0.98, 10);
    expect(second.mistakesPerLap).toBeCloseTo(0.08, 10);
  });
});
