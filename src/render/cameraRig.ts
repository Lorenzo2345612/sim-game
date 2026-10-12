import * as THREE from 'three';
import type { VehicleState } from '../core/types';
import { ChaseCamera } from './chaseCamera';

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
  private current: CameraMode = 'chase';

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
    this.camera.fov = m === 'cockpit' ? COCKPIT_FOV : this.initialFov;
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
    const offset = this.current === 'tcam' ? TCAM_OFFSET : COCKPIT_OFFSET;
    this.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w);
    this.offset.set(offset.x, offset.y, offset.z).applyQuaternion(this.rotation);
    this.camera.position.set(
      state.position.x + this.offset.x,
      state.position.y + this.offset.y,
      state.position.z + this.offset.z,
    );
    this.camera.quaternion.copy(this.rotation);
  }

  dispose(): void {
    // CameraRig owns no GPU resources.
  }
}
