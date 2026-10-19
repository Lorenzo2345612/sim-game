import { describe, expect, it } from 'vitest';
import { DynamicResolution, autoPreset } from '../../src/render/dynamicResolution';

function run(dr: DynamicResolution, ms: number, frames: number): void {
  for (let i = 0; i < frames; i++) dr.update(ms);
}

describe('DynamicResolution hysteresis', () => {
  it('stays put at steady 60 Hz', () => {
    const dr = new DynamicResolution({ initial: 1, max: 1 });
    run(dr, 1000 / 60, 60 * 20);
    expect(dr.ratio).toBe(1);
  });

  it('does not drop after a single slow window', () => {
    const dr = new DynamicResolution({ initial: 1, max: 1 });
    run(dr, 1000 / 60, 60);
    run(dr, 30, 60);
    expect(dr.ratio).toBe(1);
  });

  it('drops after two slow windows, rate limited, down to the floor', () => {
    const dr = new DynamicResolution({ initial: 1, max: 1 });
    run(dr, 1000 / 60, 60);
    run(dr, 30, 120);
    expect(dr.ratio).toBeCloseTo(0.9, 6);
    run(dr, 30, 60 * 40);
    expect(dr.ratio).toBeCloseTo(0.75, 6);
  });

  it('limits changes to one per 2 s', () => {
    const dr = new DynamicResolution({ initial: 1, max: 1 });
    run(dr, 1000 / 60, 60);
    run(dr, 50, 120); // 6 s, windows are 3 s each
    expect(dr.ratio).toBeCloseTo(0.9, 6);
    run(dr, 50, 40); // 2 s, no full window yet
    expect(dr.ratio).toBeCloseTo(0.9, 6);
    run(dr, 50, 20);
    expect(dr.ratio).toBeCloseTo(0.9, 6); // streak reset after change, needs 2 more windows
    run(dr, 50, 60);
    expect(dr.ratio).toBeCloseTo(0.8, 6);
  });

  it('recovers one step after three fast windows', () => {
    const dr = new DynamicResolution({ initial: 1, max: 1 });
    run(dr, 1000 / 60, 60);
    run(dr, 30, 120);
    expect(dr.ratio).toBeCloseTo(0.9, 6);
    run(dr, 1000 / 60, 120);
    expect(dr.ratio).toBeCloseTo(0.9, 6);
    run(dr, 1000 / 60, 60);
    expect(dr.ratio).toBeCloseTo(1, 6);
    run(dr, 1000 / 60, 60 * 10);
    expect(dr.ratio).toBe(1);
  });

  it('does not treat a 120 Hz display as slow', () => {
    const dr = new DynamicResolution({ initial: 1, max: 1 });
    run(dr, 1000 / 120, 60 * 10);
    expect(dr.ratio).toBe(1);
    expect(dr.displayPeriodMs).toBeCloseTo(1000 / 120, 3);
  });
});

describe('autoPreset', () => {
  const mk = (ms: number, n = 300): number[] => Array.from({ length: n }, () => ms);
  it('keeps the preset when the median is under 22 ms', () => {
    expect(autoPreset(mk(20), 'high')).toBe('high');
  });
  it('drops a single level when slow', () => {
    expect(autoPreset(mk(30), 'high')).toBe('medium');
    expect(autoPreset(mk(30), 'medium')).toBe('low');
  });
  it('ignores frames over 100 ms', () => {
    const s = mk(10, 200).concat(mk(500, 150));
    expect(autoPreset(s, 'high')).toBe('high');
  });
});
