import type { VehicleState } from '../core/types';

export interface ReplaySample {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  speed: number; steer: number; wheelSpin: number;
}

// 1e-9 slack so accumulated float time still crosses exact k/hz boundaries
const SLACK = 1e-9;
const Q_SCALE = 32767;
const STEER_SCALE = 127;

export class ReplayRecorder {
  private readonly carCount: number;
  private readonly hz: number;
  private readonly capacity: number;
  private readonly posX: Float32Array;
  private readonly quat: Int16Array;
  private readonly speed: Float32Array;
  private readonly steer: Int8Array;
  private readonly spin: Float32Array;
  private readonly prevPos: Float64Array;
  private readonly prevQuat: Float64Array;
  private readonly prevSpeed: Float64Array;
  private readonly prevSteer: Float64Array;
  private readonly prevSpin: Float64Array;
  private nextFrame = 0;
  private count = 0;
  private hasPrev = false;
  private prevTime = 0;

  constructor(carCount: number, hz = 20, maxSeconds = 3600) {
    this.carCount = carCount;
    this.hz = hz;
    this.capacity = Math.max(1, Math.floor(hz * maxSeconds));
    const n = this.capacity * carCount;
    this.posX = new Float32Array(n * 3);
    this.quat = new Int16Array(n * 4);
    this.speed = new Float32Array(n);
    this.steer = new Int8Array(n);
    this.spin = new Float32Array(n);
    this.prevPos = new Float64Array(carCount * 3);
    this.prevQuat = new Float64Array(carCount * 4);
    this.prevSpeed = new Float64Array(carCount);
    this.prevSteer = new Float64Array(carCount);
    this.prevSpin = new Float64Array(carCount);
  }

  get byteLength(): number {
    return this.posX.byteLength + this.quat.byteLength + this.speed.byteLength
      + this.steer.byteLength + this.spin.byteLength;
  }

  get startTime(): number {
    return this.count === 0 ? 0 : (this.nextFrame - this.count) / this.hz;
  }

  get endTime(): number {
    return this.count === 0 ? 0 : (this.nextFrame - 1) / this.hz;
  }

  record(time: number, states: readonly VehicleState[], steers: ArrayLike<number>): void {
    if (!Number.isFinite(time)) return;
    if (this.hasPrev && time <= this.prevTime) return;
    if (!this.hasPrev) {
      this.savePrev(states, steers);
      this.prevTime = time;
      this.hasPrev = true;
    }
    const span = time - this.prevTime;
    // Each frame lands on k/hz; this call emits every frame whose time it has crossed.
    while (time >= this.nextFrame / this.hz - SLACK) {
      const target = this.nextFrame / this.hz;
      const u = span > 0 ? Math.min(1, Math.max(0, (target - this.prevTime) / span)) : 1;
      this.writeFrame(this.nextFrame, states, steers, u);
      this.nextFrame++;
    }
    this.savePrev(states, steers);
    this.prevTime = time;
  }

  sampleAt(t: number, car: number, out: ReplaySample): ReplaySample {
    if (!Number.isInteger(car) || car < 0 || car >= this.carCount) throw new RangeError(`car ${car} out of range`);
    if (this.count === 0) {
      out.x = 0; out.y = 0; out.z = 0;
      out.qx = 0; out.qy = 0; out.qz = 0; out.qw = 1;
      out.speed = 0; out.steer = 0; out.wheelSpin = 0;
      return out;
    }
    const oldest = this.nextFrame - this.count;
    const newest = this.nextFrame - 1;
    let kf = t * this.hz;
    if (kf < oldest) kf = oldest;
    else if (kf > newest) kf = newest;
    const a = Math.floor(kf);
    if (a >= newest) return this.readFrame(newest, car, out);
    return this.lerpFrames(a, kf - a, car, out);
  }

  private savePrev(states: readonly VehicleState[], steers: ArrayLike<number>): void {
    for (let car = 0; car < this.carCount; car++) {
      const st = states[car];
      const p3 = car * 3;
      const p4 = car * 4;
      this.prevPos[p3] = st.position.x;
      this.prevPos[p3 + 1] = st.position.y;
      this.prevPos[p3 + 2] = st.position.z;
      this.prevQuat[p4] = st.rotation.x;
      this.prevQuat[p4 + 1] = st.rotation.y;
      this.prevQuat[p4 + 2] = st.rotation.z;
      this.prevQuat[p4 + 3] = st.rotation.w;
      this.prevSpeed[car] = st.forwardSpeed;
      const s = steers[car];
      this.prevSteer[car] = s < -1 ? -1 : s > 1 ? 1 : s;
      this.prevSpin[car] = st.wheels[0].rotation;
    }
  }

  private writeFrame(k: number, states: readonly VehicleState[], steers: ArrayLike<number>, u: number): void {
    const slot = (k % this.capacity) * this.carCount;
    for (let car = 0; car < this.carCount; car++) {
      const st = states[car];
      const p3 = car * 3;
      const p4 = car * 4;
      const i = slot + car;
      const i3 = i * 3;
      this.posX[i3] = this.prevPos[p3] + (st.position.x - this.prevPos[p3]) * u;
      this.posX[i3 + 1] = this.prevPos[p3 + 1] + (st.position.y - this.prevPos[p3 + 1]) * u;
      this.posX[i3 + 2] = this.prevPos[p3 + 2] + (st.position.z - this.prevPos[p3 + 2]) * u;

      const i4 = i * 4;
      let qx = this.prevQuat[p4];
      let qy = this.prevQuat[p4 + 1];
      let qz = this.prevQuat[p4 + 2];
      let qw = this.prevQuat[p4 + 3];
      const cx = st.rotation.x;
      const cy = st.rotation.y;
      const cz = st.rotation.z;
      const cw = st.rotation.w;
      if (qx * cx + qy * cy + qz * cz + qw * cw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
      qx += (cx - qx) * u;
      qy += (cy - qy) * u;
      qz += (cz - qz) * u;
      qw += (cw - qw) * u;
      const qlen = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
      if (qlen > 0) { qx /= qlen; qy /= qlen; qz /= qlen; qw /= qlen; }
      this.quat[i4] = Math.round(qx * Q_SCALE);
      this.quat[i4 + 1] = Math.round(qy * Q_SCALE);
      this.quat[i4 + 2] = Math.round(qz * Q_SCALE);
      this.quat[i4 + 3] = Math.round(qw * Q_SCALE);

      this.speed[i] = this.prevSpeed[car] + (st.forwardSpeed - this.prevSpeed[car]) * u;
      const s = steers[car];
      const sc = s < -1 ? -1 : s > 1 ? 1 : s;
      this.steer[i] = Math.round((this.prevSteer[car] + (sc - this.prevSteer[car]) * u) * STEER_SCALE);
      this.spin[i] = this.prevSpin[car] + (st.wheels[0].rotation - this.prevSpin[car]) * u;
    }
    if (this.count < this.capacity) this.count++;
  }

  private lerpFrames(a: number, u: number, car: number, out: ReplaySample): ReplaySample {
    const s0 = (a % this.capacity) * this.carCount + car;
    const s1 = ((a + 1) % this.capacity) * this.carCount + car;
    const p0 = s0 * 3;
    const p1 = s1 * 3;
    out.x = this.posX[p0] + (this.posX[p1] - this.posX[p0]) * u;
    out.y = this.posX[p0 + 1] + (this.posX[p1 + 1] - this.posX[p0 + 1]) * u;
    out.z = this.posX[p0 + 2] + (this.posX[p1 + 2] - this.posX[p0 + 2]) * u;
    out.speed = this.speed[s0] + (this.speed[s1] - this.speed[s0]) * u;
    const st0 = this.steer[s0] / STEER_SCALE;
    out.steer = st0 + (this.steer[s1] / STEER_SCALE - st0) * u;
    out.wheelSpin = this.spin[s0] + (this.spin[s1] - this.spin[s0]) * u;

    const q0 = s0 * 4;
    const q1 = s1 * 4;
    let ax = this.quat[q0] / Q_SCALE;
    let ay = this.quat[q0 + 1] / Q_SCALE;
    let az = this.quat[q0 + 2] / Q_SCALE;
    let aw = this.quat[q0 + 3] / Q_SCALE;
    let bx = this.quat[q1] / Q_SCALE;
    let by = this.quat[q1 + 1] / Q_SCALE;
    let bz = this.quat[q1 + 2] / Q_SCALE;
    let bw = this.quat[q1 + 3] / Q_SCALE;
    let len = Math.sqrt(ax * ax + ay * ay + az * az + aw * aw);
    if (len > 0) { ax /= len; ay /= len; az /= len; aw /= len; }
    len = Math.sqrt(bx * bx + by * by + bz * bz + bw * bw);
    if (len > 0) { bx /= len; by /= len; bz /= len; bw /= len; }
    let dot = ax * bx + ay * by + az * bz + aw * bw;
    if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
    let qx: number;
    let qy: number;
    let qz: number;
    let qw: number;
    if (dot > 0.9995) {
      qx = ax + (bx - ax) * u;
      qy = ay + (by - ay) * u;
      qz = az + (bz - az) * u;
      qw = aw + (bw - aw) * u;
    } else {
      const theta = Math.acos(Math.min(1, dot));
      const invSin = 1 / Math.sin(theta);
      const w0 = Math.sin((1 - u) * theta) * invSin;
      const w1 = Math.sin(u * theta) * invSin;
      qx = ax * w0 + bx * w1;
      qy = ay * w0 + by * w1;
      qz = az * w0 + bz * w1;
      qw = aw * w0 + bw * w1;
    }
    len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
    if (len > 0) { qx /= len; qy /= len; qz /= len; qw /= len; }
    out.qx = qx;
    out.qy = qy;
    out.qz = qz;
    out.qw = qw;
    return out;
  }

  private readFrame(k: number, car: number, out: ReplaySample): ReplaySample {
    const s = (k % this.capacity) * this.carCount + car;
    const p = s * 3;
    const q = s * 4;
    out.x = this.posX[p];
    out.y = this.posX[p + 1];
    out.z = this.posX[p + 2];
    let qx = this.quat[q] / Q_SCALE;
    let qy = this.quat[q + 1] / Q_SCALE;
    let qz = this.quat[q + 2] / Q_SCALE;
    let qw = this.quat[q + 3] / Q_SCALE;
    const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
    if (len > 0) { qx /= len; qy /= len; qz /= len; qw /= len; }
    out.qx = qx;
    out.qy = qy;
    out.qz = qz;
    out.qw = qw;
    out.speed = this.speed[s];
    out.steer = this.steer[s] / STEER_SCALE;
    out.wheelSpin = this.spin[s];
    return out;
  }
}
