import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_WEIGHT_FRONT, type CarSpec, type TyreCompound, type TyreName } from './carSpec';
import type { AeroTelemetry, ErsTelemetry } from './hybridTypes';
import { Gearbox, GearboxMode, REVERSE_MAX_SPEED_MS } from './gearbox';
import { DriverInput, SpawnPose, Surface, VehicleState } from '../core/types';
import { GRAVITY, SURFACE_GRIP } from '../core/constants';
import { surfaceOf } from './trackColliders';
import { rollingDrag } from './surfaceDrag';
import { antiRoll, staticCompression, suspensionForce } from './suspension';
import { relaxAlpha, V_LOW } from './tyre';
import { dirtGripFactor, updateDirt } from './tyreDirt';
import { AMBIENT_C, gripFactor, newTyreState, updateTyreState, TyreState } from './tyreState';
import { diffSplit, engineRpm, engineTorque } from './powertrain';
import { absScale, brakeTorques, tcScale } from './brakes';
import { trackWearMult, type TrackConditions } from '../track/trackConditions';
import { FuelTank } from './fuel';
import { solveWheel, WheelSolveInput, WheelSolveOutput } from './wheelSolver';
import { aeroForces, AeroForces } from './aero';
import { Ers, type ErsInput } from './ers';
import { ActiveAero } from './activeAero';
import {
  createDamageState,
  damageEffects,
  type CarZones,
  type DamageEffects,
  type DamageState,
} from './damage';
import type { DamageMode } from './contactEvents';

const RPM_PER_RPS = 60 / (2 * Math.PI);
const ENGINE_BRAKE_RAMP_RPM = 1500;
const MASS_EPSILON = 0.05; // kg; Rapier mass properties are re-applied only on a visible change
// Collision groups (task 093): chassis colliders are members of group 1 only and
// interact with everything; wheel rays filter that group out so no car drives on
// another car's body, own included. The environment keeps the default (all groups).
const CHASSIS_GROUP = 0x0002;
const CHASSIS_COLLISION_GROUPS = (CHASSIS_GROUP << 16) | 0xffff;
// Car-car colliders (wheel cylinders, body box): members of group 2 only, they touch
// chassis and each other but never the environment, and wheel rays skip them.
const CARCAR_GROUP = 0x0004;
export const CAR_CONTACT_COLLISION_GROUPS = (CARCAR_GROUP << 16) | CHASSIS_GROUP | CARCAR_GROUP;
const WHEEL_RAY_FILTER_GROUPS = 0xffff0000 | (0xffff & ~(CHASSIS_GROUP | CARCAR_GROUP));
// Body/nose box for car-car contact: bottom stays at the chassis slab bottom.
const BODY_EXTRA_HALF_HEIGHT = 0.25;
// Wheel cylinders are skipped when the body slab already covers the tyre's outer edge.
const WHEEL_COVERED_MARGIN = 1.1;
const SQRT_HALF = Math.SQRT1_2;
// m/s; below this the chassis is numerically at rest for the wheel solver, but only
// without brakes: the locked-wheel hold needs the real vx. The solver's tick clamp caps
// an opposing force at massShare·|vx|/dt, so a mm/s gravity creep on an uphill spawn
// would cap throttle exactly at the slope pull and the car could never launch.
const VX_REST = 0.05;
// Scraping corner ball for a lost wheel (task 146): bottom sits at ground level at static ride height.
const DETACH_RADIUS = 0.12;
const DETACH_FRICTION = 0.8;

const tmpSurfaces: Surface[] = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
const tmpRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const tmpImpulse: RAPIER.Vector = { x: 0, y: 0, z: 0 };
const tmpPoint: RAPIER.Vector = { x: 0, y: 0, z: 0 };
const rv: RAPIER.Vector = { x: 0, y: 0, z: 0 };
// Out-targets for Rapier body getters: the tick must not allocate per call.
const bodyPos: RAPIER.Vector = { x: 0, y: 0, z: 0 };
const bodyRot: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };
const bodyLinvel: RAPIER.Vector = { x: 0, y: 0, z: 0 };
const bodyAngvel: RAPIER.Vector = { x: 0, y: 0, z: 0 };
const splitOut: [number, number] = [0, 0];

function rotVec(q: RAPIER.Rotation, x: number, y: number, z: number): void {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  rv.x = x + q.w * tx + (q.y * tz - q.z * ty);
  rv.y = y + q.w * ty + (q.z * tx - q.x * tz);
  rv.z = z + q.w * tz + (q.x * ty - q.y * tx);
}

function clampControl(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(max, Math.max(min, v));
}

function emptyWheel(): WheelTelemetry {
  return { fz: 0, kappa: 0, alpha: 0, tempC: 0, wear: 0, dirt: 0, surface: 'asphalt' };
}

export interface WheelTelemetry {
  fz: number;
  kappa: number;
  alpha: number;
  tempC: number;
  wear: number;
  dirt?: number; // optional: pre-065 casts in tests declare the shape without it
  surface: Surface;
}

export interface Telemetry {
  wheels: WheelTelemetry[];
  fuelKg: number;
  rpm: number;
  gear: number;
  ers?: ErsTelemetry;
  aero?: AeroTelemetry;
}

interface WheelModel {
  mount: [number, number, number]; // ray origin in the body frame
  x0: number; // static compression (m)
  wx: number;
  wy: number;
  wz: number; // hub position in the body frame at static ride height
  x: number;
  omega: number;
  rotation: number;
  alpha: number;
  kappa: number;
  fz: number;
  fzBase: number;
  grip: number;
  hit: boolean;
  cx: number;
  cy: number;
  cz: number; // contact point, world
  nx: number;
  ny: number;
  nz: number; // contact normal
  fxAxis: [number, number, number]; // wheel forward, projected on the ground plane
  latAxis: [number, number, number]; // wheel right, on the ground plane
  vl: number;
  vt: number; // hub velocity in the wheel frame
  surface: Surface;
  dirt: number;
  tyre: TyreState;
  steer: number;
}

function newWheel(mount: [number, number, number], x0: number, pos: [number, number, number]): WheelModel {
  return {
    mount,
    x0,
    wx: pos[0],
    wy: pos[1],
    wz: pos[2],
    x: x0,
    omega: 0,
    rotation: 0,
    alpha: 0,
    kappa: 0,
    fz: 0,
    fzBase: 0,
    grip: 1,
    hit: true,
    cx: 0,
    cy: 0,
    cz: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    fxAxis: [0, 0, -1],
    latAxis: [1, 0, 0],
    vl: 0,
    vt: 0,
    surface: 'asphalt',
    dirt: 0,
    tyre: newTyreState(),
    steer: 0,
  };
}

/** Body rotation of a spawn pose: yaw about Y, then roll about the local Z axis (positive = right side up). */
function spawnRotation(spawn: SpawnPose): RAPIER.Rotation {
  const sy = Math.sin(spawn.yaw / 2);
  const cy = Math.cos(spawn.yaw / 2);
  const r = spawn.roll ?? 0;
  const sz = Math.sin(r / 2);
  const cz = Math.cos(r / 2);
  return { x: sy * sz, y: sy * cz, z: cy * sz, w: cy * cz };
}

// In-house tyre/suspension/powertrain model on a Rapier rigid body (task 065).
// Per tick: rays + suspension, gravity-predicted slip, powertrain/aids, solveWheel, aero, impulses.
export class VehicleModel {
  readonly body: RAPIER.RigidBody;
  readonly chassisCollider: RAPIER.Collider;
  /** Car-car colliders (body box, wheel cylinders); map to the same car in contact events. */
  readonly carColliders: RAPIER.Collider[] = [];
  readonly zones: CarZones;
  readonly damage: DamageState = createDamageState();
  damageMode: DamageMode = 'full';
  private readonly world: RAPIER.World;
  private readonly spec: CarSpec;
  private readonly input: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
  private readonly ers?: Ers;
  private readonly activeAero?: ActiveAero;
  private readonly ersIn: ErsInput = { speedMs: 0, throttle: 0, brake: 0, overtake: false };
  private readonly ersTel: ErsTelemetry = { socFrac: 0, powerW: 0, mode: 'balance', overtake: false, clipping: false, lapDeployJ: 0, lapHarvestJ: 0, deployCapJ: 0 };
  private readonly aeroTel: AeroTelemetry = { blend: 0, inZone: false };
  private ersCyclePrev = false;
  private aeroZone = false;
  private readonly gearbox: Gearbox;
  private readonly tank: FuelTank;
  private readonly wheels: WheelModel[];
  private readonly comZ: number;
  private readonly brakeT: number[] = [0, 0, 0, 0];
  private readonly drivenKappas: number[] = [0, 0];
  private readonly aeroOut: AeroForces = { front: 0, rear: 0, drag: 0 };
  private readonly dmgFx: DamageEffects = {
    aeroFront: 1,
    aeroRear: 1,
    toe: [0, 0, 0, 0],
    gripScale: [1, 1, 1, 1],
  };
  private readonly detachCols: (RAPIER.Collider | null)[] = [null, null, null, null];
  private readonly solveIn: WheelSolveInput = {
    omega: 0,
    r: 0,
    inertia: 0,
    driveTorque: 0,
    brakeTorque: 0,
    vx: 0,
    fz: 0,
    compound: {} as TyreCompound,
    factor: 0,
    alpha: 0,
    massShare: 0,
    dt: 0,
  };
  private readonly solveOut: WheelSolveOutput = { omega1: 0, fx: 0, fy: 0, locked: false };
  private compound: TyreName = 'medium';
  private compoundSpec: TyreCompound;
  private pressureKpa: number;
  private wearMult = 1;
  private trackWearMult = 1;
  private ambientC = AMBIENT_C;
  private fuelMult = 1;
  private massSet = -1;
  private steer = 0;

  constructor(world: RAPIER.World, spec: CarSpec, spawn: SpawnPose) {
    this.world = world;
    this.spec = spec;
    const q = spawnRotation(spawn);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.position.x, spawn.position.y, spawn.position.z)
        .setRotation(q)
        .setCanSleep(false),
    );
    const he = spec.chassis.halfExtents;
    this.chassisCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
        .setDensity(0)
        .setCollisionGroups(CHASSIS_COLLISION_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(1000),
      this.body,
    );
    const wp = spec.wheels.positions;
    const bodyHalfH = he.y + BODY_EXTRA_HALF_HEIGHT;
    this.carColliders.push(
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(he.x, bodyHalfH, he.z)
          .setTranslation(0, bodyHalfH - he.y, 0)
          .setDensity(0)
          .setCollisionGroups(CAR_CONTACT_COLLISION_GROUPS)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(1000),
        this.body,
      ),
    );
    for (let i = 0; i < 4; i++) {
      const w = i < 2 ? spec.wheels.width : spec.wheels.widthRear;
      if (Math.abs(wp[i][0]) + w / 2 <= he.x * WHEEL_COVERED_MARGIN) continue;
      this.carColliders.push(
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(w / 2, spec.wheels.radius)
            .setTranslation(wp[i][0], wp[i][1], wp[i][2])
            .setRotation({ x: 0, y: 0, z: SQRT_HALF, w: SQRT_HALF })
            .setDensity(0)
            .setCollisionGroups(CAR_CONTACT_COLLISION_GROUPS)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
            .setContactForceEventThreshold(1000),
          this.body,
        ),
      );
    }
    this.zones = {
      halfLength: he.z,
      halfWidth: he.x,
      hubs: [
        { x: wp[0][0], y: wp[0][1], z: wp[0][2] },
        { x: wp[1][0], y: wp[1][1], z: wp[1][2] },
        { x: wp[2][0], y: wp[2][1], z: wp[2][2] },
        { x: wp[3][0], y: wp[3][1], z: wp[3][2] },
      ],
    };
    this.gearbox = new Gearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    this.tank = new FuelTank(spec.fuel);
    this.compoundSpec = spec.tyres.compounds[this.compound];
    this.pressureKpa = spec.tyres.pressureKpa;
    if (spec.hybrid) this.ers = new Ers(spec.hybrid);
    if (spec.activeAero) this.activeAero = new ActiveAero(spec.activeAero);

    // Static corner loads from the dry mass set the ride height the spec asks for.
    const pos = spec.wheels.positions;
    // Local CoM z: weightFront 0.5 keeps the historical CoM at the body origin so every
    // existing car stays bit-identical; other values place the CoM so the front axle
    // carries weightFront of the static load (mean front/rear wheel z, front more negative).
    const zFront = (pos[0][2] + pos[1][2]) / 2;
    const zRear = (pos[2][2] + pos[3][2]) / 2;
    this.comZ =
      spec.chassis.weightFront === DEFAULT_WEIGHT_FRONT
        ? 0
        : zFront + (1 - spec.chassis.weightFront) * (zRear - zFront);
    const axleSpan = pos[2][2] - pos[0][2];
    const frontShare = (pos[2][2] - this.comZ) / axleSpan; // weight on the front axle = b/L
    this.wheels = [];
    for (let i = 0; i < 4; i++) {
      const axle = i < 2 ? spec.suspension.front : spec.suspension.rear;
      const share = (i < 2 ? frontShare : 1 - frontShare) / 2;
      const x0 = staticCompression(spec.chassis.massKg * Math.abs(GRAVITY) * share, axle.springRate);
      const mount: [number, number, number] = [
        pos[i][0],
        pos[i][1] + axle.restLength - x0,
        pos[i][2],
      ];
      this.wheels.push(newWheel(mount, x0, pos[i]));
    }
    this.applyMass();
  }

  setInput(input: DriverInput): void {
    this.input.throttle = clampControl(input.throttle, 0, 1);
    this.input.brake = clampControl(input.brake, 0, 1);
    this.input.steer = clampControl(input.steer, -1, 1);
    this.input.overtake = input.overtake ?? false;
    this.input.ersCycle = input.ersCycle ?? false;
  }

  setAeroZone(inZone: boolean): void {
    this.aeroZone = inZone;
  }

  ersNewLap(): void {
    this.ers?.newLap();
  }

  gear(): number {
    return this.gearbox.gear;
  }

  rpm(): number {
    return this.gearbox.rpm(this.forwardSpeed());
  }

  shiftUp(): void {
    this.gearbox.shiftUp();
  }

  shiftDown(): void {
    this.gearbox.shiftDown();
  }

  setGearMode(mode: GearboxMode): void {
    this.gearbox.setMode(mode);
  }

  setReverse(on: boolean): void {
    this.gearbox.setReverse(on);
  }

  gearMode(): GearboxMode {
    return this.gearbox.mode;
  }

  setCompound(name: TyreName): void {
    this.compound = name;
    this.compoundSpec = this.spec.tyres.compounds[name];
    for (const w of this.wheels) w.tyre = newTyreState();
  }

  setTrackConditions(c: TrackConditions): void {
    this.trackWearMult = trackWearMult(c);
    this.ambientC = c.trackTempC;
  }

  setMultipliers(wear: number, fuel: number): void {
    this.wearMult = Number.isFinite(wear) && wear > 0 ? wear : 1;
    this.fuelMult = Number.isFinite(fuel) && fuel > 0 ? fuel : 1;
  }

  private forwardSpeed(): number {
    const v = this.body.linvel(bodyLinvel);
    const q = this.body.rotation(bodyRot);
    rotVec(q, 0, 0, -1);
    return v.x * rv.x + v.y * rv.y + v.z * rv.z;
  }

  // Fuel mass rides on the chassis; re-call only when it changed visibly.
  private applyMass(): void {
    const m = this.spec.chassis.massKg + this.tank.massKg;
    if (Math.abs(m - this.massSet) < MASS_EPSILON) return;
    this.massSet = m;
    const k = m / this.spec.chassis.massKg;
    const I = this.spec.chassis.inertia;
    this.body.setAdditionalMassProperties(
      m,
      { x: 0, y: 0, z: this.comZ },
      { x: I.x * k, y: I.y * k, z: I.z * k },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
    // Rapier defers mass properties to the next step; force them now so body.mass() reads true.
    this.body.recomputeMassPropertiesFromColliders();
  }

  prePhysicsStep(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const spec = this.spec;
    // Damage effects (task 146): one reused object, identity unless mode is 'full'.
    const dmgFull = this.damageMode === 'full';
    const fx = this.dmgFx;
    if (dmgFull) {
      damageEffects(this.damage, fx);
      if (!Number.isFinite(fx.aeroFront)) fx.aeroFront = 1;
      if (!Number.isFinite(fx.aeroRear)) fx.aeroRear = 1;
      for (let i = 0; i < 4; i++) {
        if (!Number.isFinite(fx.toe[i])) fx.toe[i] = 0;
        if (!Number.isFinite(fx.gripScale[i])) fx.gripScale[i] = 1;
      }
    } else {
      fx.aeroFront = 1;
      fx.aeroRear = 1;
      fx.toe[0] = 0;
      fx.toe[1] = 0;
      fx.toe[2] = 0;
      fx.toe[3] = 0;
      fx.gripScale[0] = 1;
      fx.gripScale[1] = 1;
      fx.gripScale[2] = 1;
      fx.gripScale[3] = 1;
    }
    for (let i = 0; i < 4; i++) {
      if (!dmgFull || !this.damage.detached[i] || this.detachCols[i] !== null) continue;
      const hub = this.zones.hubs[i];
      this.detachCols[i] = this.world.createCollider(
        RAPIER.ColliderDesc.ball(DETACH_RADIUS)
          .setTranslation(hub.x, hub.y - spec.wheels.radius + DETACH_RADIUS, hub.z)
          .setFriction(DETACH_FRICTION)
          .setDensity(0)
          .setCollisionGroups(CHASSIS_COLLISION_GROUPS),
        this.body,
      );
    }
    const body = this.body;
    const R = spec.wheels.radius;
    const wheels = this.wheels;
    const p = body.translation(bodyPos);
    const q = body.rotation(bodyRot);
    const lv = body.linvel(bodyLinvel);
    const av = body.angvel(bodyAngvel);
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    // Chassis velocity as it will be after this tick's gravity: tyre slip uses it,
    // otherwise a steady creep of g·sin(slope)·dt remains on slopes.
    const vpx = lv.x;
    const vpy = lv.y + GRAVITY * dt;
    const vpz = lv.z;

    rotVec(q, 0, 1, 0);
    const upx = rv.x;
    const upy = rv.y;
    const upz = rv.z;
    rotVec(q, 0, 0, -1);
    const fwdx = rv.x;
    const fwdy = rv.y;
    const fwdz = rv.z;
    const forwardSpeed = lv.x * fwdx + lv.y * fwdy + lv.z * fwdz;
    // Point velocities use r from the CoM: linvel is the CoM velocity, not the origin's.
    rotVec(q, 0, 0, this.comZ);
    const comx = p.x + rv.x;
    const comy = p.y + rv.y;
    const comz = p.z + rv.z;

    // Steering: positive = left, speed-blended limit, slew-limited.
    const st = spec.steering;
    const maxAngle =
      st.maxAngleLow + (st.maxAngleHigh - st.maxAngleLow) * Math.min(1, speed / st.fullSpeed);
    const steerTarget = -this.input.steer * maxAngle;
    const slew = st.rate * dt;
    this.steer += Math.min(slew, Math.max(-slew, steerTarget - this.steer));
    wheels[0].steer = this.steer + fx.toe[0];
    wheels[1].steer = this.steer + fx.toe[1];
    wheels[2].steer = fx.toe[2];
    wheels[3].steer = fx.toe[3];

    // Rays and suspension.
    tmpRay.dir.x = -upx;
    tmpRay.dir.y = -upy;
    tmpRay.dir.z = -upz;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const axle = i < 2 ? spec.suspension.front : spec.suspension.rear;
      rotVec(q, w.mount[0], w.mount[1], w.mount[2]);
      const ox = p.x + rv.x;
      const oy = p.y + rv.y;
      const oz = p.z + rv.z;
      tmpRay.origin.x = ox;
      tmpRay.origin.y = oy;
      tmpRay.origin.z = oz;
      const hit = this.world.castRayAndGetNormal(
        tmpRay,
        axle.restLength + R,
        true,
        undefined,
        WHEEL_RAY_FILTER_GROUPS,
      );
      if (!hit) {
        w.hit = false;
        w.x = 0;
        w.fz = 0;
        w.fzBase = 0;
        w.surface = 'asphalt';
        w.nx = upx;
        w.ny = upy;
        w.nz = upz;
        continue;
      }
      w.hit = true;
      w.surface = surfaceOf(hit.collider) ?? 'asphalt';
      const d = hit.timeOfImpact;
      w.cx = ox - upx * d;
      w.cy = oy - upy * d;
      w.cz = oz - upz * d;
      w.nx = hit.normal.x;
      w.ny = hit.normal.y;
      w.nz = hit.normal.z;
      const rmx = ox - comx;
      const rmy = oy - comy;
      const rmz = oz - comz;
      const vmx = lv.x + av.y * rmz - av.z * rmy;
      const vmy = lv.y + av.z * rmx - av.x * rmz;
      const vmz = lv.z + av.x * rmy - av.y * rmx;
      const xdot = -(vmx * upx + vmy * upy + vmz * upz);
      const xRaw = axle.restLength + R - d;
      w.x = Math.min(Math.max(xRaw, 0), axle.travel);
      w.fzBase = suspensionForce(axle, xRaw, xdot);
    }

    // Lost wheel: the ray result is ignored, no suspension or tyre force; the corner ball drags instead.
    for (let i = 0; i < 4; i++) {
      if (!dmgFull || !this.damage.detached[i]) continue;
      const w = wheels[i];
      w.hit = false;
      w.x = 0;
      w.fz = 0;
      w.fzBase = 0;
    }

    // Dirt pickup/clean per wheel, from the surface just sampled.
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      w.dirt = updateDirt(w.dirt, w.surface, forwardSpeed, dt);
    }

    // Anti-roll bars, then vertical load.
    for (let a = 0; a < 2; a++) {
      const l = wheels[a * 2];
      const r = wheels[a * 2 + 1];
      const axle = a === 0 ? spec.suspension.front : spec.suspension.rear;
      // No bar across an axle that lost a wheel.
      const arb =
        dmgFull && (this.damage.detached[a * 2] || this.damage.detached[a * 2 + 1])
          ? 0
          : antiRoll(axle.arb, l.x, r.x);
      if (l.hit) l.fz = Math.max(0, l.fzBase + arb);
      if (r.hit) r.fz = Math.max(0, r.fzBase - arb);
    }
    let meanX = 0;
    for (let i = 0; i < 4; i++) meanX += (wheels[i].x - wheels[i].x0) * 0.25;

    // Slip kinematics at the hub, with the gravity-predicted velocity.
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (!w.hit) continue;
      const dl = w.steer;
      rotVec(q, -Math.sin(dl), 0, -Math.cos(dl));
      let fwx = rv.x;
      let fwy = rv.y;
      let fwz = rv.z;
      const ndf = w.nx * fwx + w.ny * fwy + w.nz * fwz;
      fwx -= w.nx * ndf;
      fwy -= w.ny * ndf;
      fwz -= w.nz * ndf;
      const fn = Math.hypot(fwx, fwy, fwz) || 1;
      fwx /= fn;
      fwy /= fn;
      fwz /= fn;
      const rtx = w.ny * fwz - w.nz * fwy;
      const rty = w.nz * fwx - w.nx * fwz;
      const rtz = w.nx * fwy - w.ny * fwx;
      w.fxAxis[0] = fwx;
      w.fxAxis[1] = fwy;
      w.fxAxis[2] = fwz;
      w.latAxis[0] = rtx;
      w.latAxis[1] = rty;
      w.latAxis[2] = rtz;
      const hx = w.cx + upx * R - comx;
      const hy = w.cy + upy * R - comy;
      const hz = w.cz + upz * R - comz;
      const vcx = vpx + av.y * hz - av.z * hy;
      const vcy = vpy + av.z * hx - av.x * hz;
      const vcz = vpz + av.x * hy - av.y * hx;
      const vl = vcx * fwx + vcy * fwy + vcz * fwz;
      const vt = vcx * rtx + vcy * rty + vcz * rtz;
      w.vl = vl;
      w.vt = vt;
      w.alpha = relaxAlpha(w.alpha, Math.atan2(vt, Math.max(Math.abs(vl), V_LOW)), vl, dt);
      w.grip =
        gripFactor(this.compoundSpec, w.tyre, this.pressureKpa, spec.tyres.optPressureKpa) *
        SURFACE_GRIP[w.surface] *
        dirtGripFactor(w.dirt, w.surface) *
        fx.gripScale[i];
    }

    // Powertrain, brakes and aids. Update without pedals: the 045 standstill
    // brake-hold would flip to reverse under AT3's held brake and drop the brakes.
    const gb = this.gearbox;
    gb.update(forwardSpeed, dt);
    const gear = gb.gear;
    const ratioTot =
      gear === -1
        ? -spec.gearbox.reverse * spec.gearbox.final
        : spec.gearbox.ratios[Math.min(Math.max(gear, 1), spec.gearbox.ratios.length) - 1] *
          spec.gearbox.final;
    const omegaMean = (wheels[2].omega + wheels[3].omega) * 0.5;
    this.drivenKappas[0] = wheels[2].kappa;
    this.drivenKappas[1] = wheels[3].kappa;
    const thr = this.input.throttle * tcScale(spec.aids.tc, this.drivenKappas);
    const rpmVal = engineRpm(spec, gear, omegaMean, thr);
    const rpmRaw = Math.abs(omegaMean * ratioTot) * RPM_PER_RPS;
    // Past the reverse cap the drive is cut; engine braking (te < 0) still applies.
    const thrDrive =
      gear === -1
        ? forwardSpeed <= -REVERSE_MAX_SPEED_MS
          ? 0
          : this.input.brake
        : thr;
    let te = this.tank.empty() ? 0 : engineTorque(spec.engine, rpmVal, thrDrive);
    if (te < 0) {
      te *= Math.min(1, Math.max(0, (rpmRaw - spec.engine.idleRpm) / ENGINE_BRAKE_RAMP_RPM));
    }
    const driveActive = gb.driveScale(forwardSpeed) > 0; // 0 while shifting or on the limiter
    te *= driveActive ? 1 : 0;
    if (te > 0) this.tank.burn((te * rpmVal) / RPM_PER_RPS, dt, this.fuelMult);
    const ers = this.ers;
    let tK = 0;
    if (ers) {
      const ci = this.input.ersCycle === true;
      if (ci && !this.ersCyclePrev) ers.cycleMode();
      this.ersCyclePrev = ci;
      const ei = this.ersIn;
      ei.speedMs = gear >= 1 && driveActive && !this.tank.empty() ? forwardSpeed : 0;
      ei.throttle = thr;
      ei.brake = this.input.brake;
      ei.overtake = this.input.overtake ?? false;
      const powerW = ers.step(ei, dt);
      tK = powerW / (Math.max(rpmVal, spec.engine.idleRpm) / RPM_PER_RPS);
      te += tK;
    }
    const tIn = te * ratioTot * spec.gearbox.efficiency;
    const split = diffSplit(spec.diff, tIn, wheels[2].omega, wheels[3].omega, tIn >= 0, splitOut);
    // Reflected engine inertia, except while the clutch slips or the box shifts.
    const iRed =
      !driveActive || rpmVal > rpmRaw + 1
        ? 0
        : (ratioTot * ratioTot * spec.engine.inertia) / 2;
    brakeTorques(spec.brakes, gb.brakeRequest(this.input), spec.brakes.bias, this.brakeT);
    if (ers && ers.powerW < 0 && this.input.brake >= 0.05) {
      const cut = Math.abs(tK * ratioTot * spec.gearbox.efficiency) / 2;
      this.brakeT[2] = Math.max(0, this.brakeT[2] - cut);
      this.brakeT[3] = Math.max(0, this.brakeT[3] - cut);
    }
    const mass = this.massSet;
    const share = mass / 4;
    const wheelInertia = spec.wheels.inertia;

    // Implicit long./lat. solve per wheel, then apply the contact impulse.
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      this.solveIn.omega = w.omega;
      this.solveIn.r = R;
      this.solveIn.inertia = wheelInertia + (i >= 2 ? iRed : 0);
      this.solveIn.driveTorque = i === 2 ? split[0] : i === 3 ? split[1] : 0;
      this.solveIn.brakeTorque = this.brakeT[i] * absScale(spec.aids.abs, w.kappa, speed);
      this.solveIn.vx =
        this.brakeT[i] > 0 || Math.abs(w.vl) >= VX_REST ? w.vl : 0;
      this.solveIn.fz = w.fz;
      this.solveIn.compound = this.compoundSpec;
      // rearMuScale multiplies mu of the driven wheels only (all compounds).
      this.solveIn.factor = i < 2 ? w.grip : w.grip * spec.tyres.rearMuScale;
      this.solveIn.alpha = w.alpha;
      this.solveIn.massShare = share;
      this.solveIn.dt = dt;
      solveWheel(this.solveIn, this.solveOut);
      w.omega = this.solveOut.omega1;
      w.rotation += w.omega * dt;
      if (w.hit) {
        let fx = this.solveOut.fx;
        // Off-track rolling resistance, clamped to never reverse the wheel's motion in one tick.
        const rr = rollingDrag(w.surface, w.vl, w.fz);
        if (rr > 0) fx -= Math.sign(w.vl) * Math.min(rr, (share * Math.abs(w.vl)) / dt);
        // The pure-module fy is Fy_pacejka(alpha); the force along the right axis is its negative.
        let fy = -this.solveOut.fy;
        if (fy * w.vt < 0) {
          const cap = (share * Math.abs(w.vt)) / dt;
          const mag = Math.min(Math.abs(fy), cap);
          fy = fy > 0 ? mag : -mag;
        }
        w.kappa = (w.omega * R - w.vl) / Math.max(Math.abs(w.vl), V_LOW);
        tmpImpulse.x = (w.nx * w.fz + w.fxAxis[0] * fx + w.latAxis[0] * fy) * dt;
        tmpImpulse.y = (w.ny * w.fz + w.fxAxis[1] * fx + w.latAxis[1] * fy) * dt;
        tmpImpulse.z = (w.nz * w.fz + w.fxAxis[2] * fx + w.latAxis[2] * fy) * dt;
        tmpPoint.x = w.cx;
        tmpPoint.y = w.cy;
        tmpPoint.z = w.cz;
        body.applyImpulseAtPoint(tmpImpulse, tmpPoint, true);
        const slipPower =
          Math.abs(fx * (w.omega * R - w.vl)) + Math.abs(fy * w.vt);
        updateTyreState(
          w.tyre,
          this.compoundSpec,
          slipPower,
          speed,
          dt,
          this.wearMult * this.trackWearMult,
          this.pressureKpa,
          spec.tyres.optPressureKpa,
          this.ambientC,
        );
      } else {
        w.kappa = 0;
        updateTyreState(
          w.tyre,
          this.compoundSpec,
          0,
          speed,
          dt,
          this.wearMult * this.trackWearMult,
          this.pressureKpa,
          spec.tyres.optPressureKpa,
          this.ambientC,
        );
      }
    }

    // Aero: downforce at the axle centres, drag at the CoM. rideDrop = static − current height.
    const blend = this.activeAero
      ? this.activeAero.update(this.aeroZone, this.input.throttle, this.input.brake, dt)
      : undefined;
    aeroForces(spec, speed, meanX, undefined, this.aeroOut, blend);
    this.aeroOut.front *= fx.aeroFront;
    this.aeroOut.rear *= fx.aeroRear;
    rotVec(q, 0, 0, spec.wheels.positions[0][2]);
    tmpPoint.x = p.x + rv.x;
    tmpPoint.y = p.y + rv.y;
    tmpPoint.z = p.z + rv.z;
    tmpImpulse.x = -upx * this.aeroOut.front * dt;
    tmpImpulse.y = -upy * this.aeroOut.front * dt;
    tmpImpulse.z = -upz * this.aeroOut.front * dt;
    body.applyImpulseAtPoint(tmpImpulse, tmpPoint, true);
    rotVec(q, 0, 0, spec.wheels.positions[2][2]);
    tmpPoint.x = p.x + rv.x;
    tmpPoint.y = p.y + rv.y;
    tmpPoint.z = p.z + rv.z;
    tmpImpulse.x = -upx * this.aeroOut.rear * dt;
    tmpImpulse.y = -upy * this.aeroOut.rear * dt;
    tmpImpulse.z = -upz * this.aeroOut.rear * dt;
    body.applyImpulseAtPoint(tmpImpulse, tmpPoint, true);
    if (speed > 0.01) {
      const k = (this.aeroOut.drag / speed) * dt;
      tmpImpulse.x = -lv.x * k;
      tmpImpulse.y = -lv.y * k;
      tmpImpulse.z = -lv.z * k;
      body.applyImpulse(tmpImpulse, true);
    }

    this.applyMass();
  }

  getWheelSurfaces(): Surface[] {
    const p = this.body.translation(bodyPos);
    const q = this.body.rotation(bodyRot);
    rotVec(q, 0, 1, 0);
    tmpRay.dir.x = -rv.x;
    tmpRay.dir.y = -rv.y;
    tmpRay.dir.z = -rv.z;
    const R = this.spec.wheels.radius;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const axle = i < 2 ? this.spec.suspension.front : this.spec.suspension.rear;
      rotVec(q, w.mount[0], w.mount[1], w.mount[2]);
      tmpRay.origin.x = p.x + rv.x;
      tmpRay.origin.y = p.y + rv.y;
      tmpRay.origin.z = p.z + rv.z;
      const hit = this.world.castRayAndGetNormal(
        tmpRay,
        axle.restLength + R,
        true,
        undefined,
        WHEEL_RAY_FILTER_GROUPS,
      );
      tmpSurfaces[i] = hit ? (surfaceOf(hit.collider) ?? 'asphalt') : 'asphalt';
    }
    return tmpSurfaces;
  }

  getTelemetry(out?: Telemetry): Telemetry {
    const t: Telemetry = out ?? {
      wheels: [emptyWheel(), emptyWheel(), emptyWheel(), emptyWheel()],
      fuelKg: 0,
      rpm: 0,
      gear: 0,
    };
    if (t.wheels.length !== 4) {
      t.wheels = [emptyWheel(), emptyWheel(), emptyWheel(), emptyWheel()];
    }
    this.getWheelSurfaces();
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const tel = t.wheels[i];
      tel.fz = w.fz;
      tel.kappa = w.kappa;
      tel.alpha = w.alpha;
      tel.tempC = w.tyre.tempC;
      tel.wear = w.tyre.wear;
      tel.dirt = w.dirt;
      tel.surface = tmpSurfaces[i];
    }
    t.fuelKg = this.tank.massKg;
    t.rpm = this.rpm();
    t.gear = this.gearbox.gear;
    const ers = this.ers;
    if (ers) {
      const e = (t.ers ??= this.ersTel);
      e.socFrac = ers.socFrac;
      e.powerW = ers.powerW;
      e.mode = ers.mode;
      e.overtake = ers.overtakeActive;
      e.clipping = ers.clipping;
      e.lapDeployJ = ers.lapDeployJ;
      e.lapHarvestJ = ers.lapHarvestJ;
      e.deployCapJ = ers.deployCapJ;
    } else if (out) t.ers = undefined;
    if (this.activeAero) {
      const a = (t.aero ??= this.aeroTel);
      a.blend = this.activeAero.blend;
      a.inZone = this.aeroZone;
    } else if (out) t.aero = undefined;
    return t;
  }

  getDownforce(out?: { front: number; rear: number }): { front: number; rear: number } {
    const r = out ?? { front: 0, rear: 0 };
    r.front = this.aeroOut.front;
    r.rear = this.aeroOut.rear;
    return r;
  }

  getState(out?: VehicleState): VehicleState {
    const state: VehicleState =
      out ??
      {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        forwardSpeed: 0,
        wheels: this.spec.wheels.positions.map(() => ({
          position: { x: 0, y: 0, z: 0 },
          steering: 0,
          rotation: 0,
          inContact: false,
        })),
      };

    const t = this.body.translation(state.position);
    const q = this.body.rotation(state.rotation);
    const v = this.body.linvel(bodyLinvel);
    rotVec(q, 0, 0, -1);
    state.forwardSpeed = v.x * rv.x + v.y * rv.y + v.z * rv.z;

    for (let i = 0; i < state.wheels.length; i++) {
      const w = this.wheels[i];
      rotVec(q, w.wx, w.wy + (w.x - w.x0), w.wz);
      const wheel = state.wheels[i];
      wheel.position.x = rv.x + t.x;
      wheel.position.y = rv.y + t.y;
      wheel.position.z = rv.z + t.z;
      wheel.rotation = w.rotation;
      wheel.steering = w.steer;
      wheel.inContact = w.hit;
    }
    return state;
  }

  reset(spawn: SpawnPose): void {
    for (let i = 0; i < 4; i++) {
      const col = this.detachCols[i];
      if (col !== null) {
        this.world.removeCollider(col, true);
        this.detachCols[i] = null;
      }
    }
    const fresh = createDamageState();
    for (let i = 0; i < 4; i++) {
      this.damage.suspension[i] = fresh.suspension[i];
      this.damage.puncture[i] = fresh.puncture[i];
      this.damage.detached[i] = fresh.detached[i];
    }
    this.damage.frontWing = fresh.frontWing;
    this.damage.rearWing = fresh.rearWing;
    const q = spawnRotation(spawn);
    this.body.setTranslation(spawn.position, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.omega = 0;
      w.rotation = 0;
      w.alpha = 0;
      w.kappa = 0;
      w.dirt = 0;
      w.x = w.x0;
      w.fz = 0;
      w.vl = 0;
      w.vt = 0;
      w.steer = 0;
    }
    this.steer = 0;
    this.body.wakeUp();
    this.input.throttle = 0;
    this.input.brake = 0;
    this.input.steer = 0;
    this.input.overtake = false;
    this.input.ersCycle = false;
    this.ersCyclePrev = false;
    this.ers?.reset();
    this.activeAero?.reset();
    this.aeroZone = false;
  }
}
