import { describe, it, expect } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { StartSequence, isJumpStart } from '../../../src/race/startSequence';
import { gridSlots } from '../../../src/race/grid';
import { fixture } from './022-fixture-trackdatav2';

const DT = 1 / 120;
const TOL = 1 / 120;
const POS_TOL = 1e-6;

/** Closed 200 x 100 m rectangle, 2 m spacing, index 0 at (0,0) mid long side driving towards -Z. */
function rectangleTrack(): TrackDataV2 {
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
    lengthMeters: 600,
    elevation: Array.from({ length: cl.length }, () => 0),
  };
}

describe('091 start sequence and grid acceptance', () => {
  it('AT1: rng 0.5 — lights 0 until 2 s, 1 at 2 s, 5 at 6 s, go at 7.6 ± 1/120, lights 0 after', () => {
    const seq = new StartSequence(() => 0.5);
    expect(seq.phase).toBe('grid');
    expect(seq.lights).toBe(0);
    expect(seq.goTime).toBeNull();

    let t = 0;
    while (t < 2 - DT * 1.5) {
      seq.update(DT);
      t += DT;
      expect(seq.lights, `lights at t=${t}`).toBe(0);
      expect(seq.phase, `phase at t=${t}`).toBe('grid');
    }

    seq.update(DT);
    t += DT;
    expect(Math.abs(t - 2)).toBeLessThanOrEqual(1e-9);
    expect(seq.phase).toBe('lights');
    expect(seq.lights).toBe(1);
    expect(seq.goTime).toBeNull();

    while (t < 6 - DT * 1.5) {
      seq.update(DT);
      t += DT;
      expect(seq.lights, `lights at t=${t}`).toBeLessThan(5);
      expect(seq.phase, `phase at t=${t}`).not.toBe('go');
      expect(seq.goTime).toBeNull();
    }

    seq.update(DT);
    t += DT;
    expect(Math.abs(t - 6)).toBeLessThanOrEqual(1e-9);
    expect(seq.phase).toBe('hold');
    expect(seq.lights).toBe(5);

    while (seq.phase !== 'go') {
      seq.update(DT);
      t += DT;
      expect(seq.goTime).toBeNull();
    }
    expect(seq.goTime).not.toBeNull();
    expect(Math.abs(seq.goTime as number - 7.6)).toBeLessThanOrEqual(TOL);
    expect(seq.phase).toBe('go');
    expect(seq.lights).toBe(0);

    const goTime = seq.goTime as number;
    for (let i = 0; i < 10; i++) seq.update(DT);
    expect(seq.lights).toBe(0);
    expect(seq.phase).toBe('go');
    expect(seq.goTime).toBe(goTime);
  });

  it('AT2: rng 0 goes at 6.2 s; rng 0.999999 goes at ≈ 9.0 s (± 1/120)', () => {
    const cases: { rng: () => number; expected: number }[] = [
      { rng: () => 0, expected: 6.2 },
      { rng: () => 0.999999, expected: 9.0 },
    ];
    for (const c of cases) {
      const seq = new StartSequence(c.rng);
      while (seq.phase !== 'go') seq.update(DT);
      expect(seq.goTime).not.toBeNull();
      expect(Math.abs(seq.goTime as number - c.expected)).toBeLessThanOrEqual(TOL);
      expect(seq.lights).toBe(0);
    }
  });

  it('AT3: rectangle grid — slots at 6/14/22 m behind index 0, x +3/-3/+3, yaw facing -Z', () => {
    const slots = gridSlots(rectangleTrack(), 3);
    expect(slots.length).toBe(3);
    const xs = [3, -3, 3];
    const zs = [6, 14, 22];
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(slots[k].position.x - xs[k]), `slot ${k} x`).toBeLessThanOrEqual(POS_TOL);
      expect(Math.abs(slots[k].position.z - zs[k]), `slot ${k} z`).toBeLessThanOrEqual(POS_TOL);
      expect(Math.abs(slots[k].yaw), `slot ${k} yaw`).toBeLessThanOrEqual(POS_TOL);
    }
  });

  it('AT4: jump start only when moved more than 0.5 m before go', () => {
    expect(isJumpStart(0.6, 'hold')).toBe(true);
    expect(isJumpStart(0.6, 'go')).toBe(false);
    expect(isJumpStart(0.4, 'lights')).toBe(false);
  });
});
