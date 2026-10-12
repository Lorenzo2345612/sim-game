import { FIXED_DT } from '../core/constants';
import { copyVehicleState, createVehicleState } from '../core/interpolation';
import type { DriverInput, LapEvent, SpawnPose, TrackData, VehicleState } from '../core/types';
import { cumulativeLengths } from '../track/centerline';
import { LapTimer } from '../track/lapTimer';
import { TrackProgress } from '../track/trackProgress';
import { createPhysicsWorld, initPhysics } from '../physics/physicsWorld';
import { Vehicle } from '../physics/vehicle';
import { PLACEHOLDER_CAR } from '../physics/vehicleConfig';

type World = ReturnType<typeof createPhysicsWorld>;

export interface LapInfo {
  lap: number;
  currentLapTime: number | null;
  lastLapTime: number | null;
  bestLapTime: number | null;
}

export function spawnFromTrack(track: TrackData): SpawnPose {
  const n = track.centerline.length;
  if (n < 5) throw new Error('Track too short');
  const p = track.centerline[n - 5];
  const next = track.centerline[n - 4];
  const dx = next[0] - p[0];
  const dz = next[1] - p[1];
  return {
    position: { x: p[0], y: 0.6, z: p[1] },
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

  static async create(track: TrackData): Promise<Game> {
    await initPhysics();
    const world = createPhysicsWorld();
    const spawn = spawnFromTrack(track);
    const vehicle = new Vehicle(world, PLACEHOLDER_CAR, spawn);
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
    const sample = this.progress.update(this.current.position.x, this.current.position.z);
    this.events.push(...this.lapTimer.update(sample.distance, this.time));
  }

  getPrevState(): VehicleState {
    return this.prev;
  }

  getCurrentState(): VehicleState {
    return this.current;
  }

  getLapInfo(): LapInfo {
    return {
      lap: this.lapTimer.lap,
      currentLapTime: this.lapTimer.currentLapTime(this.time),
      lastLapTime: this.lapTimer.lastLapTime,
      bestLapTime: this.lapTimer.bestLapTime,
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
