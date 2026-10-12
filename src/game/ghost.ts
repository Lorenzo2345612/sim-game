import type { Quat, Vec3 } from '../core/types';

export const GHOST_HZ = 30;
export type GhostSample = [number, number, number, number, number, number, number, number]; // [t, x, y, z, qx, qy, qz, qw]
export interface GhostLap { trackId: string; lapTime: number; samples: GhostSample[] }
export interface GhostStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export class GhostRecorder {
  private readonly interval: number;
  private samples: GhostSample[] = [];
  private t = 0;
  private nextSampleT = 0;

  constructor(private readonly trackId: string, hz: number = GHOST_HZ) {
    this.interval = 1 / hz;
  }

  start(): void {
    this.samples = [];
    this.t = 0;
    this.nextSampleT = 0;
  }

  record(dt: number, position: Vec3, rotation: Quat): void {
    // 1e-9 slack so accumulated float time still crosses exact boundaries like k/30
    if (this.samples.length === 0 || this.t >= this.nextSampleT - 1e-9) {
      this.samples.push([
        this.t,
        position.x, position.y, position.z,
        rotation.x, rotation.y, rotation.z, rotation.w,
      ]);
      this.nextSampleT += this.interval;
    }
    this.t += dt;
  }

  finishLap(valid: boolean, lapTime: number): GhostLap | null {
    if (!valid) return null;
    return { trackId: this.trackId, lapTime, samples: this.samples.slice() };
  }
}

export function ghostKey(trackId: string): string {
  return `ghost:${trackId}`;
}

export function saveGhostIfFaster(storage: GhostStorage, lap: GhostLap): boolean {
  const existing = loadGhost(storage, lap.trackId);
  if (existing && existing.lapTime <= lap.lapTime) return false;
  storage.setItem(ghostKey(lap.trackId), JSON.stringify(lap));
  return true;
}

function isGhostLap(value: unknown): value is GhostLap {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.trackId === 'string' &&
    typeof o.lapTime === 'number' &&
    Number.isFinite(o.lapTime) &&
    Array.isArray(o.samples) &&
    o.samples.every(
      (s) => Array.isArray(s) && s.length === 8 && s.every((n) => typeof n === 'number' && Number.isFinite(n)),
    )
  );
}

export function loadGhost(storage: GhostStorage, trackId: string): GhostLap | null {
  const raw = storage.getItem(ghostKey(trackId));
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isGhostLap(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function ghostAt(lap: GhostLap, t: number, outPos: Vec3, outRot: Quat): void {
  const s = lap.samples;
  if (s.length === 0) return;
  const first = s[0][0];
  const last = s[s.length - 1][0];
  const tc = t < first ? first : t > last ? last : t;

  let i = 0;
  while (i < s.length - 2 && s[i + 1][0] <= tc) i++;
  const a = s[i];
  const b = i + 1 < s.length ? s[i + 1] : a;
  const span = b[0] - a[0];
  const u = span > 0 ? (tc - a[0]) / span : 0;

  outPos.x = a[1] + (b[1] - a[1]) * u;
  outPos.y = a[2] + (b[2] - a[2]) * u;
  outPos.z = a[3] + (b[3] - a[3]) * u;

  // nlerp with shortest-arc correction (negate b when the dot product is negative)
  let ax = a[4], ay = a[5], az = a[6], aw = a[7];
  const bx = b[4], by = b[5], bz = b[6], bw = b[7];
  if (ax * bx + ay * by + az * bz + aw * bw < 0) { ax = -ax; ay = -ay; az = -az; aw = -aw; }
  const x = ax + (bx - ax) * u;
  const y = ay + (by - ay) * u;
  const z = az + (bz - az) * u;
  const w = aw + (bw - aw) * u;
  const len = Math.hypot(x, y, z, w) || 1;
  outRot.x = x / len;
  outRot.y = y / len;
  outRot.z = z / len;
  outRot.w = w / len;
}
