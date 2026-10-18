import { describe, expect, it } from 'vitest';
import { EngineVoice, WHEEL_RADIUS_M, type VoiceControl } from '../../../src/audio/engineVoice';
import { legacySynthSpec, type EngineSynthSpec } from '../../../src/audio/soundSpec';

const FS = 48000;
const SEED = 1;
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

function renderN(voice: EngineVoice, n: number, block = 128): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += block) {
    voice.render(out.subarray(i, i + Math.min(block, n - i)));
  }
  return out;
}

function renderSeconds(voice: EngineVoice, seconds: number): Float32Array {
  return renderN(voice, Math.round(seconds * FS));
}

function warmRender(voice: EngineVoice, control: VoiceControl, measureSeconds: number): Float32Array {
  voice.setControl(control);
  renderSeconds(voice, 0.5);
  return renderSeconds(voice, measureSeconds);
}

function bandPower(x: Float32Array, loHz: number, hiHz: number): number {
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
  const binHz = FS / size;
  const k0 = Math.max(1, Math.ceil(loHz / binHz));
  const k1 = Math.min((size >> 1) - 1, Math.floor(hiHz / binHz));
  let e = 0;
  for (let k = k0; k <= k1; k++) e += re[k] * re[k] + im[k] * im[k];
  return e;
}

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

function cutDuty(x: Float32Array): number {
  const env = rmsEnvelope(x, 0.005);
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < env.length; i++) {
    if (env[i] < min) min = env[i];
    if (env[i] > max) max = env[i];
  }
  const thr = (min + max) / 2;
  let below = 0;
  for (let i = 0; i < env.length; i++) if (env[i] < thr) below++;
  return below / env.length;
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

function finiteCount(x: Float32Array): number {
  let bad = 0;
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) bad++;
  return bad;
}

describe('228 engine voice layers post-code gaps', () => {
  it('POST1: render constructs no objects while every layer branch runs', () => {
    const voice = new EngineVoice(
      {
        ...baseSpec(8),
        intakeMix: 1,
        block: [
          { hz: 900, q: 8, gainDb: 12 },
          { hz: 1800, q: 4, gainDb: 6 },
          { hz: 300, q: 2, gainDb: -6 },
          { hz: 4500, q: 10, gainDb: 24 },
          { hz: 120, q: 1, gainDb: 3 },
          { hz: 6000, q: 15, gainDb: 18 },
        ],
        lowpassHz: 1500,
        turbo: { centerHz: 3000, spanHz: 3000, gain: 0.2, lagS: 0.4 },
        whine: { order: 14, gain: 0.1, source: 'wheel', minSpeedMs: 0 },
        crackle: 1,
        limiterHz: 15,
      },
      FS,
      SEED,
    );
    voice.setControl(ctrl(8000, 1, { throttle: 0.04, wheelSpeedMs: 50, limiter: true }));
    renderSeconds(voice, 0.1);
    expect(countConstructions(() => new Float64Array(4))).toBeGreaterThanOrEqual(1);
    const out = new Float32Array(4800);
    const constructions = countConstructions(() => {
      voice.render(out);
    });
    expect(constructions).toBe(0);
  });

  it('POST2: block modes beyond the first 6 are ignored', () => {
    const modes: EngineSynthSpec['block'] = [
      { hz: 900, q: 8, gainDb: 12 },
      { hz: 1800, q: 4, gainDb: 6 },
      { hz: 300, q: 2, gainDb: -6 },
      { hz: 4500, q: 10, gainDb: 24 },
      { hz: 120, q: 1, gainDb: 3 },
      { hz: 6000, q: 15, gainDb: 18 },
      { hz: 550, q: 6, gainDb: 9 },
    ];
    const a = new EngineVoice({ ...baseSpec(8), block: modes.slice(0, 7) }, FS, SEED);
    const b = new EngineVoice({ ...baseSpec(8), block: modes.slice(0, 6) }, FS, SEED);
    expect(warmRender(a, ctrl(6000, 1), 0.3)).toEqual(warmRender(b, ctrl(6000, 1), 0.3));
  });

  it('POST3: non-finite throttle and wheelSpeedMs are neutralised to 0 with layers active', () => {
    const spec: EngineSynthSpec = {
      ...baseSpec(8),
      intakeMix: 1,
      whine: { order: 14, gain: 0.05, source: 'wheel', minSpeedMs: 33 },
    };
    const cases: [number, number][] = [
      [Number.NaN, Number.NaN],
      [Infinity, Infinity],
      [-Infinity, -Infinity],
    ];
    const ref = warmRender(
      new EngineVoice(spec, FS, SEED),
      ctrl(6000, 1, { throttle: 0, wheelSpeedMs: 0 }),
      0.3,
    );
    for (const [throttle, wheelSpeedMs] of cases) {
      const x = warmRender(
        new EngineVoice(spec, FS, SEED),
        ctrl(6000, 1, { throttle, wheelSpeedMs }),
        0.3,
      );
      expect(finiteCount(x)).toBe(0);
      expect(x).toEqual(ref);
    }
  });

  it('POST4: throttle is clamped to [0,1] for the intake layer', () => {
    const spec: EngineSynthSpec = { ...baseSpec(8), intakeMix: 1 };
    const zero = warmRender(new EngineVoice(spec, FS, SEED), ctrl(6000, 1, { throttle: 0 }), 0.3);
    const neg = warmRender(new EngineVoice(spec, FS, SEED), ctrl(6000, 1, { throttle: -0.5 }), 0.3);
    expect(neg).toEqual(zero);
    const one = warmRender(new EngineVoice(spec, FS, SEED), ctrl(6000, 1, { throttle: 1 }), 0.3);
    const high = warmRender(new EngineVoice(spec, FS, SEED), ctrl(6000, 1, { throttle: 1.7 }), 0.3);
    expect(high).toEqual(one);
  });

  it('POST5: reset() clears layer filter states and RNGs for bit-identical replay', () => {
    const spec: EngineSynthSpec = {
      ...baseSpec(8),
      intakeMix: 1,
      block: [{ hz: 900, q: 8, gainDb: 12 }],
      lowpassHz: 1500,
      turbo: { centerHz: 3000, spanHz: 3000, gain: 0.2, lagS: 0.4 },
      whine: { order: 18, gain: 0.1, source: 'rpm', minSpeedMs: 0 },
      crackle: 1,
      limiterHz: 15,
    };
    const reused = new EngineVoice(spec, FS, SEED);
    reused.setControl(ctrl(8000, 1, { limiter: true }));
    renderSeconds(reused, 0.3);
    reused.reset();
    reused.setControl(ctrl(8000, 1, { limiter: true }));
    const after = renderSeconds(reused, 0.3);
    const fresh = new EngineVoice(spec, FS, SEED);
    fresh.setControl(ctrl(8000, 1, { limiter: true }));
    expect(after).toEqual(renderSeconds(fresh, 0.3));
  });

  it('POST6: crackle re-arms on a second lift after the first window expired', () => {
    const voice = new EngineVoice({ ...baseSpec(8), crackle: 1 }, FS, SEED);
    voice.setControl(ctrl(8000, 1));
    renderSeconds(voice, 0.5);
    voice.setControl(ctrl(8000, 0, { throttle: 0 }));
    renderSeconds(voice, 1.2);
    voice.setControl(ctrl(8000, 1, { throttle: 1 }));
    renderSeconds(voice, 0.3);
    voice.setControl(ctrl(8000, 0, { throttle: 0 }));
    expect(countClusters(renderSeconds(voice, 1))).toBeGreaterThanOrEqual(3);
  }, 60000);

  it('POST7: wheel whine frequency slews with RPM_SLEW_S after a speed step', () => {
    const voice = new EngineVoice(
      { ...baseSpec(8), whine: { order: 14, gain: 0.3, source: 'wheel', minSpeedMs: 0 } },
      FS,
      SEED,
    );
    voice.setControl(ctrl(4000, 0, { wheelSpeedMs: 0 }));
    renderSeconds(voice, 0.5);
    voice.setControl(ctrl(4000, 0, { wheelSpeedMs: 60 }));
    const early = renderSeconds(voice, 0.04);
    renderSeconds(voice, 0.5);
    const late = renderSeconds(voice, 0.04);
    const f = (14 * 60) / (2 * Math.PI * WHEEL_RADIUS_M);
    const earlyBand = bandPower(early, f - 15, f + 15);
    const lateBand = bandPower(late, f - 15, f + 15);
    expect(earlyBand / lateBand).toBeLessThan(0.5);
  }, 60000);

  it('POST8: limiter envelope duty stays near 50 % at limiterHz 5 and 40', () => {
    for (const limiterHz of [5, 40]) {
      const voice = new EngineVoice({ ...baseSpec(8), limiterHz }, FS, SEED);
      voice.setControl(ctrl(8000, 1, { limiter: true }));
      renderSeconds(voice, 0.5);
      const duty = cutDuty(renderSeconds(voice, 1));
      expect(duty, `limiterHz ${limiterHz}`).toBeGreaterThanOrEqual(0.25);
      expect(duty, `limiterHz ${limiterHz}`).toBeLessThanOrEqual(0.75);
    }
  }, 60000);

  it('POST9: every layer at spec maximum stays finite and peak ≤ 0.9', () => {
    const spec: EngineSynthSpec = {
      ...baseSpec(8),
      drive: 4,
      gainDb: 12,
      intakeMix: 1,
      intakeHz: 1200,
      block: [
        { hz: 40, q: 0.5, gainDb: 24 },
        { hz: 8000, q: 30, gainDb: 24 },
        { hz: 4000, q: 15, gainDb: 24 },
        { hz: 200, q: 2, gainDb: 24 },
        { hz: 1500, q: 8, gainDb: 24 },
        { hz: 6000, q: 20, gainDb: 24 },
      ],
      lowpassHz: 19999,
      turbo: { centerHz: 12000, spanHz: 8000, gain: 0.3, lagS: 0 },
      whine: { order: 100, gain: 0.3, source: 'rpm', minSpeedMs: 0 },
      crackle: 1,
      limiterHz: 40,
    };
    const voice = new EngineVoice(spec, FS, SEED);
    voice.setControl(ctrl(20000, 1, { limiter: true, throttle: 0 }));
    renderSeconds(voice, 0.5);
    const x = renderSeconds(voice, 1);
    expect(finiteCount(x)).toBe(0);
    let peak = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
    }
    expect(peak).toBeLessThanOrEqual(0.9);
  }, 60000);

  it('POST11: turbo with lagS 0 tracks a load step without lag', () => {
    const voice = new EngineVoice(
      { ...baseSpec(8), turbo: { centerHz: 3000, spanHz: 3000, gain: 0.05, lagS: 0 } },
      FS,
      SEED,
    );
    voice.setControl(ctrl(7000, 0));
    renderSeconds(voice, 1);
    voice.setControl(ctrl(7000, 1));
    const stepped = renderSeconds(voice, 1.5);
    const early = bandPower(stepped.subarray(0, Math.round(0.1 * FS)), 3000, 6000);
    const late = bandPower(stepped.subarray(Math.round(1.4 * FS), Math.round(1.5 * FS)), 3000, 6000);
    expect(early / late).toBeGreaterThanOrEqual(0.5);
  }, 60000);

  it('POST12: negative wheelSpeedMs is treated as 0', () => {
    const spec: EngineSynthSpec = {
      ...baseSpec(8),
      whine: { order: 14, gain: 0.3, source: 'wheel', minSpeedMs: 0 },
    };
    const neg = warmRender(new EngineVoice(spec, FS, SEED), ctrl(6000, 1, { wheelSpeedMs: -25 }), 0.3);
    const zero = warmRender(new EngineVoice(spec, FS, SEED), ctrl(6000, 1, { wheelSpeedMs: 0 }), 0.3);
    expect(neg).toEqual(zero);
  });

  it('POST13: crackle requires throttle < 0.05 and rpm > 3500 strictly', () => {
    function clusters(lift: VoiceControl): number {
      const voice = new EngineVoice({ ...baseSpec(8), crackle: 1 }, FS, SEED);
      voice.setControl(ctrl(lift.rpm, 1));
      renderSeconds(voice, 0.5);
      voice.setControl(lift);
      const before = voice.popCount;
      renderSeconds(voice, 1.2);
      return voice.popCount - before;
    }
    expect(clusters(ctrl(8000, 0, { throttle: 0.04 }))).toBeGreaterThanOrEqual(3);
    expect(clusters(ctrl(8000, 0, { throttle: 0.05 }))).toBe(0);
    expect(clusters(ctrl(3500, 0, { throttle: 0 }))).toBe(0);
  }, 120000);

  it('POST14: wheel whine is audible at exactly minSpeedMs', () => {
    const withMin = (minSpeedMs: number): EngineSynthSpec => ({
      ...baseSpec(8),
      whine: { order: 14, gain: 0.05, source: 'wheel', minSpeedMs },
    });
    const f = (14 * 40) / (2 * Math.PI * WHEEL_RADIUS_M);
    const on = bandPower(
      warmRender(new EngineVoice(withMin(40), FS, SEED), ctrl(7000, 1, { wheelSpeedMs: 40 }), 1),
      f - 8,
      f + 8,
    );
    const off = bandPower(
      warmRender(new EngineVoice({ ...baseSpec(8), whine: null }, FS, SEED), ctrl(7000, 1, { wheelSpeedMs: 40 }), 1),
      f - 8,
      f + 8,
    );
    expect(10 * Math.log10(on / off)).toBeGreaterThanOrEqual(20);
  }, 60000);

  it('POST15: turbo and whine with gain 0 are bit-identical to null layers', () => {
    const zeroed: EngineSynthSpec = {
      ...baseSpec(8),
      turbo: { centerHz: 3000, spanHz: 3000, gain: 0, lagS: 0.4 },
      whine: { order: 18, gain: 0, source: 'rpm', minSpeedMs: 0 },
    };
    const a = warmRender(new EngineVoice(zeroed, FS, SEED), ctrl(7000, 1), 0.3);
    const b = warmRender(new EngineVoice({ ...baseSpec(8) }, FS, SEED), ctrl(7000, 1), 0.3);
    expect(a).toEqual(b);
  });

  it('POST16: intake is silent at throttle 0 even with intakeMix 1', () => {
    const spec: EngineSynthSpec = { ...baseSpec(8), intakeMix: 1 };
    const silent = warmRender(new EngineVoice(spec, FS, SEED), ctrl(6000, 1, { throttle: 0 }), 0.3);
    const ref = warmRender(new EngineVoice({ ...baseSpec(8) }, FS, SEED), ctrl(6000, 1, { throttle: 0 }), 0.3);
    expect(silent).toEqual(ref);
  });

  it('POST17: extreme rpm with every layer stays finite and peak ≤ 0.9', () => {
    const spec: EngineSynthSpec = {
      ...baseSpec(8),
      drive: 4,
      gainDb: 12,
      intakeMix: 1,
      block: [
        { hz: 900, q: 8, gainDb: 24 },
        { hz: 40, q: 0.5, gainDb: 24 },
        { hz: 8000, q: 30, gainDb: 24 },
      ],
      lowpassHz: 1500,
      turbo: { centerHz: 3000, spanHz: 3000, gain: 0.3, lagS: 0.4 },
      whine: { order: 100, gain: 0.3, source: 'wheel', minSpeedMs: 0 },
      crackle: 1,
      limiterHz: 40,
    };
    const voice = new EngineVoice(spec, FS, SEED);
    voice.setControl(ctrl(1e6, 1, { limiter: true, throttle: 0, wheelSpeedMs: 400 }));
    const x = renderSeconds(voice, 0.5);
    expect(finiteCount(x)).toBe(0);
    let peak = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
    }
    expect(peak).toBeLessThanOrEqual(0.9);
  }, 60000);

  it('POST10: render stays finite for spec-range lowpassHz at every positive sample rate', () => {
    for (const [rate, lowpassHz] of [
      [48000, 12000],
      [22050, 12000],
      [8000, 6000],
    ] as const) {
      const voice = new EngineVoice({ ...baseSpec(8), lowpassHz }, rate, SEED);
      voice.setControl(ctrl(6000, 1));
      const x = renderN(voice, rate >> 1);
      expect(finiteCount(x), `fs=${rate} lowpassHz=${lowpassHz}`).toBe(0);
    }
  }, 60000);
});
