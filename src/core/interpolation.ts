import type { Quat, VehicleState, Vec3, WheelState } from './types';

function clampT(t: number): number {
  if (!Number.isFinite(t)) return 1;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

export function lerpVec3(a: Vec3, b: Vec3, t: number, out: Vec3): Vec3 {
  const k = clampT(t);
  out.x = a.x + (b.x - a.x) * k;
  out.y = a.y + (b.y - a.y) * k;
  out.z = a.z + (b.z - a.z) * k;
  return out;
}

export function slerpQuat(a: Quat, b: Quat, t: number, out: Quat): Quat {
  const k = clampT(t);
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let d = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (d < 0) {
    d = -d;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (d > 0.9995) {
    out.x = a.x + (bx - a.x) * k;
    out.y = a.y + (by - a.y) * k;
    out.z = a.z + (bz - a.z) * k;
    out.w = a.w + (bw - a.w) * k;
  } else {
    const theta = Math.acos(d);
    const s = Math.sin(theta);
    const wa = Math.sin((1 - k) * theta) / s;
    const wb = Math.sin(k * theta) / s;
    out.x = wa * a.x + wb * bx;
    out.y = wa * a.y + wb * by;
    out.z = wa * a.z + wb * bz;
    out.w = wa * a.w + wb * bw;
  }
  const n = Math.hypot(out.x, out.y, out.z, out.w);
  out.x /= n;
  out.y /= n;
  out.z /= n;
  out.w /= n;
  return out;
}

export function createVehicleState(wheelCount: number): VehicleState {
  const wheels: WheelState[] = [];
  for (let i = 0; i < wheelCount; i++) {
    wheels.push({ position: { x: 0, y: 0, z: 0 }, steering: 0, rotation: 0, inContact: false });
  }
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    forwardSpeed: 0,
    wheels,
  };
}

export function copyVehicleState(src: VehicleState, out: VehicleState): VehicleState {
  out.position.x = src.position.x;
  out.position.y = src.position.y;
  out.position.z = src.position.z;
  out.rotation.x = src.rotation.x;
  out.rotation.y = src.rotation.y;
  out.rotation.z = src.rotation.z;
  out.rotation.w = src.rotation.w;
  out.forwardSpeed = src.forwardSpeed;
  for (let i = 0; i < out.wheels.length; i++) {
    const s = src.wheels[i];
    const w = out.wheels[i];
    w.position.x = s.position.x;
    w.position.y = s.position.y;
    w.position.z = s.position.z;
    w.steering = s.steering;
    w.rotation = s.rotation;
    w.inContact = s.inContact;
  }
  return out;
}

export function interpolateVehicleState(
  prev: VehicleState,
  curr: VehicleState,
  t: number,
  out: VehicleState,
): VehicleState {
  const k = clampT(t);
  lerpVec3(prev.position, curr.position, k, out.position);
  slerpQuat(prev.rotation, curr.rotation, k, out.rotation);
  out.forwardSpeed = prev.forwardSpeed + (curr.forwardSpeed - prev.forwardSpeed) * k;
  for (let i = 0; i < out.wheels.length; i++) {
    const p = prev.wheels[i];
    const c = curr.wheels[i];
    const w = out.wheels[i];
    lerpVec3(p.position, c.position, k, w.position);
    w.steering = p.steering + (c.steering - p.steering) * k;
    w.rotation = p.rotation + (c.rotation - p.rotation) * k;
    w.inContact = c.inContact;
  }
  return out;
}
