import type { TrackDataV2, VehicleState } from '../core/types';
import { groundHeightAt } from './ground';

export const BOLLARD_RADIUS = 0.2;
export const BOLLARD_HEIGHT = 0.8;
export const BOLLARD_RESPAWN_S = 20;
export const BOLLARD_CLEAR_M = 30;

const GRAVITY = 9.81;
const HIT_SPEED_SCALE = 0.7;
const HIT_KICK = 2;
const HIT_VY = 3;
const SPIN_RATE = 8;
// Touching counts: the squared overlap test absorbs double rounding at the boundary (e.g. 102.7 − 2.5).
const EPS = 1e-9;

export interface BollardCar {
  x: number; z: number; yaw: number; vx: number; vz: number;
  halfLength: number; halfWidth: number;
}

export interface BollardField {
  readonly count: number;
  readonly homeX: Float32Array; readonly homeZ: Float32Array;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly spinAxisX: Float32Array; readonly spinAxisZ: Float32Array; readonly angle: Float32Array;
  readonly state: Uint8Array;   // 0 standing, 1 flying, 2 resting
  readonly timer: Float32Array; // seconds since leaving state 0
}

const fieldTrack = new WeakMap<BollardField, TrackDataV2>();

export function createBollardField(track: TrackDataV2): BollardField {
  const bollards = track.bollards ?? [];
  const n = bollards.length;
  const field: BollardField = {
    count: n,
    homeX: new Float32Array(n), homeZ: new Float32Array(n),
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
    spinAxisX: new Float32Array(n), spinAxisZ: new Float32Array(n), angle: new Float32Array(n),
    state: new Uint8Array(n), timer: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const b = bollards[i];
    field.homeX[i] = b.x;
    field.homeZ[i] = b.z;
    field.x[i] = b.x;
    field.z[i] = b.z;
    field.y[i] = groundHeightAt(track, b.x, b.z);
  }
  fieldTrack.set(field, track);
  return field;
}

/** Circle (bollard) vs car OBB in the car's local frame (three.js rotation.y = yaw, forward = −Z local). */
function overlapsCar(bx: number, bz: number, car: BollardCar): boolean {
  const cos = Math.cos(car.yaw);
  const sin = Math.sin(car.yaw);
  const dx = bx - car.x;
  const dz = bz - car.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const cx = Math.min(Math.max(lx, -car.halfWidth), car.halfWidth);
  const cz = Math.min(Math.max(lz, -car.halfLength), car.halfLength);
  const ex = lx - cx;
  const ez = lz - cz;
  return ex * ex + ez * ez <= BOLLARD_RADIUS * BOLLARD_RADIUS + EPS;
}

export function stepBollards(field: BollardField, cars: readonly BollardCar[], dt: number): void {
  const track = fieldTrack.get(field);
  if (track === undefined) return;
  for (let i = 0; i < field.count; i++) {
    if (field.state[i] === 0) {
      for (let c = 0; c < cars.length; c++) {
        const car = cars[c];
        if (!overlapsCar(field.x[i], field.z[i], car)) continue;
        let nx = field.x[i] - car.x;
        let nz = field.z[i] - car.z;
        const nd = Math.hypot(nx, nz);
        if (nd > EPS) {
          nx /= nd;
          nz /= nd;
        } else {
          nx = -Math.sin(car.yaw);
          nz = -Math.cos(car.yaw);
        }
        const hvx = HIT_SPEED_SCALE * car.vx + HIT_KICK * nx;
        const hvz = HIT_SPEED_SCALE * car.vz + HIT_KICK * nz;
        const hspd = Math.hypot(hvx, hvz);
        field.vx[i] = hvx;
        field.vz[i] = hvz;
        field.vy[i] = HIT_VY;
        if (hspd > EPS) {
          field.spinAxisX[i] = -hvz / hspd;
          field.spinAxisZ[i] = hvx / hspd;
        } else {
          field.spinAxisX[i] = nx;
          field.spinAxisZ[i] = nz;
        }
        field.angle[i] = 0;
        field.state[i] = 1;
        field.timer[i] = 0;
        break;
      }
      continue;
    }
    field.timer[i] += dt;
    if (field.state[i] === 1) {
      field.vy[i] -= GRAVITY * dt;
      field.x[i] += field.vx[i] * dt;
      field.y[i] += field.vy[i] * dt;
      field.z[i] += field.vz[i] * dt;
      field.angle[i] += SPIN_RATE * dt;
      const g = groundHeightAt(track, field.x[i], field.z[i]);
      if (field.y[i] <= g) {
        field.y[i] = g;
        field.vx[i] = 0;
        field.vy[i] = 0;
        field.vz[i] = 0;
        field.state[i] = 2;
      }
    }
    if (field.timer[i] >= BOLLARD_RESPAWN_S) {
      let clear = true;
      const hx = field.homeX[i];
      const hz = field.homeZ[i];
      for (let c = 0; c < cars.length; c++) {
        const dx = cars[c].x - hx;
        const dz = cars[c].z - hz;
        if (dx * dx + dz * dz <= BOLLARD_CLEAR_M * BOLLARD_CLEAR_M) {
          clear = false;
          break;
        }
      }
      if (clear) {
        field.x[i] = hx;
        field.z[i] = hz;
        field.y[i] = groundHeightAt(track, hx, hz);
        field.vx[i] = 0;
        field.vy[i] = 0;
        field.vz[i] = 0;
        field.angle[i] = 0;
        field.state[i] = 0;
        field.timer[i] = 0;
      }
    }
  }
}

/** Yaw and velocity from the vehicle quaternion (forward = (−2(w·y + x·z), −1 + 2(x² + y²))); writes and returns `out`. */
export function bollardCarFromState(
  s: VehicleState, halfLength: number, halfWidth: number, out: BollardCar,
): BollardCar {
  const q = s.rotation;
  const fx = -2 * (q.w * q.y + q.x * q.z);
  const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
  out.x = s.position.x;
  out.z = s.position.z;
  out.yaw = Math.atan2(-fx, -fz);
  out.vx = s.forwardSpeed * fx;
  out.vz = s.forwardSpeed * fz;
  out.halfLength = halfLength;
  out.halfWidth = halfWidth;
  return out;
}
