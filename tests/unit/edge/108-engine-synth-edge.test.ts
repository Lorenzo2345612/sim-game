import { describe, it, expect } from 'vitest';
import { EngineSynth, firingHz, type EngineSynthParams } from '../../../src/audio/engineSynth';

const SR = 48000;

function params(overrides: Partial<EngineSynthParams> = {}): EngineSynthParams {
  return { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, sampleRate: SR, ...overrides };
}

function renderAll(
  synth: EngineSynth,
  rpm: number,
  throttle: number,
  samples: number,
  block = 128,
): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += block) {
    const n = Math.min(block, samples - i);
    const buf = new Float32Array(n);
    synth.render(buf, rpm, throttle);
    out.set(buf, i);
  }
  return out;
}

function violations(x: Float32Array): number {
  let bad = 0;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || Math.abs(x[i]) > 1) bad++;
  }
  return bad;
}

function rms(x: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < x.length; i++) acc += x[i] * x[i];
  return Math.sqrt(acc / x.length);
}

describe('108 engine synth edge cases', () => {
  it('EDGE1: firingHz follows the four-stroke formula rpm/60 · cylinders/2', () => {
    expect(firingHz(6000, 4)).toBeCloseTo(200, 6);
    expect(firingHz(6000, 8)).toBeCloseTo(400, 6);
    expect(firingHz(7500, 2)).toBeCloseTo(125, 6);
    expect(firingHz(4000, 6)).toBeCloseTo(200, 6);
    expect(firingHz(0, 4)).toBeCloseTo(0, 6);
  });

  it('EDGE2: constructor throws for cylinders outside 1..12 or non-integer, and sampleRate <= 0', () => {
    for (const cylinders of [0, 13, -1, 3.5, 12.5]) {
      expect(() => new EngineSynth(params({ cylinders }), 1)).toThrow();
    }
    for (const sampleRate of [0, -1, -48000]) {
      expect(() => new EngineSynth(params({ sampleRate }), 1)).toThrow();
    }
    expect(() => new EngineSynth(params({ cylinders: 1 }), 1)).not.toThrow();
    expect(() => new EngineSynth(params({ cylinders: 12 }), 1)).not.toThrow();
    expect(() => new EngineSynth(params({ sampleRate: 1 }), 1)).not.toThrow();
  });

  it('EDGE3: negative and non-finite rpm/throttle are treated as 0', () => {
    const zeroRpm = renderAll(new EngineSynth(params(), 7), 0, 0.5, 1024);
    expect(renderAll(new EngineSynth(params(), 7), -5000, 0.5, 1024)).toEqual(zeroRpm);
    const nanRpm = renderAll(new EngineSynth(params(), 7), NaN, 0.5, 1024);
    expect(nanRpm).toEqual(zeroRpm);
    const zeroThr = renderAll(new EngineSynth(params(), 7), 3000, 0, 1024);
    const nanThr = renderAll(new EngineSynth(params(), 7), 3000, NaN, 1024);
    expect(nanThr).toEqual(zeroThr);
    expect(violations(nanRpm) + violations(nanThr)).toBe(0);
  });

  it('EDGE4: throttle is clamped to [0, 1]', () => {
    expect(renderAll(new EngineSynth(params(), 8), 3000, 5, 1024)).toEqual(
      renderAll(new EngineSynth(params(), 8), 3000, 1, 1024),
    );
    expect(renderAll(new EngineSynth(params(), 8), 3000, -2, 1024)).toEqual(
      renderAll(new EngineSynth(params(), 8), 3000, 0, 1024),
    );
  });

  it('EDGE5: blocks of length 1 match a single full block at constant rpm/throttle', () => {
    const singles = new Float32Array(480);
    const a = new EngineSynth(params(), 9);
    for (let i = 0; i < singles.length; i++) {
      const one = new Float32Array(1);
      a.render(one, 4000, 0.8);
      singles[i] = one[0];
    }
    const whole = new Float32Array(480);
    new EngineSynth(params(), 9).render(whole, 4000, 0.8);
    expect(violations(singles)).toBe(0);
    expect(singles).toEqual(whole);
  });

  it('EDGE6: different seeds give different output', () => {
    const a = renderAll(new EngineSynth(params(), 1), 5000, 0.8, 2048);
    const b = renderAll(new EngineSynth(params(), 2), 5000, 0.8, 2048);
    expect(a).not.toEqual(b);
  });

  it('EDGE7: out is overwritten, not mixed — a NaN-prefilled buffer comes out clean', () => {
    const out = new Float32Array(1024).fill(NaN);
    new EngineSynth(params(), 6).render(out, 4500, 0.7);
    expect(violations(out)).toBe(0);
  });

  it('EDGE8: first block starts at its own rpm — firing begins within the first 10 ms at 6000 rpm', () => {
    const out = new Float32Array(4800);
    new EngineSynth(params(), 10).render(out, 6000, 1);
    let firstLoud = -1;
    for (let i = 0; i < out.length; i++) {
      if (Math.abs(out[i]) > 0.45) {
        firstLoud = i;
        break;
      }
    }
    expect(firstLoud).toBeGreaterThanOrEqual(0);
    expect(firstLoud).toBeLessThanOrEqual(480);
  });

  it('EDGE9: intake level scales linearly with intakeMix', () => {
    const loud = renderAll(new EngineSynth(params({ intakeMix: 0.6 }), 12), 0, 1, 9600);
    const quiet = renderAll(new EngineSynth(params({ intakeMix: 0.3 }), 12), 0, 1, 9600);
    const ratio = rms(loud) / rms(quiet);
    expect(ratio).toBeGreaterThanOrEqual(1.85);
    expect(ratio).toBeLessThanOrEqual(2.15);
  });

  it('EDGE10: rpm 0 and throttle 0 render silence', () => {
    for (const rpm of [0, -8000]) {
      const out = renderAll(new EngineSynth(params(), 13), rpm, 0, 2400);
      let loud = 0;
      for (let i = 0; i < out.length; i++) {
        if (Math.abs(out[i]) > 1e-6) loud++;
      }
      expect(loud).toBe(0);
    }
  });
});
