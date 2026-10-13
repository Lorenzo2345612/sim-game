import { describe, it, expect } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { gridSlots } from '../../../src/race/grid';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const POS_TOL = 1e-6;

/** Closed 200 x 100 m rectangle, 2 m point spacing, index 0 at (0, 0) driving towards -Z. */
function rectangleTrack(elevation = 0): TrackDataV2 {
  const cl: [number, number][] = [[0, 0]];
  for (let i = 1; i <= 50; i++) cl.push([0, -2 * i]);
  for (let i = 1; i <= 100; i++) cl.push([2 * i, -100]);
  for (let i = 1; i <= 100; i++) cl.push([200, -100 + 2 * i]);
  for (let i = 1; i <= 100; i++) cl.push([200 - 2 * i, 100]);
  for (let i = 1; i <= 49; i++) cl.push([0, 100 - 2 * i]);
  return {
    ...fixture,
    centerline: cl,
    widthMeters: 12,
    lengthMeters: 800,
    elevation: cl.map(() => elevation),
  };
}

describe('gridSlots', () => {
  it('staggered slots behind index 0: 6 + spacing·k, alternating sides, yaw along travel', () => {
    const slots = gridSlots(rectangleTrack(), 3); // default spacing 8
    expect(slots.length).toBe(3);
    const xs = [3, -3, 3];
    const zs = [6, 14, 22];
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(slots[k].position.x - xs[k]), `slot ${k} x`).toBeLessThanOrEqual(POS_TOL);
      expect(Math.abs(slots[k].position.z - zs[k]), `slot ${k} z`).toBeLessThanOrEqual(POS_TOL);
      expect(Math.abs(slots[k].yaw), `slot ${k} yaw`).toBeLessThanOrEqual(POS_TOL);
    }
  });

  it('explicit spacing scales the longitudinal gap: d = 6 + spacing·k', () => {
    const slots = gridSlots(rectangleTrack(), 3, 2);
    expect(slots.map((s) => Math.round(s.position.z))).toEqual([6, 8, 10]);
    expect(slots.map((s) => Math.round(s.position.x))).toEqual([3, -3, 3]);
  });

  it('y = interpolated elevation + 0.6', () => {
    const slots = gridSlots(rectangleTrack(1.2), 3, 2);
    for (const s of slots) expect(Math.abs(s.position.y - 1.8)).toBeLessThanOrEqual(POS_TOL);
  });

  it('count <= 0 returns no slots', () => {
    expect(gridSlots(rectangleTrack(), 0)).toEqual([]);
    expect(gridSlots(rectangleTrack(), -5)).toEqual([]);
  });

  it('a grid longer than the lap wraps around the centerline', () => {
    // Lap is 800 m (400 points x 2 m); k = 100 → 6 + 8·100 = 806 m → wraps to 6 m.
    const slots = gridSlots(rectangleTrack(), 101);
    expect(slots.length).toBe(101);
    expect(Math.abs(slots[100].position.z - 6)).toBeLessThanOrEqual(POS_TOL);
    expect(Math.abs(slots[100].position.x - 3)).toBeLessThanOrEqual(POS_TOL);
    for (const s of slots) expect(Number.isFinite(s.position.x + s.position.y + s.position.z)).toBe(true);
  });
});
