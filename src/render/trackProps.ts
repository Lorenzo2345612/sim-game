import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TrackDataV2 } from '../core/types';
import { rightNormalAt } from '../track/barrierPath';
import { groundedBase } from '../track/placement';
import type { ResolvedTrackStyle, TrackProp } from '../track/trackStyle';

export interface TrackPropsObject { group: THREE.Group; dispose(): void }

const DEFAULT_COLOR = '#9a9ea3';
const SKIP_TOLERANCE = 1e-6;
const UP = new THREE.Vector3(0, 1, 0);

interface PropFootprint { length: number; depth: number }

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// Triangular prism: triangle in the Z-Y plane (base along Z at y=0, apex `rise`
// at the base centre), extruded along X for `length`. Indexed like BoxGeometry
// so it merges with the other parts.
function gablePrism(length: number, base: number, rise: number): THREE.BufferGeometry {
  const hl = length / 2;
  const verts: [number, number, number][] = [
    [-hl, 0, 0], [-hl, 0, base], [-hl, rise, base / 2],
    [hl, 0, 0], [hl, 0, base], [hl, rise, base / 2],
  ];
  const faces: [number, number, number][] = [
    [0, 1, 2], [3, 5, 4],
    [0, 3, 4], [0, 4, 1],
    [0, 5, 3], [0, 2, 5],
    [1, 4, 5], [1, 5, 2],
  ];
  const positions = new Float32Array(faces.length * 9);
  const uvs = new Float32Array(faces.length * 6);
  const index = new Uint16Array(faces.length * 3);
  for (let f = 0; f < faces.length; f++) {
    for (let k = 0; k < 3; k++) {
      const v = verts[faces[f][k]];
      const p = f * 3 + k;
      positions[p * 3] = v[0];
      positions[p * 3 + 1] = v[1];
      positions[p * 3 + 2] = v[2];
      index[p] = p;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}

// Squared distance from (x, z) to the centerline polyline (continuous, not just vertices).
function polylineDistance2(cx: [number, number][], x: number, z: number): number {
  const n = cx.length;
  let min = Infinity;
  for (let j = 0; j < n; j++) {
    const a = cx[j];
    const b = cx[(j + 1) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz;
    let t = len2 < 1e-12 ? 0 : ((x - a[0]) * abx + (z - a[1]) * abz) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = x - (a[0] + abx * t);
    const dz = z - (a[1] + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < min) min = d2;
  }
  return min;
}

function footprintOf(prop: TrackProp): PropFootprint {
  switch (prop.type) {
    case 'marshalPost': return { length: 2.6, depth: 2.6 };
    case 'tent': return { length: prop.lengthMeters, depth: 6 };
    case 'scoreboard': return { length: prop.lengthMeters, depth: 0.5 };
    case 'billboardRow': return { length: (Math.ceil(prop.lengthMeters / 8) - 1) * 8 + 6, depth: 0.2 };
    case 'tower': return { length: 4, depth: 4 };
    case 'footbridge': return { length: 0, depth: 0 };
  }
}

// Parts in the prop frame: X along track (L), Y up, Z outward (D), footprint D in [0, depth].
function partsOf(prop: TrackProp, track: TrackDataV2): THREE.BufferGeometry[] {
  const len = prop.lengthMeters;
  const h = prop.heightMeters;
  switch (prop.type) {
    case 'marshalPost':
      return [box(2, 2.4, 2, 0, 1.2, 1), box(2.6, 0.15, 2.6, 0, 2.475, 1.3)];
    case 'tent':
      return [box(len, 0.6 * h, 6, 0, 0.3 * h, 3), gablePrism(len, 6, 0.4 * h).translate(0, 0.6 * h, 0)];
    case 'scoreboard': {
      const legX = len / 2 - 0.25;
      return [
        box(0.5, h, 0.5, -legX, h / 2, 0.25),
        box(0.5, h, 0.5, legX, h / 2, 0.25),
        box(len, 0.4 * h, 0.5, 0, 0.8 * h, 0.25),
      ];
    }
    case 'billboardRow': {
      const count = Math.ceil(len / 8);
      const geoms: THREE.BufferGeometry[] = [];
      for (let k = 0; k < count; k++) {
        const lx = (k - (count - 1) / 2) * 8;
        geoms.push(box(6, 2.5, 0.2, lx, 2.75, 0.1));
        geoms.push(box(0.2, 1.5, 0.2, lx - 2.9, 0.75, 0.1));
        geoms.push(box(0.2, 1.5, 0.2, lx + 2.9, 0.75, 0.1));
      }
      return geoms;
    }
    case 'tower':
      return [box(3, h, 3, 0, h / 2, 2), box(4, 2.5, 4, 0, h + 1.25, 2)];
    case 'footbridge': {
      const span = Math.max(len, track.widthMeters + 4);
      return [
        box(3, 0.6, span, 0, h + 0.3, 0),
        box(1, h, 1, 0, h / 2, span / 2 - 0.5),
        box(1, h, 1, 0, h / 2, -(span / 2 - 0.5)),
        box(0.1, 1, span, 1.45, h + 1.1, 0),
        box(0.1, 1, span, -1.45, h + 1.1, 0),
      ];
    }
  }
}

export function createTrackProps(track: TrackDataV2, style: ResolvedTrackStyle): TrackPropsObject | null {
  if (style.props.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'trackProps';
  const cx = track.centerline;
  const n = cx.length;
  const halfWidth = track.widthMeters / 2;
  const buckets = new Map<string, { type: TrackProp['type']; color: string; geoms: THREE.BufferGeometry[] }>();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  let placed = 0;
  let skipped = 0;

  for (const prop of style.props) {
    const i = ((prop.index % n) + n) % n;
    const [rx, rz] = rightNormalAt(cx, i);
    const [tx, tz] = [rz, -rx];
    // A footbridge straddles the centerline; a left prop mirrors the frame 180° about Y.
    const isBridge = prop.type === 'footbridge';
    const sign = isBridge || prop.side === 'right' ? 1 : -1;
    const offset = isBridge ? 0 : halfWidth + prop.offsetMeters;
    const ox = cx[i][0] + rx * sign * offset;
    const oz = cx[i][1] + rz * sign * offset;
    let y = track.elevation[i] ?? 0;
    let plinthHeight = 0;
    let foot: PropFootprint | null = null;

    if (!isBridge) {
      foot = footprintOf(prop);
      const yaw = Math.atan2(-tz * sign, tx * sign);
      const grounded = groundedBase(track, ox, oz, yaw, {
        xMin: -foot.length / 2, xMax: foot.length / 2, zMin: 0, zMax: foot.depth,
      });
      y = grounded.baseY;
      plinthHeight = grounded.baseY - grounded.plinthBottom;
      const axX = tx * sign;
      const axZ = tz * sign;
      const azX = rx * sign;
      const azZ = rz * sign;
      const limit = (halfWidth - SKIP_TOLERANCE) ** 2;
      let collide = false;
      for (const sl of [-1, 1]) {
        for (const sd of [0, foot.depth]) {
          const wx = ox + axX * ((sl * foot.length) / 2) + azX * sd;
          const wz = oz + axZ * ((sl * foot.length) / 2) + azZ * sd;
          if (polylineDistance2(cx, wx, wz) < limit) {
            collide = true;
            break;
          }
        }
        if (collide) break;
      }
      if (collide) {
        skipped++;
        continue;
      }
    }

    const matrix = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(tx * sign, 0, tz * sign),
      UP,
      new THREE.Vector3(rx * sign, 0, rz * sign),
    ).setPosition(ox, y, oz);

    const color = prop.color ?? DEFAULT_COLOR;
    const key = `${prop.type}|${color.toLowerCase()}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { type: prop.type, color, geoms: [] };
      buckets.set(key, bucket);
    }
    const parts = partsOf(prop, track);
    if (foot && plinthHeight > 0.1) {
      parts.push(box(foot.length, plinthHeight, foot.depth, 0, -plinthHeight / 2, foot.depth / 2));
    }
    for (const g of parts) {
      g.applyMatrix4(matrix);
      bucket.geoms.push(g);
    }
    placed++;
  }

  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geoms);
    for (const g of bucket.geoms) g.dispose();
    if (!merged) continue;
    const material = new THREE.MeshStandardMaterial({ color: bucket.color });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `prop:${bucket.type}`;
    geometries.push(merged);
    materials.push(material);
    group.add(mesh);
  }

  group.userData = { placed, skipped };

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
