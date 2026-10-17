import { describe, expect, it } from 'vitest';
import {
  EngineVoice,
  LOAD_SLEW_S,
  RPM_SLEW_S,
  WHEEL_RADIUS_M,
  type VoiceControl,
} from '../../../src/audio/engineVoice';
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

function ctrl(rpm: number, load: number): VoiceControl {
  return { rpm, load, throttle: 1, wheelSpeedMs: 0, limiter: false };
}

function renderSeconds(voice: EngineVoice, seconds: number, block = 128): Float32Array {
  const n = Math.round(seconds * FS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += block) {
    voice.render(out.subarray(i, i + Math.min(block, n - i)));
  }
  return out;
}

function power(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
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

function steadyRender(spec: EngineSynthSpec, rpm: number, load: number): Float32Array {
  const voice = new EngineVoice(spec, FS, SEED);
  voice.setControl(ctrl(rpm, load));
  renderSeconds(voice, 0.5);
  return renderSeconds(voice, 0.25);
}

describe('227 engine voice core post-code gaps', () => {
  it('POST1: constructor throws for non-finite sampleRate', () => {
    const spec = baseSpec(8);
    expect(() => new EngineVoice(spec, NaN, SEED)).toThrow();
    expect(() => new EngineVoice(spec, Infinity, SEED)).toThrow();
    expect(() => new EngineVoice(spec, -Infinity, SEED)).toThrow();
  });

  it('POST2: non-finite load is treated as 0', () => {
    const spec = baseSpec(8);
    const ref = new EngineVoice(spec, FS, SEED);
    ref.setControl(ctrl(6000, 0));
    const expected = renderSeconds(ref, 0.25);
    for (const load of [NaN, Infinity, -Infinity]) {
      const voice = new EngineVoice(spec, FS, SEED);
      voice.setControl(ctrl(6000, load));
      expect(renderSeconds(voice, 0.25)).toEqual(expected);
    }
  });

  it('POST3: reset() clears the control targets so the voice stays silent', () => {
    const spec = baseSpec(8);
    const voice = new EngineVoice(spec, FS, SEED);
    voice.setControl(ctrl(6000, 1));
    renderSeconds(voice, 0.5);
    voice.reset();
    const x = renderSeconds(voice, 0.25);
    expect(peakOf(x)).toBe(0);
  });

  it('POST4: with zero jitter the seed does not affect the output', () => {
    const a = new EngineVoice(baseSpec(8), FS, 1);
    const b = new EngineVoice(baseSpec(8), FS, 2);
    a.setControl(ctrl(6000, 1));
    b.setControl(ctrl(6000, 1));
    expect(renderSeconds(a, 0.3)).toEqual(renderSeconds(b, 0.3));
  });

  it('POST5: 1-cyl fires once per 720° cycle and 12-cyl stays finite and bounded', () => {
    const one = new EngineVoice(baseSpec(1), FS, SEED);
    one.setControl(ctrl(6000, 1));
    renderSeconds(one, 0.5);
    const x = renderSeconds(one, 0.5);
    expect(Number.isFinite(power(x))).toBe(true);
    expect(power(x)).toBeGreaterThan(0);
    expect(peakOf(x)).toBeLessThanOrEqual(0.9);
    const period = argmaxLag(x, 0.015, 0.03);
    expect(Math.abs(period - 0.02)).toBeLessThanOrEqual(3 / FS);

    const twelve = new EngineVoice(baseSpec(12), FS, SEED);
    twelve.setControl(ctrl(6000, 1));
    renderSeconds(twelve, 0.5);
    const y = renderSeconds(twelve, 0.5);
    expect(Number.isFinite(power(y))).toBe(true);
    expect(power(y)).toBeGreaterThan(0);
    expect(peakOf(y)).toBeLessThanOrEqual(0.9);
  });

  it('POST6: pulse width clamps at 8 ms so pulseDeg 20 and 240 match at low rpm only', () => {
    const narrow: EngineSynthSpec = { ...baseSpec(8), pulseDeg: 20 };
    const wide: EngineSynthSpec = { ...baseSpec(8), pulseDeg: 240 };
    expect(steadyRender(wide, 400, 1)).toEqual(steadyRender(narrow, 400, 1));
    expect(steadyRender(wide, 6000, 1)).not.toEqual(steadyRender(narrow, 6000, 1));
  });

  it('POST7: pulse width clamps at 0.3 ms so pulseDeg 20 and 40 match at high rpm only', () => {
    const a: EngineSynthSpec = { ...baseSpec(8), pulseDeg: 20 };
    const b: EngineSynthSpec = { ...baseSpec(8), pulseDeg: 40 };
    const c: EngineSynthSpec = { ...baseSpec(8), pulseDeg: 110 };
    expect(steadyRender(a, 30000, 1)).toEqual(steadyRender(b, 30000, 1));
    expect(steadyRender(a, 30000, 1)).not.toEqual(steadyRender(c, 30000, 1));
    expect(steadyRender(a, 6000, 1)).not.toEqual(steadyRender(b, 6000, 1));
  });

  it('POST8: exported constants match the design contract', () => {
    expect(RPM_SLEW_S).toBe(0.02);
    expect(LOAD_SLEW_S).toBe(0.03);
    expect(WHEEL_RADIUS_M).toBeCloseTo(0.33, 10);
  });

  it('POST9: a single multi-second render call matches blocked rendering', () => {
    const spec = baseSpec(8);
    const a = new EngineVoice(spec, FS, SEED);
    const b = new EngineVoice(spec, FS, SEED);
    a.setControl(ctrl(6000, 1));
    b.setControl(ctrl(6000, 1));
    renderSeconds(a, 0.5);
    renderSeconds(b, 0.5);
    const big = new Float32Array(2 * FS);
    a.render(big);
    expect(big).toEqual(renderSeconds(b, 2));
  });

  it('POST10: setControl stores targets and the last call before render wins', () => {
    const spec = baseSpec(8);
    const a = new EngineVoice(spec, FS, SEED);
    const b = new EngineVoice(spec, FS, SEED);
    a.setControl(ctrl(6000, 1));
    a.setControl(ctrl(3000, 0.5));
    b.setControl(ctrl(3000, 0.5));
    expect(renderSeconds(a, 0.3)).toEqual(renderSeconds(b, 0.3));
  });
});
