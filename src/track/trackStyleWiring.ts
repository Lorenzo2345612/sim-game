import type { Grandstand, TrackDataV2 } from '../core/types';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type ResolvedTrackStyle } from './trackStyle';

export interface StyleResponse { ok: boolean; json(): Promise<unknown> }
export interface LoadedTrackStyle { style: ResolvedTrackStyle; loaded: boolean; errors: string[]; warnings: string[] }

const defaults = (errors: string[] = []): LoadedTrackStyle => ({ style: DEFAULT_TRACK_STYLE, loaded: false, errors, warnings: [] });

export async function loadTrackStyle(
  id: string,
  pointCount: number,
  fetchFn: (url: string) => Promise<StyleResponse> = (url) => fetch(url),
): Promise<LoadedTrackStyle> {
  let res: StyleResponse;
  try {
    res = await fetchFn(`/tracks/${id}.style.json`);
  } catch {
    return defaults();
  }
  if (!res.ok) return defaults();
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return defaults(['invalid JSON in style file']);
  }
  const parsed = parseTrackStyle(body, pointCount);
  return { style: parsed.style, loaded: parsed.errors.length === 0, errors: parsed.errors, warnings: parsed.warnings };
}

export function extraGrandstands(track: TrackDataV2, style: ResolvedTrackStyle): Grandstand[] {
  const out: Grandstand[] = [];
  const n = track.centerline.length;
  for (const e of style.extraGrandstands) {
    const [sx, sz] = track.centerline[((e.start % n) + n) % n];
    const [ex, ez] = track.centerline[((e.end % n) + n) % n];
    const dx = ex - sx;
    const dz = ez - sz;
    const len = Math.hypot(dx, dz);
    if (len === 0) continue;
    const sign = e.side === 'right' ? 1 : -1;
    const dist = track.widthMeters / 2 + e.offsetMeters;
    const mx = (sx + ex) / 2;
    const mz = (sz + ez) / 2;
    const x = mx + ((sign * -dz) / len) * dist;
    const z = mz + ((sign * dx) / len) * dist;
    out.push({ x, z, yaw: Math.atan2(-(mx - x), -(mz - z)), lengthMeters: len, rows: e.rows, roof: e.roof });
  }
  return out;
}
