import { describe, expect, it } from 'vitest';
import { FrameRing } from '../../../src/core/perfStats';

describe('151 performance harness acceptance', () => {
  it('AT1: ring buffer with frame times 1..300 ms has p50 150.5 ± 0.5 and p95 285.5 ± 0.5', () => {
    const ring = new FrameRing();
    for (let i = 1; i <= 300; i++) ring.push(i);
    const { p50, p95 } = ring.percentiles();
    expect(Math.abs(p50 - 150.5)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(p95 - 285.5)).toBeLessThanOrEqual(0.5);
  });
});
