import { describe, it, expect } from 'vitest';
import { EngineSynth, type EngineSynthParams } from '../../../src/audio/engineSynth';

const SR = 48000;

function params(overrides: Partial<EngineSynthParams> = {}): EngineSynthParams {
  return { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, sampleRate: SR, ...overrides };
}

function renderBlocks(
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

function strongestPeakLag(x: Float32Array, minLag: number, maxLag: number): number {
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const n = x.length - lag;
    let sum = 0;
    let e0 = 0;
    let e1 = 0;
    for (let i = 0; i < n; i++) {
      const a = x[i];
      const b = x[i + lag];
      sum += a * b;
      e0 += a * a;
      e1 += b * b;
    }
    const r = sum / Math.sqrt(e0 * e1);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return bestLag;
}

function rms(x: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < x.length; i++) acc += x[i] * x[i];
  return Math.sqrt(acc / x.length);
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('108 engine synth acceptance', () => {
  it('AT1: 4 cyl 6000 rpm — autocorrelation peak at 1/200 s ± 2 %', () => {
    const synth = new EngineSynth(params(), 1);
    const x = renderBlocks(synth, 6000, 1, SR);
    const minLag = Math.round(SR / 1000);
    const maxLag = Math.round(SR / 50);
    const lag = strongestPeakLag(x, minLag, maxLag);
    expect(Math.abs(lag / SR - 1 / 200)).toBeLessThanOrEqual((1 / 200) * 0.02);
  });

  it('AT2: 8 cyl 6000 rpm — autocorrelation peak at 1/400 s ± 2 %', () => {
    const synth = new EngineSynth(params({ cylinders: 8 }), 1);
    const x = renderBlocks(synth, 6000, 1, SR);
    const minLag = Math.round(SR / 1000);
    const maxLag = Math.round(SR / 50);
    const lag = strongestPeakLag(x, minLag, maxLag);
    expect(Math.abs(lag / SR - 1 / 400)).toBeLessThanOrEqual((1 / 400) * 0.02);
  });

  it('AT3: 4 cyl 4000 rpm — RMS at throttle 1 is at least 2x throttle 0', () => {
    const loud = rms(renderBlocks(new EngineSynth(params(), 2), 4000, 1, SR));
    const quiet = rms(renderBlocks(new EngineSynth(params(), 2), 4000, 0, SR));
    expect(loud / quiet).toBeGreaterThanOrEqual(2);
  });

  it('AT4: 2000 seeded random blocks — every sample finite and |x| <= 1', () => {
    const rand = mulberry32(0xc0ffee);
    const synth = new EngineSynth(params(), 3);
    let violations = 0;
    for (let b = 0; b < 2000; b++) {
      const rpm = rand() * 9000;
      const throttle = rand();
      const len = 1 + Math.floor(rand() * 256);
      const out = new Float32Array(len);
      synth.render(out, rpm, throttle);
      for (let i = 0; i < len; i++) {
        if (!Number.isFinite(out[i]) || Math.abs(out[i]) > 1) violations++;
      }
    }
    expect(violations).toBe(0);
  });

  it('AT5: same params and seed twice — identical 0.5 s output', () => {
    const a = renderBlocks(new EngineSynth(params(), 11), 5000, 0.7, SR / 2);
    const b = renderBlocks(new EngineSynth(params(), 11), 5000, 0.7, SR / 2);
    expect(a).toEqual(b);
  });

  it('AT6: block rpm 3000 then 3010 throttle 0.5 — boundary step <= 0.2', () => {
    const synth = new EngineSynth(params(), 5);
    const b1 = new Float32Array(128);
    const b2 = new Float32Array(128);
    synth.render(b1, 3000, 0.5);
    synth.render(b2, 3010, 0.5);
    expect(Math.abs(b2[0] - b1[127])).toBeLessThanOrEqual(0.2);
  });

  it('AT7: 4 cyl renders 1 s at 48 kHz in under 50 ms', () => {
    const synth = new EngineSynth(params(), 4);
    const buf = new Float32Array(128);
    const t0 = performance.now();
    for (let i = 0; i < SR; i += 128) synth.render(buf, 6000, 1);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});
