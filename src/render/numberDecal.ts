import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

export interface DecalAnchor {
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

const TEXTURE_SIZE = 256;
const textureCache = new Map<string, THREE.CanvasTexture>();

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const projectorPos = new THREE.Vector3();
const projectorNormal = new THREE.Vector3();
const rayDir = new THREE.Vector3();
const projectorSize = new THREE.Vector3();
const projectorQuat = new THREE.Quaternion();
const projectorEuler = new THREE.Euler();
const poseQuat = new THREE.Quaternion();
const bodyInverse = new THREE.Matrix4();
const poseMatrix = new THREE.Matrix4();
const poseInverse = new THREE.Matrix4();
const raycaster = new THREE.Raycaster();

export function numberTexture(n: number, fg = '#000000', bg = '#ffffff'): THREE.CanvasTexture {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`invalid race number: ${String(n)}`);
  const key = `${n}|${fg}|${bg}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  let source: HTMLCanvasElement;
  if (typeof document === 'undefined') {
    // Unit tests run without a DOM: keep the texture size, never draw.
    source = { width: TEXTURE_SIZE, height: TEXTURE_SIZE } as unknown as HTMLCanvasElement;
  } else {
    source = document.createElement('canvas');
    source.width = TEXTURE_SIZE;
    source.height = TEXTURE_SIZE;
    const ctx = source.getContext('2d');
    if (ctx) {
      const c = TEXTURE_SIZE / 2;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(c, c, c - 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.font = 'bold 140px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), c, c);
    }
  }
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, texture);
  return texture;
}

export function decalAnchors(bounds: THREE.Box3): { left: DecalAnchor; right: DecalAnchor; nose: DecalAnchor } {
  const h = bounds.max.y - bounds.min.y;
  const len = bounds.max.z - bounds.min.z;
  const y = bounds.min.y + 0.55 * h;
  const z = bounds.min.z + 0.45 * len;
  const noseZ = bounds.min.z + 0.12 * len;
  const cx = 0.5 * (bounds.min.x + bounds.max.x);
  return {
    left: { position: { x: bounds.min.x, y, z }, normal: { x: -1, y: 0, z: 0 } },
    right: { position: { x: bounds.max.x, y, z }, normal: { x: 1, y: 0, z: 0 } },
    nose: { position: { x: cx, y: bounds.max.y, z: noseZ }, normal: { x: 0, y: 1, z: 0 } },
  };
}

function firstMesh(root: THREE.Object3D): THREE.Mesh | undefined {
  let out: THREE.Mesh | undefined;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!out && mesh.isMesh) out = mesh;
  });
  return out;
}

// The glb body node is a Group around its primitive meshes, so a named non-mesh falls through to its first mesh.
function targetMesh(car: THREE.Object3D): THREE.Mesh {
  const named = car.getObjectByName('body');
  if (named && (named as THREE.Mesh).isMesh) return named as THREE.Mesh;
  const scoped = firstMesh(named ?? car) ?? firstMesh(car);
  if (!scoped) throw new Error('no mesh to project the race number onto');
  return scoped;
}

export function addNumberDecals(
  car: THREE.Object3D,
  bounds: THREE.Box3,
  n: number,
  size = 0.35,
  restWorld?: THREE.Matrix4,
): THREE.Mesh[] {
  const target = targetMesh(car);
  car.updateWorldMatrix(true, true);
  // bounds/restWorld describe the rest pose; re-express the anchors in the current world (the body moves under car.root).
  const poseNode = restWorld ? (car.getObjectByName('body') ?? car) : car;
  if (restWorld) poseMatrix.multiplyMatrices(poseNode.matrixWorld, poseInverse.copy(restWorld).invert());
  else poseMatrix.copy(car.matrixWorld);
  const material = new THREE.MeshStandardMaterial({
    map: numberTexture(n),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    metalness: 0,
    roughness: 1,
  });
  const { left, right, nose } = decalAnchors(bounds);
  poseQuat.setFromRotationMatrix(poseMatrix);
  const meshes: THREE.Mesh[] = [];
  for (const anchor of [left, right, nose]) {
    projectorPos
      .set(anchor.position.x, anchor.position.y, anchor.position.z)
      .applyMatrix4(poseMatrix);
    projectorNormal.set(anchor.normal.x, anchor.normal.y, anchor.normal.z);
    // Twist is built in anchor space then rotated by the pose: it must follow the body, not the world.
    projectorQuat.setFromUnitVectors(Z_AXIS, projectorNormal).premultiply(poseQuat);
    rayDir.copy(projectorNormal).transformDirection(poseMatrix).negate();
    raycaster.set(projectorPos, rayDir);
    const hits = raycaster.intersectObject(target, false);
    if (hits.length > 0) projectorPos.copy(hits[0].point);
    projectorEuler.setFromQuaternion(projectorQuat);
    projectorSize.set(size, size, size);
    const geometry = new DecalGeometry(target, projectorPos, projectorEuler, projectorSize);
    const mesh = new THREE.Mesh(geometry, material);
    // Geometry is baked in world space at creation; rebase it under the body that moves every frame.
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(bodyInverse.copy(target.matrixWorld).invert());
    target.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

export function disposeNumberDecals(meshes: THREE.Mesh[]): void {
  for (const mesh of meshes) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const m of material) m.dispose();
    } else {
      material.dispose();
    }
  }
}
