import { describe, it, expect } from 'vitest';
import { Vsc } from '../../../src/race/vsc';

const L = 1000;
const N = 10;
const PROFILE_MS = 50;

function newVsc(): Vsc {
  const speeds = new Float64Array(N).fill(PROFILE_MS);
  const dist = new Float64Array(N);
  for (let i = 0; i < N; i++) dist[i] = (i * L) / N;
  return new Vsc(speeds, dist, L, 1);
}

function drive(vsc: Vsc, speed: number, seconds: number): number {
  let d = 0;
  let last = vsc.delta(0, d, 0);
  const steps = Math.round(seconds * 120);
  for (let k = 1; k <= steps; k++) {
    d += speed / 120;
    last = vsc.delta(0, d, k / 120);
  }
  return last;
}

describe('129 virtual safety car acceptance', () => {
  it('AT1: stopped 9.9 s — off; 10.0 s — deployed', () => {
    const vsc = newVsc();
    vsc.update(9.9, 0);
    expect(vsc.phase).toBe('off');
    vsc.update(10, 1);
    expect(vsc.phase).toBe('deployed');
  });

  it('AT2: at 30 m/s for 10 s after deploy — delta 0 ± 1e-6', () => {
    const vsc = newVsc();
    vsc.update(10, 0);
    const d = drive(vsc, 30, 10);
    expect(Math.abs(d)).toBeLessThanOrEqual(1e-6);
  });

  it('AT3: at 35 m/s for 10 s — delta < 0 and one +5 s event', () => {
    const vsc = newVsc();
    vsc.update(10, 0);
    const d = drive(vsc, 35, 10);
    expect(d).toBeLessThan(0);
    const events = vsc.drainEvents();
    expect(events).toHaveLength(1);
    expect(events[0].car).toBe(0);
    expect(events[0].seconds).toBe(5);
    expect(vsc.drainEvents()).toHaveLength(0);
  });

  it('AT4: cause clears at t — ending at t + 4.9; off at t + 5.1', () => {
    const vsc = newVsc();
    vsc.update(10, 0);
    vsc.update(0, 10);
    vsc.update(0, 14.9);
    expect(vsc.phase).toBe('ending');
    vsc.update(0, 15.1);
    expect(vsc.phase).toBe('off');
  });
});
