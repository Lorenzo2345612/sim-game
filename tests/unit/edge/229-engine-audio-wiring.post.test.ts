import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineAudio } from '../../../src/audio/engineAudio';
import { legacySynthSpec, type EngineSynthSpec } from '../../../src/audio/soundSpec';
import type { CarSound } from '../../../src/physics/carSpec';

interface FakeParam {
  value: number;
  setValueAtTime(value: number): FakeParam;
  linearRampToValueAtTime(value: number): FakeParam;
  exponentialRampToValueAtTime(value: number): FakeParam;
  setTargetAtTime(value: number): FakeParam;
  cancelScheduledValues(): FakeParam;
}

function param(initial = 0): FakeParam {
  const p: FakeParam = {
    value: initial,
    setValueAtTime(v: number) {
      p.value = v;
      return p;
    },
    linearRampToValueAtTime(v: number) {
      p.value = v;
      return p;
    },
    exponentialRampToValueAtTime(v: number) {
      p.value = v;
      return p;
    },
    setTargetAtTime(v: number) {
      p.value = v;
      return p;
    },
    cancelScheduledValues() {
      return p;
    },
  };
  return p;
}

type FakeNode = { connect(target: unknown): unknown; disconnect(): void };

function stubNode<T extends object>(extra: T): T & FakeNode {
  return {
    ...extra,
    connect(target: unknown) {
      return target;
    },
    disconnect() {
      /* mock */
    },
  } as T & FakeNode;
}

class FakeContext {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = stubNode({});
  audioWorklet?: { addModule(url: unknown): Promise<void> };

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
    return stubNode({
      type: 'sine' as const,
      frequency: param(440),
      detune: param(0),
      onended: null,
      start() {
        /* mock */
      },
      stop() {
        /* mock */
      },
    });
  }

  createGain() {
    return stubNode({ gain: param() });
  }

  createBiquadFilter() {
    return stubNode({
      type: 'lowpass' as const,
      frequency: param(350),
      Q: param(1),
      gain: param(0),
      detune: param(0),
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
    return stubNode({
      buffer: null,
      loop: false,
      playbackRate: param(1),
      onended: null,
      start() {
        /* mock */
      },
      stop() {
        /* mock */
      },
    });
  }
}

interface WorkletRecord {
  processorOptions: Record<string, unknown> | undefined;
  messages: Array<Record<string, unknown>>;
  disconnected: number;
}

const globals = globalThis as unknown as {
  AudioWorkletNode?: unknown;
  AudioWorkletProcessor?: unknown;
  registerProcessor?: unknown;
  sampleRate?: number;
};

function installWorkletNodeGlobal(): WorkletRecord[] {
  const instances: WorkletRecord[] = [];
  globals.AudioWorkletNode = class {
    record: WorkletRecord;
    port: { postMessage(m: Record<string, unknown>): void; close(): void };
    constructor(_ctx: unknown, _name: string, options?: { processorOptions?: Record<string, unknown> }) {
      this.record = { processorOptions: options?.processorOptions, messages: [], disconnected: 0 };
      this.port = {
        postMessage: (m: Record<string, unknown>) => {
          this.record.messages.push(m);
        },
        close() {
          /* mock */
        },
      };
      instances.push(this.record);
    }
    connect(): void {
      /* mock */
    }
    disconnect(): void {
      this.record.disconnected += 1;
    }
  };
  return instances;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

interface Proc {
  port: { onmessage: ((e: { data: unknown }) => void) | null };
  process(inputs: unknown, outputs: Float32Array[][]): boolean;
}
type ProcCtor = new (options: { processorOptions?: Record<string, unknown> }) => Proc;

async function makeProcessorCtor(): Promise<ProcCtor> {
  const registered: Array<{ name: string; ctor: ProcCtor }> = [];
  globals.AudioWorkletProcessor = class {
    port = { onmessage: null as Proc['port']['onmessage'] };
  };
  globals.registerProcessor = (name: string, ctor: ProcCtor) => {
    registered.push({ name, ctor });
  };
  globals.sampleRate = 48000;
  vi.resetModules();
  await import('../../../src/audio/engineWorklet');
  expect(registered[0]?.name).toBe('engine-synth');
  return registered[0].ctor;
}

function renderLast(proc: Proc, blocks: number): Float32Array {
  let out = new Float32Array(128);
  for (let i = 0; i < blocks; i++) {
    out = new Float32Array(128);
    expect(proc.process([], [[out]])).toBe(true);
  }
  return out;
}

const GT3_SOUND: CarSound = {
  cylinders: 8,
  exhaustLengthM: 1.4,
  intakeMix: 0.25,
  crackle: 0.5,
  synth: legacySynthSpec({ cylinders: 8, exhaustLengthM: 1.4, intakeMix: 0.25, crackle: 0.5 }),
};

const L4_SOUND: CarSound = {
  cylinders: 4,
  exhaustLengthM: 1.2,
  intakeMix: 0.3,
  crackle: 0.2,
  synth: legacySynthSpec({ cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 }),
};

function makeAudio(ctx: FakeContext, sound?: CarSound): EngineAudio {
  return new EngineAudio(() => ctx as unknown as AudioContext, sound);
}

afterEach(() => {
  delete globals.AudioWorkletNode;
  delete globals.AudioWorkletProcessor;
  delete globals.registerProcessor;
  delete globals.sampleRate;
});

describe('229 engine audio wiring post gaps', () => {
  it('W1: a worklet message without load mirrors throttle while an explicit load is honoured', async () => {
    const Ctor = await makeProcessorCtor();
    const synth = L4_SOUND.synth;
    const mirror = new Ctor({ processorOptions: { synth, seed: 1 } });
    const explicit = new Ctor({ processorOptions: { synth, seed: 1 } });
    const zero = new Ctor({ processorOptions: { synth, seed: 1 } });
    mirror.port.onmessage?.({ data: { rpm: 5000, throttle: 1 } });
    explicit.port.onmessage?.({ data: { rpm: 5000, throttle: 1, load: 1 } });
    zero.port.onmessage?.({ data: { rpm: 5000, throttle: 1, load: 0 } });
    const m = renderLast(mirror, 60);
    const e = renderLast(explicit, 60);
    const z = renderLast(zero, 60);
    expect(Array.from(m)).toEqual(Array.from(e));
    expect(Array.from(m)).not.toEqual(Array.from(z));
    expect(m.some((x) => x !== 0)).toBe(true);
  });

  it('W2: wrong-typed control fields keep their previous values in the processor', async () => {
    const Ctor = await makeProcessorCtor();
    const spec: EngineSynthSpec = {
      ...GT3_SOUND.synth,
      whine: { order: 8, gain: 0.4, source: 'wheel', minSpeedMs: 10 },
    };
    const first = { rpm: 5000, throttle: 1, load: 0.4, wheelSpeedMs: 40, limiter: false };
    const keep = new Ctor({ processorOptions: { synth: spec, seed: 3 } });
    const junk = new Ctor({ processorOptions: { synth: spec, seed: 3 } });
    const changed = new Ctor({ processorOptions: { synth: spec, seed: 3 } });
    keep.port.onmessage?.({ data: first });
    keep.port.onmessage?.({ data: first });
    junk.port.onmessage?.({ data: first });
    junk.port.onmessage?.({ data: { rpm: 'high', throttle: 'loud', load: 'mid', wheelSpeedMs: 'fast', limiter: 'yes' } });
    changed.port.onmessage?.({ data: first });
    changed.port.onmessage?.({ data: { rpm: 3000, throttle: 0.2, load: 0, wheelSpeedMs: 0, limiter: true } });
    const k = renderLast(keep, 80);
    const j = renderLast(junk, 80);
    const c = renderLast(changed, 80);
    expect(k.some((x) => x !== 0)).toBe(true);
    expect(Array.from(j)).toEqual(Array.from(k));
    expect(Array.from(j)).not.toEqual(Array.from(c));
  });

  it('E1: update clamps load into [0,1] and wheelSpeedMs into >= 0', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    await flush();
    audio.update(6000, 0.8, [], { load: 5, wheelSpeedMs: -10 });
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 1,
      throttle: 0.8,
      wheelSpeedMs: 0,
      limiter: false,
    });
    audio.update(6000, 0.8, [], { load: -2, wheelSpeedMs: 0 });
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 0,
      throttle: 0.8,
      wheelSpeedMs: 0,
      limiter: false,
    });
  });

  it('E2: non-finite extra values fall back to throttle and zero wheel speed', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    await flush();
    audio.update(6000, 0.8, [], { load: Number.NaN, wheelSpeedMs: Number.POSITIVE_INFINITY });
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 0.8,
      throttle: 0.8,
      wheelSpeedMs: 0,
      limiter: false,
    });
    audio.update(6000, 0.8, [], { load: Number.NEGATIVE_INFINITY, wheelSpeedMs: Number.NaN });
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 0.8,
      throttle: 0.8,
      wheelSpeedMs: 0,
      limiter: false,
    });
  });

  it('E3: update does not mutate the extra argument', async () => {
    installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    await flush();
    const extra = { load: 0.6, wheelSpeedMs: 40 };
    audio.update(6000, 0.8, [], extra);
    audio.update(3000, 0.2, [], extra);
    expect(extra).toEqual({ load: 0.6, wheelSpeedMs: 40 });
  });

  it('E4: the limiter flag is inclusive at limiterRpm - 50 with the default 9000', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    await flush();
    audio.update(8950, 1, []);
    expect(instances[0].messages.at(-1)?.limiter).toBe(true);
    audio.update(8949, 1, []);
    expect(instances[0].messages.at(-1)?.limiter).toBe(false);
  });

  it('E5: setLimiterRpm(7000) moves the limiter threshold', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.setLimiterRpm(7000);
    await flush();
    audio.update(6950, 1, []);
    expect(instances[0].messages.at(-1)?.limiter).toBe(true);
    audio.update(6940, 1, []);
    expect(instances[0].messages.at(-1)?.limiter).toBe(false);
    audio.update(9100, 1, []);
    expect(instances[0].messages.at(-1)?.limiter).toBe(true);
  });

  it('E6: setSound re-posts the last control state to the new node', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    await flush();
    audio.update(6000, 0.8, [], { load: 0.6, wheelSpeedMs: 40 });
    audio.setSound(L4_SOUND);
    expect(instances.length).toBe(2);
    expect(instances[1].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 0.6,
      throttle: 0.8,
      wheelSpeedMs: 40,
      limiter: false,
    });
  });

  it('E7: control state stored while the module loads is posted when the node is built', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    let resolveModule: (() => void) | undefined;
    ctx.audioWorklet = {
      addModule: () =>
        new Promise<void>((resolve) => {
          resolveModule = resolve;
        }),
    };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.update(6000, 0.8, [], { load: 0.4, wheelSpeedMs: 25 });
    expect(instances.length).toBe(0);
    resolveModule?.();
    await flush();
    expect(instances.length).toBe(1);
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 0.4,
      throttle: 0.8,
      wheelSpeedMs: 25,
      limiter: false,
    });
  });

  it('M1: main.ts guards the load denominator and clamps it into [0,1]', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'main.ts'), 'utf8');
    expect(src).toMatch(/const load = fullTq > 0 \? Math\.min\(1, Math\.max\(0, engineTorque\(/);
    expect(src).toMatch(/\/ fullTq\)\) : 0;/);
  });
});
