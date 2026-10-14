import RAPIER from '@dimforge/rapier3d-compat';
import { VehicleConfig } from './vehicleConfig';
import { Gearbox, GearboxMode } from './gearbox';
import { DriverInput, SpawnPose, Surface, VehicleState } from '../core/types';
import { AIR_DENSITY, GRAVITY, SURFACE_DRAG, SURFACE_GRIP } from '../core/constants';
import { surfaceOf } from './trackColliders';

const STEER_FULL_SPEED = 60; // m/s where maxSteer reaches maxSteerHighSpeed

const tmpForward: RAPIER.Vector = { x: 0, y: 0, z: 0 };
const tmpImpulse: RAPIER.Vector = { x: 0, y: 0, z: 0 };
const tmpSurfaces: Surface[] = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];

function forwardOf(q: RAPIER.Rotation): RAPIER.Vector {
  tmpForward.x = -2 * (q.x * q.z + q.w * q.y);
  tmpForward.y = -2 * (q.y * q.z - q.w * q.x);
  tmpForward.z = -(1 - 2 * (q.x * q.x + q.y * q.y));
  return tmpForward;
}

function clampControl(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(max, Math.max(min, v));
}

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  private readonly config: VehicleConfig;
  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private readonly input: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
  private readonly gearbox = new Gearbox();

  constructor(world: RAPIER.World, config: VehicleConfig, spawn: SpawnPose) {
    this.config = config;
    const q: RAPIER.Rotation = {
      x: 0,
      y: Math.sin(spawn.yaw / 2),
      z: 0,
      w: Math.cos(spawn.yaw / 2),
    };
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.position.x, spawn.position.y, spawn.position.z)
        .setRotation(q)
        .setCanSleep(false),
    );
    const he = config.chassisHalfExtents;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z).setMass(config.massKg),
      this.body,
    );
    this.controller = world.createVehicleController(this.body);
    for (let i = 0; i < config.wheelPositions.length; i++) {
      const pos = config.wheelPositions[i];
      this.controller.addWheel(
        pos,
        { x: 0, y: -1, z: 0 },
        { x: 1, y: 0, z: 0 },
        config.suspensionRestLength,
        config.wheelRadius,
      );
      this.controller.setWheelMaxSuspensionTravel(i, config.maxSuspensionTravel);
      this.controller.setWheelSuspensionStiffness(i, config.suspensionStiffness);
      this.controller.setWheelSuspensionCompression(i, config.suspensionCompression);
      this.controller.setWheelSuspensionRelaxation(i, config.suspensionRelaxation);
      this.controller.setWheelFrictionSlip(i, config.frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, config.sideFrictionStiffness);
    }
  }

  setInput(input: DriverInput): void {
    this.input.throttle = clampControl(input.throttle, 0, 1);
    this.input.brake = clampControl(input.brake, 0, 1);
    this.input.steer = clampControl(input.steer, -1, 1);
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

  private forwardSpeed(): number {
    const v = this.body.linvel();
    const fwd = forwardOf(this.body.rotation());
    return v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
  }

  prePhysicsStep(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const config = this.config;
    const v = this.body.linvel();
    const q = this.body.rotation();
    const fwd = forwardOf(q);
    const forwardSpeed = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
    const speed = Math.hypot(v.x, v.y, v.z);

    if (speed > 0.01) {
      const k = 0.5 * AIR_DENSITY * config.dragAreaCdA * speed * dt;
      this.body.applyImpulse({ x: -v.x * k, y: -v.y * k, z: -v.z * k }, true);
    }
    this.body.applyImpulse(
      { x: 0, y: -0.5 * AIR_DENSITY * config.liftAreaClA * forwardSpeed * forwardSpeed * dt, z: 0 },
      true,
    );

    const t = Math.min(Math.abs(forwardSpeed) / STEER_FULL_SPEED, 1);
    const maxSteer = config.maxSteerLowSpeed + (config.maxSteerHighSpeed - config.maxSteerLowSpeed) * t;
    const steer = -this.input.steer * maxSteer;
    this.controller.setWheelSteering(0, steer);
    this.controller.setWheelSteering(1, steer);

    this.gearbox.update(forwardSpeed, dt, this.input);
    const forceCap = Math.min(config.maxDriveForceN, config.enginePowerW / Math.max(forwardSpeed, 1));
    const reverse = this.gearbox.gear === -1;
    const F = reverse
      ? -this.input.brake * forceCap
      : this.input.throttle * forceCap * this.gearbox.driveScale(forwardSpeed);
    this.controller.setWheelEngineForce(0, 0);
    this.controller.setWheelEngineForce(1, 0);
    this.controller.setWheelEngineForce(2, F / 2);
    this.controller.setWheelEngineForce(3, F / 2);

    const brake = this.gearbox.brakeRequest(this.input) * config.brakeMax;
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelBrake(i, brake);
    }

    this.getWheelSurfaces();
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelFrictionSlip(i, config.frictionSlip * SURFACE_GRIP[tmpSurfaces[i]]);
    }
    const hSpeed = Math.hypot(v.x, v.z);
    if (hSpeed >= 0.01) {
      const maxPerWheel = config.massKg * hSpeed / 4;
      for (let i = 0; i < 4; i++) {
        const drag = SURFACE_DRAG[tmpSurfaces[i]];
        if (drag > 0) {
          // Clamp so the 4-wheel total can at most cancel the horizontal velocity.
          const mag = Math.min(drag * config.massKg * Math.abs(GRAVITY) * dt / 4, maxPerWheel);
          tmpImpulse.x = (-v.x / hSpeed) * mag;
          tmpImpulse.y = 0;
          tmpImpulse.z = (-v.z / hSpeed) * mag;
          this.body.applyImpulse(tmpImpulse, true);
        }
      }
    }

    this.controller.updateVehicle(dt);
  }

  getWheelSurfaces(): Surface[] {
    for (let i = 0; i < 4; i++) {
      // wheelGroundObject holds an uninitialized collider for wheels that never
      // touched ground; only trust it while the wheel is in contact.
      const ground = this.controller.wheelIsInContact(i)
        ? this.controller.wheelGroundObject(i)
        : null;
      tmpSurfaces[i] = ground === null ? 'asphalt' : (surfaceOf(ground) ?? 'asphalt');
    }
    return tmpSurfaces;
  }

  getState(out?: VehicleState): VehicleState {
    const state: VehicleState =
      out ??
      {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        forwardSpeed: 0,
        wheels: this.config.wheelPositions.map(() => ({
          position: { x: 0, y: 0, z: 0 },
          steering: 0,
          rotation: 0,
          inContact: false,
        })),
      };

    const t = this.body.translation();
    state.position.x = t.x;
    state.position.y = t.y;
    state.position.z = t.z;
    const q = this.body.rotation();
    state.rotation.x = q.x;
    state.rotation.y = q.y;
    state.rotation.z = q.z;
    state.rotation.w = q.w;
    const v = this.body.linvel();
    const fwd = forwardOf(q);
    state.forwardSpeed = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;

    for (let i = 0; i < state.wheels.length; i++) {
      const c = this.controller.wheelChassisConnectionPointCs(i);
      const suspLen = this.controller.wheelSuspensionLength(i) ?? 0;
      const cx = c === null ? 0 : c.x;
      const cy = (c === null ? 0 : c.y) - suspLen;
      const cz = c === null ? 0 : c.z;
      // Rotate (cx, cy, cz) by the unit quaternion q: t = 2*(q.xyz x c); c' = c + q.w*t + q.xyz x t.
      const tx = 2 * (q.y * cz - q.z * cy);
      const ty = 2 * (q.z * cx - q.x * cz);
      const tz = 2 * (q.x * cy - q.y * cx);
      const wheel = state.wheels[i];
      wheel.position.x = cx + q.w * tx + (q.y * tz - q.z * ty) + t.x;
      wheel.position.y = cy + q.w * ty + (q.z * tx - q.x * tz) + t.y;
      wheel.position.z = cz + q.w * tz + (q.x * ty - q.y * tx) + t.z;
      wheel.rotation = this.controller.wheelRotation(i) ?? 0;
      wheel.steering = this.controller.wheelSteering(i) ?? 0;
      wheel.inContact = this.controller.wheelIsInContact(i);
    }
    return state;
  }

  reset(spawn: SpawnPose): void {
    const q: RAPIER.Rotation = {
      x: 0,
      y: Math.sin(spawn.yaw / 2),
      z: 0,
      w: Math.cos(spawn.yaw / 2),
    };
    this.body.setTranslation(spawn.position, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
      this.controller.setWheelSteering(i, 0);
    }
    this.body.wakeUp();
    this.input.throttle = 0;
    this.input.brake = 0;
    this.input.steer = 0;
  }
}
