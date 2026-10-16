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

interface FakeSource {
  buffer: unknown;
  loop: boolean;
  playbackRate: FakeParam;
  onended: (() => void) | null;
  starts: number[];
  stops: number[];
  start(t?: number): void;
  stop(t?: number): void;
}

class FakeContext {
  gains: Array<{ gain: FakeParam }> = [];
  oscillators: Array<{ type: string; frequency: FakeParam }> = [];
  sources: FakeSource[] = [];
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
    const osc = node({
      type: 'sine' as const,
      frequency: new FakeParam(440),
      detune: new FakeParam(0),
      onended: null as (() => void) | null,
      start: () => {
        /* counted via sources-style hook below */
      },
      stop: () => {
        /* mock */
      },
    });
    this.oscillators.push(osc);
    return osc;
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

  createBufferSource(): FakeSource {
    const src: FakeSource = {
      buffer: null,
      loop: false,
      playbackRate: new FakeParam(1),
      onended: null,
      starts: [],
      stops: [],
      start(t?: number) {
        this.starts.push(t ?? -1);
      },
      stop(t?: number) {
        this.stops.push(t ?? -1);
      },
    };
    const wrapped = node(src) as unknown as FakeSource & { connect(t: unknown): unknown; disconnect(): void };
    this.sources.push(wrapped);
    return wrapped;
  }
}

const SOUND: CarSound = { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 1 };

function audioWith(ctx: FakeContext, sound: CarSound = SOUND): EngineAudio {
  return new EngineAudio(() => ctx as unknown as AudioContext, sound);
}

const NO_SLIP: readonly number[] = [0, 0, 0, 0];

function liftOff(audio: EngineAudio): void {
  audio.update(6000, 0.9, NO_SLIP);
  audio.update(6000, 0.05, NO_SLIP);
}

describe('110 audio effects post edges — helpers', () => {
  it('windGain treats non-finite speeds as 0 (NaN) or fully open (Infinity)', () => {
    expect(windGain(NaN)).toBe(0);
    expect(windGain(Infinity)).toBeCloseTo(0.4, 12);
  });

  it('shiftEnvelope returns 1 for non-finite t', () => {
    expect(shiftEnvelope(NaN)).toBe(1);
    expect(shiftEnvelope(Infinity)).toBe(1);
  });

  it('kerbRumbleHz returns 0 for a non-finite stripe and divides raw for negative speed', () => {
    expect(kerbRumbleHz(30, NaN)).toBe(0);
    expect(kerbRumbleHz(30, Infinity)).toBe(0);
    expect(kerbRumbleHz(-30, 1.5)).toBe(-20);
  });

  it('crackleSchedule never fires for negative rpm against a positive limiter', () => {
    const rng = (): number => 1;
    expect(crackleSchedule(0.9, 0.05, -1, 7000, 1, rng)).toEqual([]);
    expect(crackleSchedule(0.9, 0.05, -1, 0, 1, rng)).toEqual([]);
  });
});

describe('110 audio effects post edges — wiring', () => {
  it('kerb LFO frequency follows |speed| / 1.5 on kerb and freezes when leaving kerb', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.updateEffects({ speed: 30, surface: 'kerb', shifting: false, slipRatios: NO_SLIP });
    const kerbLfo = ctx.oscillators[2]; // oscEngine, oscSub, then kerbLfo
    expect(kerbLfo.frequency.value).toBeCloseTo(20, 9);

    audio.updateEffects({ speed: -30, surface: 'kerb', shifting: false, slipRatios: NO_SLIP });
    expect(kerbLfo.frequency.value).toBeCloseTo(20, 9);

    audio.updateEffects({ speed: 60, surface: 'asphalt', shifting: false, slipRatios: NO_SLIP });
    expect(kerbLfo.frequency.value).toBeCloseTo(20, 9); // not updated off kerb
  });

  it('gravel gain saturates at speed 20 m/s and uses |speed| below it', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.updateEffects({ speed: 50, surface: 'gravel', shifting: false, slipRatios: NO_SLIP });
    const gravelGain = ctx.gains[6];
    expect(gravelGain.gain.value).toBeCloseTo(0.35 * 0.5, 9);

    audio.updateEffects({ speed: -10, surface: 'gravel', shifting: false, slipRatios: NO_SLIP });
    expect(gravelGain.gain.value).toBeCloseTo(0.35 * 0.5 * 0.5, 9);
  });

  it('negative speed produces no wind gain while squeal still follows slip', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.updateEffects({ speed: -40, surface: 'asphalt', shifting: false, slipRatios: [0.25, 0, 0, 0] });
    expect(ctx.gains[3].gain.value).toBe(0);
    expect(ctx.gains[2].gain.value).toBeCloseTo(0.125 * 0.5, 9);
  });

  it('grass and runoff leave kerb and gravel gains at 0', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    for (const surface of ['grass', 'runoff'] as const) {
      audio.updateEffects({ speed: 25, surface, shifting: false, slipRatios: NO_SLIP });
      expect(ctx.gains[4].gain.value).toBe(0); // kerbAmp
      expect(ctx.gains[6].gain.value).toBe(0); // gravel
    }
  });

  it('updateEffects with an empty slipRatios array zeroes squeal and never throws', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    expect(() => audio.updateEffects({ speed: 10, surface: 'asphalt', shifting: false, slipRatios: [] })).not.toThrow();
    expect(ctx.gains[2].gain.value).toBe(0);
  });

  it('crackle one-shots require a started engine', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.setLimiterRpm(7000);
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: false, slipRatios: NO_SLIP });
    liftOff(audio); // effects live, running still false
    expect(ctx.sources).toHaveLength(4); // squeal + 3 effect noises only

    audio.start();
    liftOff(audio);
    const burst = ctx.sources.length - 4;
    expect(burst).toBeGreaterThanOrEqual(3);
    expect(burst).toBeLessThanOrEqual(8);
  });

  it('crackle one-shots require live effect nodes', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.setLimiterRpm(7000);
    audio.start();
    liftOff(audio); // never called updateEffects
    expect(ctx.sources).toHaveLength(1); // squeal noise only
  });

  it('a silent crackle car never schedules one-shots on lift-off', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx, { ...SOUND, crackle: 0 });
    audio.setLimiterRpm(7000);
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: false, slipRatios: NO_SLIP });
    audio.start();
    liftOff(audio);
    expect(ctx.sources).toHaveLength(4);
  });

  it('dispose stops pending crackle one-shots', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.setLimiterRpm(7000);
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: false, slipRatios: NO_SLIP });
    audio.start();
    liftOff(audio);
    const crackles = ctx.sources.slice(4);
    expect(crackles.length).toBeGreaterThanOrEqual(3);
    expect(crackles.every((s) => s.stops.length === 1)).toBe(true); // scheduled end time
    audio.dispose();
    expect(crackles.every((s) => s.stops.length === 2)).toBe(true); // plus dispose stop
  });

  it('setLimiterRpm ignores non-positive and non-finite values', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.setLimiterRpm(0);
    audio.setLimiterRpm(-1);
    audio.setLimiterRpm(NaN);
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: false, slipRatios: NO_SLIP });
    audio.start();
    // default limiter 9000: 5000 < 0.7·9000 → no crackle
    audio.update(5000, 0.9, NO_SLIP);
    audio.update(5000, 0.05, NO_SLIP);
    expect(ctx.sources).toHaveLength(4);

    audio.setLimiterRpm(7000); // 5000 ≥ 0.7·7000
    audio.update(5000, 0.9, NO_SLIP);
    audio.update(5000, 0.05, NO_SLIP);
    expect(ctx.sources.length).toBeGreaterThan(4);
  });
});
