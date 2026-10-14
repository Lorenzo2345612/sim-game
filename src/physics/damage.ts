import type { Vec3 } from '../core/types';

export interface DamageState {
  frontWing: number;
  rearWing: number;
  suspension: [number, number, number, number];
  puncture: [boolean, boolean, boolean, boolean];
  detached: [boolean, boolean, boolean, boolean];
}

export interface Impact {
  /** Impulse magnitude in N·s. */
  impulse: number;
  /** Contact point in car local frame. */
  point: Vec3;
  otherCar: boolean;
}

export interface CarZones {
  halfLength: number;
  halfWidth: number;
  /** Wheel hub positions in wheel order FL, FR, RL, RR. */
  hubs: [Vec3, Vec3, Vec3, Vec3];
}

export interface DamageEffects {
  aeroFront: number;
  aeroRear: number;
  toe: [number, number, number, number];
  gripScale: [number, number, number, number];
}

const HUB_RADIUS = 0.6;
const WING_J0 = 1500;
const WING_JK = 6000;
const SUSP_J0 = 3000;
const SUSP_JK = 9000;
const PUNCTURE_J0 = 2000;
const PUNCTURE_JK = 6000;
const DETACH_J = 9000;
const TOE_FRONT = 0.03;
const TOE_REAR = 0.02;
const PUNCTURE_GRIP = 0.35;

export function createDamageState(): DamageState {
  return {
    frontWing: 0,
    rearWing: 0,
    suspension: [0, 0, 0, 0],
    puncture: [false, false, false, false],
    detached: [false, false, false, false],
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function applyImpact(
  state: DamageState,
  impact: Impact,
  zones: CarZones,
  rng: () => number,
): DamageState {
  const j = impact.impulse;
  if (!Number.isFinite(j) || j <= 0) return state;
  const p = impact.point;

  let corner = -1;
  let nearest = Infinity;
  for (let i = 0; i < 4; i++) {
    const hub = zones.hubs[i];
    const dx = p.x - hub.x;
    const dy = p.y - hub.y;
    const dz = p.z - hub.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d <= HUB_RADIUS && d < nearest) {
      nearest = d;
      corner = i;
    }
  }

  if (corner >= 0) {
    const prev = state.suspension[corner];
    const added = clamp01((j - SUSP_J0) / SUSP_JK);
    state.suspension[corner] = Math.min(1, prev + added);
    if (j > PUNCTURE_J0 && rng() < clamp01((j - PUNCTURE_J0) / PUNCTURE_JK)) {
      state.puncture[corner] = true;
    }
    if (prev >= 1 && j > DETACH_J) {
      state.detached[corner] = true;
      state.puncture[corner] = true;
    }
    return state;
  }

  const frontLimit = -0.6 * zones.halfLength;
  const rearLimit = 0.6 * zones.halfLength;
  if (p.z < frontLimit) {
    state.frontWing = Math.min(1, state.frontWing + clamp01((j - WING_J0) / WING_JK));
  } else if (p.z > rearLimit) {
    state.rearWing = Math.min(1, state.rearWing + clamp01((j - WING_J0) / WING_JK));
  }
  return state;
}

export function damageEffects(state: DamageState, out?: DamageEffects): DamageEffects {
  const result =
    out ??
    ({
      aeroFront: 0,
      aeroRear: 0,
      toe: [0, 0, 0, 0],
      gripScale: [0, 0, 0, 0],
    } as DamageEffects);
  result.aeroFront = 1 - 0.7 * state.frontWing;
  result.aeroRear = 1 - 0.5 * state.rearWing;
  for (let i = 0; i < 4; i++) {
    const toeGain = i < 2 ? TOE_FRONT : TOE_REAR;
    const sign = i % 2 === 0 ? 1 : -1;
    result.toe[i] = sign * toeGain * state.suspension[i];
    result.gripScale[i] = state.detached[i] ? 0 : state.puncture[i] ? PUNCTURE_GRIP : 1;
  }
  return result;
}
