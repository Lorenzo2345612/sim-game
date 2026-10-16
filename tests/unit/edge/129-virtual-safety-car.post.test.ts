import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Vsc } from '../../../src/race/vsc';

const L = 1000;

function constantVsc(profileMs: number, carCount = 1, n = 10): Vsc {
  const speeds = new Float64Array(n).fill(profileMs);
  const dist = new Float64Array(n);
  for (let i = 0; i < n; i++) dist[i] = (i * L) / n;
  return new Vsc(speeds, dist, L, carCount);
}

function speedUntilEvent(vsc: Vsc): void {
  vsc.delta(0, 0, 0);
  vsc.delta(0, 35, 1);
  vsc.delta(0, 70, 2);
  vsc.delta(0, 105, 3);
  vsc.delta(0, 140, 4);
}

describe('129 virtual safety car post gaps', () => {
  it('POST1: negative stopped seconds neither clears deployed nor redeploys from ending', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    expect(vsc.phase).toBe('deployed');
    vsc.update(-1, 5);
    expect(vsc.phase).toBe('deployed');
    vsc.update(0, 6);
    expect(vsc.phase).toBe('ending');
    vsc.update(-2, 7);
    expect(vsc.phase).toBe('ending');
    vsc.update(0, 11);
    expect(vsc.phase).toBe('off');
  });

  it('POST2: cars track delta and penalty independently; one event per car', () => {
    const vsc = constantVsc(50, 2);
    vsc.update(10, 0);
    vsc.delta(0, 0, 0);
    vsc.delta(1, 0, 2);
    vsc.delta(0, 35, 1);
    vsc.delta(1, 30, 3);
    vsc.delta(0, 70, 2);
    vsc.delta(1, 60, 4);
    vsc.delta(0, 105, 3);
    vsc.delta(1, 90, 5);
    vsc.delta(0, 140, 4);
    const car1 = vsc.delta(1, 120, 6);
    expect(car1).toBeCloseTo(0, 12);
    expect(vsc.drainEvents()).toEqual([{ car: 0, seconds: 5 }]);
    vsc.delta(1, 160, 7);
    vsc.delta(1, 200, 8);
    vsc.delta(1, 240, 9);
    expect(vsc.drainEvents()).toEqual([{ car: 1, seconds: 5 }]);
    expect(vsc.drainEvents()).toHaveLength(0);
  });

  it('POST3: backward movement counts zero reference time, including across the seam', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    expect(vsc.delta(0, 100, 0)).toBeCloseTo(0, 12);
    expect(vsc.delta(0, 40, 1)).toBeCloseTo(1, 12);
    expect(vsc.delta(0, 70, 2)).toBeCloseTo(1, 12);
    expect(vsc.delta(0, 1010, 3)).toBeCloseTo(2, 12);
    expect(vsc.delta(0, 40, 4)).toBeCloseTo(2, 12);
    expect(vsc.drainEvents()).toHaveLength(0);
  });

  it('POST4: lapDistance outside [0, lapLength) matches the wrapped equivalent', () => {
    const speeds = Float64Array.from([20, 40]);
    const dist = Float64Array.from([0, 500]);
    const a = new Vsc(speeds, dist, L, 1);
    const b = new Vsc(speeds, dist, L, 1);
    const c = new Vsc(speeds, dist, L, 1);
    a.update(10, 0);
    b.update(10, 0);
    c.update(10, 0);
    a.delta(0, 100, 0);
    b.delta(0, 1100, 0);
    c.delta(0, -900, 0);
    const da = a.delta(0, 200, 1);
    const db = b.delta(0, 1200, 1);
    const dc = c.delta(0, -800, 1);
    expect(da).toBeCloseTo(1 - 100 / (0.6 * 28), 12);
    expect(da).toBeCloseTo(db, 12);
    expect(da).toBeCloseTo(dc, 12);
  });

  it('POST5: ignored non-finite calls do not advance prevDist or prevTime', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    vsc.delta(0, 0, 0);
    vsc.delta(0, 35, 1);
    expect(vsc.delta(0, 70, Number.NaN)).toBeCloseTo(-1 / 6, 12);
    expect(vsc.delta(0, Number.NaN, 50)).toBeCloseTo(-1 / 6, 12);
    expect(vsc.delta(0, 70, 2)).toBeCloseTo(2 - 70 / 30, 12);
    expect(vsc.drainEvents()).toHaveLength(0);
    expect(vsc.delta(0, 105, 3)).toBeCloseTo(3 - 105 / 30, 12);
    expect(vsc.drainEvents()).toEqual([{ car: 0, seconds: 5 }]);
  });

  it('POST6: too-fast time accumulates across a non-negative delta call', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    vsc.delta(0, 0, 0);
    vsc.delta(0, 45, 1);
    vsc.delta(0, 90, 2);
    expect(vsc.drainEvents()).toHaveLength(0);
    vsc.delta(0, 150, 5);
    expect(vsc.drainEvents()).toHaveLength(0);
    vsc.delta(0, 195, 6);
    expect(vsc.drainEvents()).toEqual([{ car: 0, seconds: 5 }]);
  });

  it('POST7: redeploy from ending keeps car state, so no second event in the same deployment', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    speedUntilEvent(vsc);
    expect(vsc.drainEvents()).toHaveLength(1);
    vsc.update(0, 4.5);
    vsc.update(1, 4.6);
    expect(vsc.phase).toBe('deployed');
    vsc.delta(0, 175, 5);
    vsc.delta(0, 210, 6);
    vsc.delta(0, 245, 7);
    vsc.delta(0, 280, 8);
    expect(vsc.drainEvents()).toHaveLength(0);
  });

  it('POST8: a pending event is still drainable once after the phase goes off', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    speedUntilEvent(vsc);
    vsc.update(0, 5);
    vsc.update(0, 10.1);
    expect(vsc.phase).toBe('off');
    expect(vsc.drainEvents()).toEqual([{ car: 0, seconds: 5 }]);
    expect(vsc.drainEvents()).toHaveLength(0);
  });

  it('POST9: one long too-fast interval fires the event; a large update gap ends the deployment', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    vsc.delta(0, 0, 0);
    expect(vsc.delta(0, 450, 12)).toBeCloseTo(12 - 450 / 30, 12);
    expect(vsc.drainEvents()).toEqual([{ car: 0, seconds: 5 }]);
    vsc.update(0, 13);
    expect(vsc.phase).toBe('ending');
    vsc.update(0, 1e6);
    expect(vsc.phase).toBe('off');
  });

  it('POST10: non-integer car index and zero car count throw RangeError', () => {
    const vsc = constantVsc(50, 1);
    expect(() => vsc.delta(0.5, 0, 0)).toThrow(RangeError);
    expect(() => vsc.delta(Number.NaN, 0, 0)).toThrow(RangeError);
    const noCars = constantVsc(50, 0);
    expect(() => noCars.delta(0, 0, 0)).toThrow(RangeError);
  });

  it('POST11: vsc.ts has no runtime imports, no three/rapier, no Math.random', () => {
    const src = readFileSync(new URL('../../../src/race/vsc.ts', import.meta.url), 'utf8');
    expect(src.match(/^\s*import\s+(?!type\b).*$/gm) ?? []).toEqual([]);
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/three|rapier/i);
  });
});
