import type { GhostStorage } from './ghost';

export type Channel = 'time' | 'speed' | 'throttle' | 'brake' | 'steer' | 'gear' | 'rpm' | 'latG' | 'x' | 'z';
export const CHANNELS: readonly Channel[] = [
  'time', 'speed', 'throttle', 'brake', 'steer', 'gear', 'rpm', 'latG', 'x', 'z',
];
export const TELEMETRY_SPACING = 2; // m between samples

const VALUE_KEYS = ['speed', 'throttle', 'brake', 'steer', 'gear', 'rpm', 'latG', 'x', 'z'] as const;
const GEAR_IDX = VALUE_KEYS.indexOf('gear');
const SLACK = 1e-9;

export interface TelemetryValues {
  speed: number; throttle: number; brake: number; steer: number;
  gear: number; rpm: number; latG: number; x: number; z: number;
}
export interface LapTelemetry {
  trackId: string; carId: string; lapTime: number; spacing: 2;
  channels: Record<Channel, Float32Array>;
}

interface StoredLap {
  trackId: string; carId: string; lapTime: number; spacing: number;
  channels: Record<string, string>;
}

export class TelemetryRecorder {
  private readonly count: number;
  private channels: Record<Channel, Float32Array> | null = null;
  private collected = 0;
  private hasPrev = false;
  private prevDistance = 0;
  private prevTime = 0;
  private readonly prevVals = new Float64Array(VALUE_KEYS.length);

  constructor(private readonly trackId: string, private readonly carId: string, lapLength: number) {
    this.count = Number.isFinite(lapLength) ? Math.max(0, Math.floor(lapLength / TELEMETRY_SPACING)) : 0;
    this.start();
  }

  start(): void {
    this.channels = {} as Record<Channel, Float32Array>;
    for (const name of CHANNELS) this.channels[name] = new Float32Array(this.count);
    this.collected = 0;
    this.hasPrev = false;
  }

  record(distance: number, time: number, v: TelemetryValues): void {
    if (this.channels === null || this.collected >= this.count) return;
    if (!Number.isFinite(distance) || !Number.isFinite(time)) return;
    for (const key of VALUE_KEYS) if (!Number.isFinite(v[key])) return;

    // First accepted tick is its own previous tick (u ends up at the tick's own values).
    const pd = this.hasPrev ? this.prevDistance : distance;
    const pt = this.hasPrev ? this.prevTime : time;
    const ch = this.channels;
    const span = distance - pd;

    while (this.collected < this.count) {
      const target = this.collected * TELEMETRY_SPACING;
      if (distance < target - SLACK) break;
      const u = span > 0 ? Math.min(1, Math.max(0, (target - pd) / span)) : target >= distance ? 1 : 0;
      ch.time[this.collected] = pt + (time - pt) * u;
      for (let i = 0; i < VALUE_KEYS.length; i++) {
        const p = this.hasPrev ? this.prevVals[i] : v[VALUE_KEYS[i]];
        ch[VALUE_KEYS[i]][this.collected] = i === GEAR_IDX ? p : p + (v[VALUE_KEYS[i]] - p) * u;
      }
      this.collected++;
    }

    this.prevDistance = distance;
    this.prevTime = time;
    for (let i = 0; i < VALUE_KEYS.length; i++) this.prevVals[i] = v[VALUE_KEYS[i]];
    this.hasPrev = true;
  }

  finishLap(valid: boolean, lapTime: number): LapTelemetry | null {
    if (!valid || this.channels === null || this.collected < this.count) return null;
    if (!Number.isFinite(lapTime) || lapTime <= 0) return null;
    return { trackId: this.trackId, carId: this.carId, lapTime, spacing: TELEMETRY_SPACING, channels: this.channels };
  }
}

export function telemetryKey(trackId: string, carId: string): string {
  return `telemetry:${trackId}:${carId}`;
}

export function saveIfBest(storage: GhostStorage, lap: LapTelemetry | null): boolean {
  if (lap === null) return false;
  const existing = loadTelemetry(storage, lap.trackId, lap.carId);
  if (existing && existing.lapTime <= lap.lapTime) return false;
  const channels: Record<string, string> = {};
  for (const name of CHANNELS) channels[name] = encodeBase64(lap.channels[name]);
  const stored: StoredLap = {
    trackId: lap.trackId, carId: lap.carId, lapTime: lap.lapTime, spacing: lap.spacing, channels,
  };
  storage.setItem(telemetryKey(lap.trackId, lap.carId), JSON.stringify(stored));
  return true;
}

export function loadTelemetry(storage: GhostStorage, trackId: string, carId: string): LapTelemetry | null {
  const raw = storage.getItem(telemetryKey(trackId, carId));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isStoredLap(parsed)) return null;
  const channels = {} as Record<Channel, Float32Array>;
  let length = -1;
  for (const name of CHANNELS) {
    const arr = decodeBase64(parsed.channels[name]);
    if (arr === null || (length !== -1 && arr.length !== length)) return null;
    length = arr.length;
    channels[name] = arr;
  }
  return {
    trackId: parsed.trackId, carId: parsed.carId, lapTime: parsed.lapTime,
    spacing: TELEMETRY_SPACING, channels,
  };
}

export function deltaTrace(a: LapTelemetry, b: LapTelemetry): Float32Array {
  const n = Math.min(a.channels.time.length, b.channels.time.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a.channels.time[i] - b.channels.time[i];
  return out;
}

function isStoredLap(value: unknown): value is StoredLap {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.trackId !== 'string' || typeof o.carId !== 'string') return false;
  if (typeof o.lapTime !== 'number' || !Number.isFinite(o.lapTime)) return false;
  if (o.spacing !== TELEMETRY_SPACING) return false;
  if (typeof o.channels !== 'object' || o.channels === null || Array.isArray(o.channels)) return false;
  const c = o.channels as Record<string, unknown>;
  return CHANNELS.every((name) => typeof c[name] === 'string');
}

function encodeBase64(a: Float32Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function decodeBase64(b64: string): Float32Array | null {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  if (bin.length % 4 !== 0) return null;
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(buf);
}
