import { describe, expect, it } from 'vitest';
import {
  AERO_ZONE_MAX_CURVATURE,
  AERO_ZONE_MIN_LENGTH_M,
  AERO_ZONE_WINDOW_M,
  deriveAeroZones,
  inAeroZone,
  type AeroZone,
} from '../../../src/track/aeroZones';

// Axis-aligned square, 1 m spacing, side S (integer). With ±25 m heading
// windows landing exactly on points, a point at corner-distance a is straight
// iff 25 <= a <= S - 26, so each side's run length is S - 51 exactly.
function square(side: number, rotate = 0): [number, number][] {
  const n = 4 * side;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + rotate) % n;
    if (j < side) pts.push([j, 0]);
    else if (j < 2 * side) pts.push([side, j - side]);
    else if (j < 3 * side) pts.push([3 * side - j, side]);
    else pts.push([0, 4 * side - j]);
  }
  return pts;
}

describe('217 aero zones edge cases', () => {
  it('EDGE1: exports the spec constants', () => {
    expect(AERO_ZONE_WINDOW_M).toBe(50);
    expect(AERO_ZONE_MAX_CURVATURE).toBeCloseTo(1 / 800, 12);
    expect(AERO_ZONE_MIN_LENGTH_M).toBe(300);
  });

  it('EDGE2: fewer than 3 points yields [] without throwing', () => {
    expect(deriveAeroZones([])).toEqual([]);
    expect(deriveAeroZones([[0, 0]])).toEqual([]);
    expect(deriveAeroZones([[0, 0], [2, 0]])).toEqual([]);
  });

  it('EDGE3: deriveAeroZones does not mutate the input centerline', () => {
    const cl = square(351);
    const before = cl.map((p): [number, number] => [p[0], p[1]]);
    deriveAeroZones(cl);
    expect(cl).toEqual(before);
  });

  it('EDGE4: empty zones yield false; multiple zones match any single zone', () => {
    expect(inAeroZone([], 100, 1000)).toBe(false);
    const zones: AeroZone[] = [
      { start: 100, end: 200 },
      { start: 500, end: 600 },
    ];
    expect(inAeroZone(zones, 150, 1000)).toBe(true);
    expect(inAeroZone(zones, 550, 1000)).toBe(true);
    expect(inAeroZone(zones, 350, 1000)).toBe(false);
    expect(inAeroZone(zones, 0, 1000)).toBe(false);
  });

  it('EDGE5: inAeroZone start boundary is inclusive and d wraps across multiple laps', () => {
    const zones: AeroZone[] = [{ start: 900, end: 1100 }];
    const L = 1000;
    expect(inAeroZone(zones, 900, L)).toBe(true);
    expect(inAeroZone(zones, 899, L)).toBe(false);
    expect(inAeroZone(zones, 1000, L)).toBe(true);
    expect(inAeroZone(zones, -1050, L)).toBe(true);
    expect(inAeroZone(zones, -1500, L)).toBe(false);
  });

  it('EDGE6: run length exactly 300 m is kept (four sides of a 351 m square)', () => {
    const zones = deriveAeroZones(square(351));
    expect(zones).toHaveLength(4);
    const expected: Array<[number, number]> = [
      [25, 325],
      [376, 676],
      [727, 1027],
      [1078, 1378],
    ];
    for (let i = 0; i < 4; i++) {
      expect(zones[i].start).toBeCloseTo(expected[i][0], 6);
      expect(zones[i].end).toBeCloseTo(expected[i][1], 6);
      expect(zones[i].end - zones[i].start).toBeCloseTo(300, 6);
    }
  });

  it('EDGE7: run length of 299 m is dropped (350 m square yields no zones)', () => {
    expect(deriveAeroZones(square(350))).toEqual([]);
  });

  it('EDGE8: a straight run wrapping arc 0 yields start < L and end > L', () => {
    const L = 4 * 351;
    const zones = deriveAeroZones(square(351, 175));
    expect(zones).toHaveLength(4);
    const wrapped = zones.filter((z) => z.end > L);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].start).toBeCloseTo(L - 150, 6);
    expect(wrapped[0].end).toBeCloseTo(L + 150, 6);
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i].start).toBeGreaterThanOrEqual(zones[i - 1].start);
    }
    expect(inAeroZone(zones, 10, L)).toBe(true);
    expect(inAeroZone(zones, L - 4, L)).toBe(true);
    expect(inAeroZone(zones, 160, L)).toBe(false);
  });
});
