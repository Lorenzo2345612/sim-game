import * as THREE from 'three';
import type { TrackDataV2 } from '../core/types';
import { rightNormalAt } from '../track/barrierPath';
import { halfWidthAt } from '../track/surfaces';
import type { FloodlightStyle, ResolvedTrackStyle } from '../track/trackStyle';
import { terrainHeightAt } from '../track/ground';

export interface FloodlightsObject { group: THREE.Group; dispose(): void }

const POLE_RADIUS = 0.15;
const ARM_LENGTH = 2.5;
const ARM_SECTION = 0.15;
const HEAD_X = 0.6;
const HEAD_Y = 0.3;
const HEAD_Z = 0.4;
const HEAD_SPACING = 0.7;
const UP = new THREE.Vector3(0, 1, 0);

// Walked polyline: index[k] is the centerline point at arc position cum[k]; a
// closed (whole-lap) walk carries the closing chord back to index 0 as its last entry.
interface Walk { index: number[]; cum: number[]; closed: boolean }

// side: -1 left, +1 right; (rx, rz) is the unit right normal at the pole's centerline point.
interface Pole { x: number; y: number; z: number; rx: number; rz: number; side: 1 | -1 }

function buildWalk(track: TrackDataV2, start: number, end: number, closed: boolean): Walk {
  const cx = track.centerline;
  const n = cx.length;
  const index: number[] = [];
  if (closed) {
    for (let i = 0; i < n; i++) index.push(i);
  } else {
    const count = ((((end - start) % n) + n) % n) + 1;
    for (let k = 0; k < count; k++) index.push((((start + k) % n) + n) % n);
  }
  const cum = [0];
  for (let k = 1; k < index.length; k++) {
    const a = cx[index[k - 1]];
    const b = cx[index[k]];
    cum.push(cum[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  if (closed && index.length > 0) {
    const a = cx[index[index.length - 1]];
    const b = cx[index[0]];
    cum.push(cum[cum.length - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    index.push(index[0]);
  }
  return { index, cum, closed };
}

// Open walks have no closing chord, so their ends use a one-sided difference
// instead of the ring wrap; on an open STRAIGHT that keeps right = +z at index 0.
function sideNormalAt(w: Walk, cx: [number, number][], j: number): [number, number] {
  if (w.closed) return rightNormalAt(cx, w.index[j]);
  const i = w.index[j];
  const prev = j > 0 ? cx[w.index[j - 1]] : null;
  const next = j + 1 < w.index.length ? cx[w.index[j + 1]] : null;
  let dx: number;
  let dz: number;
  if (prev !== null && next !== null) {
    dx = next[0] - prev[0];
    dz = next[1] - prev[1];
  } else if (next !== null) {
    dx = next[0] - cx[i][0];
    dz = next[1] - cx[i][1];
  } else if (prev !== null) {
    dx = cx[i][0] - prev[0];
    dz = cx[i][1] - prev[1];
  } else {
    return [0, -1];
  }
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

function nearestEntry(w: Walk, s: number): number {
  let best = 0;
  let bestD = Math.abs(w.cum[0] - s);
  for (let j = 1; j < w.cum.length; j++) {
    const d = Math.abs(w.cum[j] - s);
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  }
  return best;
}

function elevationAt(track: TrackDataV2, w: Walk, s: number): number {
  if (w.cum.length < 2) return track.elevation[w.index[0]] ?? 0;
  let j = 0;
  while (j < w.cum.length - 2 && w.cum[j + 1] <= s) j++;
  const span = w.cum[j + 1] - w.cum[j];
  const t = span > 0 ? Math.min(Math.max((s - w.cum[j]) / span, 0), 1) : 0;
  const a = track.elevation[w.index[j]] ?? 0;
  const b = track.elevation[w.index[j + 1]] ?? 0;
  return a + (b - a) * t;
}

function tooClose(track: TrackDataV2, x: number, z: number, limit: number): boolean {
  for (const p of track.centerline) {
    if (Math.hypot(p[0] - x, p[1] - z) < limit) return true;
  }
  return false;
}

function collectPoles(track: TrackDataV2, fl: FloodlightStyle): Pole[] {
  const cx = track.centerline;
  const sides: Array<1 | -1> = fl.side === 'both' ? [-1, 1] : fl.side === 'right' ? [1] : [-1];
  const limit = track.widthMeters / 2 + 1;
  const walks =
    fl.ranges.length > 0
      ? fl.ranges.map((r) => buildWalk(track, r.start, r.end, false))
      : [buildWalk(track, 0, cx.length - 1, true)];
  const poles: Pole[] = [];
  for (const w of walks) {
    const lap = w.cum[w.cum.length - 1];
    for (let k = 0; w.closed ? k * fl.spacingMeters < lap : k <= Math.floor(lap / fl.spacingMeters); k++) {
      const s = k * fl.spacingMeters;
      const j = nearestEntry(w, s);
      const i = w.index[j];
      const [rx, rz] = sideNormalAt(w, cx, j);
      for (const side of sides) {
        const offset = halfWidthAt(track, side === 1 ? 'right' : 'left', i) + fl.offsetMeters;
        const x = cx[i][0] + rx * side * offset;
        const z = cx[i][1] + rz * side * offset;
        if (tooClose(track, x, z, limit)) continue;
        poles.push({ x, y: track.terrain ? terrainHeightAt(track.terrain, x, z) : elevationAt(track, w, s), z, rx, rz, side });
      }
    }
  }
  return poles;
}

export function createFloodlights(track: TrackDataV2, style: ResolvedTrackStyle): FloodlightsObject | null {
  const fl = style.floodlights;
  if (fl === null) return null;
  const poles = collectPoles(track, fl);

  const group = new THREE.Group();
  group.name = 'floodlights';
  group.userData = { poles: poles.length, heads: poles.length * fl.heads };
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  const matrix = new THREE.Matrix4();
  const xAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();

  const poleGeometry = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, fl.heightMeters, 16);
  poleGeometry.translate(0, fl.heightMeters / 2, 0);
  const poleMaterial = new THREE.MeshStandardMaterial({ color: '#aeb2b6', roughness: 0.6 });
  geometries.push(poleGeometry);
  materials.push(poleMaterial);
  const poleMesh = new THREE.InstancedMesh(poleGeometry, poleMaterial, poles.length);
  poleMesh.name = 'floodlightPoles';
  poles.forEach((p, k) => {
    poleMesh.setMatrixAt(k, matrix.makeTranslation(p.x, p.y, p.z));
  });
  poleMesh.instanceMatrix.needsUpdate = true;
  group.add(poleMesh);

  if (fl.style === 'arm') {
    const armGeometry = new THREE.BoxGeometry(ARM_LENGTH, ARM_SECTION, ARM_SECTION);
    armGeometry.translate(ARM_LENGTH / 2, 0, 0);
    const armMaterial = new THREE.MeshStandardMaterial({ color: '#8f9499', roughness: 0.6 });
    geometries.push(armGeometry);
    materials.push(armMaterial);
    const armMesh = new THREE.InstancedMesh(armGeometry, armMaterial, poles.length);
    armMesh.name = 'floodlightArms';
    poles.forEach((p, k) => {
      const fx = -p.side * p.rx;
      const fz = -p.side * p.rz;
      xAxis.set(fx, 0, fz);
      zAxis.set(-fz, 0, fx);
      armMesh.setMatrixAt(k, matrix.makeBasis(xAxis, UP, zAxis).setPosition(p.x, p.y + fl.heightMeters, p.z));
    });
    armMesh.instanceMatrix.needsUpdate = true;
    group.add(armMesh);
  }

  const headGeometry = new THREE.BoxGeometry(HEAD_X, HEAD_Y, HEAD_Z);
  const headMaterial = new THREE.MeshStandardMaterial({ color: '#7d8287', roughness: 0.5 });
  geometries.push(headGeometry);
  materials.push(headMaterial);
  const headMesh = new THREE.InstancedMesh(headGeometry, headMaterial, poles.length * fl.heads);
  headMesh.name = 'floodlightHeads';
  let h = 0;
  for (const p of poles) {
    const tangentX = p.rz;
    const tangentZ = -p.rx;
    const arm = fl.style === 'arm' ? ARM_LENGTH : 0;
    const anchorX = p.x - p.side * p.rx * arm;
    const anchorZ = p.z - p.side * p.rz * arm;
    const anchorY = p.y + fl.heightMeters;
    xAxis.set(tangentX, 0, tangentZ);
    zAxis.set(p.rx, 0, p.rz);
    for (let j = 0; j < fl.heads; j++) {
      const row = (j - (fl.heads - 1) / 2) * HEAD_SPACING;
      headMesh.setMatrixAt(
        h++,
        matrix.makeBasis(xAxis, UP, zAxis).setPosition(anchorX + tangentX * row, anchorY, anchorZ + tangentZ * row),
      );
    }
  }
  headMesh.instanceMatrix.needsUpdate = true;
  group.add(headMesh);

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
