import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Surface } from '../../../src/core/types';
import { EngineAudio } from '../../../src/audio/engineAudio';
import { legacySynthSpec } from '../../../src/audio/soundSpec';
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
  gains: Array<{ gain: FakeParam }> = [];
  bufferStarts = 0;
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
    const g = stubNode({ gain: param() });
    this.gains.push(g);
    return g;
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
      start: () => {
        this.bufferStarts += 1;
      },
      stop() {
        /* mock */
      },
    });
  }
}

interface EngineAudioApi {
  start(): void;
  update(
    rpm: number,
    throttle: number,
    slipRatios: readonly number[],
    extra?: { load?: number; wheelSpeedMs?: number },
  ): void;
  updateEffects(s: { speed: number; surface: Surface; shifting: boolean; slipRatios: readonly number[] }): void;
  setSound(sound: CarSound): void;
  setLimiterRpm(rpm: number): void;
  getStats(): { running: boolean; engine: 'worklet' | 'oscillator'; firingHz: number };
}

function makeAudio(ctx: FakeContext, sound?: CarSound): EngineAudioApi {
  const Ctor = EngineAudio as unknown as new (
    createContext?: () => AudioContext,
    sound?: CarSound,
  ) => EngineAudioApi;
  return new Ctor(() => ctx as unknown as AudioContext, sound);
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

const GT3_SOUND: CarSound = {
  cylinders: 8,
  exhaustLengthM: 1.4,
  intakeMix: 0.25,
  crackle: 0.5,
  synth: legacySynthSpec({ cylinders: 8, exhaustLengthM: 1.4, intakeMix: 0.25, crackle: 0.5 }),
};

afterEach(() => {
  delete globals.AudioWorkletNode;
  delete globals.AudioWorkletProcessor;
  delete globals.registerProcessor;
  delete globals.sampleRate;
});

describe('229 engine audio wiring acceptance', () => {
  it('AT1: worklet processor with gt3-a synth seed 3 renders no NaN and last-100-block RMS > 0.01', async () => {
    type MsgHandler = (e: { data: unknown }) => void;
    interface Processor {
      port: { onmessage: MsgHandler | null };
      process(inputs: unknown, outputs: Float32Array[][]): boolean;
    }
    type ProcessorCtor = new (options: { processorOptions?: Record<string, unknown> }) => Processor;
    const registered: Array<{ name: string; ctor: ProcessorCtor }> = [];
    globals.AudioWorkletProcessor = class {
      port = { onmessage: null as MsgHandler | null };
    };
    globals.registerProcessor = (name: string, ctor: ProcessorCtor) => {
      registered.push({ name, ctor });
    };
    globals.sampleRate = 48000;
    vi.resetModules();
    await import('../../../src/audio/engineWorklet');
    expect(registered.length).toBe(1);
    expect(registered[0].name).toBe('engine-synth');
    const proc = new registered[0].ctor({
      processorOptions: { synth: GT3_SOUND.synth, seed: 3 },
    });
    proc.port.onmessage?.({
      data: { rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 0, limiter: false },
    });
    const blocks: Float32Array[] = [];
    for (let i = 0; i < 400; i++) {
      const out = new Float32Array(128);
      proc.process([], [[out]]);
      blocks.push(out);
    }
    const allFinite = blocks.every((b) => Array.from(b).every((x) => Number.isFinite(x)));
    expect(allFinite).toBe(true);
    let sumSquares = 0;
    let count = 0;
    for (let i = 300; i < 400; i++) {
      for (const x of blocks[i]) {
        sumSquares += x * x;
        count += 1;
      }
    }
    expect(Math.sqrt(sumSquares / count)).toBeGreaterThan(0.01);
  });

  it('AT2: update with extra posts {rpm:6000, load:0.6, throttle:0.8, wheelSpeedMs:40, limiter:false}', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.start();
    await flush();
    audio.update(6000, 0.8, [], { load: 0.6, wheelSpeedMs: 40 });
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 0.6,
      throttle: 0.8,
      wheelSpeedMs: 40,
      limiter: false,
    });
  });

  it('AT3: update without extra posts load 0.8 and wheelSpeedMs 0', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.start();
    await flush();
    audio.update(6000, 0.8, []);
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 0.8,
      throttle: 0.8,
      wheelSpeedMs: 0,
      limiter: false,
    });
  });

  it('AT4: limiterRpm 9000 flags the limiter at 8960 rpm and not at 8940', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.setLimiterRpm(9000);
    audio.start();
    await flush();
    audio.update(8960, 1, []);
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 8960,
      load: 1,
      throttle: 1,
      wheelSpeedMs: 0,
      limiter: true,
    });
    audio.update(8940, 1, []);
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 8940,
      load: 1,
      throttle: 1,
      wheelSpeedMs: 0,
      limiter: false,
    });
  });

  it('AT5: a lift-off with a ready worklet schedules no crackle one-shots; a failed worklet keeps the 110 burst', async () => {
    installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.start();
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: false, slipRatios: [0, 0, 0, 0] });
    await flush();
    expect(audio.getStats().engine).toBe('worklet');
    const before = ctx.bufferStarts;
    audio.update(8500, 1, []);
    audio.update(8500, 0, []);
    expect(ctx.bufferStarts).toBe(before);

    const ctxFail = new FakeContext();
    ctxFail.audioWorklet = { addModule: () => Promise.reject(new Error('no worklet')) };
    const failed = makeAudio(ctxFail, GT3_SOUND);
    failed.start();
    failed.updateEffects({ speed: 0, surface: 'asphalt', shifting: false, slipRatios: [0, 0, 0, 0] });
    await flush();
    expect(failed.getStats().engine).toBe('oscillator');
    const beforeFail = ctxFail.bufferStarts;
    failed.update(8500, 1, []);
    failed.update(8500, 0, []);
    const burst = ctxFail.bufferStarts - beforeFail;
    expect(burst).toBeGreaterThanOrEqual(3);
    expect(burst).toBeLessThanOrEqual(8);
  });

  it('AT6: setSound with a different synth rebuilds the node with processorOptions.synth and disconnects the old one', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx);
    await flush();
    expect(instances.length).toBe(1);
    audio.setSound(GT3_SOUND);
    expect(instances.length).toBe(2);
    expect(instances[0].disconnected).toBeGreaterThanOrEqual(1);
    expect(instances[1].processorOptions?.synth).toEqual(GT3_SOUND.synth);
  });

  it('AT7: src/main.ts engineAudio?.update( passes a 4th argument with load from engineTorque and wheelSpeedMs', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'main.ts'), 'utf8');
    const needle = 'engineAudio?.update(';
    const at = src.indexOf(needle);
    expect(at).toBeGreaterThanOrEqual(0);
    let depth = 0;
    const args: string[] = [];
    let start = at + needle.length;
    for (let i = at + needle.length - 1; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          args.push(src.slice(start, i).trim());
          break;
        }
      } else if (ch === ',' && depth === 1) {
        args.push(src.slice(start, i).trim());
        start = i + 1;
      }
    }
    expect(args.length).toBeGreaterThanOrEqual(4);
    expect(args[3]).toMatch(/\bload\b/);
    expect(args[3]).toMatch(/\bwheelSpeedMs\b/);
    expect(src).toMatch(/load\s*[:=][^;]*engineTorque/);
    expect(src).toMatch(/wheelSpeedMs\s*[:=]\s*Math\.abs\(interp\.forwardSpeed\)/);
  });
});
