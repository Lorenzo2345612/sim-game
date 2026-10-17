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

function ctrl(rpm: number, load: number): VoiceControl {
  return { rpm, load, throttle: 1, wheelSpeedMs: 0, limiter: false };
}

function renderSamples(voice: EngineVoice, n: number, block = 128): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += block) {
    voice.render(out.subarray(i, i + Math.min(block, n - i)));
  }
  return out;
}

function peakOf(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > m) m = a;
  }
  return m;
}

describe('227 engine voice core edge', () => {
  it('EDGE1: constructor throws for sampleRate ≤ 0', () => {
    const spec = baseSpec(8);
    expect(() => new EngineVoice(spec, 0, SEED)).toThrow();
    expect(() => new EngineVoice(spec, -48000, SEED)).toThrow();
  });

  it('EDGE2: render with an empty array is a no-op that leaves state unchanged', () => {
    const a = new EngineVoice(baseSpec(8), FS, SEED);
    const b = new EngineVoice(baseSpec(8), FS, SEED);
    a.setControl(ctrl(6000, 1));
    b.setControl(ctrl(6000, 1));
    renderSamples(a, 2400, 128);
    renderSamples(b, 2400, 128);
    expect(() => a.render(new Float32Array(0))).not.toThrow();
    const xa = renderSamples(a, 512, 128);
    const xb = renderSamples(b, 512, 128);
    expect(xa).toEqual(xb);
  });

  it('EDGE3: render overwrites out instead of mixing into it', () => {
    const a = new EngineVoice(baseSpec(8), FS, SEED);
    const b = new EngineVoice(baseSpec(8), FS, SEED);
    a.setControl(ctrl(6000, 1));
    b.setControl(ctrl(6000, 1));
    const outA = new Float32Array(4096).fill(0.7);
    const outB = new Float32Array(4096);
    a.render(outA);
    b.render(outB);
    expect(outA).toEqual(outB);
  });

  it('EDGE4: negative, NaN and infinite rpm are treated as 0 and output silence', () => {
    for (const rpm of [-500, NaN, Infinity, -Infinity]) {
      const voice = new EngineVoice(baseSpec(8), FS, SEED);
      voice.setControl(ctrl(rpm, 1));
      const x = renderSamples(voice, 4800, 128);
      expect(peakOf(x)).toBe(0);
    }
  });

  it('EDGE5: load is clamped to [0,1] (load 2 ≡ load 1, load −1 ≡ load 0)', () => {
    function renderWithLoad(load: number): Float32Array {
      const voice = new EngineVoice(baseSpec(8), FS, SEED);
      voice.setControl(ctrl(6000, load));
      return renderSamples(voice, 9600, 128);
    }
    expect(renderWithLoad(2)).toEqual(renderWithLoad(1));
    expect(renderWithLoad(-1)).toEqual(renderWithLoad(0));
  });

  it('EDGE6: reset() restores the constructed state so the seed sequence restarts', () => {
    const fresh = new EngineVoice(baseSpec(8), FS, SEED);
    fresh.setControl(ctrl(6000, 1));
    const ref = renderSamples(fresh, 7200, 128);

    const reused = new EngineVoice(baseSpec(8), FS, SEED);
    reused.setControl(ctrl(6000, 1));
    renderSamples(reused, 3600, 128);
    reused.reset();
    reused.setControl(ctrl(6000, 1));
    expect(renderSamples(reused, 7200, 128)).toEqual(ref);
  });

  it('EDGE7: throttle, wheelSpeedMs and limiter are ignored in 227', () => {
    const a = new EngineVoice(baseSpec(8), FS, SEED);
    const b = new EngineVoice(baseSpec(8), FS, SEED);
    a.setControl({ rpm: 6000, load: 1, throttle: 1, wheelSpeedMs: 50, limiter: false });
    b.setControl({ rpm: 6000, load: 1, throttle: 0, wheelSpeedMs: 0, limiter: true });
    expect(renderSamples(a, 7200, 128)).toEqual(renderSamples(b, 7200, 128));
  });

  it('EDGE8: layer spec fields (intakeMix, block, turbo, whine, crackle, lowpassHz, limiterHz) are ignored in 227', () => {
    const layered: EngineSynthSpec = {
      ...baseSpec(8),
      intakeMix: 1,
      block: [{ hz: 1000, q: 2, gainDb: 6 }],
      turbo: { centerHz: 1000, spanHz: 500, gain: 0.2, lagS: 0.1 },
      whine: { order: 4, gain: 0.2, source: 'rpm', minSpeedMs: 0 },
      crackle: 1,
      lowpassHz: 800,
      limiterHz: 5,
    };
    const a = new EngineVoice(baseSpec(8), FS, SEED);
    const b = new EngineVoice(layered, FS, SEED);
    a.setControl(ctrl(6000, 1));
    b.setControl(ctrl(6000, 1));
    expect(renderSamples(a, 7200, 128)).toEqual(renderSamples(b, 7200, 128));
  });

  it('EDGE9: peak stays ≤ 0.9 at maximum drive and gainDb', () => {
    const spec: EngineSynthSpec = { ...baseSpec(8), drive: 4, gainDb: 12 };
    const voice = new EngineVoice(spec, FS, SEED);
    voice.setControl(ctrl(6000, 1));
    renderSamples(voice, 24000, 128);
    expect(peakOf(renderSamples(voice, 24000, 128))).toBeLessThanOrEqual(0.9);
  });

  it('EDGE10: output is independent of render block size', () => {
    const a = new EngineVoice(baseSpec(8), FS, SEED);
    const b = new EngineVoice(baseSpec(8), FS, SEED);
    a.setControl(ctrl(6000, 1));
    b.setControl(ctrl(6000, 1));
    renderSamples(a, 12000, 1);
    renderSamples(b, 12000, 128);
    expect(renderSamples(a, 512, 1)).toEqual(renderSamples(b, 512, 128));
  });
});
