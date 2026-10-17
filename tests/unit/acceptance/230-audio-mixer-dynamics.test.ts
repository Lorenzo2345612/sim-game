import { describe, it, expect } from 'vitest';
import {
  BYPASS_LOWPASS_HZ,
  COCKPIT_LOWPASS_HZ,
  Mixer,
  type MixerNodes,
} from '../../../src/audio/mixer';
import { EngineAudio } from '../../../src/audio/engineAudio';

type ParamEvent = { kind: 'set' | 'ramp' | 'target'; value: number; time: number; tau?: number };

class FakeParam {
  value: number;
  events: ParamEvent[] = [];
  constructor(initial = 0) {
    this.value = initial;
  }
  setValueAtTime(v: number, t: number): FakeParam {
    this.events.push({ kind: 'set', value: v, time: t });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): FakeParam {
    this.events.push({ kind: 'ramp', value: v, time: t });
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number, t: number, tau: number): FakeParam {
    this.events.push({ kind: 'target', value: v, time: t, tau });
    this.value = v;
    return this;
  }
  lastTarget(): ParamEvent {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.kind === 'target') return e;
    }
    throw new Error('no setTargetAtTime scheduled');
  }
  setEvents(): ParamEvent[] {
    return this.events.filter((e) => e.kind === 'set');
  }
}

function makeMixer(): {
  ctx: { currentTime: number };
  engineFilterFreq: FakeParam;
  cockpitWetGain: FakeParam;
  mixer: Mixer;
} {
  const ctx = { currentTime: 0 };
  const passthrough = { connect: () => undefined, disconnect: () => undefined };
  const engineFilterFreq = new FakeParam(BYPASS_LOWPASS_HZ);
  const cockpitWetGain = new FakeParam(0);
  const nodes = {
    master: { ...passthrough, gain: new FakeParam(0) },
    engine: { ...passthrough, gain: new FakeParam(0) },
    effects: { ...passthrough, gain: new FakeParam(0) },
    engineFilter: { ...passthrough, type: 'lowpass', frequency: engineFilterFreq, Q: new FakeParam(1) },
    cockpitWet: { ...passthrough, gain: cockpitWetGain },
  };
  const mixer = new Mixer(
    ctx as unknown as AudioContext,
    nodes as unknown as MixerNodes,
    { master: 0.8, engine: 1, effects: 1 },
  );
  return { ctx, engineFilterFreq, cockpitWetGain, mixer };
}

type FakeNode<T> = T & {
  connections: unknown[];
  connect(target: unknown): unknown;
  disconnect(): void;
};

function node<T extends object>(extra: T): FakeNode<T> {
  return {
    ...extra,
    connections: [] as unknown[],
    connect(target: unknown) {
      this.connections.push(target);
      return target;
    },
    disconnect() {
      this.connections.length = 0;
    },
  };
}

interface FakeBuffer {
  numberOfChannels: number;
  length: number;
  duration: number;
  sampleRate: number;
  getChannelData(ch: number): Float32Array;
  copyToChannel(src: Float32Array, ch: number): void;
}

type FakeCompressor = FakeNode<{
  threshold: FakeParam;
  knee: FakeParam;
  ratio: FakeParam;
  attack: FakeParam;
  release: FakeParam;
}>;

type FakeConvolver = FakeNode<{ buffer: FakeBuffer | null; normalize: boolean }>;

class WireContext {
  gains: Array<FakeNode<{ gain: FakeParam }>> = [];
  filters: Array<FakeNode<{ type: string; frequency: FakeParam; Q: FakeParam }>> = [];
  compressors: FakeCompressor[] = [];
  convolvers: FakeConvolver[] = [];
  currentTime = 0;
  sampleRate: number;
  destination = node({});

  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
  }

  createOscillator() {
    return node({
      type: 'sine',
      frequency: new FakeParam(440),
      detune: new FakeParam(0),
      onended: null,
      start: () => undefined,
      stop: () => undefined,
    });
  }

  createGain() {
    const g = node({ gain: new FakeParam() });
    this.gains.push(g);
    return g;
  }

  createBiquadFilter() {
    const f = node({ type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1) });
    this.filters.push(f);
    return f;
  }

  createDynamicsCompressor() {
    const c = node({
      threshold: new FakeParam(0),
      knee: new FakeParam(30),
      ratio: new FakeParam(12),
      attack: new FakeParam(0.003),
      release: new FakeParam(0.25),
    });
    this.compressors.push(c);
    return c;
  }

  createConvolver() {
    const c = node({ buffer: null as FakeBuffer | null, normalize: true });
    this.convolvers.push(c);
    return c;
  }

  createBuffer(channels: number, length: number, rate: number): FakeBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      duration: length / rate,
      sampleRate: rate,
      getChannelData: (ch: number) => data[ch],
      copyToChannel: (src: Float32Array, ch: number) => {
        data[ch].set(src);
      },
    };
  }

  createBufferSource() {
    return node({
      buffer: null as unknown,
      loop: false,
      playbackRate: new FakeParam(1),
      onended: null,
      start: () => undefined,
      stop: () => undefined,
    });
  }
}

function convolverImpulse(ctx: WireContext): Float32Array {
  const convolver = ctx.convolvers[0];
  if (!convolver?.buffer) throw new Error('missing convolver impulse buffer');
  return convolver.buffer.getChannelData(0);
}

function energy(a: Float32Array): number {
  let sum = 0;
  for (const x of a) sum += x * x;
  return sum;
}

describe('230 audio mixer dynamics acceptance', () => {
  it('AT1: COCKPIT_LOWPASS_HZ is 2500', () => {
    expect(COCKPIT_LOWPASS_HZ).toBeCloseTo(2500, 9);
  });

  it('AT2: the master bus ends in two DynamicsCompressors then the destination', () => {
    const ctx = new WireContext();
    const audio = new EngineAudio(() => ctx as unknown as AudioContext);
    expect(ctx.compressors).toHaveLength(0);
    ctx.currentTime = 1.25;
    const bus = audio.mixerNodes();
    expect(ctx.compressors).toHaveLength(2);
    const [compA, compB] = ctx.compressors;
    const master = bus.master as unknown as FakeNode<{ gain: FakeParam }>;
    expect(master.connections).toHaveLength(1);
    expect(master.connections[0]).toBe(compA);
    expect(master.connections).not.toContain(ctx.destination);
    expect(compA.connections).toHaveLength(1);
    expect(compA.connections[0]).toBe(compB);
    expect(compB.connections).toHaveLength(1);
    expect(compB.connections[0]).toBe(ctx.destination);
    for (const p of [compA.threshold, compA.ratio, compA.attack, compA.release]) {
      const sets = p.setEvents();
      expect(sets).toHaveLength(1);
      expect(sets[0].time).toBeCloseTo(1.25, 9);
    }
    expect(compA.threshold.value).toBeCloseTo(-18, 9);
    expect(compA.ratio.value).toBeCloseTo(4, 9);
    expect(compA.attack.value).toBeCloseTo(0.005, 9);
    expect(compA.release.value).toBeCloseTo(0.15, 9);
    for (const p of [compB.threshold, compB.ratio, compB.attack, compB.release]) {
      const sets = p.setEvents();
      expect(sets).toHaveLength(1);
      expect(sets[0].time).toBeCloseTo(1.25, 9);
    }
    expect(compB.threshold.value).toBeCloseTo(-2, 9);
    expect(compB.ratio.value).toBeCloseTo(20, 9);
    expect(compB.attack.value).toBeCloseTo(0.001, 9);
    expect(compB.release.value).toBeCloseTo(0.05, 9);
    expect(compA.knee.events).toHaveLength(0);
    expect(compB.knee.events).toHaveLength(0);
  });

  it('AT3: the camera switch ramps the engine lowpass via setTargetAtTime with tau 0.05 and no setValueAtTime', () => {
    const { ctx, engineFilterFreq, mixer } = makeMixer();
    ctx.currentTime = 2;
    const setsBefore = engineFilterFreq.setEvents().length;
    mixer.setCameraMode('cockpit');
    const cockpit = engineFilterFreq.lastTarget();
    expect(cockpit.value).toBeCloseTo(2500, 9);
    expect(cockpit.time).toBeCloseTo(2, 9);
    expect(cockpit.tau).toBeCloseTo(0.05, 9);
    ctx.currentTime = 3;
    mixer.setCameraMode('tcam');
    const exterior = engineFilterFreq.lastTarget();
    expect(exterior.value).toBeCloseTo(BYPASS_LOWPASS_HZ, 9);
    expect(exterior.time).toBeCloseTo(3, 9);
    expect(exterior.tau).toBeCloseTo(0.05, 9);
    expect(engineFilterFreq.setEvents()).toHaveLength(setsBefore);
  });

  it('AT4: at 48 kHz the cockpit impulse is 3840 samples, deterministic, peak-bounded and decayed', () => {
    const ctx = new WireContext(48000);
    const audio = new EngineAudio(() => ctx as unknown as AudioContext);
    expect(ctx.convolvers).toHaveLength(0);
    audio.mixerNodes();
    expect(ctx.convolvers).toHaveLength(1);
    const data = convolverImpulse(ctx);
    expect(data.length).toBe(Math.round(0.08 * 48000));
    const ctx2 = new WireContext(48000);
    const audio2 = new EngineAudio(() => ctx2 as unknown as AudioContext);
    audio2.mixerNodes();
    expect(Array.from(convolverImpulse(ctx2))).toEqual(Array.from(data));
    let peak = 0;
    for (const x of data) peak = Math.max(peak, Math.abs(x));
    expect(peak).toBeLessThanOrEqual(1);
    const window = Math.round(0.01 * 48000);
    expect(energy(data.subarray(data.length - window))).toBeLessThan(0.05 * energy(data.subarray(0, window)));
  });

  it('AT5: cockpit targets the wet gain at 0.25 and exterior at 0 via setTargetAtTime with tau 0.05', () => {
    const { ctx, cockpitWetGain, mixer } = makeMixer();
    ctx.currentTime = 1.5;
    mixer.setCameraMode('cockpit');
    const wet = cockpitWetGain.lastTarget();
    expect(wet.value).toBeCloseTo(0.25, 9);
    expect(wet.time).toBeCloseTo(1.5, 9);
    expect(wet.tau).toBeCloseTo(0.05, 9);
    ctx.currentTime = 2.5;
    mixer.setCameraMode('chase');
    const dry = cockpitWetGain.lastTarget();
    expect(dry.value).toBeCloseTo(0, 9);
    expect(dry.time).toBeCloseTo(2.5, 9);
    expect(dry.tau).toBeCloseTo(0.05, 9);
  });
});
