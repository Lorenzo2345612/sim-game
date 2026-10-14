import { describe, expect, it } from 'vitest';
import * as environment from '../../../src/render/environment';

type HorizonColor = (data: Float32Array, width: number, height: number) => [number, number, number];

// Spec-099 signature; typed locally so this test-first file compiles before the export exists.
const horizonColor = (environment as unknown as { horizonColor: HorizonColor }).horizonColor;

describe('099 hdri sky acceptance', () => {
  it('AT3: horizonColor averages the equirect rows within ±5° of the horizon', () => {
    const width = 36;
    const height = 180;
    const data = new Float32Array(width * height * 4);
    for (let r = 0; r < height; r++) {
      const lat = (0.5 - (r + 0.5) / height) * 180;
      if (Math.abs(lat) > 5) continue;
      for (let x = 0; x < width; x++) {
        const i = (r * width + x) * 4;
        data[i] = 0.6;
        data[i + 1] = 0.7;
        data[i + 2] = 0.8;
        data[i + 3] = 1;
      }
    }
    const [r, g, b] = horizonColor(data, width, height);
    expect(r).toBeCloseTo(0.6, 3);
    expect(g).toBeCloseTo(0.7, 3);
    expect(b).toBeCloseTo(0.8, 3);
  });
});
