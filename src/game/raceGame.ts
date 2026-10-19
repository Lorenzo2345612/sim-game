import { FIXED_DT } from '../core/constants';
import { copyVehicleState, createVehicleState } from '../core/interpolation';
import type { DriverInput, SpawnPose, TrackDataV2, Vec3, VehicleState } from '../core/types';
import { AiDriver, type AiObservation } from '../ai/aiDriver';
import { computeRacingLine, mengerCurvature, type RacingLine } from '../ai/racingLine';
import { carLimitsFromSpec, speedProfile } from '../ai/speedProfile';
import {
  difficultyParams,
  trafficDecision,
  type CarTrafficState,
  type Difficulty,
  type TrafficDecision,
} from '../ai/traffic';
import { NeuralFeatures, racingTargetPoints, type NeuralCarState, type NeuralLine } from '../ai/neuralFeatures';
import { NeuralDriver } from '../ai/neuralDriver';
import { halfWidthAt, hasKerb } from '../track/surfaces';
import { neuralCarSpec } from '../ai/neuralPolicy';
import { ResidualNet, type ResidualModel } from '../ai/residualPolicy';
import { cumulativeLengths } from '../track/centerline';
import type { Setup } from '../physics/setup';
import { AutoReverse, configureVehicle, type GameTune, type LapInfo } from './game';
import { RaceClassification, type Standing } from '../race/classification';
import { gridSlots } from '../race/grid';
import { isJumpStart, StartSequence, type StartPhase } from '../race/startSequence';
import { countWheelsOff, TrackLimits, type TrackLimitEvent } from '../race/trackLimits';
import { FlagState, type FlagCar } from '../race/flags';
import { yellowCap, YELLOW_FOLLOW_MIN_MS } from '../race/yellowCap';
import { Vsc } from '../race/vsc';
import { PenaltyBook, type PenaltyReason } from '../race/penalties';
import { initPhysics, createPhysicsWorld, RAPIER } from '../physics/physicsWorld';
import type { CarSpec } from '../physics/carSpec';
import { VehicleModel, type Telemetry } from '../physics/vehicleModel';
import { damageSpeedScale, type DamageState } from '../physics/damage';
import { processContactEvents, type DamageCar, type DamageMode } from '../physics/contactEvents';
import { DebrisField, type DebrisKind } from '../physics/debris';
import { V_LOW } from '../physics/tyre';
import { TrackProgress } from '../track/trackProgress';

/** Per-car start pose (task 261): arc length s, lateral d (+ right), speed v. */
export interface RaceScenario {
  starts: { s: number; d: number; v: number }[]; // by car index; player = 0
  speedScales?: number[]; // by car index, AI only
  frozen?: number[]; // car indices held with brake 1
}

export interface RaceConfig {
  trackId: string;
  carId: string;
  laps: number;
  aiCount: number;
  difficulty: Difficulty;
  seed: number;
  /** gridOrder[p] = car index at grid position p (default: player last). */
  gridOrder?: number[];
  scenario?: RaceScenario;
}

// Tune fields stay optional so the neural driver can be selected without a tune.
export interface RaceGameOptions extends Partial<GameTune> {
  aiDriver?: 'classic' | 'neural';
  neuralModels?: Partial<Record<Difficulty, Float64Array>>;
  neuralSetups?: Partial<Record<Difficulty, Partial<Setup>>>;
  /** Target line the models were trained on (default: centerline). */
  neuralLine?: { kind: 'racing' } | { kind: 'mintime'; pts: [number, number][]; v: number[] };
  /** Residual models: the classic driver drives, the net sets its offset and pace. */
  neuralResidual?: Partial<Record<Difficulty, ResidualModel>>;
}

type World = ReturnType<typeof createPhysicsWorld>;

export const AI_GRIP_MARGIN: number = 0.82;

const MAX_AI = 15;
const JUMP_PENALTY_S = 5;
const STUCK_SPEED_MS = 1;
const STUCK_RESET_S = 5;
const LOOKAHEAD_M = 30; // m ahead on the racing line for the traffic decision inputs
const SPAWN_HEIGHT_M = 0.6;
const BLUE_HOLD_S = 3; // blue-flag reaction persists this long after the flag clears
const ZERO_VEL = { x: 0, y: 0, z: 0 }; // reused: holding a debug-stopped car must not allocate
const CONTACT_PAIR_S = 0.5; // min gap between two counts of the same pair
const CONTACT_NEAR_S = 8; // m, wrapped arc-length window for the pair test
const CONTACT_NEAR_D = 4; // m, lateral window for the pair test

// contactPair callback: a named module function keeps the tick loop allocation-free.
let contactHit = false;
function probeContact(manifold: RAPIER.TempContactManifold): void {
  if (manifold.numSolverContacts() > 0) contactHit = true;
}
// A neighbour this close makes the driver ease off (task 273): car alongside or
// close ahead, within a car's width sideways. Close-ahead also caps the target
// speed to the car in front so the driver never closes on it.
const NEAR_ALONGSIDE_M = 6;
const NEAR_AHEAD_M = 20;
const NEAR_LATERAL_M = 3;

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

function validateGridOrder(order: number[], count: number): void {
  if (order.length !== count) {
    throw new Error(`gridOrder length ${order.length} must equal car count ${count}`);
  }
  const seen = new Array<boolean>(count).fill(false);
  for (const v of order) {
    if (!Number.isInteger(v) || v < 0 || v >= count) {
      throw new Error(`gridOrder entry ${v} out of range 0..${count - 1}`);
    }
    if (seen[v]) throw new Error(`gridOrder duplicate entry ${v}`);
    seen[v] = true;
  }
}

// Scenario spawn pose (task 261): centerline point at arc length s (linear, wrapped
// on the lap), shifted d m along the right-hand normal, yawed with the track.
function scenarioPose(track: TrackDataV2, start: { s: number; d: number; v: number }): SpawnPose {
  const cl = track.centerline;
  const n = cl.length;
  const cum = cumulativeLengths(cl, true);
  const lap = cum[n];
  let s = lap > 0 ? start.s % lap : 0;
  if (s < 0) s += lap;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (cum[k] <= s && s < cum[k + 1]) {
      i = k;
      break;
    }
  }
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (s - cum[i]) / seg : 0;
  const a = cl[i];
  const b = cl[(i + 1) % n];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const tx = dx / len;
  const tz = dz / len;
  const e0 = track.elevation[i] ?? 0;
  const e1 = track.elevation[(i + 1) % n] ?? e0;
  return {
    position: {
      x: a[0] + t * dx - start.d * tz,
      y: e0 + t * (e1 - e0) + SPAWN_HEIGHT_M,
      z: a[1] + t * dz + start.d * tx,
    },
    yaw: Math.atan2(-tx, -tz),
  };
}

interface AiCar {
  vehicle: VehicleModel;
  driver: AiDriver;
  /** Difficulty speed scale before the damage slowdown (task 148). */
  baseSpeedScale: number;
  /** Present when the AI runs the evolved neural policy instead of the classic driver. */
  neural?: { driver: NeuralDriver; state: NeuralCarState; tel: Telemetry };
  /** Residual neural AI: classic driver with net lateral offset and pace (neural stays unset). */
  residual?: { net: ResidualNet; state: NeuralCarState; tel: Telemetry };
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
  private readonly decision: TrafficDecision = { offset: 0, speedCap: null };
  private readonly lapInfo: LapInfo = { lap: 0, currentLapTime: null, lastLapTime: null, bestLapTime: null, valid: true };
  private readonly count: number;
  private readonly linePoints: number;
  private readonly aheadIdx: number;
  private readonly halfWidth: number;
  private readonly lapLength: number;
  private readonly events: RAPIER.EventQueue;
  private readonly damageCars: DamageCar[];
  private readonly damageRng: () => number;
  private readonly rearAxleM: number;
  private readonly debris: DebrisField;
  private readonly wingSpawned: boolean[];
  private readonly carPos: Vec3[];
  private readonly spawnPos: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly spawnVel: Vec3 = { x: 0, y: 0, z: 0 };
  readonly penalties: PenaltyBook;
  readonly trackLimits: TrackLimits;
  readonly flags: FlagState;
  readonly vsc: Vsc;
  private readonly flagCars: FlagCar[];
  private readonly stopped: Uint8Array;
  private readonly stoppedSec: Float64Array;
  private readonly blueUntil: Float64Array;
  private readonly ruleOffset: Float64Array;
  private readonly ruleCap: Float64Array;
  private readonly yellow: Uint8Array;
  private readonly yellowHold: Uint8Array;
  private readonly yellowLapDist: Float64Array;
  private readonly yellowSpeed: Float64Array;
  private readonly yellowOut: Uint8Array;
  private readonly totalDist: Float64Array;
  private readonly finished: Uint8Array;
  private readonly wheelsOff: Uint8Array;
  private readonly sectorB1: number;
  private readonly sectorB2: number;
  private blue0 = false;
  private vscDelta0 = 0;
  private readonly scenarioMode: boolean;
  private readonly frozen: boolean[];
  /** Last sim time each car pair (i·count + j, i < j) was counted, −∞ = never. */
  private readonly lastContact: Float64Array;
  private contactTotal = 0;
  private time = 0;
  private stepIndex = 0;
  private disposed = false;
  // Traffic caution of the AI being wired this tick (task 273).
  private nearTraffic = false;
  private aheadSpeedCap: number | null = null;

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
    rearAxleM: number,
    wheelRadiusM: number,
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
    this.rearAxleM = rearAxleM;
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
    this.debris = new DebrisField(world, config.seed, wheelRadiusM);
    this.wingSpawned = new Array<boolean>(this.count * 2).fill(false);
    this.carPos = new Array<Vec3>(this.count);
    for (let i = 0; i < this.count; i++) this.carPos[i] = { x: 0, y: 0, z: 0 };
    this.penalties = new PenaltyBook(this.count);
    this.trackLimits = new TrackLimits(this.count);
    this.sectorB1 = this.lapLength / 3;
    this.sectorB2 = (this.lapLength * 2) / 3;
    this.flags = new FlagState([0, this.sectorB1, this.sectorB2], this.lapLength);
    this.vsc = new Vsc(speeds, line.dist, this.lapLength, this.count);
    this.flagCars = [];
    for (let i = 0; i < this.count; i++) {
      this.flagCars.push({ distance: 0, lapDistance: 0, speed: 0, offTrack: false, retired: false });
    }
    this.stopped = new Uint8Array(this.count);
    this.stoppedSec = new Float64Array(this.count);
    this.blueUntil = new Float64Array(this.count).fill(Number.NEGATIVE_INFINITY);
    this.ruleOffset = new Float64Array(this.count);
    this.ruleCap = new Float64Array(this.count).fill(Number.NaN);
    this.yellow = new Uint8Array(this.count);
    this.yellowHold = new Uint8Array(this.count);
    this.yellowLapDist = new Float64Array(this.count);
    this.yellowSpeed = new Float64Array(this.count);
    this.yellowOut = new Uint8Array(this.count);
    this.totalDist = new Float64Array(this.count);
    this.finished = new Uint8Array(this.count);
    this.wheelsOff = new Uint8Array(this.count);
    this.scenarioMode = config.scenario !== undefined;
    this.frozen = new Array<boolean>(this.count).fill(false);
    for (const i of config.scenario?.frozen ?? []) {
      if (i >= 0 && i < this.count) this.frozen[i] = true;
    }
    this.lastContact = new Float64Array(this.count * this.count).fill(-Infinity);
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
    options?: RaceGameOptions,
  ): Promise<RaceGame> {
    const aiCount = Number.isFinite(config.aiCount)
      ? Math.min(MAX_AI, Math.max(0, Math.floor(config.aiCount)))
      : 0;
    const count = aiCount + 1;
    const order = config.gridOrder;
    if (order !== undefined) validateGridOrder(order, count);
    await initPhysics();
    const world = createPhysicsWorld(track);
    // Race tick budget (153): 4 iterations; matches Rapier's default, pinned here.
    world.integrationParameters.numSolverIterations = 4;
    const tune: GameTune | undefined =
      options?.compound !== undefined && options?.wear !== undefined && options?.fuel !== undefined
        ? { compound: options.compound, wear: options.wear, fuel: options.fuel }
        : undefined;
    const grid = gridSlots(track, count);
    const neuralWeights =
      options?.aiDriver === 'neural' ? options.neuralModels?.[config.difficulty] : undefined;
    const aiSpec = neuralWeights
      ? neuralCarSpec(spec, { setup: options?.neuralSetups?.[config.difficulty] })
      : spec;
    // Per-car spawn: without gridOrder the player (index 0) takes the last slot and
    // AI k (index k+1) slot k; with gridOrder, car i takes the slot listing it.
    // A scenario start overrides the grid slot for its car index (task 261).
    const starts = config.scenario?.starts;
    const slots: SpawnPose[] = [];
    const vehicles: VehicleModel[] = [];
    for (let i = 0; i < count; i++) {
      const start = starts !== undefined && i < starts.length ? starts[i] : null;
      const p = order ? order.indexOf(i) : i === 0 ? aiCount : i - 1;
      const pose = start !== null ? scenarioPose(track, start) : grid[p];
      slots.push(pose);
      const vehicle = new VehicleModel(world, i === 0 ? spec : aiSpec, pose);
      configureVehicle(vehicle, track.id, tune);
      if (start !== null) {
        vehicle.body.setLinvel(
          { x: -Math.sin(pose.yaw) * start.v, y: 0, z: -Math.cos(pose.yaw) * start.v },
          true,
        );
      }
      vehicles.push(vehicle);
    }
    const progresses: TrackProgress[] = [new TrackProgress(track.centerline)];
    const rng = mulberry32(config.seed);
    const { speedScale } = difficultyParams(config.difficulty);
    const line = computeRacingLine(track.centerline, track.widthMeters / 2);
    const limits = carLimitsFromSpec(spec, vehicles[0].getTelemetry().fuelKg);
    const speeds = speedProfile(line, {
      ...limits,
      muLat: limits.muLat * AI_GRIP_MARGIN,
      muLong: limits.muLong * AI_GRIP_MARGIN,
    });
    // Neural AI (opt-in): one feature extractor per track, one driver per car; missing model falls back to classic.
    let neuralFeatures: NeuralFeatures | null = null;
    let residualNet: ((w: Float64Array) => ResidualNet) | null = null;
    const residualModel = neuralWeights ? options?.neuralResidual?.[config.difficulty] : undefined;
    let compoundGrip = 0;
    if (neuralWeights) {
      const n = track.centerline.length;
      const halfLeft: number[] = [], halfRight: number[] = [], kerbLeft: boolean[] = [], kerbRight: boolean[] = [];
      for (let i = 0; i < n; i++) {
        halfLeft.push(halfWidthAt(track, 'left', i));
        halfRight.push(halfWidthAt(track, 'right', i));
        kerbLeft.push(hasKerb(track, 'left', i));
        kerbRight.push(hasKerb(track, 'right', i));
      }
      const nl = options?.neuralLine;
      let lineArg: NeuralLine | undefined;
      if (nl?.kind === 'mintime') lineArg = { points: nl.pts, mintimeSpeed: nl.v };
      else if (nl?.kind === 'racing') {
        lineArg = { points: racingTargetPoints(track.centerline, halfLeft, halfRight, kerbLeft, kerbRight) };
      }
      neuralFeatures = new NeuralFeatures(track.centerline, halfLeft, halfRight, lineArg);
      if (residualModel) {
        const nf = neuralFeatures;
        const cum = cumulativeLengths(track.centerline, true);
        residualNet = (w) => new ResidualNet(w, residualModel, nf, cum, halfLeft, halfRight);
      }
      const muMedium = spec.tyres.compounds.medium.mu0;
      compoundGrip = spec.tyres.compounds[tune?.compound ?? 'medium'].mu0 / muMedium - 1;
    }
    const ais: AiCar[] = [];
    const observations: AiObservation[] = [];
    for (let k = 0; k < aiCount; k++) {
      const progress = new TrackProgress(track.centerline);
      progresses.push(progress);
      const jitter = (rng() * 2 - 1) * 0.01;
      const baseSpeedScale = (speedScale + jitter) * (config.scenario?.speedScales?.[k + 1] ?? 1);
      const vehicle = vehicles[k + 1];
      const driver = new AiDriver(line, speeds, { speedScale: baseSpeedScale });
      driver.setSteerCurve(
        spec.steering.maxAngleLow,
        spec.steering.maxAngleHigh,
        spec.steering.fullSpeed,
      );
      const car: AiCar = {
        vehicle,
        driver,
        baseSpeedScale,
        progress,
        stuckS: 0,
      };
      if (neuralFeatures && neuralWeights) {
        const others: NeuralCarState['others'][number][] = [];
        for (let j = 0; j < count; j++) {
          if (j === k + 1) continue;
          others.push({
            position: { x: 0, y: 0, z: 0 },
            linvel: { x: 0, y: 0, z: 0 },
          });
        }
        const state: NeuralCarState = {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          forwardSpeed: 0,
          linvel: { x: 0, y: 0, z: 0 },
          angvel: { x: 0, y: 0, z: 0 },
          progress: { index: 0, distance: 0, lateral: 0 },
          fuelMassKg: 0,
          tempFrontC: 0,
          tempRearC: 0,
          optTempC: aiSpec.tyres.compounds[tune?.compound ?? 'medium'].optTempC,
          tempWindowC: aiSpec.tyres.compounds[tune?.compound ?? 'medium'].tempWindowC,
          wearMean: 0,
          offWheels: 0,
          compoundGrip,
          others,
        };
        const tel = vehicle.getTelemetry();
        if (residualNet) car.residual = { net: residualNet(neuralWeights), state, tel };
        else car.neural = { driver: new NeuralDriver(neuralWeights, neuralFeatures), state, tel };
      }
      ais.push(car);
      observations.push({ x: 0, z: 0, yaw: 0, speed: 0, rearSlip: 0, yawRate: 0, steerAngle: 0 });
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
    const wp = spec.wheels.positions;
    const rearAxleM = Math.abs((wp[2][2] + wp[3][2]) / 2);
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
      rearAxleM,
      spec.wheels.radius,
    );
    game.refreshProgress();
    return game;
  }

  step(playerInput: DriverInput): void {
    if (this.disposed) throw new Error('RaceGame disposed');
    for (let i = 0; i < this.count; i++) copyVehicleState(this.current[i], this.prev[i]);
    // A scenario race is at go from the first tick: the sequence never runs (task 261).
    if (!this.scenarioMode) this.start.update(FIXED_DT);
    const phase: StartPhase = this.scenarioMode ? 'go' : this.start.phase;
    const goTime = this.scenarioMode ? 0 : this.start.goTime;
    const raceTime = goTime === null ? 0 : this.time + FIXED_DT - goTime;
    const before = phase !== 'go';

    // Player: before go the brake is forced, steering ignored, throttle passes.
    const cmd = this.playerCmd;
    const frozenPlayer = this.frozen[0];
    if (frozenPlayer) {
      cmd.throttle = 0;
      cmd.brake = 1;
      cmd.steer = 0;
    } else {
      cmd.throttle = playerInput.throttle;
      cmd.brake = before ? 1 : playerInput.brake;
      cmd.steer = before ? 0 : playerInput.steer;
    }
    cmd.overtake = playerInput.overtake;
    cmd.ersCycle = playerInput.ersCycle;
    // AutoReverse is post-go UX only: a pre-go brake hold (waiting for the lights)
    // must not engage reverse, which would turn the forced start brake into throttle.
    if (!before && !frozenPlayer) this.autoReverse.update(this.vehicles[0], playerInput, this.current[0].forwardSpeed);
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
        if (this.stopped[i] === 1) {
          this.holdStopped(ai);
          continue;
        }
        if (this.frozen[i]) {
          this.aiCmd.throttle = 0;
          this.aiCmd.brake = 1;
          this.aiCmd.steer = 0;
          ai.vehicle.setInput(this.aiCmd);
          ai.vehicle.prePhysicsStep(FIXED_DT);
          continue;
        }
        if (ai.neural) {
          this.fillNeuralState(k, ai.neural.state, ai.neural.tel);
          const d = ai.neural.driver.decide(this.stepIndex, ai.neural.state);
          this.aiCmd.steer = d.steer;
          this.aiCmd.throttle = d.throttle;
          this.aiCmd.brake = d.brake;
        } else {
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
            this.decision,
          );
          // Damaged AI lifts off: full mode only, since visual mode has no performance effects.
          const dmgScale =
            ai.vehicle.damageMode === 'full' ? damageSpeedScale(ai.vehicle.damage) : 1;
          if (ai.residual) {
            // The net replaces the traffic offset and scales pace (no difficulty jitter, as trained).
            this.fillNeuralState(k, ai.residual.state, ai.residual.tel);
            const r = ai.residual.net.decide(ai.residual.state);
            ai.driver.setLateralOffset(r.offset);
            ai.driver.setSpeedScale(r.scale * dmgScale);
          } else {
            ai.driver.setLateralOffset(decision.offset);
            ai.driver.setSpeedScale(ai.baseSpeedScale * dmgScale);
          }
          this.updateTrafficCaution(i);
          ai.driver.setTrafficNear(this.nearTraffic);
          ai.driver.setFollowCap(this.aheadSpeedCap);
          this.applyRulesReaction(i, ai.driver, decision.speedCap);
          ai.driver.update(obs, FIXED_DT, this.aiCmd);
        }
        ai.vehicle.setInput(this.aiCmd);
        ai.vehicle.prePhysicsStep(FIXED_DT);
      }
    }

    this.world.step(this.events);
    processContactEvents(this.events, this.world, this.damageCars, FIXED_DT, this.damageRng);
    this.time += FIXED_DT;
    for (let i = 0; i < this.count; i++) this.vehicles[i].getState(this.current[i]);
    this.updateDebrisSpawns();
    for (let i = 0; i < this.count; i++) {
      const p = this.current[i].position;
      this.carPos[i].x = p.x;
      this.carPos[i].y = p.y;
      this.carPos[i].z = p.z;
    }
    this.debris.step(FIXED_DT, this.carPos);
    this.refreshProgress();
    if (!before) this.updateContactCount();
    this.updateAiDynamics();
    for (let i = 0; i < this.count; i++) {
      this.classification.update(i, this.traffic[i].distance, raceTime);
    }
    if (!before) this.applyRules();

    if (before) {
      for (let i = 0; i < this.count; i++) {
        if (this.penalised[i]) continue;
        const p = this.current[i].position;
        const slot = this.slots[i].position;
        // Suspension settle is vertical; only the horizontal creep counts.
        if (isJumpStart(Math.hypot(p.x - slot.x, p.z - slot.z), phase)) {
          this.book(i, 'penalty', JUMP_PENALTY_S, 'jump start');
          this.penalised[i] = true;
        }
      }
    } else {
      for (let k = 0; k < this.ais.length; k++) {
        const ai = this.ais[k];
        if (this.stopped[k + 1] === 1) {
          ai.stuckS = 0;
          continue;
        }
        if (this.frozen[k + 1]) continue;
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
    this.stepIndex++;
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

  /** HUD lap boxes for one car; the same object is reused and overwritten per call. */
  getLapInfo(car = 0): LapInfo {
    if (!Number.isInteger(car) || car < 0 || car >= this.count) {
      throw new RangeError(`car ${car} out of range`);
    }
    const rows = this.classification.standings();
    let row: Standing | null = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].car === car) {
        row = rows[i];
        break;
      }
    }
    if (row === null) throw new RangeError(`car ${car} out of range`);
    // lapStart lives on the classification clock (time since go), so the elapsed lap uses it too.
    const t0 = this.classification.lapStartTime(car);
    const info = this.lapInfo;
    info.lap = row.lap;
    info.currentLapTime = t0 === null || row.finished ? null : this.raceClock - t0;
    info.lastLapTime = row.lastLap;
    info.bestLapTime = row.bestLap;
    info.valid = true;
    return info;
  }

  get raceFinished(): boolean {
    return this.classification.finished;
  }

  startLights(): number {
    return this.scenarioMode ? 0 : this.start.lights;
  }

  /** Car–car contacts since go; a pair counts at most once per 0.5 s (task 261). */
  get contactCount(): number {
    return this.contactTotal;
  }

  get simTime(): number {
    return this.time;
  }

  /** Classification clock: seconds since the lights went out (0 before the start). */
  private get raceClock(): number {
    const go = this.start.goTime;
    return go === null ? 0 : this.time - go;
  }

  get carCount(): number {
    return this.count;
  }

  get debrisField(): DebrisField {
    return this.debris;
  }

  getTelemetry(out?: Telemetry): Telemetry {
    return this.vehicles[0].getTelemetry(out);
  }

  get playerDamage(): DamageState {
    return this.vehicles[0].damage;
  }

  /** Blue flag on the player this tick (false until the first post-go tick). */
  get playerBlueFlag(): boolean {
    return this.blue0;
  }

  /** Player's last VSC delta in seconds (0 while VSC is off). */
  get playerVscDelta(): number {
    return this.vscDelta0;
  }

  /** Test hook: holds an AI car stopped from now on (player not allowed). */
  debugStopCar(car: number): void {
    if (!Number.isInteger(car) || car < 1 || car >= this.count) {
      throw new RangeError(`car ${car} is not an AI car`);
    }
    this.stopped[car] = 1;
    const body = this.vehicles[car].body;
    body.setLinvel(ZERO_VEL, true);
    body.setAngvel(ZERO_VEL, true);
  }

  /** Test hook: books `count` track-limit strikes (3 warnings then a penalty). */
  debugForceTrackLimits(car: number, count: number): void {
    if (!Number.isInteger(car) || car < 0 || car >= this.count) {
      throw new RangeError(`car out of range: ${car}`);
    }
    for (let i = 0; i < count; i++) this.bookStrike(car, this.trackLimits.forceStrike(car));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.debris.dispose();
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

  // Counts pairs close in track coordinates (8 m along, 4 m across) whose chassis
  // actually touch this tick; a pair is only counted again after CONTACT_PAIR_S.
  private updateContactCount(): void {
    const n = this.count;
    const lap = this.lapLength;
    const half = lap / 2;
    const now = this.time;
    for (let i = 0; i < n; i++) {
      const ti = this.traffic[i];
      for (let j = i + 1; j < n; j++) {
        const tj = this.traffic[j];
        let ds = ti.distance - tj.distance;
        if (ds > half) ds -= lap;
        else if (ds < -half) ds += lap;
        if (Math.abs(ds) >= CONTACT_NEAR_S || Math.abs(ti.lateral - tj.lateral) >= CONTACT_NEAR_D) continue;
        const cell = i * n + j;
        if (now - this.lastContact[cell] < CONTACT_PAIR_S) continue;
        contactHit = false;
        this.world.contactPair(
          this.vehicles[i].chassisCollider,
          this.vehicles[j].chassisCollider,
          probeContact,
        );
        if (contactHit) {
          this.contactTotal++;
          this.lastContact[cell] = now;
        }
      }
    }
  }

  // Neighbour alongside or close ahead of car index i, and the target-speed cap
  // of the closest car ahead so the driver never drives into it (task 273).
  private updateTrafficCaution(i: number): void {
    const self = this.traffic[i];
    const others = this.othersByCar[i];
    this.nearTraffic = false;
    this.aheadSpeedCap = null;
    let bestGap = Infinity;
    for (let j = 0; j < others.length; j++) {
      const other = others[j];
      const gap = this.wrapGap(other.distance - self.distance);
      if (Math.abs(other.lateral - self.lateral) > NEAR_LATERAL_M) continue;
      if (gap > 0 && gap < NEAR_AHEAD_M) {
        this.nearTraffic = true;
        if (gap < bestGap) {
          bestGap = gap;
          this.aheadSpeedCap = other.speed;
        }
      } else if (Math.abs(gap) < NEAR_ALONGSIDE_M) {
        this.nearTraffic = true;
      }
    }
  }

  // Rear axle slip angle and yaw rate over the tick just stepped; the AI reads
  // them on the next tick together with the matching (x, z, yaw, speed).
  private updateAiDynamics(): void {
    const dt = FIXED_DT;
    for (let k = 0; k < this.ais.length; k++) {
      const p = this.prev[k + 1];
      const c = this.current[k + 1];
      const q = c.rotation;
      const fx = -2 * (q.w * q.y + q.x * q.z);
      const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
      const pq = p.rotation;
      const pfx = -2 * (pq.w * pq.y + pq.x * pq.z);
      const pfz = -1 + 2 * (pq.x * pq.x + pq.y * pq.y);
      let dYaw = Math.atan2(-fx, -fz) - Math.atan2(-pfx, -pfz);
      if (dYaw > Math.PI) dYaw -= 2 * Math.PI;
      else if (dYaw < -Math.PI) dYaw += 2 * Math.PI;
      const yawRate = dYaw / dt;
      const vx = (c.position.x - p.position.x) / dt;
      const vz = (c.position.z - p.position.z) / dt;
      const vLong = vx * fx + vz * fz;
      // Velocity at the rear axle: CG velocity plus the yaw rotation about it.
      const vLat = vx * -fz + vz * fx + this.rearAxleM * yawRate;
      const obs = this.observations[k];
      obs.yawRate = yawRate;
      obs.rearSlip = Math.atan2(vLat, Math.max(Math.abs(vLong), V_LOW));
      obs.steerAngle = c.wheels[0].steering;
    }
  }

  // Fills the reused neural state of AI k from the current vehicle states (no allocation).
  private fillNeuralState(k: number, s: NeuralCarState, tel: Telemetry): void {
    const i = k + 1;
    const car = this.current[i];
    s.position = car.position;
    s.rotation = car.rotation;
    s.forwardSpeed = car.forwardSpeed;
    this.ais[k].vehicle.body.linvel(s.linvel);
    this.ais[k].vehicle.body.angvel(s.angvel);
    s.progress = this.progresses[i].update(car.position.x, car.position.z);
    const t = this.ais[k].vehicle.getTelemetry(tel);
    s.fuelMassKg = t.fuelKg;
    const w = t.wheels;
    s.tempFrontC = (w[0].tempC + w[1].tempC) / 2;
    s.tempRearC = (w[2].tempC + w[3].tempC) / 2;
    s.wearMean = (w[0].wear + w[1].wear + w[2].wear + w[3].wear) / 4;
    let off = 0;
    for (let j = 0; j < 4; j++) if (w[j].surface !== 'asphalt' && w[j].surface !== 'kerb') off++;
    s.offWheels = off;
    let oc = 0;
    for (let j = 0; j < this.count; j++) {
      if (j === i) continue;
      const other = s.others[oc++];
      const cj = this.current[j];
      other.position.x = cj.position.x; other.position.y = cj.position.y; other.position.z = cj.position.z;
      this.vehicles[j].body.linvel(other.linvel);
    }
  }

  // Wing crossing > 0.95 or a wheel detaching: one debris spawn per event (task 147).
  private updateDebrisSpawns(): void {
    for (let i = 0; i < this.count; i++) {
      const dmg = this.vehicles[i].damage;
      if (!this.wingSpawned[i * 2] && dmg.frontWing > 0.95) {
        this.wingSpawned[i * 2] = true;
        this.spawnWingDebris('frontWing', i);
      }
      if (!this.wingSpawned[i * 2 + 1] && dmg.rearWing > 0.95) {
        this.wingSpawned[i * 2 + 1] = true;
        this.spawnWingDebris('rearWing', i);
      }
      for (let w = 0; w < 4; w++) {
        if (dmg.detached[w] && !this.debris.wheelHidden(i, w)) {
          const wp = this.current[i].wheels[w].position;
          this.pointVelocity(this.vehicles[i], wp, this.spawnVel);
          this.debris.spawn('wheel', i, w, wp, this.spawnVel);
        }
      }
    }
  }

  private spawnWingDebris(kind: DebrisKind, car: number): void {
    const state = this.current[car];
    const q = state.rotation;
    const fx = -2 * (q.w * q.y + q.x * q.z);
    const fy = -2 * (q.y * q.z - q.w * q.x);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const half = this.vehicles[car].zones.halfLength;
    const sign = kind === 'frontWing' ? 1 : -1;
    this.spawnPos.x = state.position.x + fx * half * sign;
    this.spawnPos.y = state.position.y + fy * half * sign;
    this.spawnPos.z = state.position.z + fz * half * sign;
    this.pointVelocity(this.vehicles[car], this.spawnPos, this.spawnVel);
    this.debris.spawn(kind, car, -1, this.spawnPos, this.spawnVel);
  }

  // Velocity of a world point rigidly attached to the chassis (CoM ≈ body origin).
  private pointVelocity(vehicle: VehicleModel, point: Vec3, out: Vec3): void {
    const t = vehicle.body.translation();
    const lv = vehicle.body.linvel();
    const av = vehicle.body.angvel();
    const rx = point.x - t.x;
    const ry = point.y - t.y;
    const rz = point.z - t.z;
    out.x = lv.x + av.y * rz - av.z * ry;
    out.y = lv.y + av.z * rx - av.x * rz;
    out.z = lv.z + av.x * ry - av.y * rx;
  }

  private book(car: number, kind: 'warning' | 'penalty', seconds: number, reason: PenaltyReason): void {
    this.penalties.add(car, kind, seconds, reason, this.time);
    if (kind === 'penalty') this.classification.addPenalty(car, seconds);
  }

  private bookStrike(car: number, ev: TrackLimitEvent): void {
    this.book(
      car,
      ev.type === 'warning' ? 'warning' : 'penalty',
      ev.type === 'warning' ? 0 : ev.seconds,
      'track limits',
    );
  }

  private holdStopped(ai: AiCar): void {
    this.aiCmd.throttle = 0;
    this.aiCmd.brake = 1;
    this.aiCmd.steer = 0;
    this.aiCmd.reset = false;
    ai.vehicle.body.setLinvel(ZERO_VEL, true);
    ai.vehicle.body.setAngvel(ZERO_VEL, true);
    ai.vehicle.setInput(this.aiCmd);
    ai.vehicle.prePhysicsStep(FIXED_DT);
  }

  // Per-tick rules after go: track limits, flags, VSC and the penalties they book.
  private applyRules(): void {
    const n = this.count;
    const t = this.time;
    const rows = this.classification.standings();
    for (let k = 0; k < rows.length; k++) {
      this.totalDist[rows[k].car] = rows[k].distance;
      this.finished[rows[k].car] = rows[k].finished ? 1 : 0;
    }
    for (let i = 0; i < n; i++) {
      this.wheelsOff[i] = countWheelsOff(this.vehicles[i].getWheelSurfaces());
      const ev = this.trackLimits.update(i, this.wheelsOff[i], t);
      if (ev !== null) this.bookStrike(i, ev);
      const fc = this.flagCars[i];
      fc.distance = this.totalDist[i];
      fc.lapDistance = this.traffic[i].distance;
      fc.speed = this.current[i].forwardSpeed;
      fc.offTrack = this.wheelsOff[i] >= 4;
      fc.retired = this.finished[i] === 1;
    }
    this.flags.update(this.flagCars, t);
    const overtakes = this.flags.overtakeUnderYellow();
    for (let k = 0; k < overtakes.length; k++) {
      const p = overtakes[k].passed;
      // Passing a stationary or retired car under yellow is legal (289).
      if (this.stopped[p] === 1 || this.finished[p] === 1) continue;
      if (!(this.traffic[p].speed >= YELLOW_FOLLOW_MIN_MS)) continue;
      this.book(overtakes[k].car, 'penalty', 5, 'yellow flag overtake');
    }
    let maxStopped = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(this.current[i].forwardSpeed) < STUCK_SPEED_MS && this.wheelsOff[i] < 4) {
        this.stoppedSec[i] += FIXED_DT;
        if (this.stoppedSec[i] > maxStopped) maxStopped = this.stoppedSec[i];
      } else {
        this.stoppedSec[i] = 0;
      }
    }
    this.vsc.update(maxStopped, t);
    for (let i = 0; i < n; i++) {
      const delta = this.vsc.delta(i, this.traffic[i].distance, t);
      if (i === 0) this.vscDelta0 = delta;
    }
    const vscEvents = this.vsc.drainEvents();
    for (let k = 0; k < vscEvents.length; k++) {
      this.book(vscEvents[k].car, 'penalty', vscEvents[k].seconds, 'VSC delta');
    }
    this.updateRuleReactions();
  }

  // Reaction data for the next tick's AI commands: VSC and yellow caps take the
  // minimum with the traffic cap; blue also steers 2 m to the roomier side.
  private updateRuleReactions(): void {
    const n = this.count;
    const t = this.time;
    const vscOn = this.vsc.phase === 'deployed' || this.vsc.phase === 'ending';
    for (let j = 0; j < n; j++) {
      this.yellowLapDist[j] = this.traffic[j].distance;
      this.yellowSpeed[j] = this.traffic[j].speed;
      this.yellowOut[j] = this.stopped[j] === 1 || this.finished[j] === 1 ? 1 : 0;
    }
    for (let i = 0; i < n; i++) {
      this.yellow[i] = 0;
      this.yellowHold[i] = 0;
      const idx = this.indices[i];
      const flag = this.flags.sectorFlag(this.sectorOf(this.traffic[i].distance) + 1);
      let cap = vscOn ? 0.6 * this.speeds[idx] : Number.NaN;
      if (flag !== 'green') {
        this.yellow[i] = 1;
        const ahead = yellowCap(i, this.yellowLapDist, this.yellowSpeed, this.yellowOut, this.lapLength);
        if (Number.isFinite(ahead)) {
          this.yellowHold[i] = 1;
          cap = Number.isNaN(cap) ? ahead : Math.min(cap, ahead);
        }
      }
      if (this.flags.blueFor(i)) this.blueUntil[i] = t + BLUE_HOLD_S;
      if (t <= this.blueUntil[i]) {
        const off = this.line.offsets[idx];
        const left = halfWidthAt(this.track, 'left', idx) + off;
        const right = halfWidthAt(this.track, 'right', idx) - off;
        this.ruleOffset[i] = right >= left ? 2 : -2;
        const blueCap = 0.95 * this.speeds[idx];
        cap = Number.isNaN(cap) ? blueCap : Math.min(cap, blueCap);
      }
      this.ruleCap[i] = cap;
    }
    this.blue0 = this.flags.blueFor(0);
  }

  private applyRulesReaction(i: number, driver: AiDriver, trafficCap: number | null): void {
    // A numeric yellow cap means moving traffic ahead: hold the line. With no cap
    // the car must be free to steer around a stationary one.
    if (this.yellow[i] === 1 && this.yellowHold[i] === 1) driver.setLateralOffset(0);
    else if (this.time <= this.blueUntil[i]) driver.setLateralOffset(this.ruleOffset[i]);
    const ruleCap = this.ruleCap[i];
    // Several caps (traffic, blue, yellow, VSC) combine as the minimum.
    if (Number.isNaN(ruleCap)) driver.setSpeedCap(trafficCap);
    else driver.setSpeedCap(trafficCap === null ? ruleCap : Math.min(trafficCap, ruleCap));
  }

  private sectorOf(lapDistance: number): number {
    return lapDistance >= this.sectorB2 ? 2 : lapDistance >= this.sectorB1 ? 1 : 0;
  }

  private wrapGap(raw: number): number {
    const g = ((raw % this.lapLength) + this.lapLength) % this.lapLength;
    return g > this.lapLength / 2 ? g - this.lapLength : g;
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
