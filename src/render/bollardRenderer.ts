import * as THREE from 'three';
import { BOLLARD_HEIGHT, BOLLARD_RADIUS, type BollardField } from '../track/bollards';

export interface BollardRenderer {
  readonly mesh: THREE.InstancedMesh;
  update(): void;
  dispose(): void;
}

const ORANGE = new THREE.Color(1, 0.42, 0);
const WHITE = new THREE.Color(1, 1, 1);
const BAND_HALF = 0.09;

function bollardGeometry(): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(BOLLARD_RADIUS, BOLLARD_RADIUS, BOLLARD_HEIGHT, 12, 4);
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = Math.abs(pos.getY(i)) <= BAND_HALF ? WHITE : ORANGE;
    colors[3 * i] = c.r;
    colors[3 * i + 1] = c.g;
    colors[3 * i + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function createBollardRenderer(field: BollardField): BollardRenderer {
  const geometry = bollardGeometry();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geometry, material, field.count);
  mesh.name = 'bollards';
  mesh.castShadow = true;
  const lastState = new Uint8Array(field.count);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const write = (i: number): void => {
    const standing = field.state[i] === 0;
    if (standing) {
      matrix.makeTranslation(field.x[i], field.y[i] + BOLLARD_HEIGHT / 2, field.z[i]);
    } else {
      const lying = field.state[i] === 2;
      axis.set(field.spinAxisX[i], 0, field.spinAxisZ[i]);
      if (axis.lengthSq() < 1e-12) axis.copy(up);
      quat.setFromAxisAngle(axis, lying ? Math.PI / 2 : field.angle[i]);
      matrix.makeRotationFromQuaternion(quat);
      matrix.setPosition(field.x[i], field.y[i] + (lying ? BOLLARD_RADIUS : BOLLARD_HEIGHT / 2), field.z[i]);
    }
    mesh.setMatrixAt(i, matrix);
  };
  for (let i = 0; i < field.count; i++) {
    write(i);
    lastState[i] = field.state[i];
  }
  mesh.instanceMatrix.needsUpdate = true;
  return {
    mesh,
    update(): void {
      for (let i = 0; i < field.count; i++) {
        if (field.state[i] === 0 && lastState[i] === 0) continue;
        write(i);
        lastState[i] = field.state[i];
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
