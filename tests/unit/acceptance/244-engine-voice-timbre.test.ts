import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as voiceNs from '../../../src/audio/engineVoice';
import { EngineVoice, type VoiceControl } from '../../../src/audio/engineVoice';
import { parseEngineSynth, type EngineSynthSpec } from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;
const BLOCK = 128;
const LIFT_BLOCK = Math.round((2 * FS) / BLOCK);
const ROOT = join(__dirname, '..', '..', '..');
const CARS_DIR = join(ROOT, 'public', 'cars');
const PULSE_KERNEL = (voiceNs as unknown as { PULSE_KERNEL: Float64Array }).PULSE_KERNEL;
const SCRATCH = new Float32Array(BLOCK);

type Spec244 = EngineSynthSpec & { cylVar: number; bassDb: number; exhaustGain: number };

const MASTER: Record<string, { pipeM: [number, number]; tailM: number }> = {
  f4: { pipeM: [0.5, 0.5], tailM: 0.5 },
  'gt3-a': { pipeM: [0.7, 0.7], tailM: 0.7 },
  'gt3-b': { pipeM: [0.55, 0.65], tailM: 0.55 },
  'gt3-c': { pipeM: [0.75, 0.75], tailM: 0.75 },
  'gt3-d': { pipeM: [0.55, 0.55], tailM: 0.55 },
  'lmp2-a': { pipeM: [0.55, 0.55], tailM: 0.6 },
  'hyper-a': { pipeM: [0.8, 0.8], tailM: 1.2 },
  ow26: { pipeM: [0.5, 0.5], tailM: 0.6 },
};

const DRIVE: Record<string, number> = {
  f4: 1.4,
  'hyper-a': 1.4,
  ow26: 1.4,
  'gt3-a': 2,
  'gt3-b': 2,
  'gt3-c': 2,
  'gt3-d': 2,
  'lmp2-a': 2,
};

const EXHAUST_GAIN: Record<string, number> = { f4: 0.8, 'hyper-a': 0.6, ow26: 0.6 };

const CRACKLE: Record<string, number> = {
  f4: 0.8,
  'gt3-a': 0.8,
  'gt3-b': 0.8,
  'gt3-c': 0.8,
  'gt3-d': 0.8,
  'lmp2-a': 0.8,
  'hyper-a': 0.25,
  ow26: 0.2,
};

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

function popCount(voice: EngineVoice): number {
  return (voice as unknown as { popCount: number }).popCount;
}

function renderSeconds(voice: EngineVoice, seconds: number): Float32Array {
  const n = Math.round(seconds * FS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += BLOCK) {
    const len = Math.min(BLOCK, n - i);
    voice.render(out.subarray(i, i + len));
  }
  return out;
}

function warmRender(voice: EngineVoice, control: VoiceControl, measureSeconds: number): Float32Array {
  voice.setControl(control);
  renderSeconds(voice, 0.5);
  return renderSeconds(voice, measureSeconds);
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
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

function overrunPops(spec: EngineSynthSpec, lift: VoiceControl): { rel: number[]; total: number } {
  const voice = new EngineVoice(spec, FS, SEED);
  const rel: number[] = [];
  let prev = 0;
  voice.setControl(ctrl(6500, 1));
  const n1 = Math.round(2 * FS);
  for (let i = 0; i < n1; i += BLOCK) {
    const len = Math.min(BLOCK, n1 - i);
    voice.render(SCRATCH.subarray(0, len));
    const c = popCount(voice);
    if (c > prev) rel.push(Math.floor(i / BLOCK) - LIFT_BLOCK);
    prev = c;
  }
  voice.setControl(lift);
  const n2 = Math.round(3 * FS);
  for (let i = 0; i < n2; i += BLOCK) {
    const len = Math.min(BLOCK, n2 - i);
    voice.render(SCRATCH.subarray(0, len));
    const c = popCount(voice);
    if (c > prev) rel.push(Math.floor(i / BLOCK));
    prev = c;
  }
  return { rel, total: popCount(voice) };
}

describe('244 engine voice timbre acceptance', () => {
  it('AT1: PULSE_KERNEL peaks at 0.035-0.045 of KERNEL_N, is ~0 at KERNEL_N and non-increasing after the peak', () => {
    const k = PULSE_KERNEL;
    const kn = k.length - 2;
    let argmax = 0;
    for (let i = 1; i <= kn; i++) if (k[i] > k[argmax]) argmax = i;
    expect(argmax / kn).toBeGreaterThanOrEqual(0.035);
    expect(argmax / kn).toBeLessThanOrEqual(0.045);
    expect(k[kn]).toBeLessThanOrEqual(1e-9);
    let violations = 0;
    for (let i = argmax + 1; i <= kn; i++) if (k[i] > k[i - 1]) violations++;
    expect(violations).toBe(0);
  });

  it(
    'AT2: f4 and gt3-c RMS across 3000-7000 rpm (250 steps) has max/min <= 1.6',
    () => {
      const rpms: number[] = [];
      for (let r = 3000; r <= 7000; r += 250) rpms.push(r);
      for (const id of ['f4', 'gt3-c']) {
        const spec = tuned(carSpec(id), { jitterDeg: 0, jitterAmp: 0 });
        let max = 0;
        let min = Infinity;
        for (const rpm of rpms) {
          const voice = new EngineVoice(spec, FS, SEED);
          voice.setControl(ctrl(rpm, 1));
          const x = renderSeconds(voice, 0.8);
          const r = rms(x.subarray(Math.round(0.3 * FS)));
          if (r > max) max = r;
          if (r < min) min = r;
        }
        expect(max / min, id).toBeLessThanOrEqual(1.6);
      }
    },
    60000,
  );

  it(
    'AT3: orders 0.5, 1, 1.5 at 3000 rpm sum to >= -20 dB vs the firing order for f4 and gt3-c',
    () => {
      const revHz = 3000 / 60;
      for (const id of ['f4', 'gt3-c']) {
        const spec = tuned(carSpec(id), { jitterDeg: 0, jitterAmp: 0, cylVar: 0.28 });
        const voice = new EngineVoice(spec, FS, SEED);
        voice.setControl(ctrl(3000, 1));
        const x = renderSeconds(voice, 1.3);
        const pow = fftPower(x.subarray(Math.round(0.3 * FS)));
        let sub = 0;
        for (const o of [0.5, 1, 1.5]) sub += bandEnergy(pow, o * revHz - 3, o * revHz + 3);
        const fireOrder = carSpec(id).firingDeg.length / 2;
        const fire = bandEnergy(pow, fireOrder * revHz - 3, fireOrder * revHz + 3);
        expect(10 * Math.log10(sub / fire), id).toBeGreaterThanOrEqual(-20);
      }
    },
    60000,
  );

  it(
    'AT4: exhaustGain 0.6 vs 1.0 at 6000 rpm gives an RMS ratio in [0.5, 0.72]',
    () => {
      const base = tuned(carSpec('f4'), { turbo: null, drive: 0.5 });
      const low = new EngineVoice(tuned(base, { exhaustGain: 0.6 }), FS, SEED);
      const high = new EngineVoice(tuned(base, { exhaustGain: 1.0 }), FS, SEED);
      const ratio =
        rms(warmRender(low, ctrl(6000, 1), 1)) / rms(warmRender(high, ctrl(6000, 1), 1));
      expect(ratio).toBeGreaterThanOrEqual(0.5);
      expect(ratio).toBeLessThanOrEqual(0.72);
    },
    30000,
  );

  it(
    'AT5: bassDb 8 vs 0 at 4000 rpm raises energy below 250 Hz by >= 5 dB and changes above 1 kHz by <= 1.5 dB',
    () => {
      function spectrum(bassDb: number): Float64Array {
        const voice = new EngineVoice(tuned(carSpec('gt3-a'), { bassDb }), FS, SEED);
        return fftPower(warmRender(voice, ctrl(4000, 1), 1));
      }
      const on = spectrum(8);
      const off = spectrum(0);
      expect(10 * Math.log10(bandEnergy(on, 0, 250) / bandEnergy(off, 0, 250))).toBeGreaterThanOrEqual(5);
      expect(
        Math.abs(10 * Math.log10(bandEnergy(on, 1000, 24000) / bandEnergy(off, 1000, 24000))),
      ).toBeLessThanOrEqual(1.5);
    },
    30000,
  );

  it(
    'AT6: crackle 0.8 pops only in 0.08-2.2 s after the lift, >= 3 of them, >= 25 ms apart; guarded variants give 0',
    () => {
      const spec = tuned(carSpec('f4'), { crackle: 0.8 });
      const main = overrunPops(spec, ctrl(6000, 0, { throttle: 0 }));
      const inWindow = main.rel.filter((r) => r >= 30 && r <= 825);
      expect(inWindow.length).toBeGreaterThanOrEqual(3);
      expect(main.rel.length).toBe(inWindow.length);
      for (let i = 1; i < main.rel.length; i++) {
        expect(((main.rel[i] - main.rel[i - 1]) * BLOCK) / FS).toBeGreaterThanOrEqual(0.025);
      }
      expect(overrunPops(tuned(spec, { crackle: 0 }), ctrl(6000, 0, { throttle: 0 })).total).toBe(0);
      expect(overrunPops(spec, ctrl(6000, 0, { throttle: 1 })).total).toBe(0);
      expect(overrunPops(spec, ctrl(3000, 0, { throttle: 0 })).total).toBe(0);
    },
    60000,
  );

  it(
    'AT7: reset() and a same-seed fresh voice both reproduce a 1 s mixed-control render bit-identically',
    () => {
      const spec = tuned(carSpec('f4'), { crackle: 0.8 });
      const segs: Array<{ s: number; c: VoiceControl }> = [
        { s: 0.25, c: ctrl(6500, 1) },
        { s: 0.45, c: ctrl(6500, 0, { throttle: 0, wheelSpeedMs: 30 }) },
        { s: 0.15, c: ctrl(3500, 0.4, { throttle: 0.5, wheelSpeedMs: 15 }) },
        { s: 0.15, c: ctrl(9000, 1, { wheelSpeedMs: 60, limiter: true }) },
      ];
      function renderSchedule(voice: EngineVoice): Float32Array {
        const out = new Float32Array(FS);
        let off = 0;
        for (const seg of segs) {
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
      const first = new EngineVoice(spec, FS, SEED);
      const a = renderSchedule(first);
      first.reset();
      expect(renderSchedule(first)).toEqual(a);
      const second = new EngineVoice(spec, FS, SEED);
      expect(renderSchedule(second)).toEqual(a);
    },
    30000,
  );

  it('AT8: car synth data matches the master baseline scaled by the v2.1 data list', () => {
    const files = readdirSync(CARS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
    expect(files.length).toBe(Object.keys(MASTER).length);
    for (const file of files) {
      const id = file.replace(/\.json$/, '');
      const master = MASTER[id];
      expect(master, id).toBeDefined();
      const spec = carSpec(id) as Spec244;
      for (let i = 0; i < 2; i++) {
        expect(Math.abs(spec.pipeM[i] - Math.min(1.5 * master.pipeM[i], 5)), `${id} pipeM[${i}]`).toBeLessThanOrEqual(1e-9);
      }
      expect(Math.abs(spec.tailM - Math.min(1.5 * master.tailM, 5)), `${id} tailM`).toBeLessThanOrEqual(1e-9);
      expect(spec.drive, `${id} drive`).toBe(DRIVE[id]);
      expect(spec.exhaustGain, `${id} exhaustGain`).toBe(EXHAUST_GAIN[id] ?? 1);
      expect(spec.crackle, `${id} crackle`).toBe(CRACKLE[id]);
      if (id === 'gt3-d') {
        expect(spec.firingDeg).toEqual([0, 72, 144, 216, 288, 360, 432, 504, 576, 648]);
      }
      if (id === 'ow26') {
        expect(spec.firingDeg).toEqual([0, 90, 240, 330, 480, 570]);
      }
    }
  });

  it('AT9: parseEngineSynth reports one error per invalid cylVar/bassDb/exhaustGain and defaults when absent', () => {
    const legacy = { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 };
    const bad = parseEngineSynth({ cylVar: 0.6, bassDb: -1, exhaustGain: 0 }, legacy);
    expect(bad.errors.length).toBe(3);
    expect(bad.errors.filter((e) => e.includes('synth.cylVar')).length).toBe(1);
    expect(bad.errors.filter((e) => e.includes('synth.bassDb')).length).toBe(1);
    expect(bad.errors.filter((e) => e.includes('synth.exhaustGain')).length).toBe(1);
    const good = parseEngineSynth({}, legacy);
    expect(good.errors).toEqual([]);
    const spec = good.spec as Spec244;
    expect(spec.cylVar).toBe(0.28);
    expect(spec.bassDb).toBe(8);
    expect(spec.exhaustGain).toBe(1);
  });
});
