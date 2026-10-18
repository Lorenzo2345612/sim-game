import { EngineVoice, type VoiceControl } from './engineVoice';
import { legacySynthSpec, type EngineSynthSpec } from './soundSpec';

declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  ctor: new (options: { processorOptions?: EngineProcessorOptions }) => object,
): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export interface EngineProcessorOptions {
  synth: EngineSynthSpec;
  seed: number;
}

class EngineVoiceProcessor extends AudioWorkletProcessor {
  private readonly voice: EngineVoice;
  private readonly ctl: VoiceControl = { rpm: 0, load: 0, throttle: 0, wheelSpeedMs: 0, limiter: false };

  constructor(options: { processorOptions?: EngineProcessorOptions }) {
    super();
    const p = options.processorOptions;
    this.voice = new EngineVoice(
      p?.synth ?? legacySynthSpec({ cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 }),
      sampleRate,
      p?.seed ?? 1,
    );
    this.port.onmessage = (ev: MessageEvent) => {
      const d = ev.data as {
        rpm?: unknown;
        load?: unknown;
        throttle?: unknown;
        wheelSpeedMs?: unknown;
        limiter?: unknown;
      } | null;
      if (typeof d?.rpm === 'number') this.ctl.rpm = d.rpm;
      if (typeof d?.throttle === 'number') this.ctl.throttle = d.throttle;
      // A load absent from the message mirrors throttle; a present wrong-typed one is ignored.
      if (typeof d?.load === 'number') this.ctl.load = d.load;
      else if (d?.load === undefined) this.ctl.load = this.ctl.throttle;
      if (typeof d?.wheelSpeedMs === 'number') this.ctl.wheelSpeedMs = d.wheelSpeedMs;
      if (typeof d?.limiter === 'boolean') this.ctl.limiter = d.limiter;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out && out.length > 0) {
      this.voice.setControl(this.ctl);
      this.voice.render(out[0]);
    }
    return true;
  }
}

registerProcessor('engine-synth', EngineVoiceProcessor);
