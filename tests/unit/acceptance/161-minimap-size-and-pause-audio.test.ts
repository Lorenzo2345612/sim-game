import { describe, it, expect } from 'vitest';
import { EngineAudio } from '../../../src/audio/engineAudio';

interface FakeParam {
  value: number;
  setValueAtTime(value: number): FakeParam;
  linearRampToValueAtTime(value: number): FakeParam;
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
  resumeCount = 0;
  suspendCount = 0;
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = stubNode({});

  resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCount += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  createOscillator() {
    return stubNode({
      type: 'sine',
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
      type: 'lowpass',
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

function audioWith(ctx: FakeContext): EngineAudio {
  return new EngineAudio(() => ctx as unknown as AudioContext);
}

describe('161 pause audio acceptance', () => {
  it('AT3: setPaused(true) twice suspends the context once and sets paused', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.setPaused(true);
    audio.setPaused(true);
    expect(ctx.suspendCount).toBe(1);
    expect(audio.paused).toBe(true);
  });

  it('AT4: while paused neither update() nor resume() resumes the context', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.setPaused(true);
    audio.update(6000, 1, [0, 0, 0, 0]);
    audio.resume();
    expect(ctx.resumeCount).toBe(0);
  });

  it('AT5: setPaused(false) resumes the context once and clears paused', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.setPaused(true);
    audio.setPaused(false);
    expect(ctx.resumeCount).toBe(1);
    expect(audio.paused).toBe(false);
  });
});
