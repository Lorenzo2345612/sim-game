import { describe, it, expect } from 'vitest';
import {
  BYPASS_LOWPASS_HZ,
  COCKPIT_LOWPASS_HZ,
  Mixer,
  type MixerNodes,
} from '../../../src/audio/mixer';
import { EngineAudio } from '../../../src/audio/engineAudio';
import {
  DEFAULT_VOLUMES,
  loadVolumes,
  savePreset,
  saveVolumes,
  SETTINGS_KEY,
  type KeyValueStorage,
} from '../../../src/core/settings';

class MapStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

class FakeParam {
  value: number;
  events: Array<{ kind: 'set' | 'ramp'; value: number; time: number }> = [];
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
  setTargetAtTime(v: number): FakeParam {
    this.value = v;
    return this;
  }
  lastRamp(): { value: number; time: number } {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].kind === 'ramp') return this.events[i];
    }
    throw new Error('no ramp scheduled');
  }
}

class FakeContext {
  currentTime = 0;
}

function makeMixer(volumes = { master: 0.8, engine: 1, effects: 1 }): {
  ctx: FakeContext;
  master: FakeParam;
  engine: FakeParam;
  effects: FakeParam;
  engineFilter: FakeParam;
  mixer: Mixer;
} {
  const ctx = new FakeContext();
  const master = new FakeParam(0);
  const engine = new FakeParam(0);
  const effects = new FakeParam(0);
  const engineFilter = new FakeParam(22050);
  const passthrough = { connect: () => undefined, disconnect: () => undefined };
  const nodes = {
    master: { ...passthrough, gain: master },
    engine: { ...passthrough, gain: engine },
    effects: { ...passthrough, gain: effects },
    engineFilter: { ...passthrough, type: 'lowpass', frequency: engineFilter, Q: new FakeParam(1) },
  };
  const mixer = new Mixer(
    ctx as unknown as AudioContext,
    nodes as unknown as MixerNodes,
    volumes,
  );
  return { ctx, master, engine, effects, engineFilter, mixer };
}

describe('volume persistence', () => {
  it('missing, corrupt or non-object settings load the defaults per field', () => {
    const empty = loadVolumes(new MapStorage());
    expect(empty).toEqual(DEFAULT_VOLUMES);
    const corrupt: KeyValueStorage = {
      getItem: () => '{oops',
      setItem: () => undefined,
    };
    expect(loadVolumes(corrupt)).toEqual(DEFAULT_VOLUMES);
    const wrongType: KeyValueStorage = {
      getItem: () => JSON.stringify({ volume: 'loud' }),
      setItem: () => undefined,
    };
    expect(loadVolumes(wrongType)).toEqual(DEFAULT_VOLUMES);
    const arr: KeyValueStorage = {
      getItem: () => JSON.stringify({ volume: [0.1, 0.2, 0.3] }),
      setItem: () => undefined,
    };
    expect(loadVolumes(arr)).toEqual(DEFAULT_VOLUMES);
  });

  it('partial volumes fall back per field and out-of-range values clamp to [0, 1]', () => {
    const storage: KeyValueStorage = {
      getItem: () => JSON.stringify({ volume: { master: 0.3, engine: 2, effects: null } }),
      setItem: () => undefined,
    };
    const v = loadVolumes(storage);
    expect(v.master).toBeCloseTo(0.3, 9);
    expect(v.engine).toBeCloseTo(1, 9);
    expect(v.effects).toBeCloseTo(1, 9);
    const clamped: KeyValueStorage = {
      getItem: () => JSON.stringify({ volume: { master: -0.5, engine: 0.4, effects: 7 } }),
      setItem: () => undefined,
    };
    const c = loadVolumes(clamped);
    expect(c.master).toBeCloseTo(0, 9);
    expect(c.engine).toBeCloseTo(0.4, 9);
    expect(c.effects).toBeCloseTo(1, 9);
  });

  it('saveVolumes round-trips and keeps unrelated keys', () => {
    const storage = new MapStorage();
    savePreset(storage, 'medium');
    saveVolumes(storage, { master: 0.25, engine: 0.5, effects: 0.75 });
    const stored = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
    expect(stored.preset).toBe('medium');
    expect(loadVolumes(storage)).toEqual({ master: 0.25, engine: 0.5, effects: 0.75 });
  });

  it('savePreset keeps stored volumes', () => {
    const storage = new MapStorage();
    saveVolumes(storage, { master: 0.6, engine: 0.7, effects: 0.8 });
    savePreset(storage, 'low');
    expect(loadVolumes(storage)).toEqual({ master: 0.6, engine: 0.7, effects: 0.8 });
  });
});

describe('Mixer gains and filter', () => {
  it('the constructor applies clamped volumes and a bypassed filter', () => {
    const { master, engine, effects, engineFilter } = makeMixer({ master: 2, engine: -1, effects: 0.5 });
    expect(master.value).toBeCloseTo(1, 9);
    expect(engine.value).toBeCloseTo(0, 9);
    expect(effects.value).toBeCloseTo(0.5, 9);
    expect(engineFilter.value).toBeCloseTo(BYPASS_LOWPASS_HZ, 9);
  });

  it('setVolumes clamps, does not mutate the argument and ramps master from its current value', () => {
    const { ctx, master, engine, effects, mixer } = makeMixer();
    const arg = { master: 3, engine: 0.25, effects: -1 };
    ctx.currentTime = 5;
    mixer.setVolumes(arg);
    expect(arg).toEqual({ master: 3, engine: 0.25, effects: -1 });
    expect(engine.value).toBeCloseTo(0.25, 9);
    expect(effects.value).toBeCloseTo(0, 9);
    const up = master.lastRamp();
    expect(up.value).toBeCloseTo(1, 9);
    expect(up.time).toBeCloseTo(5.1, 9);
    expect(master.events[master.events.length - 2]).toEqual({ kind: 'set', value: 0.8, time: 5 });
  });

  it('setVolumes while paused keeps the master at 0 and resume uses the new master', () => {
    const { ctx, master, mixer } = makeMixer();
    mixer.setPaused(true);
    ctx.currentTime = 2;
    mixer.setVolumes({ master: 0.4, engine: 1, effects: 1 });
    expect(master.value).toBeCloseTo(0, 9);
    mixer.setPaused(false);
    expect(master.lastRamp().value).toBeCloseTo(0.4, 9);
  });

  it('setPaused is idempotent and anchors each ramp at ctx.currentTime', () => {
    const { ctx, master, mixer } = makeMixer();
    ctx.currentTime = 1;
    mixer.setPaused(true);
    mixer.setPaused(true);
    expect(master.events.filter((e) => e.kind === 'ramp')).toHaveLength(1);
    expect(master.lastRamp()).toEqual({ kind: 'ramp', value: 0, time: 1.1 });
    ctx.currentTime = 4;
    mixer.setPaused(false);
    mixer.setPaused(false);
    expect(master.events.filter((e) => e.kind === 'ramp')).toHaveLength(2);
    expect(master.lastRamp().value).toBeCloseTo(0.8, 9);
  });

  it('setCameraMode filters only in the cockpit and bypasses tcam and chase', () => {
    const { engineFilter, mixer } = makeMixer();
    mixer.setCameraMode('tcam');
    expect(engineFilter.value).toBeCloseTo(BYPASS_LOWPASS_HZ, 9);
    mixer.setCameraMode('cockpit');
    expect(engineFilter.value).toBeCloseTo(COCKPIT_LOWPASS_HZ, 9);
    mixer.setCameraMode('chase');
    expect(engineFilter.value).toBeCloseTo(BYPASS_LOWPASS_HZ, 9);
  });
});

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

type FakeCompressor = FakeNode<{
  threshold: FakeParam;
  knee: FakeParam;
  ratio: FakeParam;
  attack: FakeParam;
  release: FakeParam;
}>;

class WireContext {
  gains: Array<FakeNode<{ gain: FakeParam }>> = [];
  filters: Array<FakeNode<{ type: string; frequency: FakeParam; Q: FakeParam }>> = [];
  compressors: FakeCompressor[] = [];
  currentTime = 0;
  sampleRate = 44100;
  destination = node({});

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
    return node({ buffer: null as unknown, normalize: true });
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
      onended: null,
      start: () => undefined,
      stop: () => undefined,
    });
  }
}

describe('EngineAudio mixer bus', () => {
  it('builds the bus lazily once and rewires engine and effects through it', () => {
    const ctx = new WireContext();
    const audio = new EngineAudio(() => ctx as unknown as AudioContext);
    expect(ctx.gains.length).toBe(3); // engine, sub, squeal — the mixer bus waits for mixerNodes()
    const bus = audio.mixerNodes();
    expect(ctx.gains.length).toBe(7); // + master, engine, effects, cockpitWet
    const again = audio.mixerNodes();
    expect(again.master).toBe(bus.master);
    expect(ctx.gains.length).toBe(7);
    const [engineGain, , squealGain, masterGain, engineBus, effectsBus] = ctx.gains;
    const [toneFilter, , cameraFilter] = ctx.filters;
    expect(bus.master).toBe(masterGain);
    expect(bus.engine).toBe(engineBus);
    expect(bus.effects).toBe(effectsBus);
    expect(bus.engineFilter).toBe(cameraFilter);
    expect(cameraFilter.connections).toContain(engineBus);
    expect(engineBus.connections).toContain(masterGain);
    expect(effectsBus.connections).toContain(masterGain);
    expect(ctx.compressors).toHaveLength(2);
    expect(masterGain.connections).toEqual([ctx.compressors[0]]);
    expect(ctx.compressors[0].connections).toEqual([ctx.compressors[1]]);
    expect(ctx.compressors[1].connections).toEqual([ctx.destination]);
    expect(toneFilter.connections).toEqual([cameraFilter]);
    expect(squealGain.connections).toEqual([effectsBus]);
    expect(engineGain.connections).toEqual([toneFilter]);

    audio.updateEffects({ speed: 30, surface: 'asphalt', shifting: false, slipRatios: [0, 0, 0, 0] });
    const wind = ctx.gains[7];
    const kerbAmp = ctx.gains[8];
    const gravel = ctx.gains[10];
    const crackleBus = ctx.gains[11];
    for (const g of [wind, kerbAmp, gravel, crackleBus]) {
      expect(g.connections).toEqual([effectsBus]);
    }
  });

  it('the Mixer drives the real engine filter and master gain', () => {
    const ctx = new WireContext();
    const audio = new EngineAudio(() => ctx as unknown as AudioContext);
    const bus = audio.mixerNodes();
    const mixer = new Mixer(bus.ctx, bus, { master: 0.6, engine: 0.9, effects: 1 });
    expect(bus.engineFilter.frequency.value).toBeCloseTo(BYPASS_LOWPASS_HZ, 9);
    expect(bus.master.gain.value).toBeCloseTo(0.6, 9);
    expect(bus.engine.gain.value).toBeCloseTo(0.9, 9);
    mixer.setCameraMode('cockpit');
    expect(bus.engineFilter.frequency.value).toBeCloseTo(COCKPIT_LOWPASS_HZ, 9);
    ctx.currentTime = 10;
    mixer.setPaused(true);
    expect(ctx.gains[3].gain.lastRamp().value).toBe(0);
  });
});
