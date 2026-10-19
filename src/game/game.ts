import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT } from '../core/constants';
import { copyVehicleState, createVehicleState } from '../core/interpolation';
import type { DriverInput, LapEvent, SpawnPose, Surface, TrackData, TrackDataV2, VehicleState } from '../core/types';
import { cumulativeLengths } from '../track/centerline';
import { conditionsFor, type TrackConditions } from '../track/trackConditions';
import { deriveAeroZones, inAeroZone, type AeroZone } from '../track/aeroZones';
import { LapTimer } from '../track/lapTimer';
import { TrackProgress } from '../track/trackProgress';
import { createPhysicsWorld, initPhysics } from '../physics/physicsWorld';
import type { GearboxMode } from '../physics/gearbox';
import { REVERSE_HOLD_S, STOP_SPEED_MS } from '../physics/gearbox';
import { surfaceOf } from '../physics/trackColliders';
import { Vehicle, type Telemetry } from '../physics/vehicle';
import { parseCarSpec, type CarSpec, type TyreName } from '../physics/carSpec';
import { computeRacingLine, mengerCurvature, type RacingLine } from '../ai/racingLine';
import { carLimitsFromSpec, speedProfile } from '../ai/speedProfile';
import { applyAssists, assistPreset, lookaheadTarget, type AssistLevel, type AssistPreset } from './assists';
import f4Json from '../../public/cars/f4.json';

type World = ReturnType<typeof createPhysicsWorld>;

/** Compound and wear/fuel multipliers resolved from the query and the stored options (task 070). */
export interface GameTune {
  compound: TyreName;
  wear: number;
  fuel: number;
}

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

/** Tune and track conditions applied to every car, Game and RaceGame alike (task 093). */
export function configureVehicle(
  vehicle: Vehicle,
  trackId: string,
  tune?: GameTune,
): TrackConditions {
  if (tune) {
    vehicle.setCompound(tune.compound);
    vehicle.setMultipliers(tune.wear, tune.fuel);
  }
  const conditions = conditionsFor(trackId);
  vehicle.setTrackConditions(conditions);
  return conditions;
}

/** Auto-mode reverse rule of Game.step (task 178), shared with RaceGame. */
export class AutoReverse {
  private holdT = 0;

  update(vehicle: Vehicle, input: DriverInput, forwardSpeed: number): void {
    if (vehicle.gearMode() !== 'auto' || input.reset) {
      this.holdT = 0;
      return;
    }
    const stopped = Math.abs(forwardSpeed) < STOP_SPEED_MS;
    const hold =
      stopped && input.brake >= 0.5 && input.throttle < 0.05 && vehicle.gear() >= 1;
    if (!hold) this.holdT = 0;
    else {
      this.holdT += FIXED_DT;
      if (this.holdT >= REVERSE_HOLD_S) {
        vehicle.setReverse(true);
        this.holdT = 0;
      }
    }
    if (vehicle.gear() === -1 && stopped && input.throttle >= 0.5) {
      vehicle.setReverse(false);
    }
  }
}

/** Racing line, speed profile and decel capacity backing the runtime assists (task 125). */
interface AssistRuntime {
  preset: AssistPreset;
  line: RacingLine;
  speeds: Float64Array;
  decel: number;
}

const LINE_MARGIN_M = 1;
const KAPPA_STENCIL = 3;
// Assist targets sit well below the at-limit profile so the braking assist can
// hold the car with grip to spare (a real beginner is not on the limit).
const ASSIST_GRIP_MARGIN = 0.4;

function buildAssists(track: TrackData | TrackDataV2, spec: CarSpec, level: AssistLevel): AssistRuntime {
  const preset = assistPreset(level);
  const line = computeRacingLine(track.centerline, track.widthMeters / 2, LINE_MARGIN_M);
  const fuelKg = spec.fuel.startL * spec.fuel.densityKgL;
  const limits = carLimitsFromSpec(spec, fuelKg);
  const speeds = speedProfile(line, {
    ...limits,
    muLat: limits.muLat * ASSIST_GRIP_MARGIN,
    muLong: limits.muLong * ASSIST_GRIP_MARGIN,
  });
  return { preset, line, speeds, decel: 0.8 * limits.muLong * 9.81 };
}

export function spawnFromTrack(track: TrackData | TrackDataV2): SpawnPose {
  const n = track.centerline.length;
  if (n < 5) throw new Error('Track too short');
  const p = track.centerline[n - 5];
  const next = track.centerline[n - 4];
  const dx = next[0] - p[0];
  const dz = next[1] - p[1];
  const ground = 'elevation' in track ? track.elevation[n - 5] ?? 0 : 0;
  const roll = 'elevation' in track ? track.bank?.[n - 5] ?? 0 : 0;
  return {
    position: { x: p[0], y: ground + 0.6, z: p[1] },
    yaw: Math.atan2(-dx, -dz),
    roll,
  };
}

export class Game {
  private readonly world: World;
  private readonly vehicle: Vehicle;
  private readonly spawn: SpawnPose;
  private readonly track: TrackData | TrackDataV2;
  private readonly progress: TrackProgress;
  private readonly lapTimer: LapTimer;
  private readonly prev: VehicleState;
  private readonly current: VehicleState;
  private events: LapEvent[] = [];
  private time = 0;
  private disposed = false;
  private fuelLapStartKg = 0;
  private fuelSumKg = 0;
  private fuelLaps = 0;
  private conditions: TrackConditions = conditionsFor('');
  private readonly zones: AeroZone[];
  private lastDistance = 0;
  private readonly autoReverse = new AutoReverse();
  private readonly assists: AssistPreset | null;
  private readonly assistLine: RacingLine | null;
  private readonly assistSpeeds: Float64Array | null;
  private readonly assistDecel: number;
  private lastIndex = 0;
  private lastHeading = 0;
  private yawRate = 0;

  private constructor(
    world: World,
    vehicle: Vehicle,
    spawn: SpawnPose,
    track: TrackData | TrackDataV2,
    progress: TrackProgress,
    lapTimer: LapTimer,
    prev: VehicleState,
    current: VehicleState,
    assists: AssistRuntime | null,
  ) {
    this.world = world;
    this.vehicle = vehicle;
    this.spawn = spawn;
    this.track = track;
    this.progress = progress;
    this.lapTimer = lapTimer;
    this.prev = prev;
    this.current = current;
    this.fuelLapStartKg = vehicle.getTelemetry().fuelKg;
    this.zones = deriveAeroZones(track.centerline);
    this.assists = assists?.preset ?? null;
    this.assistLine = assists?.line ?? null;
    this.assistSpeeds = assists?.speeds ?? null;
    this.assistDecel = assists?.decel ?? 0;
  }

  aeroZones(): readonly AeroZone[] {
    return this.zones;
  }

  static async create(
    track: TrackData | TrackDataV2,
    spec: CarSpec = parseCarSpec(f4Json),
    tune?: GameTune,
    assists?: AssistLevel,
  ): Promise<Game> {
    await initPhysics();
    const runtime = assists === undefined ? null : buildAssists(track, spec, assists);
    const applied =
      runtime === null
        ? spec
        : {
            ...spec,
            aids: {
              abs: { ...spec.aids.abs, enabled: runtime.preset.abs },
              tc: { ...spec.aids.tc, enabled: runtime.preset.tc },
            },
          };
    const world = 'version' in track ? createPhysicsWorld(track) : createPhysicsWorld();
    const spawn = spawnFromTrack(track);
    const vehicle = new Vehicle(world, applied, spawn);
    if (runtime !== null) vehicle.setGearMode(runtime.preset.autoGear ? 'auto' : 'manual');
    const conditions = configureVehicle(vehicle, track.id, tune);
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
    const game = new Game(world, vehicle, spawn, track, progress, lapTimer, prev, current, runtime);
    game.conditions = conditions;
    if (runtime !== null) game.lastHeading = game.heading();
    return game;
  }

  trackConditions(): TrackConditions {
    return this.conditions;
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
      this.lastDistance = 0;
      this.lastIndex = 0;
      if (this.assists !== null) {
        this.vehicle.getState(this.current);
        this.lastHeading = this.heading();
        this.yawRate = 0;
      }
    }
    // Auto-mode reverse UX (task 178): the rule lives here, not in VehicleModel.
    this.autoReverse.update(this.vehicle, input, this.current.forwardSpeed);
    this.vehicle.setInput(this.assists === null ? input : this.applyAssistInput(input));
    this.vehicle.setAeroZone(inAeroZone(this.zones, this.lastDistance, this.progress.length));
    this.vehicle.prePhysicsStep(FIXED_DT);
    this.world.step();
    this.time += FIXED_DT;
    this.vehicle.getState(this.current);
    const surfaces = this.vehicle.getWheelSurfaces();
    if (!surfaces.some((s) => s === 'asphalt' || s === 'kerb')) {
      this.events.push(...this.lapTimer.invalidate());
    }
    const sample = this.progress.update(this.current.position.x, this.current.position.z);
    this.lastDistance = sample.distance;
    this.lastIndex = sample.index;
    if (this.assists !== null) this.updateYawRate();
    const lapEvents = this.lapTimer.update(sample.distance, this.time);
    for (const ev of lapEvents) {
      if (ev.type === 'lapStarted') {
        this.fuelLapStartKg = this.vehicle.getTelemetry().fuelKg;
        this.vehicle.ersNewLap();
      }
      else if (ev.type === 'lapCompleted') this.closeLapFuel();
    }
    this.events.push(...lapEvents);
  }

  /** Braking and steering assist over a copy of the driver input (task 125). */
  private applyAssistInput(input: DriverInput): DriverInput {
    const line = this.assistLine;
    const speeds = this.assistSpeeds;
    const preset = this.assists;
    if (preset === null || line === null || speeds === null) return input;
    const speed = this.current.forwardSpeed;
    const n = line.points.length / 2;
    const i = ((this.lastIndex % n) + n) % n;
    // Racing-line arc position of the car: `lastDistance` is a centerline arc
    // and must not be mixed with `line.dist` (they diverge through corners).
    const carDist = line.dist[i];
    const look = lookaheadTarget(speeds, line.dist, line.length, carDist);
    const length = line.length;
    const distanceToTarget = ((look.distance - carDist) % length + length) % length;
    const ia = (((i - KAPPA_STENCIL) % n) + n) % n;
    const ic = (i + KAPPA_STENCIL) % n;
    const kappa = mengerCurvature(
      line.points[2 * ia], line.points[2 * ia + 1],
      line.points[2 * i], line.points[2 * i + 1],
      line.points[2 * ic], line.points[2 * ic + 1],
    );
    return applyAssists(preset, input, {
      speed,
      targetSpeed: look.targetSpeed,
      distanceToTarget,
      decel: this.assistDecel,
      yawRateError: -speed * kappa - this.yawRate,
    });
  }

  private updateYawRate(): void {
    const h = this.heading();
    let dh = h - this.lastHeading;
    if (dh > Math.PI) dh -= 2 * Math.PI;
    else if (dh < -Math.PI) dh += 2 * Math.PI;
    this.yawRate = dh / FIXED_DT;
    this.lastHeading = h;
  }

  private closeLapFuel(): void {
    const kg = this.vehicle.getTelemetry().fuelKg;
    this.fuelSumKg += this.fuelLapStartKg - kg;
    this.fuelLapStartKg = kg;
    this.fuelLaps++;
  }

  /** Mean fuel burnt per completed lap in kg; null before the first lap. */
  meanLapFuel(): number | null {
    const laps = this.fuelLaps;
    return laps > 0 ? this.fuelSumKg / laps : null;
  }

  /** Car yaw in radians: 0 facing -Z, positive turning left (CCW seen from +Y). */
  heading(): number {
    const q = this.current.rotation;
    return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
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

  getTelemetry(out?: Telemetry): Telemetry {
    return this.vehicle.getTelemetry(out);
  }

  // Arrow fields so the debug hooks survive being detached from the instance.
  gear = (): number => this.vehicle.gear();

  rpm = (): number => this.vehicle.rpm();

  shiftUp(): void {
    this.vehicle.shiftUp();
  }

  shiftDown(): void {
    this.vehicle.shiftDown();
  }

  setGearMode(mode: GearboxMode): void {
    this.vehicle.setGearMode(mode);
  }

  /** Places the car on centerline point `i`, facing the next point, at rest. */
  teleportToIndex(i: number): void {
    const centerline = this.track.centerline;
    const n = centerline.length;
    const idx = ((Math.floor(i) % n) + n) % n;
    const p = centerline[idx];
    const next = centerline[(idx + 1) % n];
    const ground = 'elevation' in this.track ? this.track.elevation[idx] ?? 0 : 0;
    const roll = 'elevation' in this.track ? this.track.bank?.[idx] ?? 0 : 0;
    this.vehicle.reset({
      position: { x: p[0], y: ground + 0.6, z: p[1] },
      yaw: Math.atan2(-(next[0] - p[0]), -(next[1] - p[1])),
      roll,
    });
    this.progress.reset();
    this.lapTimer.reset();
    this.lastDistance = 0;
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
