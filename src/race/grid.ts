import type { SpawnPose, TrackDataV2 } from '../core/types';

const POLE_OFFSET = 6; // m behind the start line

export function gridSlots(track: TrackDataV2, count: number, spacing = 8): SpawnPose[] {
  const slots: SpawnPose[] = [];
  if (count <= 0) return slots;
  const cl = track.centerline;
  const n = cl.length;
  if (n === 0) return slots;
  // Backward walk from index 0: leg j runs from idx(j) to idx(j + 1), where
  // idx(j) = (n - j) mod n, so idx(0) = 0, idx(1) = n - 1, ...
  const idx = (j: number): number => (n - (j % n)) % n;
  const legLen = new Float64Array(n);
  const cum = new Float64Array(n + 1);
  for (let j = 0; j < n; j++) {
    const a = cl[idx(j)];
    const b = cl[idx(j + 1)];
    legLen[j] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    cum[j + 1] = cum[j] + legLen[j];
  }
  const total = cum[n];
  const elev = track.elevation;
  for (let k = 0; k < count; k++) {
    const d = total > 0 ? ((POLE_OFFSET + spacing * k) % total + total) % total : 0;
    let j = 0;
    while (j < n - 1 && cum[j + 1] <= d) j++;
    const s = legLen[j] > 0 ? (d - cum[j]) / legLen[j] : 0;
    const a = cl[idx(j)];
    const b = cl[idx(j + 1)];
    const cx = a[0] + (b[0] - a[0]) * s;
    const cz = a[1] + (b[1] - a[1]) * s;
    // Travel direction: leg j runs backward, so forward is a - b.
    const fx = a[0] - b[0];
    const fz = a[1] - b[1];
    const fl = Math.hypot(fx, fz);
    const dx = fl > 0 ? fx / fl : 0;
    const dz = fl > 0 ? fz / fl : -1;
    const lateral = (k % 2 === 0 ? 1 : -1) * (track.widthMeters / 4);
    const ea = elev[idx(j)] ?? 0;
    const eb = elev[idx(j + 1)] ?? 0;
    slots.push({
      position: {
        x: cx + lateral * -dz,
        y: ea + (eb - ea) * s + 0.6,
        z: cz + lateral * dx,
      },
      yaw: Math.atan2(-dx, -dz),
    });
  }
  return slots;
}
