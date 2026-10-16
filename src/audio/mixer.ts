import type { CameraMode } from '../render/cameraRig';
import type { Volumes } from '../core/settings';

export const COCKPIT_LOWPASS_HZ = 1200;
export const BYPASS_LOWPASS_HZ = 22050;
const RAMP_S = 0.1;

export interface MixerNodes {
  master: GainNode;
  engine: GainNode;
  effects: GainNode;
  engineFilter: BiquadFilterNode;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Mixer {
  private readonly ctx: AudioContext;
  private readonly nodes: MixerNodes;
  private volumes: Volumes;
  private paused = false;

  constructor(ctx: AudioContext, nodes: MixerNodes, volumes: Volumes) {
    this.ctx = ctx;
    this.nodes = nodes;
    this.volumes = {
      master: clamp01(volumes.master),
      engine: clamp01(volumes.engine),
      effects: clamp01(volumes.effects),
    };
    const now = ctx.currentTime;
    this.nodes.master.gain.setValueAtTime(this.volumes.master, now);
    this.nodes.engine.gain.setValueAtTime(this.volumes.engine, now);
    this.nodes.effects.gain.setValueAtTime(this.volumes.effects, now);
    this.nodes.engineFilter.frequency.setValueAtTime(BYPASS_LOWPASS_HZ, now);
  }

  setCameraMode(mode: CameraMode): void {
    const hz = mode === 'cockpit' ? COCKPIT_LOWPASS_HZ : BYPASS_LOWPASS_HZ;
    this.nodes.engineFilter.frequency.setValueAtTime(hz, this.ctx.currentTime);
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.rampMaster(paused ? 0 : this.volumes.master);
  }

  setVolumes(v: Volumes): void {
    this.volumes = { master: clamp01(v.master), engine: clamp01(v.engine), effects: clamp01(v.effects) };
    const now = this.ctx.currentTime;
    this.nodes.engine.gain.setValueAtTime(this.volumes.engine, now);
    this.nodes.effects.gain.setValueAtTime(this.volumes.effects, now);
    // While paused the master stays at 0; resume ramps to the updated master.
    if (!this.paused) this.rampMaster(this.volumes.master);
  }

  private rampMaster(value: number): void {
    const now = this.ctx.currentTime;
    this.nodes.master.gain.setValueAtTime(this.nodes.master.gain.value, now);
    this.nodes.master.gain.linearRampToValueAtTime(value, now + RAMP_S);
  }
}
