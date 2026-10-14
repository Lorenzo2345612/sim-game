import { describe, expect, it } from 'vitest';
import { difficultyParams, trafficDecision, type Difficulty } from '../../../src/ai/traffic';

describe('090 AI traffic acceptance', () => {
  it('AT1: no others gives offset 0 and speedCap null', () => {
    const d = trafficDecision({ distance: 0, lateral: 0, speed: 30 }, [], 1000, 6, 0, 0);
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeNull();
  });

  it('AT2: blocker 15 m ahead with inside room on the right passes at +3.0', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 0, speed: 25 }],
      1000,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(3, 9);
    expect(d.speedCap).toBeNull();
  });

  it('AT3: right pass at 5 > 4.5 infeasible falls back to left pass at -1.0', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 2, speed: 25 }],
      1000,
      5.5,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(-1, 9);
    expect(d.speedCap).toBeNull();
  });

  it('AT4: no pass side fits, blocker sets speedCap to its speed', () => {
    const d = trafficDecision(
      { distance: 0, lateral: 0, speed: 30 },
      [{ distance: 15, lateral: 0, speed: 25 }],
      1000,
      3,
      0,
      0,
    );
    expect(d.offset).toBeCloseTo(0, 10);
    expect(d.speedCap).toBeCloseTo(25, 10);
  });

  it('AT5: alongside car at gap -3 on the right gives offset -1.0', () => {
    const d = trafficDecision(
      { distance: 10, lateral: 0, speed: 30 },
      [{ distance: 7, lateral: 1.5, speed: 30 }],
      1000,
      6,
      0,
      0,
    );
    expect(d.offset).toBeCloseTo(-1, 10);
  });

  it('AT6: gap across the start line wraps to 18.4 and the blocking rule applies', () => {
    const d = trafficDecision(
      { distance: 5780, lateral: 0, speed: 30 },
      [{ distance: 10, lateral: 0, speed: 25 }],
      5788.4,
      6,
      0,
      0.01,
    );
    expect(d.offset).toBeCloseTo(3, 9);
    expect(d.speedCap).toBeNull();
  });

  it('AT7: difficultyParams returns the table values for every level', () => {
    const table: [Difficulty, number, number][] = [
      ['easy', 0.86, 0.4],
      ['medium', 0.93, 0.2],
      ['hard', 0.98, 0.08],
      ['expert', 1.0, 0],
    ];
    for (const [level, speedScale, mistakesPerLap] of table) {
      const p = difficultyParams(level);
      expect(p.speedScale).toBeCloseTo(speedScale, 10);
      expect(p.mistakesPerLap).toBeCloseTo(mistakesPerLap, 10);
    }
  });
});
