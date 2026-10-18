import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineVoice, type VoiceControl } from '../../../src/audio/engineVoice';
import {
  legacySynthSpec,
  parseEngineSynth,
  type EngineSynthSpec,
  type TurboLayer,
} from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;
const BLOCK = 128;
const ROOT = join(__dirname, '..', '..', '..');
const LIFT = 2 * FS;
const BASE_TURBO: TurboLayer = { centerHz: 3000, spanHz: 3000, gain: 0.05, lagS: 0.4 };
const NONE_FIELDS = { valve: 'none', flutter: 0, wastegate: 0 } as const;

function baseSpec(cylinders: number, turbo: TurboLayer): EngineSynthSpec {
  const s = legacySynthSpec({ cylinders, exhaustLengthM: 1, intakeMix: 0, crackle: 0 });
  return {
    ...s,
    intakeMix: 0,
    block: [],
    turbo,
    whine: null,
    crackle: 0,
    lowpassHz: 20000,
    jitterDeg: 0,
    jitterAmp: 0,
  };
}

function ctrl(rpm: number, load: number, throttle: number): VoiceControl {
  return { rpm, load, throttle, wheelSpeedMs: 0, limiter: false };
}

function renderInto(voice: EngineVoice, out: Float32Array, from: number, to: number): void {
  for (let i = from; i < to; i += BLOCK) voice.render(out.subarray(i, Math.min(i + BLOCK, to)));
}

function liftRun(
  cyl: number,
  turbo: TurboLayer,
  from: number,
  after: number,
  rpm = 7000,
): Float32Array {
  const voice = new EngineVoice(baseSpec(cyl, turbo), FS, SEED);
  const out = new Float32Array(LIFT + Math.round(after * FS));
  for (let i = 0; i < LIFT; i += BLOCK) {
    voice.setControl(ctrl(rpm, from, from));
    renderInto(voice, out, i, i + BLOCK);
  }
  voice.setControl(ctrl(rpm, 0, 0));
  renderInto(voice, out, LIFT, out.length);
  return out;
}

function diffOf(a: Float32Array, b: Float32Array): Float64Array {
  const d = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) d[i] = a[i] - b[i];
  return d;
}

function lift(extra: Partial<TurboLayer>, from: number, after: number) {
  const out = liftRun(8, { ...BASE_TURBO, ...extra }, from, after);
  const base = liftRun(8, { ...BASE_TURBO, ...extra, ...NONE_FIELDS }, from, after);
  return { out, base, d: diffOf(out, base) };
}

function rms(x: ArrayLike<number>, t0: number, t1: number, origin = LIFT): number {
  const a = origin + Math.round(t0 * FS);
  const b = origin + Math.round(t1 * FS);
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
}

function energy(x: ArrayLike<number>, t0: number, t1: number): number {
  const n = Math.round((t1 - t0) * FS);
  return rms(x, t0, t1) ** 2 * n;
}

function maxAbs(x: ArrayLike<number>, fromIdx: number, toIdx: number): number {
  let m = 0;
  for (let i = fromIdx; i < toIdx; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}

function fftPower(x: ArrayLike<number>): { p: Float64Array; size: number } {
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
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
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
        const vr = re[i + k + half] * cr - im[i + k + half] * ci;
        const vi = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k + half] = re[i + k] - vr;
        im[i + k + half] = im[i + k] - vi;
        re[i + k] += vr;
        im[i + k] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const p = new Float64Array(size / 2);
  for (let k = 0; k < p.length; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return { p, size };
}

function centroid(x: ArrayLike<number>): number {
  const { p, size } = fftPower(x);
  let num = 0;
  let den = 0;
  for (let k = 1; k < p.length; k++) {
    num += p[k] * ((k * FS) / size);
    den += p[k];
  }
  return num / den;
}

function bandEnergy(x: ArrayLike<number>, lo: number, hi: number): number {
  const { p, size } = fftPower(x);
  let s = 0;
  for (let k = 0; k < p.length; k++) {
    const f = (k * FS) / size;
    if (f >= lo && f <= hi) s += p[k];
  }
  return s;
}

function slice(x: ArrayLike<number>, t0: number, t1: number): Float64Array {
  const a = LIFT + Math.round(t0 * FS);
  const b = LIFT + Math.round(t1 * FS);
  const out = new Float64Array(b - a);
  for (let i = 0; i < out.length; i++) out[i] = x[a + i];
  return out;
}

function peakTimes(d: ArrayLike<number>, t1: number): number[] {
  const w = Math.round(0.005 * FS);
  const n = Math.floor((t1 * FS) / w);
  const env: number[] = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < w; j++) s += d[LIFT + i * w + j] ** 2;
    env.push(Math.sqrt(s / w));
  }
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = env[i];
    if (v <= 1e-6) continue;
    if (i > 0 && env[i - 1] >= v) continue;
    if (i < n - 1 && env[i + 1] > v) continue;
    let leftMin = i === 0 ? 0 : Infinity;
    for (let j = i - 1; j >= 0 && env[j] <= v; j--) leftMin = Math.min(leftMin, env[j]);
    if (i > 0 && !Number.isFinite(leftMin)) continue;
    let rightMin = Infinity;
    for (let j = i + 1; j < n && env[j] <= v; j++) rightMin = Math.min(rightMin, env[j]);
    if (!Number.isFinite(rightMin)) rightMin = v;
    if (v >= 2 * leftMin && v >= 2 * rightMin) times.push((i * w) / FS);
  }
  return times;
}

function carTurbo(id: string): TurboLayer {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', `${id}.json`), 'utf8')) as {
    sound: Record<string, unknown>;
  };
  const sound = json.sound;
  const { spec } = parseEngineSynth(sound['synth'], {
    cylinders: sound['cylinders'] as number,
    exhaustLengthM: sound['exhaustLengthM'] as number,
    intakeMix: sound['intakeMix'] as number,
    crackle: sound['crackle'] as number,
  });
  return spec.turbo as TurboLayer;
}

const LEGACY = { cylinders: 8, exhaustLengthM: 1, intakeMix: 0.2, crackle: 0.3 };

function parseTurbo(extra: Record<string, unknown>) {
  return parseEngineSynth({ turbo: { ...BASE_TURBO, ...extra } }, LEGACY);
}

describe('239 turbo transients acceptance', () => {
  it('AT1: bov blow-off burst level and spectrum', () => {
    const { out, d } = lift({ valve: 'bov' }, 1, 1.6);
    const b = rms(out, -0.5, 0);
    const lvl = rms(d, 0.02, 0.35);
    expect(lvl).toBeGreaterThanOrEqual(b * Math.pow(10, -12 / 20));
    expect(lvl).toBeLessThanOrEqual(b * Math.pow(10, -1 / 20));
    const c = centroid(slice(d, 0.02, 0.35));
    expect(c).toBeGreaterThanOrEqual(3000);
    expect(c).toBeLessThanOrEqual(7000);
  });

  it('AT2: bov is silent after the burst', () => {
    const { out, d } = lift({ valve: 'bov' }, 1, 1.6);
    expect(rms(d, 1.2, 1.5)).toBeLessThan(0.01 * rms(out, -0.5, 0));
  });

  it('AT3: bov strength scales with boost at the lift', () => {
    const e = (from: number) => energy(lift({ valve: 'bov' }, from, 0.6).d, 0, 0.5);
    const e1 = e(1);
    const e04 = e(0.4);
    expect(10 * Math.log10(e1 / e04)).toBeGreaterThanOrEqual(6);
    const low = lift({ valve: 'bov' }, 0.2, 0.6).d;
    expect(maxAbs(low, 0, low.length)).toBeLessThan(1e-6);
  });

  it('AT4: bpv is lower and quieter than bov', () => {
    const bpv = lift({ valve: 'bpv' }, 1, 0.6).d;
    const bov = lift({ valve: 'bov' }, 1, 0.6).d;
    const c = centroid(slice(bpv, 0.02, 0.35));
    expect(c).toBeGreaterThanOrEqual(800);
    expect(c).toBeLessThanOrEqual(3000);
    expect(10 * Math.log10(energy(bov, 0.02, 0.35) / energy(bpv, 0.02, 0.35))).toBeGreaterThanOrEqual(10);
  });

  it('AT5: flutter 1 gives 6 to 8 pulses at 7-14 Hz', () => {
    const { d } = lift({ flutter: 1, valve: 'none' }, 1, 1.2);
    const t = peakTimes(d, 1);
    expect(t.length).toBeGreaterThanOrEqual(6);
    expect(t.length).toBeLessThanOrEqual(8);
    const mean = (t[t.length - 1] - t[0]) / (t.length - 1);
    expect(mean).toBeGreaterThanOrEqual(1 / 14);
    expect(mean).toBeLessThanOrEqual(1 / 7);
  });

  it('AT6: flutter 0.4 gives 2 to 4 pulses', () => {
    const { d } = lift({ flutter: 0.4 }, 1, 1.2);
    const n = peakTimes(d, 1).length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
  });

  it('AT7: wastegate only audible when external', () => {
    const internal = lift({ wastegate: 1, wastegateKind: 'internal' }, 1, 0.6);
    expect(maxAbs(internal.d, 0, internal.d.length)).toBeLessThan(1e-6);
    const ext = lift({ wastegate: 1, wastegateKind: 'external' }, 1, 0.6);
    const b = rms(ext.base, -0.5, 0);
    const held = rms(ext.d, -1, 0);
    expect(held).toBeGreaterThanOrEqual(b * Math.pow(10, -20 / 20));
    expect(held).toBeLessThanOrEqual(b * Math.pow(10, -6 / 20));
    expect(rms(ext.d, 0, 0.15)).toBeGreaterThanOrEqual(2 * held);
  });

  it('AT8: longer downLagS keeps more boost and 3-6 kHz energy during spool-down', () => {
    const run = (downLagS: number) => {
      const voice = new EngineVoice(baseSpec(8, { ...BASE_TURBO, ...NONE_FIELDS, downLagS }), FS, SEED);
      const out = new Float32Array(LIFT + Math.round(0.8 * FS));
      for (let i = 0; i < LIFT; i += BLOCK) {
        voice.setControl(ctrl(7000, 1, 1));
        renderInto(voice, out, i, i + BLOCK);
      }
      voice.setControl(ctrl(7000, 0, 0));
      const t07 = LIFT + Math.round(0.7 * FS);
      renderInto(voice, out, LIFT, t07);
      const boost = voice.boost;
      renderInto(voice, out, t07, out.length);
      return { boost, out };
    };
    const slow = run(1.2);
    const fast = run(0.3);
    expect(slow.boost).toBeGreaterThanOrEqual(3 * fast.boost);
    const eSlow = bandEnergy(slice(slow.out, 0.6, 0.8), 3000, 6000);
    const eFast = bandEnergy(slice(fast.out, 0.6, 0.8), 3000, 6000);
    expect(10 * Math.log10(eSlow / eFast)).toBeGreaterThanOrEqual(0.5);
  });

  it('AT9: explicit defaults are sample-identical to absent fields', () => {
    const a = liftRun(8, BASE_TURBO, 1, 1);
    const b = liftRun(
      8,
      { ...BASE_TURBO, ...NONE_FIELDS, wastegateKind: 'internal', downLagS: 0.4 },
      1,
      1,
    );
    expect(a.length).toBe(3 * FS);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('AT10: no triggers on a slow ramp-down', () => {
    const rampRun = (turbo: TurboLayer): Float32Array => {
      const voice = new EngineVoice(baseSpec(8, turbo), FS, SEED);
      const out = new Float32Array(LIFT + Math.round(1.5 * FS));
      voice.setControl(ctrl(7000, 1, 1));
      renderInto(voice, out, 0, LIFT);
      const step = Math.round(0.05 * FS);
      for (let k = 1; k <= 20; k++) {
        const v = 1 - k / 20;
        voice.setControl(ctrl(7000, v, v));
        renderInto(voice, out, LIFT + (k - 1) * step, LIFT + k * step);
      }
      renderInto(voice, out, LIFT + 20 * step, out.length);
      return out;
    };
    const t = { ...BASE_TURBO, valve: 'bov', flutter: 0.4, wastegate: 0.5, wastegateKind: 'external' } as const;
    const d = diffOf(rampRun(t), rampRun({ ...t, ...NONE_FIELDS }));
    expect(maxAbs(d, LIFT + Math.round(0.3 * FS), d.length)).toBeLessThan(1e-6);
  });

  it('AT11: extreme settings stay finite and within 0.9', () => {
    const turbo: TurboLayer = {
      ...BASE_TURBO,
      valve: 'bov',
      flutter: 1,
      wastegate: 1,
      wastegateKind: 'external',
    };
    const out = liftRun(6, turbo, 1, 1, 15000);
    expect(out.length).toBe(3 * FS);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
      expect(Math.abs(out[i])).toBeLessThanOrEqual(0.9);
    }
  });

  it('AT12: parser validates the five new turbo fields', () => {
    const bad: Record<string, unknown>[] = [
      { valve: 'x' },
      { flutter: 2 },
      { wastegate: -1 },
      { wastegateKind: 'y' },
      { downLagS: 9 },
    ];
    for (const extra of bad) {
      const { errors } = parseTurbo(extra);
      expect(errors.some((e) => e.includes('synth.turbo')), JSON.stringify(extra)).toBe(true);
    }
    const full = {
      valve: 'bov',
      flutter: 0.5,
      wastegate: 0.25,
      wastegateKind: 'external',
      downLagS: 0.8,
    };
    const ok = parseTurbo(full);
    expect(ok.errors).toEqual([]);
    expect(ok.spec.turbo).toMatchObject(full);
    const plain = parseTurbo({});
    expect(plain.errors).toEqual([]);
    for (const k of ['valve', 'flutter', 'wastegate', 'wastegateKind', 'downLagS']) {
      expect(plain.spec.turbo).not.toHaveProperty(k);
    }
  });

  it('AT13: car data carries the transient fields', () => {
    const f4 = carTurbo('f4');
    expect(f4.valve).toBe('bpv');
    expect(f4.flutter).toBe(0.4);
    const hyper = carTurbo('hyper-a');
    expect(hyper.valve).toBe('bpv');
    expect(hyper.flutter).toBe(0);
    expect(hyper.wastegate).toBe(0.3);
    expect(hyper.wastegateKind).toBe('internal');
    const ow = carTurbo('ow26');
    expect(ow.valve).toBe('bpv');
    expect(ow.flutter).toBe(0);
    expect(ow.wastegate).toBe(0.5);
    expect(ow.wastegateKind).toBe('external');
    for (const t of [f4, hyper, ow]) {
      expect(Math.abs((t.downLagS as number) - 1.5 * t.lagS)).toBeLessThan(1e-9);
    }
  });

  it(
    'AT14: 226, 227, 228 and 231 acceptance tests pass',
    () => {
      execSync(
        'npx vitest run tests/unit/acceptance/226-engine-sound-spec.test.ts tests/unit/acceptance/227-engine-voice-core.test.ts tests/unit/acceptance/228-engine-voice-layers.test.ts tests/unit/acceptance/231-car-synth-data.test.ts',
        { cwd: ROOT, stdio: 'pipe', timeout: 280000 },
      );
    },
    300000,
  );
});
