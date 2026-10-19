import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineVoice, type VoiceControl } from '../../../src/audio/engineVoice';
import { parseEngineSynth, type EngineSynthSpec } from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;
const BLOCK = 128;
const CARS_DIR = join(__dirname, '..', '..', '..', 'public', 'cars');
const LEGACY = { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 };

type Spec285 = EngineSynthSpec & {
  kind: 'combustion' | 'electric';
  electric: {
    layers: { order: number; gain: number; source: 'wheel' | 'rpm' }[];
    carrierHz: number;
    carrierGain: number;
  } | null;
};

const ELEC_RAW = {
  kind: 'electric',
  electric: {
    layers: [{ order: 31, gain: 0.2, source: 'wheel' }],
    carrierHz: 10000,
    carrierGain: 0.05,
  },
};

const BAD_RAW = {
  kind: 'electric',
  electric: {
    layers: [
      { order: 500, gain: 0.1, source: 'wheel' },
      { order: 2, gain: 0.1, source: 'wheel' },
      { order: 4, gain: 0.1, source: 'rpm' },
      { order: 6, gain: 0.1, source: 'wheel' },
      { order: 8, gain: 0.1, source: 'rpm' },
    ],
    carrierHz: 20000,
    carrierGain: 0.05,
  },
};

function carIds(): string[] {
  return readdirSync(CARS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function carSynth(id: string): { spec: EngineSynthSpec; errors: string[] } {
  const json = JSON.parse(readFileSync(join(CARS_DIR, `${id}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
  const sound = json['sound'] as Record<string, unknown>;
  return parseEngineSynth(sound['synth'], {
    cylinders: sound['cylinders'] as number,
    exhaustLengthM: sound['exhaustLengthM'] as number,
    intakeMix: sound['intakeMix'] as number,
    crackle: sound['crackle'] as number,
  });
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v !== 'object' || v === null) return v;
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src).sort()) out[k] = canonical(src[k]);
  return out;
}

function sha256Text(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function specFingerprint(spec: EngineSynthSpec): string {
  const copy = { ...(spec as unknown as Record<string, unknown>) };
  delete copy['kind'];
  delete copy['electric'];
  return sha256Text(JSON.stringify(canonical(copy)));
}

function renderFingerprint(x: Float32Array): string {
  return createHash('sha256')
    .update(Buffer.from(x.buffer, x.byteOffset, x.byteLength))
    .digest('hex');
}

const SCHEDULE: Array<{ s: number; c: VoiceControl }> = [
  { s: 0.15, c: { rpm: 4000, load: 0.6, throttle: 0.7, wheelSpeedMs: 30, limiter: false } },
  { s: 0.15, c: { rpm: 8000, load: 1, throttle: 1, wheelSpeedMs: 60, limiter: false } },
];

function renderSchedule(spec: EngineSynthSpec): Float32Array {
  const voice = new EngineVoice(spec, FS, SEED);
  const out = new Float32Array(Math.round(0.3 * FS));
  let off = 0;
  for (const seg of SCHEDULE) {
    voice.setControl(seg.c);
    const n = Math.round(seg.s * FS);
    for (let i = 0; i < n; i += BLOCK) {
      const len = Math.min(BLOCK, n - i);
      voice.render(out.subarray(off + i, off + i + len));
    }
    off += n;
  }
  return out;
}

function renderSeconds(voice: EngineVoice, seconds: number): Float32Array {
  const n = Math.round(seconds * FS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += BLOCK) {
    voice.render(out.subarray(i, i + Math.min(BLOCK, n - i)));
  }
  return out;
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

// Fingerprints of the pre-285 parse/render output of each existing car voice.
const PARSE_FP: Record<string, string> = {
  f4: '0530b10bb0b5723ddd57accb63beeb36a4368799007c9ed8828282b0ae1feb80',
  'gt3-a': 'f0bada7d6a2c2b32234a7d9843c7ddccde62276d308c6226b01c08f94ce779a0',
  'gt3-b': '1f05e077e13e3352d75108bdcd3f35b484c4ddf9a18175e734449e75b3c5e624',
  'gt3-c': 'd7ae27fad3b5af58736b9ebdbeb6d49de42a1be802772b1824f4e268c34b0d29',
  'gt3-d': 'fe61476580a926b603efb2d92f78ab8758931a6f2a25c31d91cf947ce3a1b268',
  'hyper-a': '7af1e10196c1f72fdbe3d672dd0c2be8ea385bfdd399d8b13070993bdee4a8f5',
  'lmp2-a': 'da30574a7809eeb9b50e32de4169f564de026c75627fe38a627d50c52b76ac65',
  ow26: '8ae70c370e2df58e6f8c56fb6174afabae6e002802999230fbfd0a0c328b3b09',
};
const RENDER_FP: Record<string, string> = {
  f4: '00b924662ebd83c57f789a713777dfa837373b7fbdd78d2f785a3dc60b6bda28',
  'gt3-a': '9111a1d0714eaf4cbe0ddbc0c835e9c546c2354a26329927e1bb249e7701f722',
  'gt3-b': '2b7f7503c27e9ceb22d813c307fd57248e2954d9efdc92d41b3928df7fe027b5',
  'gt3-c': '9250917488680786896e991c9fdb9fe16249d1801ae387740dcb0dad66ebdf91',
  'gt3-d': '12bc9583c309bf4a31fdef2f3dc37ac57c8259f6dc255694e8c019ff2ed7357d',
  'hyper-a': 'f54a14e4504e84e6139aa94736add205a4d3315a265075937a7cfbcf2b191e7b',
  'lmp2-a': '4a5e0cdfb1ecb95fab2426cf8a200ad30620a332351d70c199909b55967e66a7',
  ow26: '4cb8d5bb899fb4dc166941f5846e5a84e512213c53e26f2f7c1da061bdfb0805',
};

describe('285 electric voice acceptance', () => {
  it('AT1: electric spec layers [{order 31, gain 0.2, wheel}] with carrier 10000/0.05 parses with no errors', () => {
    const { spec, errors } = parseEngineSynth(ELEC_RAW, LEGACY);
    expect(errors).toEqual([]);
    const s = spec as Spec285;
    expect(s.kind).toBe('electric');
    expect(s.electric).toEqual(ELEC_RAW.electric);
  });

  it('AT2: order 500, five layers and carrierHz 20000 each report one synth.electric. error', () => {
    const { errors } = parseEngineSynth(BAD_RAW, LEGACY);
    expect(errors.length).toBe(3);
    for (const e of errors) expect(e.startsWith('synth.electric.'), e).toBe(true);
    expect(errors.some((e) => e.includes('order'))).toBe(true);
    expect(errors.some((e) => e.includes('layers'))).toBe(true);
    expect(errors.some((e) => e.includes('carrierHz'))).toBe(true);
  });

  it('AT3: AT1 voice at wheelSpeedMs 50 renders 0.5 s with a peak within +/-10 Hz of 747.5 Hz and a peak at 10000 +/- 50 Hz', () => {
    const { spec } = parseEngineSynth(ELEC_RAW, LEGACY);
    const voice = new EngineVoice(spec, FS, SEED);
    voice.setControl({ rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 50, limiter: false });
    const pow = fftPower(renderSeconds(voice, 0.5));
    expect(Math.abs(binPeakHz(pow, 0, FS / 2) - 747.5)).toBeLessThanOrEqual(10);
    expect(Math.abs(binPeakHz(pow, 8000, 12000) - 10000)).toBeLessThanOrEqual(50);
  });

  it('AT4: at wheelSpeedMs 0 and throttle 0 the 0.2 s render is silent below 9500 Hz (RMS < 1e-3) with only the carrier <= carrierGain', () => {
    const { spec } = parseEngineSynth(ELEC_RAW, LEGACY);
    const voice = new EngineVoice(spec, FS, SEED);
    voice.setControl({ rpm: 0, load: 0, throttle: 0, wheelSpeedMs: 0, limiter: false });
    const x = renderSeconds(voice, 0.2);
    expect(bandRms(x, 0, 10000 - 500)).toBeLessThan(1e-3);
    const carrier = bandRms(x, 10000 - 100, 10000 + 100);
    expect(carrier).toBeGreaterThan(0);
    expect(carrier).toBeLessThanOrEqual(0.05);
  });

  it('AT5: every existing car voice parses with kind combustion, electric null and unchanged spec and render fingerprints', () => {
    const ids = carIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const { spec, errors } = carSynth(id);
      expect(errors, id).toEqual([]);
      const s = spec as Spec285;
      if (s.kind === 'electric') continue;
      expect(s.kind, id).toBe('combustion');
      expect(s.electric, id).toBeNull();
      expect(PARSE_FP[id], `${id} parse baseline`).toBeDefined();
      expect(RENDER_FP[id], `${id} render baseline`).toBeDefined();
      expect(specFingerprint(spec), `${id} spec`).toBe(PARSE_FP[id]);
      expect(renderFingerprint(renderSchedule(spec)), `${id} render`).toBe(RENDER_FP[id]);
    }
  });
});
