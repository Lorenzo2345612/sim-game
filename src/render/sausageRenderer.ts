import * as THREE from 'three';
import type { Sausage, TrackDataV2 } from '../core/types';
import {
  SAUSAGE_BASE_WIDTH,
  SAUSAGE_CAP_LENGTH,
  SAUSAGE_HEIGHT,
  SAUSAGE_TOP_WIDTH,
  sausagePose,
} from '../track/sausages';

export {
  SAUSAGE_BASE_WIDTH,
  SAUSAGE_CAP_LENGTH,
  SAUSAGE_HEIGHT,
  SAUSAGE_TOP_WIDTH,
  sausageHullPoints,
  sausagePose,
} from '../track/sausages';

export interface SausageObject {
  group: THREE.Group;
  count: number;
  dispose(): void;
}

const BODY_COLOR = new THREE.Color(1, 0.78, 0);
const CAP_COLOR = new THREE.Color(0, 0, 0);

/**
 * Trapezoid prism along Z: rings at both ends and at ±(half − cap) plus the
 * middle, so the cap gradient stays inside the last SAUSAGE_CAP_LENGTH metres.
 * Ring order: base-left, base-right, top-right, top-left.
 */
export function createSausageGeometry(length: number): THREE.BufferGeometry {
  const half = length / 2;
  const bw = SAUSAGE_BASE_WIDTH / 2;
  const tw = SAUSAGE_TOP_WIDTH / 2;
  const h = SAUSAGE_HEIGHT;
  const zs = [-half, -half + SAUSAGE_CAP_LENGTH, 0, half - SAUSAGE_CAP_LENGTH, half].filter(
    (z, i, a) => i === 0 || z > a[i - 1] + 1e-9,
  );
  const positions: number[] = [];
  const colors: number[] = [];
  for (const z of zs) {
    const c = Math.abs(z) >= half - 1e-6 ? CAP_COLOR : BODY_COLOR;
    positions.push(-bw, 0, z, bw, 0, z, tw, h, z, -tw, h, z);
    for (let k = 0; k < 4; k++) colors.push(c.r, c.g, c.b);
  }
  const indices: number[] = [];
  for (let r = 0; r + 1 < zs.length; r++) {
    const a = r * 4;
    const b = a + 4;
    indices.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2); // top
    indices.push(a, a + 1, b + 1, a, b + 1, b); // bottom
    indices.push(a + 1, a + 2, b + 2, a + 1, b + 2, b + 1); // right
    indices.push(a + 3, a, b, a + 3, b, b + 3); // left
  }
  const last = (zs.length - 1) * 4;
  indices.push(3, 2, 1, 3, 1, 0);
  indices.push(last, last + 1, last + 2, last, last + 2, last + 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createSausages(track: TrackDataV2): SausageObject {
  const group = new THREE.Group();
  group.name = 'sausages';
  const sausages = track.sausages ?? [];
  const byLength = new Map<number, Sausage[]>();
  for (const s of sausages) {
    const list = byLength.get(s.length);
    if (list === undefined) byLength.set(s.length, [s]);
    else list.push(s);
  }
  const geometries: THREE.BufferGeometry[] = [];
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.5,
    metalness: 0,
  });
  const matrix = new THREE.Matrix4();
  for (const [length, list] of byLength) {
    const geometry = createSausageGeometry(length);
    geometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    mesh.name = `sausages-${length}`;
    for (let i = 0; i < list.length; i++) {
      const { position, yaw } = sausagePose(track, list[i]);
      matrix.makeRotationY(yaw);
      matrix.setPosition(position.x, position.y, position.z);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  let disposed = false;
  return {
    group,
    count: sausages.length,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };
}
