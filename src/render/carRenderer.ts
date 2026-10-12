import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Quat, VehicleState } from '../core/types';

export const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const FLIP = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, Math.PI);
const chassisTmp = new THREE.Quaternion();
const steerTmp = new THREE.Quaternion();
const spinTmp = new THREE.Quaternion();

export function computeWheelQuaternion(
  chassis: Quat,
  steering: number,
  rotation: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  chassisTmp.set(chassis.x, chassis.y, chassis.z, chassis.w);
  steerTmp.setFromAxisAngle(AXIS_Y, steering);
  // wheelRotation grows positive forward; a wheel rolling toward -Z spins negative about +X
  spinTmp.setFromAxisAngle(AXIS_X, -rotation);
  out.copy(chassisTmp).multiply(steerTmp).multiply(spinTmp).multiply(FLIP);
  return out;
}

export class CarRenderer {
  static async load(url: string): Promise<CarRenderer> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return CarRenderer.fromGltfScene(gltf.scene);
  }

  static fromGltfScene(scene: THREE.Object3D): CarRenderer {
    const body = scene.getObjectByName('body');
    if (!body) throw new Error('Missing node: body');
    const wheels = WHEEL_NODE_NAMES.map((name) => {
      const node = scene.getObjectByName(name);
      if (!node) throw new Error(`Missing node: ${name}`);
      return node;
    });

    const root = new THREE.Group();
    const carBody = new THREE.Group();
    const bodyPivot = new THREE.Group();
    bodyPivot.rotation.y = Math.PI;
    bodyPivot.position.y = -0.45;
    body.removeFromParent();
    body.scale.setScalar(1.6);
    bodyPivot.add(body);
    carBody.add(bodyPivot);
    root.add(carBody);

    const wheelGroups = wheels.map((wheel) => {
      wheel.removeFromParent();
      wheel.position.set(0, 0, 0);
      wheel.scale.setScalar(1.1);
      const group = new THREE.Group();
      group.add(wheel);
      root.add(group);
      return group;
    });

    return new CarRenderer(root, carBody, wheelGroups);
  }

  readonly root: THREE.Group;
  private readonly carBody: THREE.Group;
  private readonly wheelGroups: THREE.Group[];
  private readonly tmpQuat = new THREE.Quaternion();

  private constructor(root: THREE.Group, carBody: THREE.Group, wheelGroups: THREE.Group[]) {
    this.root = root;
    this.carBody = carBody;
    this.wheelGroups = wheelGroups;
  }

  update(state: VehicleState): void {
    const p = state.position;
    this.carBody.position.set(p.x, p.y, p.z);
    const r = state.rotation;
    this.carBody.quaternion.set(r.x, r.y, r.z, r.w);
    for (let i = 0; i < this.wheelGroups.length; i++) {
      const w = state.wheels[i];
      const group = this.wheelGroups[i];
      group.position.set(w.position.x, w.position.y, w.position.z);
      group.quaternion.copy(computeWheelQuaternion(r, w.steering, w.rotation, this.tmpQuat));
    }
  }

  /** Turns every mesh into a translucent tinted clone of its material (best-lap ghost car). */
  makeGhost(color = 0x66ccff, opacity = 0.35): void {
    this.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const apply = (m: THREE.Material): THREE.Material => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = opacity;
        c.depthWrite = false;
        if (c instanceof THREE.MeshStandardMaterial || c instanceof THREE.MeshBasicMaterial) c.color.set(color);
        return c;
      };
      obj.material = Array.isArray(obj.material) ? obj.material.map(apply) : apply(obj.material);
    });
  }

  dispose(): void {
    this.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.geometry.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
  }
}
