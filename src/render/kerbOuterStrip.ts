import * as THREE from 'three';
import { KERB_WIDTH } from '../core/constants';
import type { TrackDataV2 } from '../core/types';
import { halfWidthAt, KERB_Y } from '../track/surfaces';
import { segmentOverride, type ResolvedTrackStyle } from '../track/trackStyle';

const STRIP_WIDTH = 0.6;

export interface KerbOuterStrips {
  group: THREE.Group;
  dispose(): void;
}

/** Right normal of the direction a→b: (-dz, dx), the surfaces.ts convention. */
function segNormal(cx: [number, number][], a: number, b: number): [number, number] {
  const dx = cx[b][0] - cx[a][0];
  const dz = cx[b][1] - cx[a][1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

/** End points use their own segment's normal, interior points average the adjacent ones (roadLateral). */
function rightNormalAt(cx: [number, number][], i: number): [number, number] {
  const n = cx.length;
  if (i === 0) return segNormal(cx, 0, 1);
  if (i === n - 1) return segNormal(cx, n - 2, n - 1);
  const [ax, az] = segNormal(cx, i - 1, i);
  const [bx, bz] = segNormal(cx, i, i + 1);
  const nx = ax + bx;
  const nz = az + bz;
  const len = Math.hypot(nx, nz);
  if (len < 1e-9) return [ax, az];
  return [nx / len, nz / len];
}

interface Bucket {
  positions: number[];
  indices: number[];
  meters: number;
}

export function createKerbOuterStrips(track: TrackDataV2, style: ResolvedTrackStyle): KerbOuterStrips | null {
  const cx = track.centerline;
  const n = cx.length;
  if (n === 0) return null;
  const order: string[] = [];
  const buckets = new Map<string, Bucket>();
  for (const kerb of track.kerbs) {
    const color = segmentOverride(style.kerbs.ranges, kerb, n)?.outerStrip ?? style.kerbs.outerStrip ?? null;
    if (color === null) continue;
    const start = ((kerb.start % n) + n) % n;
    const end = ((kerb.end % n) + n) % n;
    const k = ((end - start + n) % n) + 1;
    if (k < 2) continue;
    const key = color.toLowerCase();
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = { positions: [], indices: [], meters: 0 };
      buckets.set(key, bucket);
      order.push(key);
    }
    const sign = kerb.side === 'right' ? 1 : -1;
    const base = bucket.positions.length / 3;
    let prevX = cx[start][0];
    let prevZ = cx[start][1];
    for (let j = 0; j < k; j++) {
      const idx = (start + j) % n;
      const x = cx[idx][0];
      const z = cx[idx][1];
      if (j > 0) bucket.meters += Math.hypot(x - prevX, z - prevZ);
      prevX = x;
      prevZ = z;
      const [rx, rz] = rightNormalAt(cx, idx);
      const inner = sign * (halfWidthAt(track, kerb.side, idx) + KERB_WIDTH);
      const outer = sign * (halfWidthAt(track, kerb.side, idx) + KERB_WIDTH + STRIP_WIDTH);
      const latMin = Math.min(inner, outer);
      const latMax = Math.max(inner, outer);
      const y = (track.elevation[idx] ?? 0) + KERB_Y;
      bucket.positions.push(x + rx * latMin, y, z + rz * latMin, x + rx * latMax, y, z + rz * latMax);
    }
    for (let j = 0; j + 1 < k; j++) {
      const a = base + j * 2;
      const b = a + 1;
      const d = a + 2;
      const e = a + 3;
      bucket.indices.push(a, b, d, b, e, d);
    }
  }
  if (order.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'kerbOuterStrips';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  let total = 0;
  order.forEach((key, i) => {
    const bucket = buckets.get(key);
    if (bucket === undefined) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setIndex(bucket.indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: key,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = i === 0 ? 'kerbOuterStrip' : `kerbOuterStrip:${i}`;
    mesh.userData = { meters: bucket.meters };
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    total += bucket.meters;
  });
  group.userData = { meters: total };
  let disposed = false;
  return {
    group,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
