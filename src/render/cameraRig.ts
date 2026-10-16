import * as THREE from 'three';
import type { VehicleState } from '../core/types';
import type { Vec3 } from '../physics/carSpec';
import { ChaseCamera } from './chaseCamera';
import { shakeOffset } from './cameraShake';

export type CameraMode = 'chase' | 'tcam' | 'cockpit';

export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'tcam', 'cockpit'];
export const TCAM_OFFSET = { x: 0, y: 1.15, z: 0.6 };
export const COCKPIT_OFFSET = { x: 0, y: 0.75, z: -0.2 };
export const COCKPIT_FOV = 75;

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly chase: ChaseCamera;
  private readonly initialFov: number;
  private readonly offset = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly shakeOut = { y: 0, roll: 0 };
  private readonly cockpitEye: Vec3 = { ...COCKPIT_OFFSET };
  private current: CameraMode = 'chase';
  private shakeScale = 1;
  private headX = 0;
  private headZ = 0;
  private cockpitFov = COCKPIT_FOV;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.chase = new ChaseCamera(camera);
    this.initialFov = camera.fov;
  }

  get mode(): CameraMode {
    return this.current;
  }

  set mode(m: CameraMode) {
    if (m === this.current) return;
    this.current = m;
    this.camera.fov = m === 'cockpit' ? this.cockpitFov : this.initialFov;
    this.camera.updateProjectionMatrix();
  }

  next(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.current);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    return this.current;
  }

  update(state: VehicleState, dt: number): void {
    if (this.current === 'chase') {
      this.chase.update(state, dt);
      return;
    }
    const offset = this.current === 'tcam' ? TCAM_OFFSET : this.cockpitEye;
    this.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w);
    this.offset.set(offset.x, offset.y, offset.z);
    if (this.current === 'cockpit') {
      this.offset.x += this.headX;
      this.offset.z += this.headZ;
    }
    this.offset.applyQuaternion(this.rotation);
    this.camera.position.set(
      state.position.x + this.offset.x,
      state.position.y + this.offset.y,
      state.position.z + this.offset.z,
    );
    this.camera.quaternion.copy(this.rotation);
  }

  setCockpitEye(eye: Vec3): void {
    this.cockpitEye.x = eye.x;
    this.cockpitEye.y = eye.y;
    this.cockpitEye.z = eye.z;
  }

  setHeadOffset(x: number, z: number): void {
    this.headX = x;
    this.headZ = z;
  }

  setCockpitFov(fov: number): void {
    this.cockpitFov = fov;
    if (this.current === 'cockpit') {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  setShakeScale(s: number): void {
    this.shakeScale = Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 1;
  }

  // Called after update() each frame; update rewrites the pose, so the offset never accumulates.
  applyShake(amount: number, t: number): void {
    const scaled = amount * this.shakeScale;
    if (scaled === 0) return;
    const o = shakeOffset(scaled, t, this.current, this.shakeOut);
    this.camera.position.y += o.y;
    this.camera.rotateZ(o.roll);
  }

  dispose(): void {
    // CameraRig owns no GPU resources.
  }
}
