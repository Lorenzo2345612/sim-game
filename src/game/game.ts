import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT } from '../core/constants';
import { copyVehicleState, createVehicleState } from '../core/interpolation';
import type { DriverInput, LapEvent, SpawnPose, Surface, TrackData, TrackDataV2, VehicleState } from '../core/types';
import { cumulativeLengths } from '../track/centerline';
import { LapTimer } from '../track/lapTimer';
import { TrackProgress } from '../track/trackProgress';
import { createPhysicsWorld, initPhysics } from '../physics/physicsWorld';
import { surfaceOf } from '../physics/trackColliders';
import { Vehicle } from '../physics/vehicle';
import { F4_CAR } from '../physics/vehicleConfig';

type World = ReturnType<typeof createPhysicsWorld>;

const GROUND_RAY_ORIGIN_OFFSET = 1; // m above the chassis centre
const GROUND_RAY_MAX_TOI = 600;     // m; covers the elevation range of every track

// Reused by every castGround call (no per-call allocation); dir is unit down.
const groundRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

export interface LapInfo {
  lap: number;
  currentLapTime: number | null;
  lastLapTime: number | null;
  bestLapTime: number | null;
  valid: boolean;
}

export function spawnFromTrack(track: TrackData | TrackDataV2): SpawnPose {
  const n = track.centerline.length;
  if (n < 5) throw new Error('Track too short');
  const p = track.centerline[n - 5];
  const next = track.centerline[n - 4];
  const dx = next[0] - p[0];
  const dz = next[1] - p[1];
  const ground = 'elevation' in track ? track.elevation[n - 5] ?? 0 : 0;
  return {
    position: { x: p[0], y: ground + 0.6, z: p[1] },
    yaw: Math.atan2(-dx, -dz),
  };
}

export class Game {
  private readonly world: World;
  private readonly vehicle: Vehicle;
  private readonly spawn: SpawnPose;
  private readonly progress: TrackProgress;
  private readonly lapTimer: LapTimer;
  private readonly prev: VehicleState;
  private readonly current: VehicleState;
  private events: LapEvent[] = [];
  private time = 0;
  private disposed = false;

  private constructor(
    world: World,
    vehicle: Vehicle,
    spawn: SpawnPose,
    progress: TrackProgress,
    lapTimer: LapTimer,
    prev: VehicleState,
    current: VehicleState,
  ) {
    this.world = world;
    this.vehicle = vehicle;
    this.spawn = spawn;
    this.progress = progress;
    this.lapTimer = lapTimer;
    this.prev = prev;
    this.current = current;
  }

  static async create(track: TrackData | TrackDataV2): Promise<Game> {
    await initPhysics();
    const world = 'version' in track ? createPhysicsWorld(track) : createPhysicsWorld();
    const spawn = spawnFromTrack(track);
    const vehicle = new Vehicle(world, F4_CAR, spawn);
    const progress = new TrackProgress(track.centerline);
    const cum = cumulativeLengths(track.centerline, true);
    const lapTimer = new LapTimer(progress.length, [
      cum[track.sectors[0]],
      cum[track.sectors[1]],
      cum[track.sectors[2]],
    ]);
    const current = createVehicleState(4);
    vehicle.getState(current);
    const prev = createVehicleState(4);
    copyVehicleState(current, prev);
    return new Game(world, vehicle, spawn, progress, lapTimer, prev, current);
  }

  get simTime(): number {
    return this.time;
  }

  step(input: DriverInput): void {
    if (this.disposed) throw new Error('Game disposed');
    copyVehicleState(this.current, this.prev);
    if (input.reset) {
      this.vehicle.reset(this.spawn);
      this.progress.reset();
      this.lapTimer.reset();
    }
    this.vehicle.setInput(input);
    this.vehicle.prePhysicsStep(FIXED_DT);
    this.world.step();
    this.time += FIXED_DT;
    this.vehicle.getState(this.current);
    const surfaces = this.vehicle.getWheelSurfaces();
    if (!surfaces.some((s) => s === 'asphalt' || s === 'kerb')) {
      this.events.push(...this.lapTimer.invalidate());
    }
    const sample = this.progress.update(this.current.position.x, this.current.position.z);
    this.events.push(...this.lapTimer.update(sample.distance, this.time));
  }

  getPrevState(): VehicleState {
    return this.prev;
  }

  getCurrentState(): VehicleState {
    return this.current;
  }

  getWheelSurfaces(): Surface[] {
    return this.vehicle.getWheelSurfaces();
  }

  /**
   * Downward raycast from above the chassis centre to the colliders with a known
   * surface (terrain heightfield and track surface strips; barriers and the car
   * itself are excluded). Null when nothing is below within GROUND_RAY_MAX_TOI.
   */
  private castGround(): RAPIER.RayColliderHit | null {
    const p = this.current.position;
    groundRay.origin.x = p.x;
    groundRay.origin.y = p.y + GROUND_RAY_ORIGIN_OFFSET;
    groundRay.origin.z = p.z;
    return this.world.castRay(
      groundRay,
      GROUND_RAY_MAX_TOI,
      true,
      undefined,
      undefined,
      undefined,
      this.vehicle.body,
      (collider) => surfaceOf(collider) !== null,
    );
  }

  /** Surface at the chassis centre x/z; 'asphalt' when nothing is below (v1 flat ground). */
  surfaceUnderCar(): Surface {
    const hit = this.castGround();
    return hit === null ? 'asphalt' : surfaceOf(hit.collider) ?? 'asphalt';
  }

  /** Track or terrain surface y at the chassis centre x/z; NaN when nothing is below. */
  trackHeightUnderCar(): number {
    const hit = this.castGround();
    return hit === null ? NaN : groundRay.origin.y - hit.timeOfImpact;
  }

  getLapInfo(): LapInfo {
    return {
      lap: this.lapTimer.lap,
      currentLapTime: this.lapTimer.currentLapTime(this.time),
      lastLapTime: this.lapTimer.lastLapTime,
      bestLapTime: this.lapTimer.bestLapTime,
      valid: this.lapTimer.valid,
    };
  }

  drainEvents(): LapEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.free();
  }
}
