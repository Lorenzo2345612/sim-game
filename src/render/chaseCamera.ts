import * as THREE from 'three';
import type { Quat, Vec3, VehicleState } from '../core/types';

export interface ChaseTarget { position: Vec3; lookAt: Vec3 }

export const CHASE_DISTANCE = 6.0;
export const CHASE_HEIGHT = 2.2;
export const LOOK_AHEAD = 4.0;
export const LOOK_HEIGHT = 0.8;

const FWD_MIN_LEN = 1e-3;

export function computeChaseTarget(carPosition: Vec3, carRotation: Quat, previousForward: Vec3, out: ChaseTarget): ChaseTarget {
  const fx = -2 * (carRotation.x * carRotation.z + carRotation.w * carRotation.y);
  const fz = -(1 - 2 * (carRotation.x * carRotation.x + carRotation.y * carRotation.y));
  const len = Math.hypot(fx, fz);
  let dx: number, dy: number, dz: number;
  if (len < FWD_MIN_LEN) {
    dx = previousForward.x;
    dy = previousForward.y;
    dz = previousForward.z;
  } else {
    dx = fx / len;
    dy = 0;
    dz = fz / len;
    previousForward.x = dx;
    previousForward.y = 0;
    previousForward.z = dz;
  }
  out.position.x = carPosition.x - dx * CHASE_DISTANCE;
  out.position.y = carPosition.y - dy * CHASE_DISTANCE + CHASE_HEIGHT;
  out.position.z = carPosition.z - dz * CHASE_DISTANCE;
  out.lookAt.x = carPosition.x + dx * LOOK_AHEAD;
  out.lookAt.y = carPosition.y + dy * LOOK_AHEAD + LOOK_HEIGHT;
  out.lookAt.z = carPosition.z + dz * LOOK_AHEAD;
  return out;
}

export class ChaseCamera {
  private camera: THREE.PerspectiveCamera;
  private target: ChaseTarget = { position: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } };
  private pos: Vec3 = { x: 0, y: 0, z: 0 };
  private look: Vec3 = { x: 0, y: 0, z: 0 };
  private prevForward: Vec3 = { x: 0, y: 0, z: -1 };
  private initialized = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  snap(state: VehicleState): void {
    computeChaseTarget(state.position, state.rotation, this.prevForward, this.target);
    this.pos.x = this.target.position.x;
    this.pos.y = this.target.position.y;
    this.pos.z = this.target.position.z;
    this.look.x = this.target.lookAt.x;
    this.look.y = this.target.lookAt.y;
    this.look.z = this.target.lookAt.z;
    this.camera.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.camera.lookAt(this.look.x, this.look.y, this.look.z);
    this.camera.fov = this.targetFov(state.forwardSpeed);
    this.camera.updateProjectionMatrix();
    this.initialized = true;
  }

  update(state: VehicleState, dt: number): void {
    if (!this.initialized) {
      this.snap(state);
      return;
    }
    computeChaseTarget(state.position, state.rotation, this.prevForward, this.target);
    const kPos = 1 - Math.exp(-8 * dt);
    const kLook = 1 - Math.exp(-12 * dt);
    this.pos.x += (this.target.position.x - this.pos.x) * kPos;
    this.pos.y += (this.target.position.y - this.pos.y) * kPos;
    this.pos.z += (this.target.position.z - this.pos.z) * kPos;
    this.look.x += (this.target.lookAt.x - this.look.x) * kLook;
    this.look.y += (this.target.lookAt.y - this.look.y) * kLook;
    this.look.z += (this.target.lookAt.z - this.look.z) * kLook;
    this.camera.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.camera.lookAt(this.look.x, this.look.y, this.look.z);

    const targetFov = this.targetFov(state.forwardSpeed);
    const newFov = this.camera.fov + (targetFov - this.camera.fov) * (1 - Math.exp(-3 * dt));
    const fovDelta = Math.abs(newFov - this.camera.fov);
    this.camera.fov = newFov;
    if (fovDelta > 0.01) this.camera.updateProjectionMatrix();
  }

  private targetFov(forwardSpeed: number): number {
    const t = Math.min(Math.abs(forwardSpeed) / 80, 1);
    return 60 + 10 * t;
  }
}
