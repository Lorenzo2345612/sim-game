import { describe, expect, it } from 'vitest';
import { EngineVoice, type VoiceControl } from '../../../src/audio/engineVoice';
import { parseEngineSynth, type EngineSynthSpec } from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;
const BLOCK = 128;
const LEGACY = { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 };
const WHEEL_R = 0.33;
const TAU = 2 * Math.PI;

type Layer = { order: number; gain: number; source: 'wheel' | 'rpm' };
type Elec = { layers: Layer[]; carrierHz: number; carrierGain: number };
type Spec285 = EngineSynthSpec & { kind: 'combustion' | 'electric'; electric: Elec | null };

function parse(raw: unknown): { spec: Spec285; errors: string[] } {
  const r = parseEngineSynth(raw, LEGACY);
  return { spec: r.spec as Spec285, errors: r.errors };
}

function ctrl(partial: Partial<VoiceControl>): VoiceControl {
  return { rpm: 0, load: 0, throttle: 0, wheelSpeedMs: 0, limiter: false, ...partial };
}

function renderSeconds(voice: EngineVoice, seconds: number): Float32Array {
  const n = Math.round(seconds * FS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += BLOCK) voice.render(out.subarray(i, i + Math.min(BLOCK, n - i)));
  return out;
}

function warm(voice: EngineVoice, c: VoiceControl, seconds = 0.3): void {
  voice.setControl(c);
  renderSeconds(voice, seconds);
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

function binPeakHz(pow: Float64Array, loHz: number, hiHz: number): number {
  const binHz = FS / pow.length;
  const k0 = Math.max(1, Math.ceil(loHz / binHz));
  const k1 = Math.min((pow.length >> 1) - 1, Math.floor(hiHz / binHz));
  let best = k0;
  for (let k = k0; k <= k1; k++) if (pow[k] > pow[best]) best = k;
  return best * binHz;
}

function binBandPow(pow: Float64Array, loHz: number, hiHz: number): number {
  const binHz = FS / pow.length;
  const k0 = Math.max(1, Math.ceil(loHz / binHz));
  const k1 = Math.min((pow.length >> 1) - 1, Math.floor(hiHz / binHz));
  let m = 0;
  for (let k = k0; k <= k1; k++) if (pow[k] > m) m = pow[k];
  return m;
}

// RMS of the x band from the Hann-windowed spectrum (Parseval, de-windowed by E[w^2] = 3/8).
function bandRms(x: Float32Array, loHz: number, hiHz: number): number {
  const n = x.length;
  const pow = fftPower(x);
  const binHz = FS / pow.length;
  const k0 = Math.max(0, Math.ceil(loHz / binHz));
  const k1 = Math.min((pow.length >> 1) - 1, Math.floor(hiHz / binHz));
  let e = 0;
  for (let k = k0; k <= k1; k++) e += pow[k];
  return Math.sqrt(e / (pow.length * n * 0.375));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

function deepFreeze(o: unknown): void {
  if (typeof o !== 'object' || o === null) return;
  Object.freeze(o);
  for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
}

describe('285 electric voice edge cases', () => {
  it('EDGE1: electric parse accepts every inclusive bound (order 400, gain 0.3 and 0, carrier 4000..16000, carrierGain 0..0.1, 1 and 4 layers)', () => {
    const low = {
      kind: 'electric',
      electric: {
        layers: [{ order: 1, gain: 0, source: 'rpm' }],
        carrierHz: 4000,
        carrierGain: 0,
      },
    };
    const high = {
      kind: 'electric',
      electric: {
        layers: [
          { order: 400, gain: 0.3, source: 'wheel' },
          { order: 0.5, gain: 0, source: 'rpm' },
          { order: 200, gain: 0.15, source: 'wheel' },
          { order: 50, gain: 0.3, source: 'rpm' },
        ],
        carrierHz: 16000,
        carrierGain: 0.1,
      },
    };
    const a = parse(low);
    expect(a.errors).toEqual([]);
    expect(a.spec.kind).toBe('electric');
    const b = parse(high);
    expect(b.errors).toEqual([]);
    expect(b.spec.kind).toBe('electric');
    expect(b.spec.electric).toEqual(high.electric);
  });

  it('EDGE2: each electric violation adds exactly one synth.electric.-prefixed error', () => {
    const raw = {
      kind: 'electric',
      electric: {
        layers: [
          { order: 0, gain: 0.1, source: 'wheel' },
          { order: 5, gain: 0.31, source: 'gear' },
        ],
        carrierHz: 3999,
        carrierGain: 0.11,
      },
    };
    const { errors } = parse(raw);
    expect(errors.length).toBe(5);
    for (const e of errors) expect(e.startsWith('synth.electric.'), e).toBe(true);
    const empty = parse({
      kind: 'electric',
      electric: { layers: [], carrierHz: 8000, carrierGain: 0.05 },
    });
    expect(empty.errors.length).toBe(1);
    expect(empty.errors[0].startsWith('synth.electric.')).toBe(true);
  });

  it('EDGE3: an unknown synth.kind reports the exact spec error and nothing else', () => {
    const { errors } = parse({ kind: 'hybrid' });
    expect(errors).toEqual(["synth.kind must be 'combustion' or 'electric'"]);
  });

  it('EDGE4: kind electric without an electric block reports an error and keeps kind electric', () => {
    const { spec, errors } = parse({ kind: 'electric' });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(spec.kind).toBe('electric');
  });

  it('EDGE5: parseEngineSynth does not mutate the raw synth input', () => {
    const raw = {
      kind: 'electric',
      electric: {
        layers: [{ order: 31, gain: 0.2, source: 'wheel' }],
        carrierHz: 10000,
        carrierGain: 0.05,
      },
      whine: { order: 50, gain: 0.1, source: 'rpm', minSpeedMs: 0 },
      turbo: { centerHz: 4000, spanHz: 2000, gain: 0.2, lagS: 0.1 },
      crackle: 0.4,
    };
    const snap = JSON.stringify(raw);
    deepFreeze(raw);
    const { errors } = parse(raw);
    expect(errors).toEqual([]);
    expect(JSON.stringify(raw)).toBe(snap);
  });

  it('EDGE6: an rpm-source layer sounds at order*rpm/60 (700 Hz), not at the wheel-order frequency', () => {
    const { spec, errors } = parse({
      kind: 'electric',
      electric: {
        layers: [{ order: 7, gain: 0.3, source: 'rpm' }],
        carrierHz: 10000,
        carrierGain: 0.02,
      },
    });
    expect(errors).toEqual([]);
    const voice = new EngineVoice(spec, FS, SEED);
    warm(voice, ctrl({ rpm: 6000, load: 1, throttle: 1, wheelSpeedMs: 50 }));
    const pow = fftPower(renderSeconds(voice, 0.5));
    const wheelFormulaHz = (7 * 50) / (TAU * WHEEL_R);
    expect(Math.abs(binPeakHz(pow, 660, 740) - 700)).toBeLessThanOrEqual(10);
    expect(binBandPow(pow, 660, 740)).toBeGreaterThan(
      binBandPow(pow, wheelFormulaHz - 25, wheelFormulaHz + 25) * 1e3,
    );
  });

  it('EDGE7: every declared layer sounds — wheel order 31 at 747.5 Hz and rpm order 15 at 1200 Hz together', () => {
    const { spec, errors } = parse({
      kind: 'electric',
      electric: {
        layers: [
          { order: 31, gain: 0.15, source: 'wheel' },
          { order: 15, gain: 0.12, source: 'rpm' },
        ],
        carrierHz: 10000,
        carrierGain: 0.02,
      },
    });
    expect(errors).toEqual([]);
    const voice = new EngineVoice(spec, FS, SEED);
    warm(voice, ctrl({ rpm: 4800, load: 1, throttle: 1, wheelSpeedMs: 50 }));
    const pow = fftPower(renderSeconds(voice, 0.5));
    expect(Math.abs(binPeakHz(pow, 700, 800) - 747.5)).toBeLessThanOrEqual(10);
    expect(Math.abs(binPeakHz(pow, 1150, 1250) - 1200)).toBeLessThanOrEqual(10);
  });

  it('EDGE8: phase stays continuous across render block sizes and repeated identical setControl calls', () => {
    const { spec } = parse({
      kind: 'electric',
      electric: {
        layers: [{ order: 31, gain: 0.2, source: 'wheel' }],
        carrierHz: 10000,
        carrierGain: 0.05,
      },
    });
    const c = ctrl({ rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 50 });
    const n = Math.round(0.4 * FS);
    const render = (voice: EngineVoice, block: number, perBlock: boolean): Float32Array => {
      const out = new Float32Array(n);
      if (!perBlock) voice.setControl(c);
      for (let i = 0; i < n; i += block) {
        if (perBlock) voice.setControl(c);
        voice.render(out.subarray(i, i + Math.min(block, n - i)));
      }
      return out;
    };
    const whole = render(new EngineVoice(spec, FS, SEED), n, false);
    const b128 = render(new EngineVoice(spec, FS, SEED), 128, false);
    const b128ctl = render(new EngineVoice(spec, FS, SEED), 128, true);
    const b64 = render(new EngineVoice(spec, FS, SEED), 64, false);
    expect(maxAbsDiff(whole, b128)).toBeLessThan(1e-6);
    expect(maxAbsDiff(whole, b128ctl)).toBeLessThan(1e-6);
    expect(maxAbsDiff(whole, b64)).toBeLessThan(1e-6);
  });

  it('EDGE9: firing, exhaust, turbo, legacy whine and limiter contribute nothing to an electric render', () => {
    const { spec, errors } = parse({
      kind: 'electric',
      electric: {
        layers: [{ order: 31, gain: 0.2, source: 'wheel' }],
        carrierHz: 10000,
        carrierGain: 0.05,
      },
      whine: { order: 50, gain: 0.3, source: 'rpm', minSpeedMs: 0 },
      turbo: { centerHz: 4000, spanHz: 2000, gain: 0.3, lagS: 0.1 },
      crackle: 0.5,
      limiterHz: 15,
    });
    expect(errors).toEqual([]);
    const voice = new EngineVoice(spec, FS, SEED);
    voice.setControl({ rpm: 6000, load: 1, throttle: 0, wheelSpeedMs: 0, limiter: true });
    const x = renderSeconds(voice, 0.3);
    expect(bandRms(x, 0, 10000 - 500)).toBeLessThan(1e-3);
  });

  it('EDGE10: the carrier keeps amplitude carrierGain under full throttle with the limiter on', () => {
    const { spec, errors } = parse({
      kind: 'electric',
      electric: {
        layers: [{ order: 31, gain: 0.2, source: 'wheel' }],
        carrierHz: 10000,
        carrierGain: 0.05,
      },
    });
    expect(errors).toEqual([]);
    const voice = new EngineVoice(spec, FS, SEED);
    warm(voice, ctrl({ rpm: 7000, load: 1, throttle: 1, wheelSpeedMs: 40, limiter: true }));
    const x = renderSeconds(voice, 0.5);
    expect(Math.abs(binPeakHz(fftPower(x), 9900, 10100) - 10000)).toBeLessThanOrEqual(50);
    expect(bandRms(x, 9900, 10100)).toBeCloseTo(0.05 / Math.SQRT2, 2);
  });
});
