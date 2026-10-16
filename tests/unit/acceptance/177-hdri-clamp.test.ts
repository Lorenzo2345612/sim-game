import { describe, expect, it } from 'vitest';
import * as environment from '../../../src/render/environment';

type ClampHdrData = (data: Float32Array, max: number) => number;

// Spec-177 signatures; typed locally so this test-first file compiles before the exports exist.
const clampHdrData = (environment as unknown as { clampHdrData: ClampHdrData }).clampHdrData;
const HDR_MAX = (environment as unknown as { HDR_MAX: number }).HDR_MAX;

describe('177 hdri half-float clamp acceptance', () => {
  it('AT1: clampHdrData clamps RGB above max and non-finite values to max, never touching alpha', () => {
    const data = new Float32Array([1, 70000, Infinity, 99999, NaN, 0.5, 2, 1]);
    const changed = clampHdrData(data, 60000);
    expect(Array.from(data)).toEqual([1, 60000, 60000, 99999, 60000, 0.5, 2, 1]);
    expect(changed).toBe(3);
  });

  it('AT2: clampHdrData leaves data with all values ≤ max unchanged and returns 0', () => {
    const data = new Float32Array([1, 2, 3, 1, 60000, 0.25, 400, 1]);
    const before = Array.from(data);
    const changed = clampHdrData(data, 60000);
    expect(Array.from(data)).toEqual(before);
    expect(changed).toBe(0);
  });

  it('AT3: HDR_MAX equals 60000 and is below the half-float max 65504', () => {
    expect(HDR_MAX).toBe(60000);
    expect(HDR_MAX).toBeLessThan(65504);
  });
});
