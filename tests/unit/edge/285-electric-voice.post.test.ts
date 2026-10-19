import { describe, expect, it } from 'vitest';
import { EngineVoice, type VoiceControl } from '../../../src/audio/engineVoice';
import { parseEngineSynth, type EngineSynthSpec } from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;
const BLOCK = 128;
const LEGACY = { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 };
const WHEEL_R = 0.33;
const TAU = 2 * Math.PI;
const MAX_FC = 0.45;

type Layer = { order: number; gain: number; source: 'wheel' | 'rpm' };
type Elec = { layers: Layer[]; carrierHz: number; carrierGain: number };
type Spec285 = EngineSynthSpec & { kind: 'combustion' | 'electric'; electric: Elec | null };

const ELEC: Elec = {
  layers: [{ order: 31, gain: 0.2, source: 'wheel' }],
  carrierHz: 10000,
  carrierGain: 0.05,
};

function parse(raw: unknown): { spec: Spec285; errors: string[] } {
  const r = parseEngineSynth(raw, LEGACY);
  return { spec: r.spec as Spec285, errors: r.errors };
}

function ctrl(partial: Partial<VoiceControl>): VoiceControl {
  return { rpm: 0, load: 0, throttle: 0, wheelSpeedMs: 0, limiter: false, ...partial };
}

function renderSeconds(voice: EngineVoice, seconds: number, fs = FS): Float32Array {
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += BLOCK) voice.render(out.subarray(i, i + Math.min(BLOCK, n - i)));
  return out;
}

function warm(voice: EngineVoice, c: VoiceControl, seconds = 0.3): void {
  voice.setControl(c);
  renderSeconds(voice, seconds);
}

function maxAbs(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > m) m = a;
  }
  return m;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
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

function binPeakHz(pow: Float64Array, loHz: number, hiHz: number, fs = FS): number {
  const binHz = fs / pow.length;
  const k0 = Math.max(1, Math.ceil(loHz / binHz));
  const k1 = Math.min((pow.length >> 1) - 1, Math.floor(hiHz / binHz));
  let best = k0;
  for (let k = k0; k <= k1; k++) if (pow[k] > pow[best]) best = k;
  return best * binHz;
}

function bandRms(x: Float32Array, loHz: number, hiHz: number, fs = FS): number {
  const n = x.length;
  const pow = fftPower(x);
  const binHz = fs / pow.length;
  const k0 = Math.max(0, Math.ceil(loHz / binHz));
  const k1 = Math.min((pow.length >> 1) - 1, Math.floor(hiHz / binHz));
  let e = 0;
  for (let k = k0; k <= k1; k++) e += pow[k];
  return Math.sqrt(e / (pow.length * n * 0.375));
}

function renderSchedule(spec: EngineSynthSpec, seconds = 0.3): Float32Array {
  const voice = new EngineVoice(spec, FS, SEED);
  voice.setControl({ rpm: 4000, load: 0.8, throttle: 0.9, wheelSpeedMs: 45, limiter: false });
  return renderSeconds(voice, seconds);
}

describe('285 electric voice post gaps', () => {
  it('POST1: a valid electric block on a combustion kind parses but renders bit-identically to combustion alone', () => {
    const withE = parse({ electric: ELEC });
    const without = parse({});
    expect(withE.errors).toEqual([]);
    expect(withE.spec.kind).toBe('combustion');
    expect(withE.spec.electric).toEqual(ELEC);
    expect(maxAbsDiff(renderSchedule(withE.spec), renderSchedule(without.spec))).toBe(0);
  });

  it('POST2: electric kind with a null electric block renders silence without throwing', () => {
    const { spec, errors } = parse({ kind: 'electric' });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(spec.electric).toBeNull();
    const voice = new EngineVoice(spec, FS, SEED);
    voice.setControl({ rpm: 8000, load: 1, throttle: 1, wheelSpeedMs: 80, limiter: false });
    expect(maxAbs(renderSeconds(voice, 0.2))).toBeLessThan(1e-7);
  });

  it('POST3: non-numeric, NaN, Infinity and negative electric fields each add one synth.electric. error', () => {
    const { spec, errors } = parse({
      kind: 'electric',
      electric: {
        layers: [
          { order: '31', gain: 0.2, source: 'wheel' },
          { order: -5, gain: 0.1, source: 'rpm' },
        ],
        carrierHz: NaN,
        carrierGain: Infinity,
      },
    });
    expect(errors.length).toBe(4);
    for (const e of errors) expect(e.startsWith('synth.electric.'), e).toBe(true);
    expect(spec.electric).toBeNull();
  });

  it('POST4: a non-object electric block and a non-object layer entry each report one error', () => {
    const a = parse({ kind: 'electric', electric: 'loud' });
    expect(a.errors).toEqual(['synth.electric must be an object']);
    expect(a.spec.electric).toBeNull();
    const b = parse({
      kind: 'electric',
      electric: { layers: [7], carrierHz: 8000, carrierGain: 0.05 },
    });
    expect(b.errors).toEqual(['synth.electric.layers[0].must be an object']);
    expect(b.spec.electric).toBeNull();
  });

  it('POST5: gainDb scales the electric output by 10^(gainDb/20)', () => {
    const loud = parse({ kind: 'electric', electric: ELEC, gainDb: 6 });
    const ref = parse({ kind: 'electric', electric: ELEC });
    expect(loud.errors).toEqual([]);
    const band = (spec: EngineSynthSpec): number => {
      const voice = new EngineVoice(spec, FS, SEED);
      warm(voice, ctrl({ rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 50 }));
      return bandRms(renderSeconds(voice, 0.5), 9900, 10100);
    };
    expect(band(loud.spec) / band(ref.spec)).toBeCloseTo(Math.pow(10, 6 / 20), 1);
  });

  it('POST6: reset clears layer and carrier phases so rendering restarts bit-identically', () => {
    const { spec } = parse({ kind: 'electric', electric: ELEC });
    const c = ctrl({ rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 50 });
    const n = Math.round(0.3 * FS);
    const fresh = new EngineVoice(spec, FS, SEED);
    fresh.setControl(c);
    const a = renderSeconds(fresh, 0.3);
    const used = new EngineVoice(spec, FS, SEED);
    used.setControl(c);
    used.render(new Float32Array(2048));
    used.reset();
    used.setControl(c);
    const b = renderSeconds(used, 0.3);
    expect(a.length).toBe(n);
    expect(maxAbsDiff(a, b)).toBe(0);
  });

  it('POST7: a zero-gain layer is inaudible and carrierGain 0 silences the carrier', () => {
    const noCarrier = parse({
      kind: 'electric',
      electric: { ...ELEC, carrierGain: 0 },
    });
    const rest = new EngineVoice(noCarrier.spec, FS, SEED);
    rest.setControl(ctrl({}));
    expect(maxAbs(renderSeconds(rest, 0.2))).toBeLessThan(1e-7);
    const noLayer = parse({
      kind: 'electric',
      electric: { ...ELEC, layers: [{ order: 31, gain: 0, source: 'wheel' }] },
    });
    expect(noLayer.errors).toEqual([]);
    const moving = new EngineVoice(noLayer.spec, FS, SEED);
    warm(moving, ctrl({ rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 50 }));
    const x = renderSeconds(moving, 0.5);
    expect(bandRms(x, 0, 9500)).toBeLessThan(1e-3);
    expect(bandRms(x, 9900, 10100)).toBeCloseTo(0.05 / 2, 2);
  });

  it('POST8: a layer frequency above 0.45*fs clamps to 0.45*fs', () => {
    const { spec, errors } = parse({
      kind: 'electric',
      electric: {
        layers: [{ order: 400, gain: 0.25, source: 'rpm' }],
        carrierHz: 8000,
        carrierGain: 0.02,
      },
    });
    expect(errors).toEqual([]);
    const voice = new EngineVoice(spec, FS, SEED);
    warm(voice, ctrl({ rpm: 6000, load: 1, throttle: 1, wheelSpeedMs: 0 }));
    expect((400 * 6000) / 60).toBeGreaterThan(MAX_FC * FS);
    const peak = binPeakHz(fftPower(renderSeconds(voice, 0.5)), 12000, 23000);
    expect(Math.abs(peak - MAX_FC * FS)).toBeLessThanOrEqual(10);
  });

  it('POST9: carrierHz above 0.45*fs clamps the carrier to 0.45*fs', () => {
    const fs = 32000;
    const { spec, errors } = parse({
      kind: 'electric',
      electric: { ...ELEC, carrierHz: 16000 },
    });
    expect(errors).toEqual([]);
    const voice = new EngineVoice(spec, fs, SEED);
    voice.setControl(ctrl({}));
    const peak = binPeakHz(fftPower(renderSeconds(voice, 0.5, fs)), 13000, 15500, fs);
    expect(Math.abs(peak - MAX_FC * fs)).toBeLessThanOrEqual(10);
  });

  it('POST10: a layer below 1 Hz is skipped', () => {
    const { spec, errors } = parse({
      kind: 'electric',
      electric: {
        layers: [{ order: 1, gain: 0.3, source: 'wheel' }],
        carrierHz: 10000,
        carrierGain: 0,
      },
    });
    expect(errors).toEqual([]);
    expect(0.5 / (TAU * WHEEL_R)).toBeLessThan(1);
    const voice = new EngineVoice(spec, FS, SEED);
    voice.setControl(ctrl({ rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 0.5 }));
    expect(maxAbs(renderSeconds(voice, 0.2))).toBeLessThan(1e-7);
  });
});
