import { describe, expect, it } from 'vitest';
import { EngineVoice, type VoiceControl } from '../../../src/audio/engineVoice';
import { legacySynthSpec, parseEngineSynth, type EngineSynthSpec, type TurboLayer } from '../../../src/audio/soundSpec';

const FS = 48000;
const BLOCK = 128;
const T: TurboLayer = { centerHz: 3000, spanHz: 3000, gain: 0.05, lagS: 0.4, valve: 'bov', flutter: 0.5, wastegate: 0.5, wastegateKind: 'external' };

function spec(turbo: TurboLayer): EngineSynthSpec {
  const s = legacySynthSpec({ cylinders: 8, exhaustLengthM: 1, intakeMix: 0, crackle: 0 });
  return { ...s, intakeMix: 0, block: [], turbo, whine: null, crackle: 0, lowpassHz: 20000, jitterDeg: 0, jitterAmp: 0 };
}
const ctrl = (load: number, throttle: number): VoiceControl => ({ rpm: 7000, load, throttle, wheelSpeedMs: 0, limiter: false });

function run(turbo: TurboLayer, liftThrottle: number, opts: { skipRender?: boolean; sec?: number } = {}): { out: Float32Array; v: EngineVoice } {
  const v = new EngineVoice(spec(turbo), FS, 1);
  const hold = 2 * FS;
  const out = new Float32Array(hold + Math.round((opts.sec ?? 1) * FS));
  const r = (a: number, b: number) => { for (let i = a; i < b; i += BLOCK) v.render(out.subarray(i, Math.min(i + BLOCK, b))); };
  for (let i = 0; i < hold; i += BLOCK) { v.setControl(ctrl(1, 1)); r(i, i + BLOCK); }
  if (opts.skipRender) { v.setControl(ctrl(1, 1)); }
  v.setControl(ctrl(0, liftThrottle));
  r(hold, out.length);
  return { out, v };
}
const maxDiff = (a: Float32Array, b: Float32Array, from = 0) => { let m = 0; for (let i = from; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const NONE = { ...T, valve: 'none' as const, flutter: 0, wastegate: 0 };

describe('239 turbo transients post-code gaps', () => {
  it('POST1: NaN throttle on lift triggers nothing', () => {
    const a = run({ ...T, wastegate: 0 }, NaN).out;
    const b = run(NONE, NaN).out;
    expect(maxDiff(a, b, 2 * FS)).toBeLessThan(1e-6);
  });

  it('POST2: control update with no samples rendered since previous one does not trigger', () => {
    const a = run({ ...T, wastegate: 0 }, 0, { skipRender: true }).out;
    const b = run(NONE, 0, { skipRender: true }).out;
    expect(maxDiff(a, b, 2 * FS + 0.5 * FS)).toBeLessThan(1e-6);
  });

  it('POST3: reset reproduces identical transient output', () => {
    const v = new EngineVoice(spec(T), FS, 3);
    const go = () => {
      const o = new Float32Array(FS);
      for (let i = 0; i < FS; i += BLOCK) { v.setControl(ctrl(1, i < FS / 2 ? 1 : 0)); v.render(o.subarray(i, i + BLOCK)); }
      return o;
    };
    const a = go();
    v.reset();
    expect(v.boost).toBe(0);
    const b = go();
    expect(maxDiff(a, b)).toBe(0);
  });

  it('POST4: boost decays with downLagS and is zero-lag when downLagS is 0', () => {
    const slow = run({ ...NONE, downLagS: 2 }, 0, { sec: 0.5 }).v.boost;
    const zero = run({ ...NONE, downLagS: 0 }, 0, { sec: 0.3 }).v.boost;
    expect(slow).toBeGreaterThan(0.7);
    expect(zero).toBeLessThan(0.01);
  });

  it('POST5: transients do not mutate the spec', () => {
    const s = spec({ ...T });
    const snap = JSON.stringify(s);
    const v = new EngineVoice(s, FS, 1);
    const o = new Float32Array(BLOCK);
    for (let i = 0; i < 400; i++) { v.setControl(ctrl(1, i < 200 ? 1 : 0)); v.render(o); }
    expect(JSON.stringify(s)).toBe(snap);
  });

  it('POST6: second lift inside the 0.3 s refractory window adds no new transient', () => {
    const v = new EngineVoice(spec({ ...T, flutter: 0, wastegate: 0 }), FS, 1);
    const o = new Float32Array(BLOCK);
    for (let i = 0; i < 800; i++) { v.setControl(ctrl(1, 1)); v.render(o); }
    v.setControl(ctrl(0, 0)); v.render(o);
    const b0 = v.boost;
    expect(b0).toBeGreaterThan(0.25);
    for (let i = 0; i < 20; i++) { v.setControl(ctrl(1, 1)); v.render(o); v.setControl(ctrl(0, 0)); v.render(o); }
    for (const x of o) expect(Number.isFinite(x)).toBe(true);
  });

  it('POST7: output stays finite and bounded for out-of-range throttle and huge samples', () => {
    const v = new EngineVoice(spec(T), FS, 1);
    const o = new Float32Array(BLOCK);
    for (let i = 0; i < 600; i++) {
      v.setControl(ctrl(1, i < 300 ? 5 : -5));
      v.render(o);
      for (const x of o) { expect(Number.isFinite(x)).toBe(true); expect(Math.abs(x)).toBeLessThanOrEqual(0.9); }
    }
  });
});

describe('239 parser boundaries', () => {
  const base = { centerHz: 3000, spanHz: 3000, gain: 0.05, lagS: 0.4 };
  const legacy = { cylinders: 4, exhaustLengthM: 1, intakeMix: 0, crackle: 0 };
  const parse = (extra: object) => parseEngineSynth({ turbo: { ...base, ...extra } }, legacy);
  it('POST8: boundary values accepted', () => {
    const r = parse({ flutter: 1, wastegate: 0, downLagS: 5 });
    expect(r.errors).toEqual([]);
    expect(r.spec.turbo).toMatchObject({ flutter: 1, wastegate: 0, downLagS: 5 });
  });
  it.each([{ flutter: NaN }, { flutter: '1' }, { wastegate: -0.01 }, { downLagS: 5.01 }, { downLagS: -1 }, { valve: 1 }, { wastegateKind: null }])(
    'POST9: rejects %j',
    (b) => {
      const r = parse(b);
      expect(r.errors.some((e) => e.includes('synth.turbo'))).toBe(true);
    },
  );
});
