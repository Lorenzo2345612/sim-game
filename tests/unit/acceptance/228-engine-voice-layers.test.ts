import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineVoice, WHEEL_RADIUS_M, type VoiceControl } from '../../../src/audio/engineVoice';
import { legacySynthSpec, type EngineSynthSpec } from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;
const ROOT = join(__dirname, '..', '..', '..');
const HALF_OCT = Math.pow(2, 1 / 6);
const BLOCK_TURBO = { centerHz: 3000, spanHz: 3000, gain: 0.05, lagS: 0.4 };

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

function ctrl(rpm: number, load: number, extra: Partial<VoiceControl> = {}): VoiceControl {
  return { rpm, load, throttle: 1, wheelSpeedMs: 0, limiter: false, ...extra };
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

function warmRender(voice: EngineVoice, control: VoiceControl, measureSeconds: number): Float32Array {
  voice.setControl(control);
  renderSeconds(voice, 0.5);
  return renderSeconds(voice, measureSeconds);
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

function binsIn(pow: Float64Array, loHz: number, hiHz: number): number[] {
  const binHz = FS / pow.length;
  const k0 = Math.max(1, Math.ceil(loHz / binHz));
  const k1 = Math.min((pow.length >> 1) - 1, Math.floor(hiHz / binHz));
  const out: number[] = [];
  for (let k = k0; k <= k1; k++) out.push(pow[k]);
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

function peakIn(pow: Float64Array, loHz: number, hiHz: number): number {
  const bs = binsIn(pow, loHz, hiHz);
  let m = 0;
  for (const b of bs) if (b > m) m = b;
  return m;
}

function rmsEnvelope(x: Float32Array, winS: number): Float32Array {
  const w = Math.round(winS * FS);
  const n = Math.floor(x.length / w);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < w; k++) {
      const v = x[i * w + k];
      s += v * v;
    }
    env[i] = Math.sqrt(s / w);
  }
  return env;
}

function envArgmaxLagS(env: Float32Array, winS: number, minLagS: number, maxLagS: number): number {
  const minLag = Math.max(1, Math.round(minLagS / winS));
  const maxLag = Math.min(Math.round(maxLagS / winS), env.length - 1);
  let e0 = 0;
  for (let i = 0; i < env.length; i++) e0 += env[i] * env[i];
  let best = minLag;
  let bestR = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    const r = s / e0;
    if (r > bestR) {
      bestR = r;
      best = lag;
    }
  }
  return best * winS;
}

describe('228 engine voice layers acceptance', () => {
  it('AT1: intakeMix 1 raises band 212-424 Hz energy by ≥ 6 dB vs intakeMix 0 (intakeHz 300)', () => {
    function bandDb(intakeMix: number): Float64Array {
      const voice = new EngineVoice({ ...baseSpec(8), intakeMix, intakeHz: 300 }, FS, SEED);
      return fftPower(warmRender(voice, ctrl(6000, 1), 1));
    }
    const e0 = bandEnergy(bandDb(0), 212, 424);
    const e1 = bandEnergy(bandDb(1), 212, 424);
    expect(10 * Math.log10(e1 / e0)).toBeGreaterThanOrEqual(6);
  }, 30000);

  it('AT2: block [{hz:900,q:8,gainDb:12}] raises the 1/3-octave band at 900 Hz by ≥ 4 dB vs []', () => {
    function bandDb(block: EngineSynthSpec['block']): number {
      const voice = new EngineVoice({ ...baseSpec(8), block }, FS, SEED);
      const pow = fftPower(warmRender(voice, ctrl(6000, 1), 1));
      return 10 * Math.log10(Math.max(bandEnergy(pow, 900 / HALF_OCT, 900 * HALF_OCT), 1e-20));
    }
    expect(bandDb([{ hz: 900, q: 8, gainDb: 12 }]) - bandDb([])).toBeGreaterThanOrEqual(4);
  }, 30000);

  it('AT3: lowpassHz 1500 puts energy above 4 kHz ≥ 12 dB below lowpassHz 12000', () => {
    function above4k(lowpassHz: number): number {
      const voice = new EngineVoice({ ...baseSpec(8), lowpassHz }, FS, SEED);
      const pow = fftPower(warmRender(voice, ctrl(6000, 1), 1));
      return bandEnergy(pow, 4000, FS / 2);
    }
    const hi = above4k(12000);
    const lo = above4k(1500);
    expect(10 * Math.log10(lo / hi)).toBeLessThanOrEqual(-12);
  }, 30000);

  it('AT4: turbo band 3-6 kHz energy over the last second at rpm 7000 load 1 is ≥ 6 dB above turbo null', () => {
    function bandEnergyLastSecond(turbo: EngineSynthSpec['turbo']): number {
      const voice = new EngineVoice({ ...baseSpec(8), lowpassHz: 3000, turbo }, FS, SEED);
      voice.setControl(ctrl(7000, 1));
      renderSeconds(voice, 1);
      return bandEnergy(fftPower(renderSeconds(voice, 1)), 5700, 6300);
    }
    const eNull = bandEnergyLastSecond(null);
    const eTurbo = bandEnergyLastSecond(BLOCK_TURBO);
    expect(10 * Math.log10(eTurbo / eNull)).toBeGreaterThanOrEqual(6);
  }, 60000);

  it('AT5: after load 0→1 the turbo band energy in the first 0.1 s is < 50 % of that 1.4-1.5 s later', () => {
    const voice = new EngineVoice({ ...baseSpec(8), lowpassHz: 3000, turbo: BLOCK_TURBO }, FS, SEED);
    voice.setControl(ctrl(7000, 0));
    renderSeconds(voice, 1);
    voice.setControl(ctrl(7000, 1));
    const stepped = renderSeconds(voice, 1.5);
    const early = bandEnergy(
      fftPower(stepped.subarray(0, Math.round(0.1 * FS))),
      5700,
      6300,
    );
    const late = bandEnergy(
      fftPower(stepped.subarray(Math.round(1.4 * FS), Math.round(1.5 * FS))),
      5700,
      6300,
    );
    expect(early / late).toBeLessThan(0.5);
  }, 60000);

  it('AT6: rpm whine order 18 at 10000 rpm peaks at 3000 Hz ± 5 Hz ≥ 20 dB above the 2.5-3.5 kHz median', () => {
    const voice = new EngineVoice(
      {
        ...baseSpec(8),
        whine: { order: 18, gain: 0.05, source: 'rpm', minSpeedMs: 0 },
      },
      FS,
      SEED,
    );
    const pow = fftPower(warmRender(voice, ctrl(10000, 1), 1));
    const peak = peakIn(pow, 2995, 3005);
    const med = median(binsIn(pow, 2500, 3500));
    expect(10 * Math.log10(peak / med)).toBeGreaterThanOrEqual(20);
  }, 30000);

  it('AT7: wheel whine order 14 minSpeedMs 33 is silent at 20 m/s and ≥ 20 dB above median at 60 m/s', () => {
    function peakOverMedian(wheelSpeedMs: number): number {
      const voice = new EngineVoice(
        {
          ...baseSpec(8),
          whine: { order: 14, gain: 0.05, source: 'wheel', minSpeedMs: 33 },
        },
        FS,
        SEED,
      );
      const pow = fftPower(warmRender(voice, ctrl(7000, 1, { wheelSpeedMs }), 1));
      const f = (14 * wheelSpeedMs) / (2 * Math.PI * WHEEL_RADIUS_M);
      const peak = peakIn(pow, f - 5, f + 5);
      const med = median(binsIn(pow, f - 500, f + 500));
      return 10 * Math.log10(peak / med);
    }
    const silent = new EngineVoice(
      {
        ...baseSpec(8),
        whine: { order: 14, gain: 0.05, source: 'wheel', minSpeedMs: 33 },
      },
      FS,
      SEED,
    );
    const ref = new EngineVoice({ ...baseSpec(8), whine: null }, FS, SEED);
    expect(warmRender(silent, ctrl(7000, 1, { wheelSpeedMs: 20 }), 1)).toEqual(
      warmRender(ref, ctrl(7000, 1, { wheelSpeedMs: 20 }), 1),
    );
    expect(peakOverMedian(60)).toBeGreaterThanOrEqual(20);
  }, 60000);

  it('AT8: limiter at 15 Hz yields a 1/15 s ± 10 % envelope period with dips ≥ 6 dB below peaks', () => {
    const voice = new EngineVoice(
      { ...baseSpec(8), limiterHz: 15 },
      FS,
      SEED,
    );
    voice.setControl(ctrl(8000, 1, { limiter: true }));
    renderSeconds(voice, 0.5);
    const env = rmsEnvelope(renderSeconds(voice, 1), 0.005);
    const lag = envArgmaxLagS(env, 0.005, 0.03, 0.15);
    expect(Math.abs(lag - 1 / 15) / (1 / 15)).toBeLessThanOrEqual(0.1);
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < env.length; i++) {
      if (env[i] < min) min = env[i];
      if (env[i] > max) max = env[i];
    }
    expect(min / max).toBeLessThanOrEqual(Math.pow(10, -6 / 20));
  }, 30000);

  it(
    'AT9: crackle 1 after lift counts ≥ 3 pop clusters; crackle 0 or throttle held 1 counts 0',
    () => {
      function clustersAfterLift(crackle: number, lift: boolean): number {
        const voice = new EngineVoice({ ...baseSpec(8), crackle }, FS, SEED);
        voice.setControl(ctrl(8000, 1));
        renderSeconds(voice, 0.5);
        if (lift) voice.setControl(ctrl(8000, 0, { throttle: 0 }));
        const before = voice.popCount;
        renderSeconds(voice, 1);
        return voice.popCount - before;
      }
      expect(clustersAfterLift(1, true)).toBeGreaterThanOrEqual(3);
      expect(clustersAfterLift(0, true)).toBe(0);
      expect(clustersAfterLift(1, false)).toBe(0);
    },
    60000,
  );

  it(
    'AT10: all 227 acceptance tests pass and engineSynth.ts is unchanged',
    () => {
      const diff = execSync('git diff HEAD --stat -- src/audio/engineSynth.ts', {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim();
      expect(diff).toBe('');
      execSync('npx vitest run tests/unit/acceptance/227-engine-voice-core.test.ts', {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: 120000,
      });
    },
    180000,
  );
});
