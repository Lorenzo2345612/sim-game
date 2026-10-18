import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../core/types';

export type DebrisKind = 'wheel' | 'frontWing' | 'rearWing';

export const MAX_DEBRIS = 8;
export const DEBRIS_LIFETIME_S = 60;
export const DEBRIS_MAX_DISTANCE_M = 300;

// Matches public/cars/f4.json wheels.radius; RaceGame overrides with the car's own spec.
const DEFAULT_WHEEL_RADIUS_M = 0.28;
const WHEEL_WIDTH_M = 0.3;
const WHEEL_MASS_KG = 12;
const FRONT_WING_HALF = { x: 0.8, y: 0.025, z: 0.2 };
const FRONT_WING_MASS_KG = 6;
const REAR_WING_HALF = { x: 0.5, y: 0.15, z: 0.15 };
const REAR_WING_MASS_KG = 5;
const ANGVEL_LIMIT = 15;
const DEBRIS_CONTACT_FORCE_THRESHOLD_N = 1000;

// Local copy (engineSynth has one too); the debris rng must never be unseeded random.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finite3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

interface DebrisEntry {
  body: RAPIER.RigidBody;
  age: number;
}

export class DebrisField {
  private readonly world: RAPIER.World;
  private readonly rng: () => number;
  private readonly wheelRadius: number;
  private readonly entries: DebrisEntry[] = [];
  private readonly bodies: RAPIER.RigidBody[] = [];
  private readonly kinds: DebrisKind[] = [];
  private readonly hidden = new Map<number, boolean[]>();

  constructor(world: RAPIER.World, seed: number, wheelRadiusM: number = DEFAULT_WHEEL_RADIUS_M) {
    this.world = world;
    this.rng = mulberry32(seed);
    this.wheelRadius =
      Number.isFinite(wheelRadiusM) && wheelRadiusM > 0 ? wheelRadiusM : DEFAULT_WHEEL_RADIUS_M;
  }

  get count(): number {
    return this.entries.length;
  }

  spawn(
    kind: DebrisKind,
    car: number,
    wheel: number,
    position: Vec3,
    velocity: Vec3,
  ): void {
    if (!finite3(position) || !finite3(velocity)) return;
    const body = this.world.createRigidBody(this.bodyDesc(position, velocity));
    this.world.createCollider(this.colliderDesc(kind), body);
    if (this.entries.length >= MAX_DEBRIS) this.removeAt(0);
    this.entries.push({ body, age: 0 });
    this.bodies.push(body);
    this.kinds.push(kind);
    if (kind === 'wheel' && wheel >= 0 && wheel < 4) {
      let flags = this.hidden.get(car);
      if (flags === undefined) {
        flags = [false, false, false, false];
        this.hidden.set(car, flags);
      }
      flags[wheel] = true;
    }
  }

  step(dt: number, carPositions: readonly Vec3[]): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const maxDistSq = DEBRIS_MAX_DISTANCE_M * DEBRIS_MAX_DISTANCE_M;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      entry.age += dt;
      if (entry.age > DEBRIS_LIFETIME_S) {
        this.removeAt(i);
        continue;
      }
      const t = entry.body.translation();
      let far = true;
      for (let c = 0; c < carPositions.length; c++) {
        const car = carPositions[c];
        if (!Number.isFinite(car.x) || !Number.isFinite(car.z)) continue;
        const dx = t.x - car.x;
        const dz = t.z - car.z;
        if (dx * dx + dz * dz <= maxDistSq) {
          far = false;
          break;
        }
      }
      if (carPositions.length > 0 && far) this.removeAt(i);
    }
  }

  wheelHidden(car: number, wheel: number): boolean {
    const flags = this.hidden.get(car);
    return flags !== undefined && flags[wheel] === true;
  }

  getBodies(): readonly RAPIER.RigidBody[] {
    return this.bodies;
  }

  /** Kind of each body, index-aligned with `getBodies()`. */
  getKinds(): readonly DebrisKind[] {
    return this.kinds;
  }

  dispose(): void {
    for (let i = this.entries.length - 1; i >= 0; i--) this.removeAt(i);
    this.hidden.clear();
  }

  private removeAt(index: number): void {
    const [entry] = this.entries.splice(index, 1);
    this.bodies.splice(index, 1);
    this.kinds.splice(index, 1);
    this.world.removeRigidBody(entry.body);
  }

  private bodyDesc(position: Vec3, velocity: Vec3): RAPIER.RigidBodyDesc {
    const ax = this.rng() * 30 - ANGVEL_LIMIT;
    const ay = this.rng() * 30 - ANGVEL_LIMIT;
    const az = this.rng() * 30 - ANGVEL_LIMIT;
    const len = Math.hypot(ax, ay, az);
    const scale = len > ANGVEL_LIMIT ? ANGVEL_LIMIT / len : 1;
    return RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setAngvel({ x: ax * scale, y: ay * scale, z: az * scale });
  }

  private colliderDesc(kind: DebrisKind): RAPIER.ColliderDesc {
    let desc: RAPIER.ColliderDesc;
    if (kind === 'wheel') {
      desc = RAPIER.ColliderDesc.cylinder(WHEEL_WIDTH_M / 2, this.wheelRadius).setMass(WHEEL_MASS_KG);
    } else if (kind === 'frontWing') {
      desc = RAPIER.ColliderDesc.cuboid(FRONT_WING_HALF.x, FRONT_WING_HALF.y, FRONT_WING_HALF.z).setMass(
        FRONT_WING_MASS_KG,
      );
    } else {
      desc = RAPIER.ColliderDesc.cuboid(REAR_WING_HALF.x, REAR_WING_HALF.y, REAR_WING_HALF.z).setMass(
        REAR_WING_MASS_KG,
      );
    }
    return desc
      .setFriction(0.7)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(DEBRIS_CONTACT_FORCE_THRESHOLD_N);
  }
}
