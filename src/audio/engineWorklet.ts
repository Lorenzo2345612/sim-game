import { EngineSynth } from './engineSynth';

declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  ctor: new (options: { processorOptions?: EngineProcessorOptions }) => object,
): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export interface EngineProcessorOptions {
  cylinders: number;
  exhaustLengthM: number;
  intakeMix: number;
  seed: number;
}

class EngineSynthProcessor extends AudioWorkletProcessor {
  private readonly synth: EngineSynth;
  private rpm = 0;
  private throttle = 0;

  constructor(options: { processorOptions?: EngineProcessorOptions }) {
    super();
    const p = options.processorOptions;
    this.synth = new EngineSynth(
      {
        cylinders: p?.cylinders ?? 4,
        exhaustLengthM: p?.exhaustLengthM ?? 1.2,
        intakeMix: p?.intakeMix ?? 0.3,
        sampleRate,
      },
      p?.seed ?? 1,
    );
    this.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { rpm?: unknown; throttle?: unknown };
      if (typeof data?.rpm === 'number') this.rpm = data.rpm;
      if (typeof data?.throttle === 'number') this.throttle = data.throttle;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out && out.length > 0) this.synth.render(out[0], this.rpm, this.throttle);
    return true;
  }
}

registerProcessor('engine-synth', EngineSynthProcessor);
