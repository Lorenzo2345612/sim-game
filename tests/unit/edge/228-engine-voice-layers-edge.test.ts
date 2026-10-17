import { describe, expect, it } from 'vitest';
import { EngineVoice, type VoiceControl } from '../../../src/audio/engineVoice';
import { legacySynthSpec, type EngineSynthSpec } from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;

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

function bandEnergy(pow: Float64Array, loHz: number, hiHz: number): number {
  const binHz = FS / pow.length;
  const k0 = Math.max(1, Math.ceil(loHz / binHz));
  const k1 = Math.min((pow.length >> 1) - 1, Math.floor(hiHz / binHz));
  let e = 0;
  for (let k = k0; k <= k1; k++) e += pow[k];
  return e;
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

function countClusters(x: Float32Array): number {
  const win = Math.round(0.05 * FS);
  const minGap = Math.round(0.002 * FS);
  let sum = 0;
  let clusters = 0;
  let lastEnd = -minGap - 1;
  for (let i = 0; i < x.length; i++) {
    sum += x[i] * x[i];
    if (i >= win) sum -= x[i - win] * x[i - win];
    const r = Math.sqrt(sum / Math.min(i + 1, win));
    if (Math.abs(x[i]) > 3 * r) {
      if (i - lastEnd >= minGap) clusters++;
      lastEnd = i;
    }
  }
  return clusters;
}

describe('228 engine voice layers edge', () => {
  it('EDGE1: with every layer empty, throttle and wheelSpeedMs are ignored', () => {
    const spec = baseSpec(8);
    const a = new EngineVoice(spec, FS, SEED);
    const b = new EngineVoice(spec, FS, SEED);
    a.setControl(ctrl(6000, 1, { throttle: 1, wheelSpeedMs: 0 }));
    b.setControl(ctrl(6000, 1, { throttle: 0, wheelSpeedMs: 50 }));
    renderSeconds(a, 0.15);
    renderSeconds(b, 0.15);
    a.setControl(ctrl(6000, 1, { throttle: 1, wheelSpeedMs: 0 }));
    b.setControl(ctrl(6000, 1, { throttle: 0.5, wheelSpeedMs: -5 }));
    expect(renderSeconds(a, 0.15)).toEqual(renderSeconds(b, 0.15));
  });

  it('EDGE2: intake level depends only on the product intakeMix·throttle', () => {
    const a = new EngineVoice({ ...baseSpec(8), intakeMix: 1 }, FS, SEED);
    const b = new EngineVoice({ ...baseSpec(8), intakeMix: 0.5 }, FS, SEED);
    a.setControl(ctrl(6000, 1, { throttle: 0.5 }));
    b.setControl(ctrl(6000, 1, { throttle: 1 }));
    renderSeconds(a, 0.15);
    renderSeconds(b, 0.15);
    expect(renderSeconds(a, 0.3)).toEqual(renderSeconds(b, 0.3));
  });

  it('EDGE3: zero-gain turbo and whine add nothing (bit-identical to null)', () => {
    const a = new EngineVoice(
      {
        ...baseSpec(8),
        turbo: { centerHz: 3000, spanHz: 3000, gain: 0, lagS: 0.4 },
        whine: { order: 18, gain: 0, source: 'rpm', minSpeedMs: 0 },
      },
      FS,
      SEED,
    );
    const b = new EngineVoice(baseSpec(8), FS, SEED);
    a.setControl(ctrl(7000, 1));
    b.setControl(ctrl(7000, 1));
    expect(renderSeconds(a, 0.3)).toEqual(renderSeconds(b, 0.3));
  });

  it('EDGE4: with limiter false, limiterHz does not affect the output', () => {
    const a = new EngineVoice({ ...baseSpec(8), limiterHz: 5 }, FS, SEED);
    const b = new EngineVoice({ ...baseSpec(8), limiterHz: 40 }, FS, SEED);
    a.setControl(ctrl(8000, 1, { limiter: false }));
    b.setControl(ctrl(8000, 1, { limiter: false }));
    expect(renderSeconds(a, 0.3)).toEqual(renderSeconds(b, 0.3));
  });

  it('EDGE5: limiter cut never silences the output (tubes keep ringing)', () => {
    const voice = new EngineVoice({ ...baseSpec(8), limiterHz: 15 }, FS, SEED);
    voice.setControl(ctrl(8000, 1, { limiter: true }));
    renderSeconds(voice, 0.5);
    const env = rmsEnvelope(renderSeconds(voice, 1), 0.005);
    let min = Infinity;
    for (let i = 0; i < env.length; i++) if (env[i] < min) min = env[i];
    expect(min).toBeGreaterThan(0);
  });

  it('EDGE6: crackle pops stop after 1 s from the lift', () => {
    const voice = new EngineVoice({ ...baseSpec(8), crackle: 1 }, FS, SEED);
    voice.setControl(ctrl(8000, 1));
    renderSeconds(voice, 0.5);
    voice.setControl(ctrl(8000, 0, { throttle: 0 }));
    const x = renderSeconds(voice, 2);
    expect(countClusters(x.subarray(Math.round(1.2 * FS), Math.round(2 * FS)))).toBe(0);
  });

  it('EDGE7: crackle does not arm at rpm ≤ 4000', () => {
    const voice = new EngineVoice({ ...baseSpec(8), crackle: 1 }, FS, SEED);
    voice.setControl(ctrl(4000, 1));
    renderSeconds(voice, 0.5);
    voice.setControl(ctrl(4000, 0, { throttle: 0 }));
    expect(countClusters(renderSeconds(voice, 1))).toBe(0);
  });

  it('EDGE8: crackle never fires while throttle ≥ 0.05', () => {
    const voice = new EngineVoice({ ...baseSpec(8), crackle: 1 }, FS, SEED);
    voice.setControl(ctrl(8000, 1));
    renderSeconds(voice, 0.5);
    voice.setControl(ctrl(8000, 0, { throttle: 0.05 }));
    expect(countClusters(renderSeconds(voice, 1))).toBe(0);
  });

  it('EDGE9: wheel whine is silent below minSpeedMs (negative → 0) and audible at exactly minSpeedMs', () => {
    function renderWheel(wheelSpeedMs: number): Float32Array {
      const voice = new EngineVoice(
        { ...baseSpec(8), whine: { order: 14, gain: 0.05, source: 'wheel', minSpeedMs: 33 } },
        FS,
        SEED,
      );
      return warmRender(voice, ctrl(7000, 1, { wheelSpeedMs }), 0.3);
    }
    const ref = warmRender(new EngineVoice(baseSpec(8), FS, SEED), ctrl(7000, 1), 0.3);
    expect(renderWheel(32)).toEqual(ref);
    expect(renderWheel(-10)).toEqual(ref);
    expect(maxAbsDiff(renderWheel(33), ref)).toBeGreaterThan(0);
  });

  it('EDGE10: turbo with lagS 0 tracks the load step without lag', () => {
    const voice = new EngineVoice(
      { ...baseSpec(8), turbo: { centerHz: 3000, spanHz: 3000, gain: 0.05, lagS: 0 } },
      FS,
      SEED,
    );
    voice.setControl(ctrl(7000, 0));
    renderSeconds(voice, 1);
    voice.setControl(ctrl(7000, 1));
    const stepped = renderSeconds(voice, 1.5);
    const early = bandEnergy(
      fftPower(stepped.subarray(0, Math.round(0.1 * FS))),
      3000,
      6000,
    );
    const late = bandEnergy(
      fftPower(stepped.subarray(Math.round(1.4 * FS), Math.round(1.5 * FS))),
      3000,
      6000,
    );
    expect(early / late).toBeGreaterThanOrEqual(0.25);
  }, 60000);
});
