import type { Point2 } from './geo';

export interface RibbonGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  vertexCount: number;
}

export function buildRibbon(centerline: Point2[], width: number, y: number): RibbonGeometry {
  const n = centerline.length;
  if (n < 3) {
    throw new Error('buildRibbon: need at least 3 points');
  }
  const half = width / 2;
  const positions = new Float32Array(n * 6);
  const uvs = new Float32Array(n * 4);
  const indices = new Uint32Array(n * 6);
  let s = 0;
  let px = centerline[0][0];
  let pz = centerline[0][1];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      s += Math.hypot(centerline[i][0] - px, centerline[i][1] - pz);
      px = centerline[i][0];
      pz = centerline[i][1];
    }
    const prev = centerline[(i - 1 + n) % n];
    const next = centerline[(i + 1) % n];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) {
      dx = 0;
      dz = -1;
    } else {
      dx /= len;
      dz /= len;
    }
    const rx = -dz;
    const rz = dx;
    const x = centerline[i][0];
    const z = centerline[i][1];
    const p = i * 6;
    positions[p] = x - rx * half;
    positions[p + 1] = y;
    positions[p + 2] = z - rz * half;
    positions[p + 3] = x + rx * half;
    positions[p + 4] = y;
    positions[p + 5] = z + rz * half;
    const v = s / width;
    const t = i * 4;
    uvs[t] = 0;
    uvs[t + 1] = v;
    uvs[t + 2] = 1;
    uvs[t + 3] = v;
    const j = (i + 1) % n;
    const o = i * 6;
    indices[o] = 2 * i;
    indices[o + 1] = 2 * i + 1;
    indices[o + 2] = 2 * j;
    indices[o + 3] = 2 * i + 1;
    indices[o + 4] = 2 * j + 1;
    indices[o + 5] = 2 * j;
  }
  return { positions, indices, uvs, vertexCount: 2 * n };
}
