import { FIXED_DT } from '../core/constants';
import { copyVehicleState, createVehicleState } from '../core/interpolation';
import type { DriverInput, SpawnPose, TrackDataV2, VehicleState } from '../core/types';
import { AiDriver, type AiObservation } from '../ai/aiDriver';
import { computeRacingLine, mengerCurvature, type RacingLine } from '../ai/racingLine';
import { carLimitsFromSpec, speedProfile } from '../ai/speedProfile';
import { difficultyParams, trafficDecision, type CarTrafficState, type Difficulty } from '../ai/traffic';
import { AutoReverse, configureVehicle, type GameTune } from './game';
import { RaceClassification, type Standing } from '../race/classification';
import { gridSlots } from '../race/grid';
import { isJumpStart, StartSequence } from '../race/startSequence';
import { initPhysics, createPhysicsWorld, RAPIER } from '../physics/physicsWorld';
import type { CarSpec } from '../physics/carSpec';
import { VehicleModel, type Telemetry } from '../physics/vehicleModel';
import { processContactEvents, type DamageCar, type DamageMode } from '../physics/contactEvents';
import { TrackProgress } from '../track/trackProgress';

export interface RaceConfig {
  trackId: string;
  carId: string;
  laps: number;
  aiCount: number;
  difficulty: Difficulty;
  seed: number;
}

type World = ReturnType<typeof createPhysicsWorld>;

const MAX_AI = 15;
const JUMP_PENALTY_S = 5;
const STUCK_SPEED_MS = 1;
const STUCK_RESET_S = 5;
const LOOKAHEAD_M = 30; // m ahead on the racing line for the traffic decision inputs
const SPAWN_HEIGHT_M = 0.6;

// Local copy (engineSynth has one too); the race never draws unseeded randoms.
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

interface AiCar {
  vehicle: VehicleModel;
  driver: AiDriver;
  progress: TrackProgress;
  stuckS: number;
}

// One Rapier world with a car per grid slot (task 093). The player is index 0 and
// takes the last slot; AI k is index k+1 on slot k. One racing line and speed
// profile are shared; each AI runs its own AiDriver with traffic decisions.
export class RaceGame {
  readonly config: RaceConfig;
  private readonly world: World;
  private readonly track: TrackDataV2;
  private readonly vehicles: VehicleModel[];
  private readonly progresses: TrackProgress[];
  private readonly ais: AiCar[];
  private readonly start: StartSequence;
  private readonly classification: RaceClassification;
  private readonly autoReverse = new AutoReverse();
  private readonly prev: VehicleState[];
  private readonly current: VehicleState[];
  private readonly slots: SpawnPose[];
  private readonly penalised: boolean[];
  private readonly line: RacingLine;
  private readonly speeds: Float64Array;
  private readonly traffic: CarTrafficState[];
  private readonly othersByCar: CarTrafficState[][];
  private readonly indices: Int32Array;
  private readonly observations: AiObservation[];
  private readonly playerCmd: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
  private readonly aiCmd: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
  private readonly count: number;
  private readonly linePoints: number;
  private readonly aheadIdx: number;
  private readonly halfWidth: number;
  private readonly lapLength: number;
  private readonly events: RAPIER.EventQueue;
  private readonly damageCars: DamageCar[];
  private readonly damageRng: () => number;
  private time = 0;
  private disposed = false;

  private constructor(
    track: TrackDataV2,
    config: RaceConfig,
    world: World,
    vehicles: VehicleModel[],
    progresses: TrackProgress[],
    ais: AiCar[],
    start: StartSequence,
    classification: RaceClassification,
    current: VehicleState[],
    prev: VehicleState[],
    slots: SpawnPose[],
    line: RacingLine,
    speeds: Float64Array,
    traffic: CarTrafficState[],
    othersByCar: CarTrafficState[][],
    observations: AiObservation[],
    aheadIdx: number,
  ) {
    this.track = track;
    this.config = config;
    this.world = world;
    this.vehicles = vehicles;
    this.progresses = progresses;
    this.ais = ais;
    this.start = start;
    this.classification = classification;
    this.current = current;
    this.prev = prev;
    this.slots = slots;
    this.line = line;
    this.speeds = speeds;
    this.traffic = traffic;
    this.othersByCar = othersByCar;
    this.observations = observations;
    this.aheadIdx = aheadIdx;
    this.count = vehicles.length;
    this.linePoints = line.points.length / 2;
    this.halfWidth = track.widthMeters / 2;
    this.lapLength = progresses[0].length;
    this.penalised = new Array<boolean>(this.count).fill(false);
    this.indices = new Int32Array(this.count);
    this.events = new RAPIER.EventQueue(true);
    this.damageCars = vehicles.map((v) => ({
      chassis: v.chassisCollider,
      body: v.body,
      zones: v.zones,
      damage: v.damage,
      damageMode: v.damageMode,
    }));
    this.damageRng = mulberry32(config.seed);
  }

  setDamageMode(mode: DamageMode): void {
    for (let i = 0; i < this.count; i++) {
      this.vehicles[i].damageMode = mode;
      this.damageCars[i].damageMode = mode;
    }
  }

  static async create(
    track: TrackDataV2,
    spec: CarSpec,
    config: RaceConfig,
    tune?: GameTune,
  ): Promise<RaceGame> {
    await initPhysics();
    const world = createPhysicsWorld(track);
    const aiCount = Number.isFinite(config.aiCount)
      ? Math.min(MAX_AI, Math.max(0, Math.floor(config.aiCount)))
      : 0;
    const count = aiCount + 1;
    const grid = gridSlots(track, count);
    // Per-car spawn: the player (index 0) takes the last slot, AI k (index k+1) slot k.
    const slots: SpawnPose[] = [];
    const vehicles: VehicleModel[] = [];
    for (let i = 0; i < count; i++) {
      const slot = i === 0 ? grid[aiCount] : grid[i - 1];
      slots.push(slot);
      const vehicle = new VehicleModel(world, spec, slot);
      configureVehicle(vehicle, track.id, tune);
      vehicles.push(vehicle);
    }
    const progresses: TrackProgress[] = [new TrackProgress(track.centerline)];
    const rng = mulberry32(config.seed);
    const { speedScale } = difficultyParams(config.difficulty);
    const line = computeRacingLine(track.centerline, track.widthMeters / 2);
    const speeds = speedProfile(line, carLimitsFromSpec(spec, vehicles[0].getTelemetry().fuelKg));
    const ais: AiCar[] = [];
    const observations: AiObservation[] = [];
    for (let k = 0; k < aiCount; k++) {
      const progress = new TrackProgress(track.centerline);
      progresses.push(progress);
      const jitter = (rng() * 2 - 1) * 0.01;
      ais.push({
        vehicle: vehicles[k + 1],
        driver: new AiDriver(line, speeds, { speedScale: speedScale + jitter }),
        progress,
        stuckS: 0,
      });
      observations.push({ x: 0, z: 0, yaw: 0, speed: 0 });
    }
    const traffic: CarTrafficState[] = [];
    for (let i = 0; i < count; i++) traffic.push({ distance: 0, lateral: 0, speed: 0 });
    const othersByCar: CarTrafficState[][] = [];
    for (let i = 0; i < count; i++) {
      const others: CarTrafficState[] = [];
      for (let j = 0; j < count; j++) if (j !== i) others.push(traffic[j]);
      othersByCar.push(others);
    }
    const classification = new RaceClassification(count, config.laps, progresses[0].length);
    const current: VehicleState[] = [];
    const prev: VehicleState[] = [];
    for (let i = 0; i < count; i++) {
      const s = createVehicleState(4);
      vehicles[i].getState(s);
      current.push(s);
      const p = createVehicleState(4);
      copyVehicleState(s, p);
      prev.push(p);
    }
    const spacing = track.centerline.length > 0 ? track.lengthMeters / track.centerline.length : 0;
    const aheadIdx = Math.max(1, Math.round(LOOKAHEAD_M / (spacing > 0 ? spacing : LOOKAHEAD_M)));
    const game = new RaceGame(
      track,
      { ...config, aiCount },
      world,
      vehicles,
      progresses,
      ais,
      new StartSequence(rng),
      classification,
      current,
      prev,
      slots,
      line,
      speeds,
      traffic,
      othersByCar,
      observations,
      aheadIdx,
    );
    game.refreshProgress();
    return game;
  }

  step(playerInput: DriverInput): void {
    if (this.disposed) throw new Error('RaceGame disposed');
    for (let i = 0; i < this.count; i++) copyVehicleState(this.current[i], this.prev[i]);
    this.start.update(FIXED_DT);
    const phase = this.start.phase;
    const goTime = this.start.goTime;
    const raceTime = goTime === null ? 0 : this.time + FIXED_DT - goTime;
    const before = phase !== 'go';

    // Player: before go the brake is forced, steering ignored, throttle passes.
    const cmd = this.playerCmd;
    cmd.throttle = playerInput.throttle;
    cmd.brake = before ? 1 : playerInput.brake;
    cmd.steer = before ? 0 : playerInput.steer;
    cmd.overtake = playerInput.overtake;
    cmd.ersCycle = playerInput.ersCycle;
    // AutoReverse is post-go UX only: a pre-go brake hold (waiting for the lights)
    // must not engage reverse, which would turn the forced start brake into throttle.
    if (!before) this.autoReverse.update(this.vehicles[0], playerInput, this.current[0].forwardSpeed);
    this.vehicles[0].setInput(cmd);
    this.vehicles[0].prePhysicsStep(FIXED_DT);

    if (before) {
      this.aiCmd.throttle = 0;
      this.aiCmd.brake = 1;
      this.aiCmd.steer = 0;
      for (const ai of this.ais) {
        ai.vehicle.setInput(this.aiCmd);
        ai.vehicle.prePhysicsStep(FIXED_DT);
      }
    } else {
      const pts = this.line.points;
      const offsets = this.line.offsets;
      for (let k = 0; k < this.ais.length; k++) {
        const i = k + 1;
        const ai = this.ais[k];
        const s = this.current[i];
        const q = s.rotation;
        const obs = this.observations[k];
        const fx = -2 * (q.w * q.y + q.x * q.z);
        const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
        obs.x = s.position.x;
        obs.z = s.position.z;
        obs.yaw = Math.atan2(-fx, -fz);
        obs.speed = s.forwardSpeed;
        const n = this.linePoints;
        const ahead = (this.indices[i] + this.aheadIdx) % n;
        const behind = (ahead + n - 1) % n;
        const curvatureAhead = mengerCurvature(
          pts[2 * behind], pts[2 * behind + 1],
          pts[2 * ahead], pts[2 * ahead + 1],
          pts[2 * ((ahead + 1) % n)], pts[2 * ((ahead + 1) % n) + 1],
        );
        const decision = trafficDecision(
          this.traffic[i],
          this.othersByCar[i],
          this.lapLength,
          this.halfWidth,
          offsets[ahead],
          curvatureAhead,
        );
        ai.driver.setLateralOffset(decision.offset);
        ai.driver.setSpeedCap(decision.speedCap);
        ai.driver.update(obs, FIXED_DT, this.aiCmd);
        ai.vehicle.setInput(this.aiCmd);
        ai.vehicle.prePhysicsStep(FIXED_DT);
      }
    }

    this.world.step(this.events);
    processContactEvents(this.events, this.world, this.damageCars, FIXED_DT, this.damageRng);
    this.time += FIXED_DT;
    for (let i = 0; i < this.count; i++) this.vehicles[i].getState(this.current[i]);
    this.refreshProgress();
    for (let i = 0; i < this.count; i++) {
      this.classification.update(i, this.traffic[i].distance, raceTime);
    }

    if (before) {
      for (let i = 0; i < this.count; i++) {
        if (this.penalised[i]) continue;
        const p = this.current[i].position;
        const slot = this.slots[i].position;
        // Suspension settle is vertical; only the horizontal creep counts.
        if (isJumpStart(Math.hypot(p.x - slot.x, p.z - slot.z), phase)) {
          this.classification.addPenalty(i, JUMP_PENALTY_S);
          this.penalised[i] = true;
        }
      }
    } else {
      for (let k = 0; k < this.ais.length; k++) {
        const ai = this.ais[k];
        if (Math.abs(this.current[k + 1].forwardSpeed) < STUCK_SPEED_MS) {
          ai.stuckS += FIXED_DT;
          if (ai.stuckS >= STUCK_RESET_S) {
            this.respawnOnLine(k);
            ai.stuckS = 0;
          }
        } else {
          ai.stuckS = 0;
        }
      }
    }
  }

  getStates(out: VehicleState[]): VehicleState[] {
    const n = Math.min(out.length, this.count);
    for (let i = 0; i < n; i++) copyVehicleState(this.current[i], out[i]);
    return out;
  }

  getPrevStates(): readonly VehicleState[] {
    return this.prev;
  }

  standings(): readonly Standing[] {
    return this.classification.standings();
  }

  get raceFinished(): boolean {
    return this.classification.finished;
  }

  startLights(): number {
    return this.start.lights;
  }

  get simTime(): number {
    return this.time;
  }

  get carCount(): number {
    return this.count;
  }

  getTelemetry(out?: Telemetry): Telemetry {
    return this.vehicles[0].getTelemetry(out);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.events.free();
    this.world.free();
  }

  // Track sample of every car's entering pose, reused by the traffic decisions
  // of the next tick and by the classification of this one.
  private refreshProgress(): void {
    for (let i = 0; i < this.count; i++) {
      const s = this.current[i];
      const sample = this.progresses[i].update(s.position.x, s.position.z);
      this.indices[i] = sample.index;
      const t = this.traffic[i];
      t.distance = sample.distance;
      t.lateral = sample.lateral;
      t.speed = s.forwardSpeed;
    }
  }

  private respawnOnLine(k: number): void {
    const cl = this.track.centerline;
    const n = cl.length;
    const idx = ((this.indices[k + 1] % n) + n) % n;
    const p = cl[idx];
    const next = cl[(idx + 1) % n];
    const ground = this.track.elevation[idx] ?? 0;
    this.ais[k].vehicle.reset({
      position: { x: p[0], y: ground + SPAWN_HEIGHT_M, z: p[1] },
      yaw: Math.atan2(-(next[0] - p[0]), -(next[1] - p[1])),
    });
  }
}
