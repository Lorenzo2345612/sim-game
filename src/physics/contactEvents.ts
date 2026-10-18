import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../core/types';
import { applyImpact, type CarZones, type DamageState, type Impact } from './damage';

export type DamageMode = 'off' | 'visual' | 'full';

// Margin subtracted from each raw contact impulse (mRed·V_SAFE) so resting contacts and low-speed taps never damage.
export const V_SAFE = 6;

export interface DamageCar {
  chassis: RAPIER.Collider;
  body: RAPIER.RigidBody;
  zones: CarZones;
  damage: DamageState;
  damageMode: DamageMode;
}

const localPoint: Vec3 = { x: 0, y: 0, z: 0 };
const worldPoint: Vec3 = { x: 0, y: 0, z: 0 };
const tmpPoint: Vec3 = { x: 0, y: 0, z: 0 };
const colPos: Vec3 = { x: 0, y: 0, z: 0 };
const colRot = { x: 0, y: 0, z: 0, w: 1 };
const impact: Impact = { impulse: 0, point: localPoint, otherCar: false };

// Handle→car map, rebuilt only when the cars array identity changes (no per-tick rebuild).
let cachedCars: readonly DamageCar[] | null = null;
let handleToCar = new Map<number, DamageCar>();

function carsByHandle(cars: readonly DamageCar[]): Map<number, DamageCar> {
  if (cachedCars !== cars) {
    handleToCar = new Map<number, DamageCar>();
    for (let i = 0; i < cars.length; i++) {
      handleToCar.set(cars[i].chassis.handle, cars[i]);
    }
    cachedCars = cars;
  }
  return handleToCar;
}

export function toLocalPoint(
  world: Vec3,
  carPos: Vec3,
  carQuat: { x: number; y: number; z: number; w: number },
  out: Vec3,
): Vec3 {
  const dx = world.x - carPos.x;
  const dy = world.y - carPos.y;
  const dz = world.z - carPos.z;
  const { x, y, z, w } = carQuat;
  // inverse(q)·d = d − 2w(q×d) + 2q×(q×d)
  const cx = y * dz - z * dy;
  const cy = z * dx - x * dz;
  const cz = x * dy - y * dx;
  const tx = y * cz - z * cy;
  const ty = z * cx - x * cz;
  const tz = x * cy - y * cx;
  out.x = dx - 2 * w * cx + 2 * tx;
  out.y = dy - 2 * w * cy + 2 * ty;
  out.z = dz - 2 * w * cz + 2 * tz;
  return out;
}

export function processContactEvents(
  queue: RAPIER.EventQueue,
  world: RAPIER.World,
  cars: readonly DamageCar[],
  dt: number,
  rng: () => number,
): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  const byHandle = carsByHandle(cars);
  queue.drainContactForceEvents((event) => {
    const h1 = event.collider1();
    const h2 = event.collider2();
    const car1 = byHandle.get(h1) ?? null;
    const car2 = byHandle.get(h2) ?? null;
    if (car1 === null && car2 === null) return;
    const jRaw = event.totalForceMagnitude() * dt;
    if (!(jRaw > 0)) return;
    let mRed: number;
    if (car1 !== null && car2 !== null) {
      const m1 = car1.body.mass();
      const m2 = car2.body.mass();
      mRed = (m1 * m2) / (m1 + m2);
    } else {
      mRed = (car1 ?? car2)!.body.mass();
    }
    const j = jRaw - mRed * V_SAFE;
    if (!(j > 0)) return;
    if (!contactCentroid(world, h1, h2, worldPoint)) {
      // Manifold with no points at all: keep the event, anchor it at the car chassis.
      const fallback = car1 ?? car2;
      if (fallback === null) return;
      const t = fallback.body.translation();
      worldPoint.x = t.x;
      worldPoint.y = t.y;
      worldPoint.z = t.z;
    }
    applyTo(car1, car2 !== null, j, rng);
    applyTo(car2, car1 !== null, j, rng);
  });
}

function applyTo(car: DamageCar | null, otherCar: boolean, j: number, rng: () => number): void {
  if (car === null || car.damageMode === 'off') return;
  const t = car.body.translation();
  const q = car.body.rotation();
  toLocalPoint(worldPoint, t, q, localPoint);
  impact.impulse = j;
  impact.otherCar = otherCar;
  applyImpact(car.damage, impact, car.zones, rng);
}

function contactCentroid(
  world: RAPIER.World,
  h1: number,
  h2: number,
  out: Vec3,
): boolean {
  const c1 = world.getCollider(h1);
  const c2 = world.getCollider(h2);
  let n = 0;
  out.x = 0;
  out.y = 0;
  out.z = 0;
  world.contactPair(c1, c2, (manifold, flipped) => {
    const count = manifold.numSolverContacts();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        if (manifold.solverContactPoint(i, tmpPoint) === null) continue;
        out.x += tmpPoint.x;
        out.y += tmpPoint.y;
        out.z += tmpPoint.z;
        n++;
      }
      return;
    }
    // Trimesh colliders (track barriers) keep raw contacts but no solver contacts at drain time.
    const raw = manifold.numContacts();
    if (raw === 0) return;
    const source = flipped ? c2 : c1;
    source.translation(colPos);
    source.rotation(colRot);
    for (let i = 0; i < raw; i++) {
      if (manifold.localContactPoint1(i, tmpPoint) === null) continue;
      const p = tmpPoint;
      const tx = 2 * (colRot.y * p.z - colRot.z * p.y);
      const ty = 2 * (colRot.z * p.x - colRot.x * p.z);
      const tz = 2 * (colRot.x * p.y - colRot.y * p.x);
      out.x += p.x + colRot.w * tx + colRot.y * tz - colRot.z * ty + colPos.x;
      out.y += p.y + colRot.w * ty + colRot.z * tx - colRot.x * tz + colPos.y;
      out.z += p.z + colRot.w * tz + colRot.x * ty - colRot.y * tx + colPos.z;
      n++;
    }
  });
  if (n === 0) return false;
  out.x /= n;
  out.y /= n;
  out.z /= n;
  return true;
}
