import * as THREE from 'three';
import { KERB_WIDTH } from '../core/constants';
import type { TrackDataV2 } from '../core/types';
import {
  halfWidthAt,
  innerCornerRadii,
  INNER_CURVE_CLAMP,
  KERB_MIN_WIDTH,
  KERB_Y,
} from '../track/surfaces';
import { segmentOverride, type ResolvedTrackStyle } from '../track/trackStyle';

const STRIP_WIDTH = 0.6;
const MIN_REMAINING = 0.1; // clamped outer strip thinner than this is dropped

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
  const reff = innerCornerRadii(cx);
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
    let prevBase = -1;
    let prevX = cx[start][0];
    let prevZ = cx[start][1];
    for (let j = 0; j < k; j++) {
      const idx = (start + j) % n;
      const x = cx[idx][0];
      const z = cx[idx][1];
      if (j > 0) bucket.meters += Math.hypot(x - prevX, z - prevZ);
      prevX = x;
      prevZ = z;
      const half = halfWidthAt(track, kerb.side, idx);
      // Inner-side rows (own corner or ±10 m arc neighbour) cap the strip at
      // 0.9 x the neighbourhood's smallest corner radius; dropped kerb rows
      // lose their outer strip too.
      const near = kerb.side === 'left' ? reff.left[idx] : reff.right[idx];
      const clamp = Number.isFinite(near) ? INNER_CURVE_CLAMP * near : Number.POSITIVE_INFINITY;
      if (clamp - half < KERB_MIN_WIDTH) {
        prevBase = -1;
        continue;
      }
      const inner = half + KERB_WIDTH;
      const outer = Math.min(inner + STRIP_WIDTH, clamp);
      if (outer - inner < MIN_REMAINING) {
        prevBase = -1;
        continue;
      }
      const [rx, rz] = rightNormalAt(cx, idx);
      const latA = sign * inner;
      const latB = sign * outer;
      const latMin = Math.min(latA, latB);
      const latMax = Math.max(latA, latB);
      const y = (track.elevation[idx] ?? 0) + KERB_Y;
      const base = bucket.positions.length / 3;
      bucket.positions.push(x + rx * latMin, y, z + rz * latMin, x + rx * latMax, y, z + rz * latMax);
      if (prevBase >= 0) {
        const a = prevBase;
        const b = a + 1;
        const d = base;
        const e = base + 1;
        bucket.indices.push(a, b, d, b, e, d);
      }
      prevBase = base;
    }
  }
  const built = order
    .map((key) => ({ key, bucket: buckets.get(key) }))
    .filter((e): e is { key: string; bucket: Bucket } => e.bucket !== undefined && e.bucket.positions.length > 0);
  if (built.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'kerbOuterStrips';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  let total = 0;
  built.forEach(({ key, bucket }, i) => {
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
