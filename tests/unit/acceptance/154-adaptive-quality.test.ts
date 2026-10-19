import { describe, expect, it } from 'vitest';
import { DynamicResolution, autoPreset } from '../../../src/render/dynamicResolution';

function feed(dr: DynamicResolution, frames: number, ms: number): number {
  let last = dr.ratio;
  for (let i = 0; i < frames; i += 1) last = dr.update(ms);
  return last;
}

const samples = (n: number, ms: number): number[] => Array.from({ length: n }, () => ms);

describe('154 adaptive quality acceptance', () => {
  it('AT1: 25 ms frames from 1.0 yield 0.9 / 0.8 / 0.75 (floor)', () => {
    const dr = new DynamicResolution({ initial: 1.0, max: 1.0 });
    expect(feed(dr, 120, 25)).toBeCloseTo(0.9, 9);
    expect(feed(dr, 120, 25)).toBeCloseTo(0.8, 9);
    expect(feed(dr, 960, 25)).toBeCloseTo(0.75, 9);
  });

  it('AT2: 600 frames at 16 ms from 0.75 with max 1.0 yield ratio 1.0', () => {
    const dr = new DynamicResolution({ initial: 0.75, max: 1.0 });
    expect(feed(dr, 600, 16)).toBe(1.0);
  });

  it('AT3: 60 Hz frames (16.7 then 19 ms) do not ratchet down from 1.0', () => {
    const dr = new DynamicResolution({ initial: 1.0, max: 1.0 });
    feed(dr, 600, 16.7);
    expect(feed(dr, 600, 19)).toBe(1.0);
  });

  it('AT4: autoPreset steps one level and ignores outliers', () => {
    expect(autoPreset(samples(300, 30))).toBe('medium');
    expect(autoPreset(samples(300, 20))).toBe('high');
    expect(autoPreset(samples(300, 12))).toBe('high');
    expect(autoPreset(samples(300, 30), 'medium')).toBe('low');
    expect(autoPreset(samples(300, 150))).toBe('high');
  });
});
