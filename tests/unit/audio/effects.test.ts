import { describe, it, expect } from 'vitest';
import { crackleSchedule, kerbRumbleHz, shiftEnvelope, windGain } from '../../../src/audio/effects';
import { EngineAudio } from '../../../src/audio/engineAudio';
import type { CarSound } from '../../../src/physics/carSpec';

class FakeParam {
  value: number;
  constructor(initial = 0) {
    this.value = initial;
  }
  setValueAtTime(v: number): FakeParam {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): FakeParam {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): FakeParam {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number): FakeParam {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): FakeParam {
    return this;
  }
}

type FakeNode<T> = T & { connect(target: unknown): unknown; disconnect(): void };

function node<T extends object>(extra: T): FakeNode<T> {
  return {
    ...extra,
    connect(target: unknown) {
      return target;
    },
    disconnect() {
      /* mock */
    },
  };
}

class FakeContext {
  gains: Array<{ gain: FakeParam }> = [];
  started = 0;
  stopped = 0;
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = node({});

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  createOscillator() {
    return node({
      type: 'sine' as const,
      frequency: new FakeParam(440),
      detune: new FakeParam(0),
      onended: null as (() => void) | null,
      start: () => {
        this.started += 1;
      },
      stop: () => {
        this.stopped += 1;
      },
    });
  }

  createGain() {
    const g = node({ gain: new FakeParam() });
    this.gains.push(g);
    return g;
  }

  createBiquadFilter() {
    return node({
      type: 'lowpass' as const,
      frequency: new FakeParam(350),
      Q: new FakeParam(1),
      gain: new FakeParam(0),
      detune: new FakeParam(0),
    });
  }

  createBuffer(channels: number, length: number, rate: number) {
    return {
      numberOfChannels: channels,
      length,
      duration: length / rate,
      sampleRate: rate,
      getChannelData() {
        return new Float32Array(length);
      },
    };
  }

  createBufferSource() {
    return node({
      buffer: null as unknown,
      loop: false,
      playbackRate: new FakeParam(1),
      onended: null as (() => void) | null,
      start: () => {
        this.started += 1;
      },
      stop: () => {
        this.stopped += 1;
      },
    });
  }
}

const SOUND: CarSound = { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 1 };

function audioWith(ctx: FakeContext, sound: CarSound = SOUND): EngineAudio {
  return new EngineAudio(() => ctx as unknown as AudioContext, sound);
}

describe('110 effects helpers edges', () => {
  it('crackleSchedule draws once for the count then one per offset and sorts', () => {
    const draws: number[] = [];
    const rng = (): number => {
      const v = draws.length === 0 ? 0.5 : 1 - draws.length * 0.1;
      draws.push(v);
      return v;
    };
    const offsets = crackleSchedule(0.9, 0.05, 6000, 7000, 1, rng);
    expect(draws).toHaveLength(1 + offsets.length);
    expect(offsets).toHaveLength(6); // round(3 + 5·0.5) = 6
    const expected = draws.slice(1).map((v) => 0.6 * v).sort((a, b) => a - b);
    expect(offsets).toEqual(expected);
  });

  it('crackleSchedule clamps the count between 3 and 8', () => {
    const at = (r: number) => (): number => r;
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, 0.5, at(0))).toHaveLength(3);
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, 0.1, at(1))).toHaveLength(4);
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, 0.5, at(1))).toHaveLength(6);
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, 0.9, at(1))).toHaveLength(8);
  });

  it('windGain is monotonic and clamps into [0, 0.4]', () => {
    let prev = -1;
    for (let v = -10; v <= 200; v += 2.5) {
      const g = windGain(v);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(0.4);
      expect(g).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = g;
    }
  });

  it('kerbRumbleHz is linear in speed', () => {
    expect(kerbRumbleHz(0, 1.5)).toBe(0);
    expect(kerbRumbleHz(15, 1.5)).toBe(10);
    expect(kerbRumbleHz(30, 3)).toBe(10);
  });

  it('shiftEnvelope is monotone down, flat, then up across its breakpoints', () => {
    expect(shiftEnvelope(0)).toBe(1);
    expect(shiftEnvelope(0.019999)).toBeLessThan(1);
    expect(shiftEnvelope(0.019999)).toBeGreaterThan(0.3);
    expect(shiftEnvelope(0.02)).toBe(0.3);
    expect(shiftEnvelope(0.059999)).toBe(0.3);
    expect(shiftEnvelope(0.06)).toBe(0.3);
    expect(shiftEnvelope(0.079999)).toBeGreaterThan(0.3);
    expect(shiftEnvelope(0.079999)).toBeLessThan(1);
    expect(shiftEnvelope(0.08)).toBe(1);
    expect(shiftEnvelope(1)).toBe(1);
  });
});

describe('110 EngineAudio effect wiring', () => {
  it('effects stay lazy: the constructor still creates only the three engine gains', () => {
    const ctx = new FakeContext();
    audioWith(ctx);
    expect(ctx.gains.length).toBe(3);
  });

  it('updateEffects drives wind, gravel, kerb and squeal gains through the master volume', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.updateEffects({ speed: 40, surface: 'asphalt', shifting: false, slipRatios: [0.25, 0.25, 0, 0] });
    expect(ctx.gains.length).toBe(8);
    const [engine, sub, squeal, wind, kerbAmp, kerbDepth, gravel, crackleBus] = ctx.gains;
    expect(wind.gain.value).toBeCloseTo(0.1 * 0.5, 9);
    expect(kerbAmp.gain.value).toBe(0);
    expect(kerbDepth.gain.value).toBe(0);
    expect(gravel.gain.value).toBe(0);
    expect(squeal.gain.value).toBeCloseTo(0.25 * 0.5, 9);
    expect(crackleBus.gain.value).toBe(0.5);

    audio.updateEffects({ speed: 10, surface: 'gravel', shifting: false, slipRatios: [0, 0, 0, 0] });
    expect(gravel.gain.value).toBeCloseTo(0.35 * 0.5 * 0.5, 9);
    expect(squeal.gain.value).toBe(0);

    audio.updateEffects({ speed: 30, surface: 'kerb', shifting: false, slipRatios: [0, 0, 0, 0] });
    expect(kerbAmp.gain.value).toBeCloseTo(0.15 * 0.5, 9);
    expect(kerbDepth.gain.value).toBeCloseTo(0.15 * 0.5, 9);

    audio.setMasterVolume(0);
    for (const g of ctx.gains) expect(g.gain.value).toBe(0);
    expect(engine.gain.value).toBe(0);
    expect(sub.gain.value).toBe(0);
  });

  it('a shift rise dips the engine gain for 0.08 s and a new rise restarts the envelope', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.update(3000, 1, [0, 0, 0, 0]);
    const engine = ctx.gains[0];
    expect(engine.gain.value).toBeCloseTo(0.6 * 0.5, 9);

    ctx.currentTime = 0;
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: true, slipRatios: [0, 0, 0, 0] });
    expect(engine.gain.value).toBeCloseTo(0.6 * 0.5, 9); // t = 0 → envelope 1

    ctx.currentTime = 0.04;
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: true, slipRatios: [0, 0, 0, 0] });
    expect(engine.gain.value).toBeCloseTo(0.6 * 0.5 * 0.3, 9);

    ctx.currentTime = 0.08;
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: false, slipRatios: [0, 0, 0, 0] });
    expect(engine.gain.value).toBeCloseTo(0.6 * 0.5, 9);

    ctx.currentTime = 0.5;
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: true, slipRatios: [0, 0, 0, 0] });
    ctx.currentTime = 0.54;
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: true, slipRatios: [0, 0, 0, 0] });
    expect(engine.gain.value).toBeCloseTo(0.6 * 0.5 * 0.3, 9);

    ctx.currentTime = 0.55;
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: false, slipRatios: [0, 0, 0, 0] });
    expect(engine.gain.value).toBeCloseTo(0.6 * 0.5 * 0.3, 9); // still inside the first envelope

    ctx.currentTime = 0.56;
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: true, slipRatios: [0, 0, 0, 0] });
    expect(engine.gain.value).toBeCloseTo(0.6 * 0.5, 9); // rise restarts at t = 0
  });

  it('the engine keeps working when updateEffects is never called', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx, { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0 });
    audio.start();
    audio.update(3000, 1, [0, 0, 0, 0]);
    expect(ctx.gains[0].gain.value).toBeCloseTo(0.6 * 0.5, 9);
    expect(ctx.gains[1].gain.value).toBeCloseTo(0.3 * 0.5, 9);
  });

  it('a lift-off near the limiter schedules 3-8 crackle one-shots once effects are live', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.setLimiterRpm(7000);
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: false, slipRatios: [0, 0, 0, 0] });
    audio.start();
    const before = ctx.started;
    audio.update(6000, 0.9, [0, 0, 0, 0]);
    expect(ctx.started).toBe(before);
    audio.update(6000, 0.05, [0, 0, 0, 0]);
    const burst = ctx.started - before;
    expect(burst).toBeGreaterThanOrEqual(3);
    expect(burst).toBeLessThanOrEqual(8);
  });

  it('dispose stops the effect sources and later updateEffects calls are no-ops', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.updateEffects({ speed: 80, surface: 'gravel', shifting: false, slipRatios: [0.3, 0, 0, 0] });
    audio.start();
    const stopsBefore = ctx.stopped;
    audio.dispose();
    expect(ctx.stopped).toBeGreaterThanOrEqual(stopsBefore + 4); // 3 noise sources + kerb LFO
    expect(() => {
      audio.updateEffects({ speed: 80, surface: 'kerb', shifting: true, slipRatios: [0.3, 0, 0, 0] });
      audio.update(6000, 1, [0, 0, 0, 0]);
    }).not.toThrow();
  });
});
