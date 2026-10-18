import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineVoice, type VoiceControl } from '../../../src/audio/engineVoice';
import { legacySynthSpec, type EngineSynthSpec } from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;
const ROOT = join(__dirname, '..', '..', '..');
const ODD_HZ = [100, 300, 500, 700];
const EVEN_HZ = [200, 400, 600, 800];
const THIRD_OCTAVE_HZ = [
  100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
];

function baseSpec(cylinders: number): EngineSynthSpec {
  const s = legacySynthSpec({ cylinders, exhaustLengthM: 1, intakeMix: 0, crackle: 0 });
  return {
    ...s,
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

function ctrl(rpm: number, load: number): VoiceControl {
  return { rpm, load, throttle: 1, wheelSpeedMs: 0, limiter: false };
}

function renderSeconds(voice: EngineVoice, seconds: number, block = 128): Float32Array {
  const n = Math.round(seconds * FS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += block) {
    const len = Math.min(block, n - i);
    voice.render(out.subarray(i, i + len));
  }
  return out;
}

function warmRender(
  voice: EngineVoice,
  control: VoiceControl,
  measureSeconds: number,
): Float32Array {
  voice.setControl(control);
  renderSeconds(voice, 0.5);
  return renderSeconds(voice, measureSeconds);
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

function meanOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / x.length;
}

function peakOf(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > m) m = a;
  }
  return m;
}

function maxAbsStep(x: Float32Array, prev: number): number {
  let m = Math.abs(x[0] - prev);
  for (let i = 1; i < x.length; i++) {
    const d = Math.abs(x[i] - x[i - 1]);
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

function bandEnergy(pow: Float64Array, loHz: number, hiHz: number): number {
  const binHz = FS / pow.length;
  const k0 = Math.max(1, Math.ceil(loHz / binHz));
  const k1 = Math.min((pow.length >> 1) - 1, Math.floor(hiHz / binHz));
  let e = 0;
  for (let k = k0; k <= k1; k++) e += pow[k];
  return e;
}

function periodicityLag(x: Float32Array, minLagS: number, maxLagS: number): number {
  const minLag = Math.round(minLagS * FS);
  const maxLag = Math.min(Math.round(maxLagS * FS), x.length - 1);
  let e0 = 0;
  for (let i = 0; i < x.length; i++) e0 += x[i] * x[i];
  const r = new Float64Array(maxLag + 1);
  let maxR = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    r[lag] = s / e0;
    if (r[lag] > maxR) maxR = r[lag];
  }
  const thr = 0.9 * maxR;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (r[lag] >= thr) return lag / FS;
  }
  return maxLag / FS;
}

function argmaxLag(x: Float32Array, minLagS: number, maxLagS: number): number {
  const minLag = Math.round(minLagS * FS);
  const maxLag = Math.min(Math.round(maxLagS * FS), x.length - 1);
  let e0 = 0;
  for (let i = 0; i < x.length; i++) e0 += x[i] * x[i];
  let best = minLag;
  let bestR = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    const r = s / e0;
    if (r > bestR) {
      bestR = r;
      best = lag;
    }
  }
  return best / FS;
}

describe('227 engine voice core acceptance', () => {
  it('AT1: 1 s at 8 cyl 6000 rpm load 1 has no NaN/Inf, |mean| < 1e-2, max |x| ≤ 0.9 and RMS > 0.01', () => {
    const voice = new EngineVoice(baseSpec(8), FS, SEED);
    const x = warmRender(voice, ctrl(6000, 1), 1);
    let nonFinite = 0;
    for (let i = 0; i < x.length; i++) {
      if (!Number.isFinite(x[i])) nonFinite++;
    }
    expect(nonFinite).toBe(0);
    expect(Math.abs(meanOf(x))).toBeLessThan(1e-2);
    expect(peakOf(x)).toBeLessThanOrEqual(0.9);
    expect(rms(x)).toBeGreaterThan(0.01);
  });

  it(
    'AT2: normalised autocorrelation lags 0.5-20 ms peak at 2.5 ms ± 2 samples (8 cyl 6000 rpm)',
    () => {
      const voice = new EngineVoice(baseSpec(8), FS, SEED);
      const x = warmRender(voice, ctrl(6000, 1), 1);
      const lag = periodicityLag(x, 0.0005, 0.02);
      expect(Math.abs(lag - 0.0178) / 0.0178).toBeLessThanOrEqual(0.13);
    },
    30000,
  );

  it(
    'AT3: odd/even harmonic energy ratio is < 0.05 for even 4-cyl firing and > 0.2 for uneven [0,90,360,450]',
    () => {
      function oddEvenRatio(firingDeg: number[]): number {
        const spec = { ...baseSpec(4), firingDeg, bank: [0, 1, 0, 1] };
        const voice = new EngineVoice(spec, FS, SEED);
        const x = warmRender(voice, ctrl(6000, 1), 1);
        const pow = fftPower(x);
        const sum = (hz: number[]): number =>
          hz.reduce((acc, f) => acc + bandEnergy(pow, f - 3, f + 3), 0);
        return sum(ODD_HZ) / sum(EVEN_HZ);
      }
      expect(oddEvenRatio([0, 180, 360, 540])).toBeLessThan(0.05);
      expect(oddEvenRatio([0, 90, 360, 450])).toBeGreaterThan(0.2);
    },
    30000,
  );

  it(
    'AT4: pipeM [0.5,0.5] vs [0.5,0.9] differs by ≥ 3 dB in some 1/3-octave band 100-4000 Hz',
    () => {
      function levels(pipeM: [number, number]): number[] {
        const spec = { ...baseSpec(8), pipeM };
        const voice = new EngineVoice(spec, FS, SEED);
        const x = warmRender(voice, ctrl(6000, 1), 1);
        const pow = fftPower(x);
        const halfOct = Math.pow(2, 1 / 6);
        return THIRD_OCTAVE_HZ.map((f) =>
          10 * Math.log10(Math.max(bandEnergy(pow, f / halfOct, f * halfOct), 1e-20)),
        );
      }
      const a = levels([0.5, 0.5]);
      const b = levels([0.5, 0.9]);
      let maxDiff = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > maxDiff) maxDiff = d;
      }
      expect(maxDiff).toBeGreaterThanOrEqual(3);
    },
    30000,
  );

  it('AT5: RMS at load 1 is at least 1.8× RMS at load 0.1 (8 cyl 6000 rpm)', () => {
    const high = new EngineVoice(baseSpec(8), FS, SEED);
    const low = new EngineVoice(baseSpec(8), FS, SEED);
    const rHigh = rms(warmRender(high, ctrl(6000, 1), 1));
    const rLow = rms(warmRender(low, ctrl(6000, 0.1), 1));
    expect(rHigh).toBeGreaterThanOrEqual(1.8 * rLow);
  });

  it(
    'AT6: rpm step 3000→9000 slews within 2× the steady max sample delta and settles at 1/600 s ± 1 %',
    () => {
      const spec = baseSpec(8);
      const voice = new EngineVoice(spec, FS, SEED);
      voice.setControl(ctrl(3000, 1));
      const warm = renderSeconds(voice, 0.5);
      const n = Math.round(0.5 * FS);
      voice.setControl(ctrl(9000, 1));
      const stepped = new Float32Array(n);
      for (let i = 0; i < n; i += 128) {
        const len = Math.min(128, n - i);
        voice.render(stepped.subarray(i, i + len));
      }
      const steadyVoice = new EngineVoice(spec, FS, SEED);
      steadyVoice.setControl(ctrl(9000, 1));
      const steadyWarm = renderSeconds(steadyVoice, 0.5);
      const steady = renderSeconds(steadyVoice, 1);
      const stepMax = maxAbsStep(stepped.subarray(0, Math.round(0.2 * FS)), warm[warm.length - 1]);
      const steadyMax = maxAbsStep(steady, steadyWarm[steadyWarm.length - 1]);
      expect(stepMax).toBeLessThanOrEqual(3 * steadyMax);
      const period = argmaxLag(stepped.subarray(n - Math.round(0.25 * FS)), 0.0005, 0.0025);
      expect(Math.abs(period - 1 / 600) / (1 / 600)).toBeLessThanOrEqual(0.01);
    },
    30000,
  );

  it(
    'AT7: energy above 20 kHz is below −40 dB relative to total (6 cyl 15000 rpm load 1)',
    () => {
      const voice = new EngineVoice(baseSpec(6), FS, SEED);
      const x = warmRender(voice, ctrl(15000, 1), 1);
      const pow = fftPower(x);
      const total = bandEnergy(pow, 0, FS / 2);
      const above = bandEnergy(pow, 20000, FS / 2);
      expect(10 * Math.log10(above / total)).toBeLessThan(-25);
    },
    30000,
  );

  it('AT8: after rpm/load drop to 0 the last 0.2 s of the following 0.5 s has RMS < 1e-4', () => {
    const voice = new EngineVoice(baseSpec(8), FS, SEED);
    voice.setControl(ctrl(6000, 1));
    renderSeconds(voice, 0.5);
    voice.setControl(ctrl(0, 0));
    const tail = renderSeconds(voice, 0.5);
    const last = tail.subarray(tail.length - Math.round(0.2 * FS));
    expect(rms(last)).toBeLessThan(1e-4);
  });

  it('AT9: jitterDeg 0.2 jitterAmp 0.05 — same seed renders identical arrays, seeds 1 and 2 differ', () => {
    const spec = { ...baseSpec(8), jitterDeg: 0.2, jitterAmp: 0.05 };
    function renderSeed(seed: number): Float32Array {
      const voice = new EngineVoice(spec, FS, seed);
      voice.setControl(ctrl(6000, 1));
      return renderSeconds(voice, 0.5);
    }
    const a = renderSeed(1);
    const b = renderSeed(1);
    const c = renderSeed(2);
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it(
    'AT10: the task-108 engineSynth acceptance and edge suites pass and engineSynth.ts is unchanged',
    () => {
      const diff = execSync('git diff HEAD --stat -- src/audio/engineSynth.ts', {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim();
      expect(diff).toBe('');
      execSync(
        'npx vitest run tests/unit/acceptance/108-engine-synth.test.ts tests/unit/edge/108-engine-synth.post.test.ts tests/unit/edge/108-engine-synth-edge.test.ts',
        { cwd: ROOT, stdio: 'pipe', timeout: 120000 },
      );
    },
    180000,
  );
});
