import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as voiceNs from '../../../src/audio/engineVoice';
import { EngineVoice, WHEEL_RADIUS_M, type VoiceControl } from '../../../src/audio/engineVoice';
import { parseEngineSynth, type EngineSynthSpec } from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;
const BLOCK = 128;
const ROOT = join(__dirname, '..', '..', '..');
const CARS_DIR = join(ROOT, 'public', 'cars');

type Spec244 = EngineSynthSpec & { cylVar: number; bassDb: number; exhaustGain: number };

const PINNED: Record<string, string> = {
  'f4.json': '7f4829fbaa25a8c8aa834353dc9d0c048bc0044e4cfb422c2d00121cf5a015b8',
  'gt3-a.json': 'c5fbdca95b7758b273f7c889714a116cfbe6696f7085cd0d187142b76c69ef46',
  'gt3-b.json': '86c0aadd8801a63d3ae67ac8ed176672671255436a54c169ea9bda294ed77c26',
  'gt3-c.json': '933f10ac098aab4cd1b705709698024369d10337fcc25967051242e451b8fd08',
  'gt3-d.json': '592590bd537dcd58ea13392d96da0d64f6a90520774952c36b6d5da96b4a610b',
  'hyper-a.json': 'c418544b13b4839545fcd4a8f9f2d352d8caf6c4efd8a1631cf4247c2f3c47c8',
  'index.json': 'ae277e0021615e04acbf70d386f85377340e752c0de7f6245744b6f6761eb829',
  'lmp2-a.json': '95b15ce1078531d311e2ad480987abf2e87d3f48a3a1e08fea11ac14f7355168',
  'ow26.json': 'bc6b4f39bc29dd34e37e46f7e03c04b073dbd00087a24f4534774dc65c6d834a',
};

const CTOR_NAMES = [
  'Array',
  'Object',
  'ArrayBuffer',
  'DataView',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Float32Array',
  'Float64Array',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'BigInt64Array',
  'BigUint64Array',
];

type Ctor = new (...args: never[]) => unknown;

function countConstructions(fn: () => void): number {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: [string, unknown][] = [];
  let count = 0;
  for (const name of CTOR_NAMES) {
    const original = g[name];
    saved.push([name, original]);
    g[name] = new Proxy(original as Ctor, {
      construct(target, args) {
        count += 1;
        return Reflect.construct(target, args);
      },
      get(target, prop) {
        if (prop === 'from' || prop === 'of') count += 1;
        return Reflect.get(target, prop);
      },
    });
  }
  try {
    fn();
  } finally {
    for (const [name, original] of saved) g[name] = original;
  }
  return count;
}

function ctrl(rpm: number, load: number, extra: Partial<VoiceControl> = {}): VoiceControl {
  return { rpm, load, throttle: 1, wheelSpeedMs: 0, limiter: false, ...extra };
}

function tuned(
  base: EngineSynthSpec,
  extra: Record<string, unknown>,
): EngineSynthSpec & Record<string, unknown> {
  return Object.assign({}, base, extra);
}

function carSpec(id: string): EngineSynthSpec {
  const json = JSON.parse(readFileSync(join(CARS_DIR, `${id}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
  const sound = json['sound'] as Record<string, unknown>;
  const { spec, errors } = parseEngineSynth(sound['synth'], {
    cylinders: sound['cylinders'] as number,
    exhaustLengthM: sound['exhaustLengthM'] as number,
    intakeMix: sound['intakeMix'] as number,
    crackle: sound['crackle'] as number,
  });
  expect(errors, id).toEqual([]);
  return spec;
}

function renderSeconds(voice: EngineVoice, seconds: number): Float32Array {
  const n = Math.round(seconds * FS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += BLOCK) {
    voice.render(out.subarray(i, i + Math.min(BLOCK, n - i)));
  }
  return out;
}

function popCount(voice: EngineVoice): number {
  return (voice as unknown as { popCount: number }).popCount;
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

function bandEnergy(pow: Float64Array, loHz: number, hiHz: number): number {
  const binHz = FS / pow.length;
  const k0 = Math.max(1, Math.ceil(loHz / binHz));
  const k1 = Math.min((pow.length >> 1) - 1, Math.floor(hiHz / binHz));
  let e = 0;
  for (let k = k0; k <= k1; k++) e += pow[k];
  return e;
}

function peakAndMedian(pow: Float64Array, fHz: number): { peak: number; median: number } {
  const binHz = FS / pow.length;
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

function canon(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return (
      '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}'
    );
  }
  return JSON.stringify(v);
}

describe('244 engine voice timbre edge', () => {
  it('EDGE1: exported REFLECTION is -0.25 and LOOP_LP_HZ is 1800', () => {
    const ns = voiceNs as unknown as { REFLECTION?: number; LOOP_LP_HZ?: number };
    expect(ns.REFLECTION).toBe(-0.25);
    expect(ns.LOOP_LP_HZ).toBe(1800);
  });

  it('EDGE2: PULSE_KERNEL follows the 4 % Hann rise and exp(-5d)(1-d) decay', () => {
    const k = (voiceNs as unknown as { PULSE_KERNEL?: Float64Array }).PULSE_KERNEL;
    expect(k).toBeInstanceOf(Float64Array);
    const table = k as Float64Array;
    const kn = table.length - 2;
    expect(table[0]).toBeCloseTo(0, 6);
    const i1 = Math.round(0.02 * kn);
    const u1 = i1 / kn;
    expect(u1).toBeLessThan(0.04);
    expect(table[i1]).toBeCloseTo(0.5 * (1 - Math.cos((Math.PI * u1) / 0.04)), 6);
    const i2 = Math.round(0.52 * kn);
    const u2 = i2 / kn;
    expect(u2).toBeGreaterThan(0.04);
    const d2 = (u2 - 0.04) / 0.96;
    expect(table[i2]).toBeCloseTo(Math.exp(-5 * d2) * (1 - d2), 6);
  });

  it('EDGE3: parseEngineSynth accepts the new-field boundaries and rejects values past them', () => {
    const legacy = { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 };
    const low = parseEngineSynth({ cylVar: 0, bassDb: 0, exhaustGain: 2 }, legacy);
    expect(low.errors).toEqual([]);
    expect((low.spec as Spec244).cylVar).toBe(0);
    expect((low.spec as Spec244).bassDb).toBe(0);
    expect((low.spec as Spec244).exhaustGain).toBe(2);
    const high = parseEngineSynth({ cylVar: 0.5, bassDb: 12, exhaustGain: 0.01 }, legacy);
    expect(high.errors).toEqual([]);
    expect((high.spec as Spec244).cylVar).toBe(0.5);
    expect((high.spec as Spec244).bassDb).toBe(12);
    expect((high.spec as Spec244).exhaustGain).toBe(0.01);
    const bad = parseEngineSynth({ cylVar: -0.01, bassDb: 12.01, exhaustGain: 2.01 }, legacy);
    expect(bad.errors.length).toBe(3);
    expect(bad.errors.filter((e) => e.includes('synth.cylVar')).length).toBe(1);
    expect(bad.errors.filter((e) => e.includes('synth.bassDb')).length).toBe(1);
    expect(bad.errors.filter((e) => e.includes('synth.exhaustGain')).length).toBe(1);
  });

  it('EDGE4: overrun without a prior throttle >= 0.5 opens no pop window', () => {
    const spec = tuned(carSpec('f4'), { crackle: 0.8, jitterDeg: 0, jitterAmp: 0 });
    const voice = new EngineVoice(spec, FS, SEED);
    voice.setControl(ctrl(6000, 1, { throttle: 0.4 }));
    renderSeconds(voice, 1);
    voice.setControl(ctrl(6000, 0, { throttle: 0 }));
    renderSeconds(voice, 3);
    expect(popCount(voice)).toBe(0);
  }, 30000);

  it('EDGE5: popCount starts at 0 and is back at 0 after reset()', () => {
    const spec = tuned(carSpec('f4'), { crackle: 0.8 });
    const voice = new EngineVoice(spec, FS, SEED);
    expect(popCount(voice)).toBe(0);
    voice.setControl(ctrl(6500, 1));
    renderSeconds(voice, 2);
    voice.setControl(ctrl(6000, 0, { throttle: 0 }));
    renderSeconds(voice, 2.5);
    expect(popCount(voice)).toBeGreaterThan(0);
    voice.reset();
    expect(popCount(voice)).toBe(0);
  }, 30000);

  it(
    'EDGE6: the whine layer bypasses exhaustGain',
    () => {
      const base = tuned(carSpec('f4'), {
        turbo: null,
        intakeMix: 0,
        block: [],
        whine: { order: 18, gain: 0.3, source: 'wheel', minSpeedMs: 0 },
        jitterDeg: 0,
        jitterAmp: 0,
        crackle: 0,
        drive: 0.5,
      });
      const fHz = (18 * 60) / (2 * Math.PI * WHEEL_RADIUS_M);
      function stats(exhaustGain: number): { peak: number; median: number } {
        const voice = new EngineVoice(tuned(base, { exhaustGain }), FS, SEED);
        voice.setControl(ctrl(6000, 0.1, { wheelSpeedMs: 60 }));
        renderSeconds(voice, 0.5);
        return peakAndMedian(fftPower(renderSeconds(voice, 1)), fHz);
      }
      const high = stats(1.0);
      expect(10 * Math.log10(high.peak / high.median)).toBeGreaterThanOrEqual(10);
      const low = stats(0.6);
      expect(Math.abs(10 * Math.log10(low.peak / high.peak))).toBeLessThanOrEqual(1.5);
    },
    60000,
  );

  it(
    'EDGE7: a non-null turbo adds the second muffling low-pass stage',
    () => {
      const base = tuned(carSpec('f4'), {
        intakeMix: 0,
        block: [],
        whine: null,
        crackle: 0,
        jitterDeg: 0,
        jitterAmp: 0,
      });
      const without = new EngineVoice(tuned(base, { turbo: null }), FS, SEED);
      const withStage = new EngineVoice(
        tuned(base, { turbo: { centerHz: 3000, spanHz: 3000, gain: 0, lagS: 0.3 } }),
        FS,
        SEED,
      );
      function highBand(voice: EngineVoice): number {
        voice.setControl(ctrl(6000, 1));
        renderSeconds(voice, 0.5);
        return bandEnergy(fftPower(renderSeconds(voice, 1)), 8000, 20000);
      }
      expect(highBand(withStage) / highBand(without)).toBeLessThanOrEqual(0.5);
    },
    60000,
  );

  it('EDGE8: car JSONs change only sound.synth relative to the pinned content', () => {
    const files = readdirSync(CARS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();
    expect(files).toEqual(Object.keys(PINNED).sort());
    for (const file of files) {
      const j = JSON.parse(readFileSync(join(CARS_DIR, file), 'utf8')) as Record<string, unknown>;
      const sound = j['sound'] as Record<string, unknown> | undefined;
      if (sound && sound['synth']) delete sound['synth'];
      const hash = createHash('sha256').update(canon(j)).digest('hex');
      expect(hash, file).toBe(PINNED[file]);
    }
  });

  it(
    'EDGE9: render allocates nothing while pops fire',
    () => {
      const spec = tuned(carSpec('f4'), { crackle: 0.8 });
      const voice = new EngineVoice(spec, FS, SEED);
      voice.setControl(ctrl(6500, 1));
      renderSeconds(voice, 2);
      voice.setControl(ctrl(6000, 0, { throttle: 0 }));
      renderSeconds(voice, 0.08);
      const n = Math.round(2.12 * FS);
      const out = new Float32Array(n);
      const views: Float32Array[] = [];
      for (let i = 0; i < n; i += BLOCK) {
        views.push(out.subarray(i, i + Math.min(BLOCK, n - i)));
      }
      const before = popCount(voice);
      expect(typeof before).toBe('number');
      const constructions = countConstructions(() => {
        for (const v of views) voice.render(v);
      });
      expect(popCount(voice)).toBeGreaterThan(before);
      expect(constructions).toBe(0);
    },
    60000,
  );

  it('EDGE10: cylVar reaches the voice (cylVar 0 and 0.28 renders differ)', () => {
    const base = tuned(carSpec('f4'), {
      intakeMix: 0,
      block: [],
      turbo: null,
      whine: null,
      crackle: 0,
      jitterDeg: 0,
      jitterAmp: 0,
    });
    const zero = new EngineVoice(tuned(base, { cylVar: 0 }), FS, SEED);
    const varied = new EngineVoice(tuned(base, { cylVar: 0.28 }), FS, SEED);
    zero.setControl(ctrl(6000, 1));
    varied.setControl(ctrl(6000, 1));
    expect(renderSeconds(zero, 0.3)).not.toEqual(renderSeconds(varied, 0.3));
  }, 30000);
});
