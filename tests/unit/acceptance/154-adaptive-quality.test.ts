import { describe, expect, it } from 'vitest';
import { DynamicResolution, autoPreset } from '../../../src/render/dynamicResolution';

function feed(dr: DynamicResolution, frames: number, ms: number): number {
  let last = dr.ratio;
  for (let i = 0; i < frames; i += 1) last = dr.update(ms);
  return last;
}

describe('154 adaptive quality acceptance', () => {
  it('AT1: 120 frames at 25 ms from ratio 1.0 yields ratio 0.8', () => {
    const dr = new DynamicResolution({ initial: 1.0, max: 1.0 });
    const ratio = feed(dr, 120, 25);
    expect(ratio).toBeCloseTo(0.8, 9);
  });

  it('AT2: 600 frames at 10 ms from 0.6 with max 1.0 yields ratio 1.0', () => {
    const dr = new DynamicResolution({ initial: 0.6, max: 1.0 });
    const ratio = feed(dr, 600, 10);
    expect(ratio).toBe(1.0);
  });

  it('AT3: autoPreset of 300 samples at 30/20/12 ms yields low / medium / high', () => {
    const slow = Array.from({ length: 300 }, () => 30);
    const medium = Array.from({ length: 300 }, () => 20);
    const fast = Array.from({ length: 300 }, () => 12);
    expect(autoPreset(slow)).toBe('low');
    expect(autoPreset(medium)).toBe('medium');
    expect(autoPreset(fast)).toBe('high');
  });
});
