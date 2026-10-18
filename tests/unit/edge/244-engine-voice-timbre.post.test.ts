import { describe, expect, it } from 'vitest';
import * as voiceNs from '../../../src/audio/engineVoice';
import { EngineVoice, type VoiceControl } from '../../../src/audio/engineVoice';
import { legacySynthSpec, type EngineSynthSpec } from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;

function baseSpec(cylinders = 8): EngineSynthSpec {
  return {
    ...legacySynthSpec({ cylinders, exhaustLengthM: 1, intakeMix: 0, crackle: 0 }),
    intakeMix: 0,
    block: [],
    turbo: null,
    whine: null,
    crackle: 0,
    lowpassHz: 20000,
    jitterDeg: 0,
    jitterAmp: 0,
  };
}

function ctrl(rpm: number, load: number, extra: Partial<VoiceControl> = {}): VoiceControl {
  return { rpm, load, throttle: 1, wheelSpeedMs: 0, limiter: false, ...extra };
}

function renderSeconds(voice: EngineVoice, seconds: number, fs = FS): Float32Array {
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    voice.render(out.subarray(i, i + Math.min(128, n - i)));
  }
  return out;
}

function popCount(voice: EngineVoice): number {
  return (voice as unknown as { popCount: number }).popCount;
}

function finiteCount(x: Float32Array): number {
  let bad = 0;
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) bad++;
  return bad;
}

function peakOf(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

function fftPower(x: Float32Array): Float64Array {
  const n = x.length;
  const size = 1 << Math.ceil(Math.log2(n));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = x[i] * 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < size; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const xr = re[i + k + half];
        const xi = im[i + k + half];
        const vr = xr * cr - xi * ci;
        const vi = xr * ci + xi * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const pow = new Float64Array(size);
  for (let i = 0; i < size; i++) pow[i] = re[i] * re[i] + im[i] * im[i];
  return pow;
}

function peakAndMedian(pow: Float64Array, fHz: number, fs = FS): { peak: number; median: number } {
  const binHz = fs / pow.length;
  const kP0 = Math.max(1, Math.ceil((fHz - 5) / binHz));
  const kP1 = Math.min((pow.length >> 1) - 1, Math.floor((fHz + 5) / binHz));
  let peak = 0;
  for (let k = kP0; k <= kP1; k++) peak += pow[k];
  const side: number[] = [];
  const kLo = Math.max(1, Math.ceil((fHz - 300) / binHz));
  const kHi = Math.min((pow.length >> 1) - 1, Math.floor((fHz + 300) / binHz));
  for (let k = kLo; k <= kHi; k++) {
    if (Math.abs(k * binHz - fHz) <= 10) continue;
    side.push(pow[k]);
  }
  side.sort((a, b) => a - b);
  return { peak, median: side[Math.floor(side.length / 2)] };
}

describe('244 engine voice timbre post-code gaps', () => {
  it('POST1: PULSE_KERNEL is length KERNEL_N + 2 with a zero interpolation guard after KERNEL_N', () => {
    const k = (voiceNs as unknown as { PULSE_KERNEL?: Float64Array }).PULSE_KERNEL;
    expect(k).toBeInstanceOf(Float64Array);
    const table = k as Float64Array;
    expect(table.length).toBe(2050);
    expect(table[2048]).toBeLessThanOrEqual(1e-9);
    expect(table[2049]).toBe(0);
  });

  it('POST2: a second lift mid-window restarts the pop clock', () => {
    for (const seed of [1, 2, 3]) {
      const voice = new EngineVoice({ ...baseSpec(8), crackle: 1 }, FS, seed);
      voice.setControl(ctrl(8000, 1));
      renderSeconds(voice, 0.5);
      voice.setControl(ctrl(8000, 0, { throttle: 0 }));
      renderSeconds(voice, 1.5);
      voice.setControl(ctrl(8000, 1));
      renderSeconds(voice, 0.1);
      voice.setControl(ctrl(8000, 0, { throttle: 0 }));
      const atLift2 = popCount(voice);
      renderSeconds(voice, 0.08);
      expect(popCount(voice) - atLift2, `seed ${seed} right after the new lift`).toBe(0);
      renderSeconds(voice, 0.52);
      const atOldClose = popCount(voice);
      renderSeconds(voice, 1.6);
      expect(popCount(voice) - atOldClose, `seed ${seed} past the old window`).toBeGreaterThanOrEqual(3);
      const atNewClose = popCount(voice);
      renderSeconds(voice, 0.5);
      expect(popCount(voice) - atNewClose, `seed ${seed} past the new window`).toBe(0);
    }
  }, 120000);

  it('POST3: throttle 0.5 arms the pop window, 0.49 does not', () => {
    function popsAfter(armThrottle: number): number {
      const voice = new EngineVoice({ ...baseSpec(8), crackle: 1 }, FS, SEED);
      voice.setControl(ctrl(8000, 1, { throttle: armThrottle }));
      renderSeconds(voice, 0.5);
      voice.setControl(ctrl(8000, 0, { throttle: 0 }));
      const before = popCount(voice);
      renderSeconds(voice, 1.2);
      return popCount(voice) - before;
    }
    expect(popsAfter(0.5)).toBeGreaterThanOrEqual(3);
    expect(popsAfter(0.49)).toBe(0);
  }, 60000);

  it(
    'POST4: the turbo layer bypasses exhaustGain',
    () => {
      const base = {
        ...baseSpec(8),
        lowpassHz: 1500,
        turbo: { centerHz: 6000, spanHz: 0, gain: 0.3, lagS: 0 },
        cylVar: 0,
        drive: 0.5,
      };
      function stats(exhaustGain: number): { peak: number; median: number } {
        const voice = new EngineVoice({ ...base, exhaustGain }, FS, SEED);
        voice.setControl(ctrl(6000, 1));
        renderSeconds(voice, 0.5);
        return peakAndMedian(fftPower(renderSeconds(voice, 1)), 6000);
      }
      const high = stats(1.0);
      expect(10 * Math.log10(high.peak / high.median)).toBeGreaterThanOrEqual(10);
      const low = stats(0.2);
      expect(Math.abs(10 * Math.log10(low.peak / high.peak))).toBeLessThanOrEqual(1.5);
    },
    60000,
  );

  it(
    'POST5: the intake layer bypasses exhaustGain',
    () => {
      const base = {
        ...baseSpec(8),
        intakeMix: 1,
        intakeHz: 250,
        cylVar: 0,
        drive: 0.5,
        gainDb: -6,
      };
      function stats(exhaustGain: number): { peak: number; median: number } {
        const voice = new EngineVoice({ ...base, exhaustGain }, FS, SEED);
        voice.setControl(ctrl(4000, 1));
        renderSeconds(voice, 0.5);
        return peakAndMedian(fftPower(renderSeconds(voice, 1)), 250);
      }
      const high = stats(1.0);
      expect(10 * Math.log10(high.peak / high.median)).toBeGreaterThanOrEqual(10);
      const low = stats(0.2);
      expect(Math.abs(10 * Math.log10(low.peak / high.peak))).toBeLessThanOrEqual(1.5);
    },
    60000,
  );

  it('POST6: a zero-length render is a no-op', () => {
    const spec = { ...baseSpec(8), crackle: 1 };
    const a = new EngineVoice(spec, FS, SEED);
    const b = new EngineVoice(spec, FS, SEED);
    a.setControl(ctrl(8000, 1));
    b.setControl(ctrl(8000, 1));
    renderSeconds(a, 0.3);
    renderSeconds(b, 0.3);
    a.render(new Float32Array(0));
    a.setControl(ctrl(8000, 0, { throttle: 0 }));
    b.setControl(ctrl(8000, 0, { throttle: 0 }));
    expect(renderSeconds(a, 1)).toEqual(renderSeconds(b, 1));
    expect(popCount(a)).toBe(popCount(b));
  }, 30000);

  it('POST7: the new fields at spec extremes stay finite with peak <= 0.9', () => {
    for (const exhaustGain of [0.01, 2]) {
      const spec = {
        ...baseSpec(8),
        bassDb: 12,
        exhaustGain,
        cylVar: 0.5,
        crackle: 1,
        drive: 4,
        gainDb: 12,
        turbo: { centerHz: 6000, spanHz: 3000, gain: 0.3, lagS: 0.2 },
      };
      const voice = new EngineVoice(spec, FS, SEED);
      voice.setControl(ctrl(8000, 1, { throttle: 0.04, limiter: true }));
      renderSeconds(voice, 0.5);
      const x = renderSeconds(voice, 1);
      expect(finiteCount(x), `exhaustGain ${exhaustGain}`).toBe(0);
      expect(peakOf(x), `exhaustGain ${exhaustGain}`).toBeLessThanOrEqual(0.9);
    }
  }, 60000);

  it('POST8: with zero jitter, cylVar 0.28 alone makes seeds 1 and 2 differ', () => {
    const spec = { ...baseSpec(8), cylVar: 0.28, bassDb: 0 };
    const a = new EngineVoice(spec, FS, 1);
    const b = new EngineVoice(spec, FS, 2);
    const c = new EngineVoice(spec, FS, 1);
    a.setControl(ctrl(6000, 1));
    b.setControl(ctrl(6000, 1));
    c.setControl(ctrl(6000, 1));
    const ra = renderSeconds(a, 0.3);
    expect(ra).not.toEqual(renderSeconds(b, 0.3));
    expect(renderSeconds(c, 0.3)).toEqual(ra);
  }, 30000);

  it('POST9: overrun pops fire at 96 kHz and the render stays finite', () => {
    const fs = 96000;
    const voice = new EngineVoice({ ...baseSpec(8), crackle: 1 }, fs, SEED);
    voice.setControl(ctrl(8000, 1));
    renderSeconds(voice, 0.5, fs);
    voice.setControl(ctrl(8000, 0, { throttle: 0 }));
    const x = renderSeconds(voice, 1.2, fs);
    expect(popCount(voice)).toBeGreaterThanOrEqual(3);
    expect(finiteCount(x)).toBe(0);
  }, 60000);

  it('POST10: reset() during an overrun closes the pop window', () => {
    const voice = new EngineVoice({ ...baseSpec(8), crackle: 1 }, FS, SEED);
    voice.setControl(ctrl(8000, 1));
    renderSeconds(voice, 0.5);
    voice.setControl(ctrl(8000, 0, { throttle: 0 }));
    renderSeconds(voice, 0.2);
    voice.reset();
    expect(popCount(voice)).toBe(0);
    voice.setControl(ctrl(8000, 0, { throttle: 0 }));
    renderSeconds(voice, 1.2);
    expect(popCount(voice)).toBe(0);
    voice.setControl(ctrl(8000, 1));
    renderSeconds(voice, 0.3);
    voice.setControl(ctrl(8000, 0, { throttle: 0 }));
    renderSeconds(voice, 1.2);
    expect(popCount(voice)).toBeGreaterThanOrEqual(3);
  }, 60000);
});
