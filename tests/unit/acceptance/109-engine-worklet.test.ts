import { describe, it, expect } from 'vitest';
import { EngineAudio } from '../../../src/audio/engineAudio';

interface EngineStats {
  running: boolean;
  engine: 'worklet' | 'oscillator';
  firingHz: number;
}

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
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = stubNode({});

  addEventListener() {
    /* mock */
  }

  removeEventListener() {
    /* mock */
  }

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

function statsOf(audio: EngineAudio): EngineStats {
  return (audio as unknown as { getStats(): EngineStats }).getStats();
}

describe('109 engine worklet acceptance', () => {
  it('AT2: EngineAudio with a stub context lacking audioWorklet reports engine oscillator without throwing', () => {
    const ctx = new FakeContext();
    let audio: EngineAudio | undefined;
    expect(() => {
      audio = new EngineAudio(() => ctx as unknown as AudioContext);
      audio.update(3000, 0.5, [0, 0, 0, 0]);
    }).not.toThrow();
    expect(statsOf(audio!).engine).toBe('oscillator');
  });
});
