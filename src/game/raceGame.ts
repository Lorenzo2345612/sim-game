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
import {
  FlagState,
  RACE_CAUSE_GAP_S,
  RACE_COUNTDOWN_S,
  RACE_MIN_YELLOW_S,
  START_GRACE_S,
  type FlagCar,
} from '../race/flags';
import { yellowCap, YELLOW_FOLLOW_MIN_MS } from '../race/yellowCap';
import { Vsc } from '../race/vsc';
import { TroubleTracker } from '../race/trouble';
import { GiveBack, GIVE_BACK_PENALTY_S } from '../race/giveBack';
import { PenaltyBook, type PenaltyReason } from '../race/penalties';
import { OvertakeLog, type OvertakeCar } from '../race/overtakeLog';
import { initPhysics, createPhysicsWorld, RAPIER } from '../physics/physicsWorld';
import type { CarSpec } from '../physics/carSpec';
import { VehicleModel, type Telemetry } from '../physics/vehicleModel';
import { damageSpeedScale, type DamageState } from '../physics/damage';
import { processContactEvents, type DamageCar, type DamageMode } from '../physics/contactEvents';
import { DebrisField, type DebrisKind } from '../physics/debris';
import { V_LOW } from '../physics/tyre';
import { BlueFlagTimer } from '../race/blueFlagTimer';
import { TrackProgress } from '../track/trackProgress';

/** Per-car start pose (task 261): arc length s, lateral d (+ right), speed v. */
export interface RaceScenario {
  starts: { s: number; d: number; v: number }[]; // by car index; player = 0
  speedScales?: number[]; // by car index, AI only
  frozen?: number[]; // car indices held with brake 1
  lapsAhead?: number[]; // by car index, whole laps added to race distance at start
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

export const AI_GRIP_MARGIN: number = 0.75;
export const NEURAL_GRIP_MARGIN = 0.82; // residual nets were trained against this profile

const RESIDUAL_THROTTLE_KP = 0.5;
const RESIDUAL_BRAKE_KB = 0.25;
const AI_THROTTLE_KP = 1.5;
const AI_BRAKE_KB = 0.07;
const RULE_BRAKE_KB = 0.25; // firm braking while a rule cap (VSC/yellow/blue) applies
const LINE_MARGIN_M = 2.2;
const EDGE_BAND_M = 1.0; // edge keeping starts this far inside the track limit
const NEURAL_EDGE_BAND_M = 2.5;
const NEURAL_FOLLOW_KB = 0.1;
const EDGE_STEER_GAIN = 0.4;
const MAX_AI = 15;
const STUCK_SPEED_MS = 1; // yellow/VSC stopped-car detection
const JUMP_PENALTY_S = 5;
const FLIP_UP_Y = 0.3;
const FLIP_RESET_S = 1.5;
const PROGRESS_WINDOW_S = 5;
const PROGRESS_MIN_M = 5;
const LOOKAHEAD_M = 30; // m ahead on the racing line for the traffic decision inputs
const SPAWN_HEIGHT_M = 0.6;
/** Offsets each AI decision step by car index % 4. Off: 269 AT3 (resets <= 6) fails with it on. */
export const AI_DECISION_STAGGER = false;
const BLUE_OFFSET_M = 2.5;
const BLUE_EDGE_M = 1.2; // m kept inside the track edge
const BLUE_BATTLE_M = 50;
const BLUE_CAP_RANGE_M = 40;
const BLUE_PENALTY_S = 5;
const BLUE_PUSH_M = 1.5; // extra offset the lapper takes to the side opposite the blued car
const BLUE_HOLD_S = 3; // blue-flag reaction persists this long after the flag clears
const ZERO_VEL = { x: 0, y: 0, z: 0 }; // reused: holding a debug-stopped car must not allocate
const CONTACT_PAIR_S = 0.5; // min gap between two counts of the same pair
const CONTACT_NEAR_S = 8; // m, wrapped arc-length window for the pair test
const CONTACT_NEAR_D = 4; // m, lateral window for the pair test
const OVERTAKE_CONTACT_M = 6; // m, Euclidean chassis proximity for the overtake contact time
const OVERTAKE_CONTACT_GAP_M = 0.01; // m, contact distance below which a pair counts as touching

// contactPair callback: a named module function keeps the tick loop allocation-free.
// One probe fills both flags so a pair is queried once per tick.
let contactHit = false;
let contactNear = false;
function probeContact(manifold: RAPIER.TempContactManifold): void {
  const n = manifold.numSolverContacts();
  if (n > 0) contactHit = true;
  for (let i = 0; i < n && !contactNear; i++) {
    if (manifold.solverContactDist(i) < OVERTAKE_CONTACT_GAP_M) contactNear = true;
  }
}
// A neighbour this close makes the driver ease off (task 273): car alongside or
// close ahead, within a car's width sideways. Close-ahead also caps the target
// speed to the car in front so the driver never closes on it.
const NEAR_ALONGSIDE_M = 6;
const NEAR_AHEAD_M = 20;
const FOLLOW_MIN_GAP_M = 3; // closer than this the car is alongside: braking would not clear it
const NEAR_LATERAL_M = 3;

// Wrapped, signed advance along the lap into (-L/2, L/2]
function wrapDelta(raw: number, lapLength: number): number {
  const g = ((raw % lapLength) + lapLength) % lapLength;
  return g > lapLength / 2 ? g - lapLength : g;
}

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
  steering: CarSpec['steering'];
  flipS: number;
  windowS: number;
  markDist: number;
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
  private readonly steering: CarSpec['steering'];
  private playerAuto = false;
  private playerDriver: AiDriver | null = null;
  private readonly playerObs: AiObservation = { x: 0, z: 0, yaw: 0, speed: 0 };
  private readonly prev: VehicleState[];
  private readonly current: VehicleState[];
  private readonly slots: SpawnPose[];
  private readonly penalised: boolean[];
  private readonly line: RacingLine;
  private readonly speeds: Float64Array;
  private readonly halfLeft: number[];
  private readonly halfRight: number[];
  private readonly traffic: CarTrafficState[];
  private readonly followSelf: CarTrafficState = { distance: 0, lateral: 0, speed: 0 };
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
  readonly overtakes: OvertakeLog;
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
  private blueLapper0 = -1;
  private readonly blueTimer = new BlueFlagTimer();
  private blueLapperOf: Int16Array = new Int16Array(0);
  private blueSide: Int8Array = new Int8Array(0);
  private lapperPush: Float64Array = new Float64Array(0);
  private vscDelta0 = 0;
  private readonly giveBack: GiveBack;
  private readonly trouble: TroubleTracker;
  private readonly giveBackOut: boolean[];
  private readonly owedMask: Uint8Array;
  private readonly playerGiveBackView = { passed: 0, remaining: 0 };
  private readonly scenarioMode: boolean;
  private readonly frozen: boolean[];
  /** Last sim time each car pair (i·count + j, i < j) was counted, −∞ = never. */
  private readonly lastContact: Float64Array;
  /** Last chassis touch of each car with any car, −∞ = never (task 290). */
  private readonly lastCarContact: Float64Array;
  /** Reused per-tick overtake classification input (no allocation in the loop). */
  private readonly overtakeCars: OvertakeCar[];
  private readonly gridPos: Int32Array;
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
    halfLeft: number[],
    halfRight: number[],
    traffic: CarTrafficState[],
    othersByCar: CarTrafficState[][],
    observations: AiObservation[],
    aheadIdx: number,
    rearAxleM: number,
    wheelRadiusM: number,
    steering: CarSpec['steering'],
  ) {
    this.steering = steering;
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
    this.halfLeft = halfLeft;
    this.halfRight = halfRight;
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
    this.penalties = new PenaltyBook(this.count, { maxPerReason: Infinity, maxTotal: Infinity });
    this.trackLimits = new TrackLimits(this.count);
    this.sectorB1 = this.lapLength / 3;
    this.sectorB2 = (this.lapLength * 2) / 3;
    this.flags = new FlagState([0, this.sectorB1, this.sectorB2], this.lapLength, {
      minYellowS: RACE_MIN_YELLOW_S,
      causeGapS: RACE_CAUSE_GAP_S,
      countdownS: RACE_COUNTDOWN_S,
    });
    this.vsc = new Vsc(speeds, line.dist, this.lapLength, this.count);
    this.flagCars = [];
    for (let i = 0; i < this.count; i++) {
      this.flagCars.push({ distance: 0, lapDistance: 0, speed: 0, offTrack: false, retired: false });
    }
    this.stopped = new Uint8Array(this.count);
    this.stoppedSec = new Float64Array(this.count);
    this.blueUntil = new Float64Array(this.count).fill(Number.NEGATIVE_INFINITY);
    this.ruleOffset = new Float64Array(this.count);
    this.blueLapperOf = new Int16Array(this.count).fill(-1);
    this.blueSide = new Int8Array(this.count);
    this.lapperPush = new Float64Array(this.count);
    this.ruleCap = new Float64Array(this.count).fill(Number.NaN);
    this.giveBack = new GiveBack(this.count);
    this.trouble = new TroubleTracker(this.count);
    this.giveBackOut = new Array<boolean>(this.count).fill(false);
    this.owedMask = new Uint8Array(this.count);
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
    this.lastCarContact = new Float64Array(this.count).fill(-Infinity);
    this.overtakes = new OvertakeLog(this.count);
    this.overtakeCars = [];
    this.gridPos = new Int32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.overtakeCars.push({ dist: 0, lapDist: 0, lap: 0, speed: 0, running: true, position: i + 1, lastContact: -Infinity });
    }
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
    const gridPos: number[] = [];
    for (let i = 0; i < count; i++) {
      const start = starts !== undefined && i < starts.length ? starts[i] : null;
      const p = order ? order.indexOf(i) : i === 0 ? aiCount : i - 1;
      gridPos.push(p + 1);
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
    const nPts = track.centerline.length;
    const halfLeft = new Array<number>(nPts);
    const halfRight = new Array<number>(nPts);
    for (let i = 0; i < nPts; i++) {
      halfLeft[i] = halfWidthAt(track, 'left', i);
      halfRight[i] = halfWidthAt(track, 'right', i);
    }
    const line = computeRacingLine(
      track.centerline,
      track.widthMeters / 2,
      LINE_MARGIN_M,
      undefined,
      halfLeft,
      halfRight,
    );
    const limits = carLimitsFromSpec(spec, vehicles[0].getTelemetry().fuelKg);
    const speeds = speedProfile(line, {
      ...limits,
      muLat: limits.muLat * AI_GRIP_MARGIN,
      muLong: limits.muLong * AI_GRIP_MARGIN,
    });
    // Neural AI (opt-in): one feature extractor per track, one driver per car; missing model falls back to classic.
    let neuralFeatures: NeuralFeatures | null = null;
    let residualNet: ((w: Float64Array, phase: number) => ResidualNet) | null = null;
    const residualModel = neuralWeights ? options?.neuralResidual?.[config.difficulty] : undefined;
    let compoundGrip = 0;
    const neuralSpeeds = residualModel
      ? speedProfile(line, {
          ...limits,
          muLat: limits.muLat * NEURAL_GRIP_MARGIN,
          muLong: limits.muLong * NEURAL_GRIP_MARGIN,
        })
      : speeds;
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
        residualNet = (w, phase) => new ResidualNet(w, residualModel, nf, cum, halfLeft, halfRight, phase);
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
      const driver = new AiDriver(line, neuralSpeeds, { speedScale: baseSpeedScale, kp: AI_THROTTLE_KP, kb: AI_BRAKE_KB });
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
        steering: spec.steering,
        flipS: 0,
        windowS: -1,
        markDist: 0,
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
        if (residualNet) {
          car.residual = { net: residualNet(neuralWeights, AI_DECISION_STAGGER ? k + 1 : 0), state, tel };
          // The nets were trained on the default pedal gains; the classic gains cost ~8 s a lap.
          driver.setPedalGains(RESIDUAL_THROTTLE_KP, RESIDUAL_BRAKE_KB);
        }
        else car.neural = { driver: new NeuralDriver(neuralWeights, neuralFeatures, AI_DECISION_STAGGER ? k + 1 : 0), state, tel };
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
    const lapsAhead = config.scenario?.lapsAhead;
    for (let i = 0; lapsAhead !== undefined && i < count; i++) {
      if (lapsAhead[i]) classification.setLapsAhead(i, lapsAhead[i]);
    }
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
      halfLeft,
      halfRight,
      traffic,
      othersByCar,
      observations,
      aheadIdx,
      rearAxleM,
      spec.wheels.radius,
      spec.steering,
    );
    game.refreshProgress();
    game.gridPos.set(gridPos);
    return game;
  }

  step(playerInput: DriverInput): void {
    if (this.disposed) throw new Error('RaceGame disposed');
    for (let i = 0; i < this.count; i++) copyVehicleState(this.current[i], this.prev[i]);
    // A scenario race is at go from the first tick: the sequence never runs (task 261).
    if (!this.scenarioMode) this.start.update(FIXED_DT);
    const phase: StartPhase = this.scenarioMode ? 'go' : this.start.phase;
    const goTime = this.scenarioMode ? 0 : this.start.goTime;
    // Grace window: grid speed below CAUSE_SPEED must not raise a yellow at the launch (298).
    if (!this.scenarioMode && goTime !== null) this.flags.startAt(goTime);
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
    const auto = (this.playerAuto || this.finished[0] === 1) && !before && !frozenPlayer;
    if (auto) this.driveAutopilot(cmd);
    // AutoReverse is post-go UX only: a pre-go brake hold (waiting for the lights)
    // must not engage reverse, which would turn the forced start brake into throttle.
    if (!before && !frozenPlayer && !auto) this.autoReverse.update(this.vehicles[0], playerInput, this.current[0].forwardSpeed);
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
          // Observation only on this car's decision step (phase staggered by car index).
          if (ai.neural.driver.due(this.stepIndex)) this.fillNeuralState(k, ai.neural.state, ai.neural.tel);
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
          // The follow cap pins the AI to the leader's speed, which would hide the
          // leader from the blocker test (closing speed); pass as if still closing.
          this.updateTrafficCaution(i);
          const selfState = this.followSelf;
          selfState.distance = this.traffic[i].distance;
          selfState.lateral = this.traffic[i].lateral;
          selfState.speed =
            this.aheadSpeedCap === null
              ? this.traffic[i].speed
              : Math.max(this.traffic[i].speed, this.aheadSpeedCap + 1);
          const decision = trafficDecision(
            selfState,
            this.othersByCar[i],
            this.lapLength,
            this.halfWidth,
            offsets[ahead],
            curvatureAhead,
            this.halfLeft[ahead],
            this.halfRight[ahead],
            this.decision,
          );
          // Damaged AI lifts off: full mode only, since visual mode has no performance effects.
          const dmgScale =
            ai.vehicle.damageMode === 'full' ? damageSpeedScale(ai.vehicle.damage) : 1;
          if (ai.residual) {
            // The net replaces the traffic offset and scales pace (no difficulty jitter, as trained).
            if (ai.residual.net.due()) this.fillNeuralState(k, ai.residual.state, ai.residual.tel);
            const r = ai.residual.net.decide(ai.residual.state);
            ai.driver.setLateralOffset(r.offset);
            ai.driver.setSpeedScale(r.scale * dmgScale);
          } else {
            ai.driver.setLateralOffset(decision.offset + this.lapperPush[i]);
            ai.driver.setSpeedScale(ai.baseSpeedScale * dmgScale);
          }
          this.updateTrafficCaution(i);
          ai.driver.setTrafficNear(this.nearTraffic);
          // A car owed a position must be free to pass its debtor, so it ignores follow/traffic caps.
          const owedPos = this.owedMask[i] === 1;
          ai.driver.setFollowCap(owedPos ? null : this.aheadSpeedCap);
          const st = ai.steering;
          ai.driver.setMaxSteerAngle(
            st.maxAngleLow + (st.maxAngleHigh - st.maxAngleLow) * Math.min(1, Math.abs(obs.speed) / st.fullSpeed),
          );
          this.applyRulesReaction(i, ai.driver, owedPos ? null : decision.speedCap);
          ai.driver.update(obs, FIXED_DT, this.aiCmd);
        }
        if (ai.neural) {
          this.keepOnTrack(i, NEURAL_EDGE_BAND_M);
          this.followForNeural(i);
        } else this.keepOnTrack(i);
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
    if (!before) {
      this.updateContacts();
    }
    this.updateAiDynamics();
    for (let i = 0; i < this.count; i++) {
      this.classification.update(i, this.traffic[i].distance, raceTime);
    }
    if (!before) {
      this.applyRules();
      this.stepOvertakes();
    }

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
        if (this.stopped[k + 1] === 1 || this.frozen[k + 1]) {
          ai.flipS = 0;
          ai.windowS = -1;
          continue;
        }
        const q = this.current[k + 1].rotation;
        const up = 1 - 2 * (q.x * q.x + q.z * q.z);
        if (up < FLIP_UP_Y) ai.flipS += FIXED_DT;
        else ai.flipS = 0;
        const rolling = Math.abs(this.current[k + 1].forwardSpeed) >= STUCK_SPEED_MS;
        if (rolling && this.isHeld(k + 1)) {
          // Held by the follow cap or a rule cap while still rolling: the lack of
          // progress is deliberate, so the window restarts instead of expiring.
          // A car that is itself stopped stays stuck and is reset as usual.
          ai.windowS = 0;
          ai.markDist = this.traffic[k + 1].distance;
        } else if (ai.windowS < 0) {
          ai.windowS = 0;
          ai.markDist = this.traffic[k + 1].distance;
        } else {
          ai.windowS += FIXED_DT;
          if (ai.windowS >= PROGRESS_WINDOW_S) {
            if (
              wrapDelta(this.traffic[k + 1].distance - ai.markDist, this.lapLength) < PROGRESS_MIN_M
            ) {
              this.respawnOnLine(k);
              ai.flipS = 0;
            }
            ai.windowS = 0;
            ai.markDist = this.traffic[k + 1].distance;
          }
        }
        if (ai.flipS >= FLIP_RESET_S) {
          this.respawnOnLine(k);
          ai.flipS = 0;
          ai.windowS = 0;
          ai.markDist = this.traffic[k + 1].distance;
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

  /** 1-based grid slot the car started from (task 290). */
  gridPosition(car: number): number {
    if (!Number.isInteger(car) || car < 0 || car >= this.count) {
      throw new RangeError(`car ${car} out of range`);
    }
    return this.gridPos[car];
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

  /** Seconds since the lights went out; -1 before the start (scenarios count from 0). */
  get raceElapsed(): number {
    if (this.scenarioMode) return this.time;
    const go = this.start.goTime;
    return go === null ? -1 : this.time - go;
  }

  /** Classification clock: seconds since the lights went out (0 before the start). */
  private get raceClock(): number {
    const go = this.start.goTime;
    return go === null ? 0 : this.time - go;
  }

  get carCount(): number {
    return this.count;
  }

  /** Minimap state for car i: map position and whether it counts as stopped (302). */
  carMapState(i: number, out: { x: number; z: number; stopped: boolean }): void {
    if (!Number.isInteger(i) || i < 0 || i >= this.count) {
      throw new RangeError(`car ${i} out of range`);
    }
    const s = this.current[i];
    out.x = s.position.x;
    out.z = s.position.z;
    const go = this.scenarioMode ? 0 : this.start.goTime;
    // Signed on purpose, like FlagState CAUSE_SPEED: a reversing car counts as stopped.
    out.stopped =
      this.stopped[i] === 1 ||
      (this.finished[i] !== 1 &&
        go !== null &&
        this.time - go >= START_GRACE_S &&
        s.forwardSpeed < 5);
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

  /** Sector (1..3) of the player's lap distance. */
  get playerSector(): number {
    return this.sectorOf(this.traffic[0].distance) + 1;
  }

  /** Blue flag on the player this tick (false until the first post-go tick). */
  get playerBlueLapper(): number {
    return this.blueLapper0;
  }

  get playerBlueFlag(): boolean {
    return this.blue0;
  }

  /** Player's last VSC delta in seconds (0 while VSC is off). */
  get playerVscDelta(): number {
    return this.vscDelta0;
  }

  debugRespawn(car: number): void {
    if (!Number.isInteger(car) || car < 1 || car > this.ais.length) throw new RangeError(`debugRespawn: bad car ${car}`);
    this.respawnOnLine(car - 1);
  }

  isInTrouble(car: number): boolean {
    return this.trouble.inTrouble(car, this.time);
  }

  debugGiveBack(car: number, passed: number): void {
    this.giveBack.open(car, passed, this.time);
  }

  /** Car 0's oldest open give-back (reused object), null when it owes nothing. */
  get playerGiveBack(): { passed: number; remaining: number } | null {
    const p = this.giveBack.owes(0);
    if (p < 0) return null;
    this.playerGiveBackView.passed = p;
    this.playerGiveBackView.remaining = this.giveBack.remaining(0, this.time);
    return this.playerGiveBackView;
  }

  setPlayerAutopilot(on: boolean): void {
    this.playerAuto = on;
  }

  isRetired(car: number): boolean {
    return this.stopped[car] === 1;
  }

  private driveAutopilot(cmd: DriverInput): void {
    let d = this.playerDriver;
    if (d === null) {
      d = new AiDriver(this.line, this.speeds, { speedScale: 0.8, kp: AI_THROTTLE_KP, kb: AI_BRAKE_KB });
      const st = this.steering;
      d.setSteerCurve(st.maxAngleLow, st.maxAngleHigh, st.fullSpeed);
      this.playerDriver = d;
    }
    const s = this.current[0];
    const q = s.rotation;
    const obs = this.playerObs;
    obs.x = s.position.x;
    obs.z = s.position.z;
    obs.yaw = Math.atan2(-(-2 * (q.w * q.y + q.x * q.z)), -(-1 + 2 * (q.x * q.x + q.y * q.y)));
    obs.speed = s.forwardSpeed;
    d.setMaxSteerAngle(
      this.steering.maxAngleLow +
        (this.steering.maxAngleHigh - this.steering.maxAngleLow) * Math.min(1, Math.abs(obs.speed) / this.steering.fullSpeed),
    );
    d.update(obs, FIXED_DT, cmd);
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

  // Per pair, one chassis contact query serves two consumers: the contact count (pair close in
  // track coordinates, 8 m along and 4 m across, counted again only after CONTACT_PAIR_S) and
  // the per-car touch time for the overtake log (task 290: within 6 m, contact distance < 1 cm).
  private updateContacts(): void {
    const n = this.count;
    const lap = this.lapLength;
    const half = lap / 2;
    const now = this.time;
    const sq = OVERTAKE_CONTACT_M * OVERTAKE_CONTACT_M;
    for (let i = 0; i < n; i++) {
      const ti = this.traffic[i];
      const pi = this.current[i].position;
      for (let j = i + 1; j < n; j++) {
        const tj = this.traffic[j];
        let ds = ti.distance - tj.distance;
        if (ds > half) ds -= lap;
        else if (ds < -half) ds += lap;
        const cell = i * n + j;
        const count =
          Math.abs(ds) < CONTACT_NEAR_S &&
          Math.abs(ti.lateral - tj.lateral) < CONTACT_NEAR_D &&
          now - this.lastContact[cell] >= CONTACT_PAIR_S;
        const pj = this.current[j].position;
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const dz = pi.z - pj.z;
        const near = dx * dx + dy * dy + dz * dz <= sq;
        if (!count && !near) continue;
        contactHit = false;
        contactNear = false;
        // Chassis plus the car-car colliders (body box, open wheels) of both cars.
        const vi = this.vehicles[i];
        const vj = this.vehicles[j];
        const ni = vi.carColliders.length;
        const nj = vj.carColliders.length;
        for (let a = -1; a < ni; a++) {
          const ca = a < 0 ? vi.chassisCollider : vi.carColliders[a];
          for (let b = -1; b < nj; b++) {
            this.world.contactPair(ca, b < 0 ? vj.chassisCollider : vj.carColliders[b], probeContact);
          }
        }
        if (count && contactHit) {
          this.contactTotal++;
          this.lastContact[cell] = now;
        }
        if (near && contactNear) {
          this.lastCarContact[i] = now;
          this.lastCarContact[j] = now;
        }
      }
    }
  }

  // Feeds the overtake log after go with each car's classification data (task 290).
  // Finished, stopped and detached-wheel cars count as not running.
  private stepOvertakes(): void {
    const rows = this.classification.standings();
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k].car;
      const c = this.overtakeCars[i];
      c.dist = rows[k].distance;
      c.lapDist = this.traffic[i].distance;
      c.lap = rows[k].lap;
      c.speed = this.current[i].forwardSpeed;
      const dmg = this.vehicles[i].damage;
      c.running =
        this.stopped[i] !== 1 &&
        this.finished[i] !== 1 &&
        !(dmg.detached[0] || dmg.detached[1] || dmg.detached[2] || dmg.detached[3]);
      c.position = rows[k].position;
      c.lastContact = this.lastCarContact[i];
    }
    this.overtakes.step(this.time, this.overtakeCars);
  }

  // Neighbour alongside or close ahead of car index i, and the target-speed cap
  // of the closest car ahead so the driver never drives into it (task 273).
  private updateTrafficCaution(i: number, minGap = FOLLOW_MIN_GAP_M): void {
    const self = this.traffic[i];
    const others = this.othersByCar[i];
    this.nearTraffic = false;
    this.aheadSpeedCap = null;
    const yellow = this.yellow?.[i] === 1;
    let bestGap = Infinity;
    for (let j = 0; j < others.length; j++) {
      const other = others[j];
      const gap = this.wrapGap(other.distance - self.distance);
      if (Math.abs(other.lateral - self.lateral) > NEAR_LATERAL_M) continue;
      if (gap > 0 && gap < NEAR_AHEAD_M) {
        this.nearTraffic = true;
        // Under yellow a stopped or finished car ahead is an incident, not a
        // queue to join: the yellow cap governs and the field must roll on (289).
        const t = this.traffic.indexOf(other);
        const incident = yellow && t >= 0 && (this.stopped[t] === 1 || this.finished[t] === 1);
        const yielding = t >= 0 && this.blueLapperOf[t] === i && this.time <= this.blueUntil[t];
        if (!incident && !yielding && gap >= minGap && gap < bestGap) {
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
    s.progress = this.progresses[i].current; // sampled by refreshProgress from this same pose
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

  // Edge-keeping: steer back towards the centre and lift when near the verge.
  private keepOnTrack(i: number, band = EDGE_BAND_M): void {
    const here = this.indices[i];
    const lat = this.traffic[i].lateral;
    const excess = Math.abs(lat) - ((lat >= 0 ? this.halfRight[here] : this.halfLeft[here]) - band);
    if (excess <= 0) return;
    const pull = Math.min(1, excess * EDGE_STEER_GAIN) * (lat >= 0 ? -1 : 1);
    const cmd = this.aiCmd;
    cmd.steer = Math.max(-1, Math.min(1, cmd.steer + pull));
    cmd.throttle *= Math.max(0, 1 - excess * EDGE_STEER_GAIN);
  }

  // Learned drivers have no traffic awareness: brake to the speed of a car right ahead.
  private followForNeural(i: number): void {
    this.updateTrafficCaution(i, 0);
    const cap = this.aheadSpeedCap;
    if (cap === null) return;
    const over = this.current[i].forwardSpeed - cap;
    if (over <= 0) return;
    const cmd = this.aiCmd;
    cmd.throttle = 0;
    cmd.brake = Math.max(cmd.brake, Math.min(1, NEURAL_FOLLOW_KB * over));
  }

  // A car is being slowed by a rule cap (VSC/yellow/blue) or by the car ahead,
  // so a lack of progress is not stuck behaviour and must not trigger a reset.
  private isHeld(i: number): boolean {
    if (Number.isFinite(this.ruleCap[i])) return true;
    const self = this.traffic[i];
    const others = this.othersByCar[i];
    for (let j = 0; j < others.length; j++) {
      const other = others[j];
      const gap = this.wrapGap(other.distance - self.distance);
      if (Math.abs(other.lateral - self.lateral) > NEAR_LATERAL_M) continue;
      if (gap > 0 && gap < NEAR_AHEAD_M) return true;
    }
    return false;
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
      this.trouble.update(i, fc.offTrack, fc.speed, t);
    }
    this.flags.update(this.flagCars, t);
    for (let j = 0; j < n; j++) this.giveBackOut[j] = this.stopped[j] === 1 || this.finished[j] === 1 || this.trouble.inTrouble(j, t);
    this.giveBack.update(this.totalDist, this.giveBackOut, t);
    const gbEvents = this.giveBack.drainEvents();
    for (let k = 0; k < gbEvents.length; k++) {
      if (gbEvents[k].kind === 'penalty') {
        this.book(gbEvents[k].car, 'penalty', GIVE_BACK_PENALTY_S, 'yellow flag overtake');
      }
    }
    const overtakes = this.flags.overtakeUnderYellow();
    for (let k = 0; k < overtakes.length; k++) {
      const p = overtakes[k].passed;
      // Passing a stationary or retired car under yellow is legal (289).
      if (this.stopped[p] === 1 || this.finished[p] === 1) continue;
      if (this.trouble.inTrouble(p, t)) continue;
      if (!(this.traffic[p].speed >= YELLOW_FOLLOW_MIN_MS)) continue;
      if (this.giveBack.isGiveBack(overtakes[k].car, p, t)) continue;
      this.giveBack.open(overtakes[k].car, p, t);
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
    this.lapperPush.fill(0);
    const vscOn = this.vsc.phase === 'deployed' || this.vsc.phase === 'ending';
    for (let j = 0; j < n; j++) {
      this.yellowLapDist[j] = this.traffic[j].distance;
      this.yellowSpeed[j] = this.traffic[j].speed;
      this.yellowOut[j] = this.stopped[j] === 1 || this.finished[j] === 1 ? 1 : 0;
    }
    this.owedMask.fill(0);
    for (let i = 1; i < n; i++) {
      const o = this.giveBack.owes(i);
      if (o >= 0) this.owedMask[o] = 1;
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
      const lapper = this.flags.blueLapper(i);
      if (lapper !== -1) {
        if (t > this.blueUntil[i] || lapper !== this.blueLapperOf[i]) this.blueSide[i] = 0;
        this.blueUntil[i] = t + BLUE_HOLD_S;
        this.blueLapperOf[i] = lapper;
      }
      if (t <= this.blueUntil[i]) {
        const lp = this.blueLapperOf[i];
        const off = this.line.offsets[idx];
        const room = halfWidthAt(this.track, 'left', idx);
        const left = room + off;
        const right = halfWidthAt(this.track, 'right', idx) - off;
        const roomL = Math.max(0, left - BLUE_EDGE_M);
        const roomR = Math.max(0, right - BLUE_EDGE_M);
        if (this.blueSide[i] === 0) {
          const goLeft = this.traffic[lp].lateral > this.traffic[i].lateral;
          this.blueSide[i] = goLeft ? -1 : 1;
        }
        this.ruleOffset[i] = this.blueSide[i] < 0 ? -Math.min(BLUE_OFFSET_M, roomL) : Math.min(BLUE_OFFSET_M, roomR);
        const behind = ((this.traffic[i].distance - this.traffic[lp].distance) % this.lapLength + this.lapLength) % this.lapLength;
        let battling = false;
        for (let k = 0; k < n && !battling; k++) {
          if (k === i || k === lp || this.finished[k] === 1) continue;
          battling = Math.abs(this.totalDist[k] - this.totalDist[i]) <= BLUE_BATTLE_M;
        }
        if (i > 0 && behind <= BLUE_CAP_RANGE_M && this.lapperPush[lp] === 0) this.lapperPush[lp] = -this.blueSide[i] * BLUE_PUSH_M;
        if (!battling && behind <= BLUE_CAP_RANGE_M) {
          const blueCap = 0.92 * this.speeds[idx];
          cap = Number.isNaN(cap) ? blueCap : Math.min(cap, blueCap);
        }
      }
      const owed = i >= 1 ? this.giveBack.owes(i) : -1;
      if (owed >= 0) {
        const g = this.totalDist[i] - this.totalDist[owed];
        const v = this.current[owed].forwardSpeed;
        const gbCap = g > 15 ? 0.5 * v : Math.max(0, v - 6);
        cap = Number.isNaN(cap) ? gbCap : Math.min(cap, gbCap);
      }
      this.ruleCap[i] = cap;
    }
    const lapper0 = this.flags.blueLapper(0);
    this.blue0 = lapper0 !== -1;
    this.blueLapper0 = lapper0;
    if (this.blueTimer.update(lapper0, lapper0 === -1 ? 0 : this.trackGap(0, lapper0), FIXED_DT)) {
      this.book(0, 'penalty', BLUE_PENALTY_S, 'ignoring blue flags');
    }
  }

  private applyRulesReaction(i: number, driver: AiDriver, trafficCap: number | null): void {
    // A numeric yellow cap means moving traffic ahead: hold the line. With no cap
    // the car must be free to steer around a stationary one.
    if (this.yellow[i] === 1 && this.yellowHold[i] === 1) driver.setLateralOffset(0);
    else if (this.time <= this.blueUntil[i]) driver.setLateralOffset(this.ruleOffset[i]);
    const ruleCap = this.ruleCap[i];
    if (!this.ais[i - 1].residual) {
      driver.setBrakeGain(Number.isNaN(ruleCap) && this.aheadSpeedCap === null ? AI_BRAKE_KB : RULE_BRAKE_KB);
    }
    // Several caps (traffic, blue, yellow, VSC) combine as the minimum.
    if (Number.isNaN(ruleCap)) driver.setSpeedCap(trafficCap);
    else driver.setSpeedCap(trafficCap === null ? ruleCap : Math.min(trafficCap, ruleCap));
  }

  private trackGap(car: number, lapper: number): number {
    const L = this.lapLength;
    return ((this.traffic[car].distance - this.traffic[lapper].distance) % L + L) % L;
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
    this.trouble.mark(k + 1, this.time);
    this.ais[k].vehicle.reset({
      position: { x: p[0], y: ground + SPAWN_HEIGHT_M, z: p[1] },
      yaw: Math.atan2(-(next[0] - p[0]), -(next[1] - p[1])),
    });
  }
}
