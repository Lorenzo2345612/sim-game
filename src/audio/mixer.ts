import type { CameraMode } from '../render/cameraRig';
import type { Volumes } from '../core/settings';

export const COCKPIT_LOWPASS_HZ = 2500;
export const BYPASS_LOWPASS_HZ = 22050;
export const COCKPIT_WET_GAIN = 0.25;
export const CAMERA_TAU_S = 0.05;
const RAMP_S = 0.1;
const IMPULSE_S = 0.08;
const IMPULSE_TAU_S = 0.02;

export interface MixerNodes {
  master: GainNode;
  engine: GainNode;
  effects: GainNode;
  engineFilter: BiquadFilterNode;
  cockpitWet?: GainNode;
}

/** Short room impulse for the cockpit reverb send; deterministic per sampleRate. */
export function cockpitImpulse(sampleRate: number): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('sampleRate must be a positive finite number');
  }
  const out = new Float32Array(Math.round(IMPULSE_S * sampleRate));
  let seed = 0x2545f491;
  for (let i = 0; i < out.length; i++) {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const noise = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    out[i] = noise * Math.exp(-(i / sampleRate) / IMPULSE_TAU_S);
  }
  return out;
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
    const cockpit = mode === 'cockpit';
    const now = this.ctx.currentTime;
    this.nodes.engineFilter.frequency.setTargetAtTime(
      cockpit ? COCKPIT_LOWPASS_HZ : BYPASS_LOWPASS_HZ,
      now,
      CAMERA_TAU_S,
    );
    this.nodes.cockpitWet?.gain.setTargetAtTime(cockpit ? COCKPIT_WET_GAIN : 0, now, CAMERA_TAU_S);
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
