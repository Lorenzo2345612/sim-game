import { describe, expect, it } from 'vitest';
import { EngineVoice, type VoiceControl } from '../../../src/audio/engineVoice';
import { legacySynthSpec, type EngineSynthSpec, type TurboLayer } from '../../../src/audio/soundSpec';

const FS = 48000;
const BLOCK = 128;
const BASE: TurboLayer = { centerHz: 3000, spanHz: 3000, gain: 0.05, lagS: 0.4 };
const NONE = { valve: 'none', flutter: 0, wastegate: 0 } as const;

type Seg = [seconds: number, load: number, throttle: number];

function spec(turbo: TurboLayer): EngineSynthSpec {
  const s = legacySynthSpec({ cylinders: 8, exhaustLengthM: 1, intakeMix: 0, crackle: 0 });
  return { ...s, intakeMix: 0, block: [], turbo, whine: null, crackle: 0, lowpassHz: 20000, jitterDeg: 0, jitterAmp: 0 };
}

function run(turbo: TurboLayer, segs: Seg[], s: EngineSynthSpec = spec(turbo)): Float32Array {
  const voice = new EngineVoice(s, FS, 1);
  const total = segs.reduce((a, g) => a + Math.round(g[0] * FS), 0);
  const out = new Float32Array(total);
  let pos = 0;
  for (const [sec, load, throttle] of segs) {
    const c: VoiceControl = { rpm: 7000, load, throttle, wheelSpeedMs: 0, limiter: false };
    voice.setControl(c);
    const end = pos + Math.round(sec * FS);
    for (; pos < end; pos += BLOCK) voice.render(out.subarray(pos, Math.min(pos + BLOCK, end)));
    pos = end;
  }
  return out;
}

function diff(extra: Partial<TurboLayer>, segs: Seg[]): Float64Array {
  const a = run({ ...BASE, ...extra }, segs);
  const b = run({ ...BASE, ...extra, ...NONE }, segs);
  const d = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) d[i] = a[i] - b[i];
  return d;
}

function maxAbs(x: ArrayLike<number>, from = 0, to = x.length): number {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}

function peakCount(d: ArrayLike<number>, origin: number, t1: number): number {
  const w = Math.round(0.005 * FS);
  const n = Math.floor((t1 * FS) / w);
  const env: number[] = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < w; j++) s += d[origin + i * w + j] ** 2;
    env.push(Math.sqrt(s / w));
  }
  let count = 0;
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
    if (v >= 2 * leftMin && v >= 2 * rightMin) count++;
  }
  return count;
}

const LIFT = 2 * FS;

describe('239 turbo transients edge cases', () => {
  it('EDGE1: a second lift inside the 0.3 s refractory does not trigger again', () => {
    const second: Seg[] = [[2, 1, 1], [0.1, 1, 0], [0.1, 1, 1], [1, 1, 0]];
    const slow: Seg[] = [[2, 1, 1], [0.1, 1, 0], [0.1, 1, 1], [1, 1, 0.9]];
    const dA = diff({ valve: 'bov' }, second);
    const dB = diff({ valve: 'bov' }, slow);
    expect(maxAbs(dA, 0, dA.length) - maxAbs(dB, 0, dB.length)).toBeLessThan(1e-6);
    expect(maxAbs(dA, 0, LIFT)).toBeLessThan(1e-6);
    let worst = 0;
    for (let i = 0; i < dA.length; i++) worst = Math.max(worst, Math.abs(dA[i] - dB[i]));
    expect(worst).toBeLessThan(1e-6);
  });

  it('EDGE2: consecutive setControl calls with no samples rendered do not trigger', () => {
    const voice = new EngineVoice(spec({ ...BASE, valve: 'bov' }), FS, 1);
    const ref = new EngineVoice(spec({ ...BASE, ...NONE }), FS, 1);
    const out = new Float32Array(FS * 3);
    const base = new Float32Array(FS * 3);
    const c = (t: number): VoiceControl => ({ rpm: 7000, load: 1, throttle: t, wheelSpeedMs: 0, limiter: false });
    for (const [v, o] of [[voice, out], [ref, base]] as const) {
      for (let i = 0; i < LIFT; i += BLOCK) {
        v.setControl(c(1));
        v.render(o.subarray(i, i + BLOCK));
      }
      v.setControl(c(1));
      v.setControl(c(0));
      for (let i = LIFT; i < o.length; i += BLOCK) v.render(o.subarray(i, Math.min(i + BLOCK, o.length)));
    }
    let worst = 0;
    for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - base[i]));
    expect(worst).toBeLessThan(1e-6);
  });

  it('EDGE3: throttle is clamped to [0,1] before computing the fall rate', () => {
    const d = diff({ valve: 'bov' }, [[2, 1, 3], [1, 1, 1]]);
    expect(maxAbs(d)).toBeLessThan(1e-6);
    const same = diff({ valve: 'bov' }, [[2, 1, 1.5], [1, 1, 0]]);
    const ref = diff({ valve: 'bov' }, [[2, 1, 1], [1, 1, 0]]);
    let worst = 0;
    for (let i = 0; i < ref.length; i++) worst = Math.max(worst, Math.abs(same[i] - ref[i]));
    expect(worst).toBeLessThan(1e-6);
    expect(maxAbs(ref, LIFT)).toBeGreaterThan(1e-3);
  });

  it('EDGE4: trigger needs a fall rate above 3 per second', () => {
    const run1 = (to: number) => {
      const voice = new EngineVoice(spec({ ...BASE, valve: 'bov' }), FS, 1);
      const ref = new EngineVoice(spec({ ...BASE, ...NONE }), FS, 1);
      const a = new Float32Array(FS * 2.5);
      const b = new Float32Array(FS * 2.5);
      for (const [v, o] of [[voice, a], [ref, b]] as const) {
        for (let i = 0; i < o.length; i += BLOCK) {
          const t = i < LIFT ? 1 : to;
          v.setControl({ rpm: 7000, load: 1, throttle: t, wheelSpeedMs: 0, limiter: false });
          v.render(o.subarray(i, Math.min(i + BLOCK, o.length)));
        }
      }
      let worst = 0;
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
      return worst;
    };
    expect(run1(0.993)).toBeLessThan(1e-6);
    expect(run1(0.99)).toBeGreaterThan(1e-3);
  });

  it('EDGE5: boost seen by the trigger decays with downLagS', () => {
    const segs = (wait: number): Seg[] => [[2, 1, 1], [wait, 0, 1], [1, 0, 0]];
    const early = diff({ valve: 'bov', downLagS: 2 }, segs(0.5));
    const late = diff({ valve: 'bov', downLagS: 2 }, segs(4));
    expect(maxAbs(early, 2 * FS + Math.round(0.5 * FS))).toBeGreaterThan(1e-3);
    expect(maxAbs(late, 2 * FS + 4 * FS)).toBeLessThan(1e-6);
  });

  it('EDGE6: transients never mutate the spec', () => {
    const s = spec({ ...BASE, valve: 'bov', flutter: 1, wastegate: 1, wastegateKind: 'external' });
    const before = JSON.stringify(s);
    run(s.turbo as TurboLayer, [[2, 1, 1], [1, 0, 0]], s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('EDGE7: a non-finite throttle never triggers and keeps the output finite', () => {
    const turbo: TurboLayer = { ...BASE, valve: 'bov', flutter: 1, wastegate: 1, wastegateKind: 'external' };
    const out = run(turbo, [[2, 1, 1], [1, 1, Number.NaN]]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i])).toBe(true);
    const d = diff({ valve: 'bov' }, [[2, 1, 1], [1, 1, Number.NaN]]);
    expect(maxAbs(d, LIFT)).toBeLessThan(1e-6);
  });

  it('EDGE8: the external wastegate hold needs load and boost above 0.7', () => {
    const d = diff({ wastegate: 1, wastegateKind: 'external' }, [[3, 0.5, 0.5]]);
    expect(maxAbs(d)).toBeLessThan(1e-6);
  });

  it('EDGE9: an external wastegate at amount 0 is silent', () => {
    const d = diff({ wastegate: 0, wastegateKind: 'external' }, [[2, 1, 1], [1, 0, 0]]);
    expect(maxAbs(d)).toBeLessThan(1e-6);
  });

  it('EDGE10: flutter pulse count scales with boost at the lift', () => {
    const peaks = (from: number) => peakCount(diff({ flutter: 1 }, [[2, from, from], [1.2, 0, 0]]), LIFT, 1);
    const low = peaks(0.3);
    expect(low).toBeGreaterThanOrEqual(2);
    expect(low).toBeLessThanOrEqual(5);
    expect(peaks(1)).toBeGreaterThan(low);
  });
});
