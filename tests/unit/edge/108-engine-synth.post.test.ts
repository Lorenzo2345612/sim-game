import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EngineSynth, firingHz, type EngineSynthParams } from '../../../src/audio/engineSynth';

const SR = 48000;
const ROOT = join(__dirname, '..', '..', '..');

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

describe('108 engine synth post gaps', () => {
  it('P1: source has no imports and never calls Math.random', () => {
    const src = readFileSync(join(ROOT, 'src', 'audio', 'engineSynth.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/from\s+['"]/);
    expect(src).not.toContain('Math.random');
  });

  it('P2: firingHz clamps negative rpm to 0', () => {
    expect(firingHz(-6000, 4)).toBe(0);
    expect(firingHz(-1, 12)).toBe(0);
  });

  it('P3: constructor throws for non-finite cylinders or sampleRate', () => {
    for (const cylinders of [NaN, Infinity, -Infinity]) {
      expect(() => new EngineSynth(params({ cylinders }), 1)).toThrow();
    }
    for (const sampleRate of [NaN, Infinity, -Infinity]) {
      expect(() => new EngineSynth(params({ sampleRate }), 1)).toThrow();
    }
  });

  it('P4: exhaust length 0, negative, NaN and Infinity share the min comb delay', () => {
    const ref = renderAll(new EngineSynth(params({ exhaustLengthM: 0 }), 21), 4000, 0.8, 2048);
    expect(violations(ref)).toBe(0);
    expect(renderAll(new EngineSynth(params({ exhaustLengthM: -5 }), 21), 4000, 0.8, 2048)).toEqual(
      ref,
    );
    expect(renderAll(new EngineSynth(params({ exhaustLengthM: NaN }), 21), 4000, 0.8, 2048)).toEqual(
      ref,
    );
    expect(
      renderAll(new EngineSynth(params({ exhaustLengthM: Infinity }), 21), 4000, 0.8, 2048),
    ).toEqual(ref);
    expect(renderAll(new EngineSynth(params(), 21), 4000, 0.8, 2048)).not.toEqual(ref);
  });

  it('P5: Infinity rpm and throttle are treated as 0 (non-finite)', () => {
    expect(renderAll(new EngineSynth(params(), 31), Infinity, 0.5, 1024)).toEqual(
      renderAll(new EngineSynth(params(), 31), 0, 0.5, 1024),
    );
    expect(renderAll(new EngineSynth(params(), 31), 3000, Infinity, 1024)).toEqual(
      renderAll(new EngineSynth(params(), 31), 3000, 0, 1024),
    );
    expect(renderAll(new EngineSynth(params(), 31), 3000, -Infinity, 1024)).toEqual(
      renderAll(new EngineSynth(params(), 31), 3000, 0, 1024),
    );
  });

  it('P6: extreme finite rpm stays finite and bounded', () => {
    for (const rpm of [1e12, Number.MAX_VALUE]) {
      const out = renderAll(new EngineSynth(params(), 41), rpm, 1, 512);
      expect(violations(out)).toBe(0);
    }
  });

  it('P7: single 10 s block stays finite and bounded', () => {
    const out = new Float32Array(10 * SR);
    new EngineSynth(params(), 51).render(out, 7000, 0.9);
    expect(violations(out)).toBe(0);
  });

  it('P8: unequal block sizes match a single whole block at constant input', () => {
    const sizes = [3, 50, 128, 7, 1000];
    const split = new Float32Array(48000);
    const a = new EngineSynth(params(), 61);
    let off = 0;
    let k = 0;
    while (off < split.length) {
      const n = Math.min(sizes[k % sizes.length], split.length - off);
      const buf = new Float32Array(n);
      a.render(buf, 4200, 0.6);
      split.set(buf, off);
      off += n;
      k++;
    }
    const whole = new Float32Array(48000);
    new EngineSynth(params(), 61).render(whole, 4200, 0.6);
    expect(split).toEqual(whole);
  });

  it('P9: throttle ramps across a block instead of stepping', () => {
    const synth = new EngineSynth(params(), 71);
    const b1 = new Float32Array(128);
    const b2 = new Float32Array(128);
    synth.render(b1, 0, 0);
    synth.render(b2, 0, 1);
    expect(Math.abs(b2[0])).toBeLessThanOrEqual(0.05);
    expect(rms(b2.slice(64))).toBeGreaterThan(rms(b2.slice(0, 64)) * 1.5);
  });

  it('P10: large rpm jumps at a block boundary stay continuous', () => {
    for (const [from, to] of [
      [6000, 9000],
      [9000, 1000],
    ] as const) {
      const synth = new EngineSynth(params(), 81);
      const b1 = new Float32Array(128);
      const b2 = new Float32Array(128);
      synth.render(b1, from, 1);
      synth.render(b2, to, 1);
      expect(Math.abs(b2[0] - b1[127])).toBeLessThanOrEqual(0.2);
    }
  });

  it('P11: throttle jump at a block boundary stays continuous', () => {
    const synth = new EngineSynth(params(), 91);
    const b1 = new Float32Array(128);
    const b2 = new Float32Array(128);
    synth.render(b1, 4000, 0);
    synth.render(b2, 4000, 1);
    expect(Math.abs(b2[0] - b1[127])).toBeLessThanOrEqual(0.2);
  });

  it('P12: non-finite rpm mid-stream ramps to 0 without NaN', () => {
    const synth = new EngineSynth(params(), 101);
    const b1 = new Float32Array(128);
    const b2 = new Float32Array(128);
    synth.render(b1, 5000, 1);
    synth.render(b2, NaN, 1);
    expect(violations(b2)).toBe(0);
    expect(Math.abs(b2[0] - b1[127])).toBeLessThanOrEqual(0.2);
  });

  it('P13: 1 cylinder fires at rpm/120 — peak at 1/80 s for 9600 rpm', () => {
    const x = renderAll(new EngineSynth(params({ cylinders: 1 }), 111), 9600, 1, SR);
    const lag = strongestPeakLag(x, Math.round(SR / 1000), Math.round(SR / 50));
    expect(Math.abs(lag / SR - 1 / 80)).toBeLessThanOrEqual((1 / 80) * 0.02);
  });

  it('P14: 12 cylinders fires at rpm/60·6 — peak at 1/300 s for 3000 rpm', () => {
    const x = renderAll(new EngineSynth(params({ cylinders: 12 }), 121), 3000, 1, SR);
    const lag = strongestPeakLag(x, Math.round(SR / 1000), Math.round(SR / 50));
    expect(Math.abs(lag / SR - 1 / 300)).toBeLessThanOrEqual((1 / 300) * 0.02);
  });

  it('P15: intakeMix 0 with no firing renders exact zeros', () => {
    const out = renderAll(new EngineSynth(params({ intakeMix: 0 }), 131), 0, 1, 2400);
    expect([...out].every((v) => v === 0)).toBe(true);
  });

  it('P16: seed is coerced to uint32', () => {
    expect(renderAll(new EngineSynth(params(), 2 ** 32 + 5), 5000, 0.8, 1024)).toEqual(
      renderAll(new EngineSynth(params(), 5), 5000, 0.8, 1024),
    );
    expect(renderAll(new EngineSynth(params(), -1), 5000, 0.8, 1024)).toEqual(
      renderAll(new EngineSynth(params(), 2 ** 32 - 1), 5000, 0.8, 1024),
    );
  });
});
