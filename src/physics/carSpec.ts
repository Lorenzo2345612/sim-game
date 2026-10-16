import type { ActiveAeroSpec, HybridSpec } from './hybridTypes';

export type Vec3 = { x: number; y: number; z: number };

export type SetupKey =
  | 'frontWing'
  | 'rearWing'
  | 'brakeBias'
  | 'finalDrive'
  | 'arbFront'
  | 'arbRear'
  | 'rideHeight'
  | 'tyrePressureKpa';

export interface SetupRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

export type SetupRanges = Record<SetupKey, SetupRange>;
export type PresetName = 'stable' | 'balanced' | 'aggressive';
export type PresetSetup = Record<SetupKey, number>;
export type TyreName = 'soft' | 'medium' | 'hard';

export interface TyreCompound {
  mu0: number;
  Fz0: number;
  loadSens: number;
  Bx: number;
  Cx: number;
  Ex: number;
  By: number;
  Cy: number;
  Ey: number;
  optTempC: number;
  tempWindowC: number;
  heatCoef: number;
  coolCoef: number;
  wearRate: number;
  wearGripLoss: number;
  cliffWear: number;
}

export interface AxleSpec {
  springRate: number;
  bumpDamping: number;
  reboundDamping: number;
  restLength: number;
  travel: number;
  bumpStopRate: number;
  arb: number;
}

export interface CarSound {
  cylinders: number;
  exhaustLengthM: number;
  intakeMix: number;
  crackle: number;
}

export const DEFAULT_CAR_SOUND: CarSound = {
  cylinders: 4,
  exhaustLengthM: 1.2,
  intakeMix: 0.3,
  crackle: 0.2,
};

export type CarCategory = 'open-wheel' | 'gt3' | 'gt4' | 'touring' | 'prototype' | 'lmp2' | 'hypercar';
const CATEGORIES: readonly CarCategory[] = [
  'open-wheel',
  'gt3',
  'gt4',
  'touring',
  'prototype',
  'lmp2',
  'hypercar',
];

export interface CockpitSpec {
  eye: Vec3;
  wheel: Vec3;
  wheelRadius: number;
  lockDeg: number;
}

export const DEFAULT_COCKPIT_EYE: Vec3 = { x: 0, y: 0.75, z: -0.2 };

export interface CarSpec {
  id: string;
  name: string;
  category: CarCategory;
  model: { url: string };
  drive: 'rwd';
  chassis: {
    massKg: number;
    cgHeight: number;
    inertia: Vec3;
    halfExtents: Vec3;
  };
  wheels: {
    positions: [number, number, number][];
    radius: number;
    width: number;
    inertia: number;
  };
  suspension: { front: AxleSpec; rear: AxleSpec };
  steering: {
    maxAngleLow: number;
    maxAngleHigh: number;
    fullSpeed: number;
    rate: number;
  };
  tyres: {
    optPressureKpa: number;
    pressureKpa: number;
    compounds: Record<TyreName, TyreCompound>;
  };
  aero: {
    cda: number;
    claFront: number;
    claRear: number;
    rideHeightSens: number;
    wingStep: { claFront: number; claRear: number; cda: number };
  };
  engine: {
    torqueCurve: [number, number][];
    idleRpm: number;
    launchRpm: number;
    limiterRpm: number;
    inertia: number;
    brakingTorque: number;
  };
  sound: CarSound;
  gearbox: {
    ratios: number[];
    final: number;
    reverse: number;
    upRpm: number;
    downRpm: number;
    shiftTime: number;
    efficiency: number;
  };
  diff: {
    type: 'open' | 'lsd' | 'locked';
    preload: number;
    lockPower: number;
    lockCoast: number;
  };
  brakes: { maxTorque: number; bias: number };
  aids: {
    abs: { enabled: boolean; slip: number };
    tc: { enabled: boolean; slip: number };
  };
  fuel: { capacityL: number; densityKgL: number; bsfc: number; startL: number };
  cockpit: CockpitSpec;
  hybrid?: HybridSpec;
  activeAero?: ActiveAeroSpec;
  setup: SetupRanges;
  presets: Record<PresetName, PresetSetup>;
}

const WHEEL_INERTIA_DEFAULT = 1.2;

function fail(path: string): never {
  throw new Error(`Invalid car spec: ${path} is missing or invalid`);
}

function pick(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function finiteNum(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path);
  return value;
}

function num(root: unknown, path: string): number {
  return finiteNum(pick(root, path), path);
}

function optNum(root: unknown, path: string): number | undefined {
  const v = pick(root, path);
  if (v === undefined) return undefined;
  return finiteNum(v, path);
}

function str(root: unknown, path: string): string {
  const v = pick(root, path);
  if (typeof v !== 'string') fail(path);
  return v;
}

function bool(root: unknown, path: string): boolean {
  const v = pick(root, path);
  if (typeof v !== 'boolean') fail(path);
  return v;
}

function enumStr<T extends string>(root: unknown, path: string, allowed: readonly T[]): T {
  const v = pick(root, path);
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail(path);
  return v as T;
}

function numList(value: unknown, path: string, length?: number): number[] {
  if (!Array.isArray(value)) fail(path);
  const arr = value as unknown[];
  if (length !== undefined && arr.length !== length) fail(path);
  return arr.map((n) => finiteNum(n, path));
}

function numArray(root: unknown, path: string): number[] {
  return numList(pick(root, path), path);
}

function numPairs(root: unknown, path: string): [number, number][] {
  const v = pick(root, path);
  if (!Array.isArray(v)) fail(path);
  return (v as unknown[]).map((row): [number, number] => {
    const p = numList(row, path, 2);
    return [p[0], p[1]];
  });
}

function vec3(root: unknown, path: string): Vec3 {
  return {
    x: num(root, `${path}.x`),
    y: num(root, `${path}.y`),
    z: num(root, `${path}.z`),
  };
}

function axle(root: unknown, path: string): AxleSpec {
  return {
    springRate: num(root, `${path}.springRate`),
    bumpDamping: num(root, `${path}.bumpDamping`),
    reboundDamping: num(root, `${path}.reboundDamping`),
    restLength: num(root, `${path}.restLength`),
    travel: num(root, `${path}.travel`),
    bumpStopRate: num(root, `${path}.bumpStopRate`),
    arb: num(root, `${path}.arb`),
  };
}

function compound(root: unknown, path: string): TyreCompound {
  return {
    mu0: num(root, `${path}.mu0`),
    Fz0: num(root, `${path}.Fz0`),
    loadSens: num(root, `${path}.loadSens`),
    Bx: num(root, `${path}.Bx`),
    Cx: num(root, `${path}.Cx`),
    Ex: num(root, `${path}.Ex`),
    By: num(root, `${path}.By`),
    Cy: num(root, `${path}.Cy`),
    Ey: num(root, `${path}.Ey`),
    optTempC: num(root, `${path}.optTempC`),
    tempWindowC: num(root, `${path}.tempWindowC`),
    heatCoef: num(root, `${path}.heatCoef`),
    coolCoef: num(root, `${path}.coolCoef`),
    wearRate: num(root, `${path}.wearRate`),
    wearGripLoss: num(root, `${path}.wearGripLoss`),
    cliffWear: num(root, `${path}.cliffWear`),
  };
}

function range(root: unknown, path: string): SetupRange {
  return {
    min: num(root, `${path}.min`),
    max: num(root, `${path}.max`),
    step: num(root, `${path}.step`),
    default: num(root, `${path}.default`),
  };
}

function preset(root: unknown, name: PresetName): PresetSetup {
  return {
    frontWing: num(root, `presets.${name}.frontWing`),
    rearWing: num(root, `presets.${name}.rearWing`),
    brakeBias: num(root, `presets.${name}.brakeBias`),
    finalDrive: num(root, `presets.${name}.finalDrive`),
    arbFront: num(root, `presets.${name}.arbFront`),
    arbRear: num(root, `presets.${name}.arbRear`),
    rideHeight: num(root, `presets.${name}.rideHeight`),
    tyrePressureKpa: num(root, `presets.${name}.tyrePressureKpa`),
  };
}

function carSound(root: unknown): CarSound {
  const cylinders = optNum(root, 'sound.cylinders') ?? DEFAULT_CAR_SOUND.cylinders;
  if (!Number.isInteger(cylinders) || cylinders < 1 || cylinders > 12) fail('sound.cylinders');
  const exhaustLengthM = optNum(root, 'sound.exhaustLengthM') ?? DEFAULT_CAR_SOUND.exhaustLengthM;
  if (!(exhaustLengthM > 0 && exhaustLengthM <= 10)) fail('sound.exhaustLengthM');
  const intakeMix = optNum(root, 'sound.intakeMix') ?? DEFAULT_CAR_SOUND.intakeMix;
  if (intakeMix < 0 || intakeMix > 1) fail('sound.intakeMix');
  const crackle = optNum(root, 'sound.crackle') ?? DEFAULT_CAR_SOUND.crackle;
  if (crackle < 0 || crackle > 1) fail('sound.crackle');
  return { cylinders, exhaustLengthM, intakeMix, crackle };
}

const COCKPIT_WHEEL_OFFSET: Vec3 = { x: 0, y: -0.15, z: -0.45 };
const DEFAULT_COCKPIT_WHEEL_RADIUS = 0.13;
const DEFAULT_COCKPIT_LOCK_DEG = 270;

function cockpitSpec(root: unknown): CockpitSpec {
  const raw = pick(root, 'cockpit');
  if (raw !== undefined && (typeof raw !== 'object' || raw === null)) fail('cockpit');
  const eye =
    pick(root, 'cockpit.eye') === undefined
      ? { ...DEFAULT_COCKPIT_EYE }
      : vec3(root, 'cockpit.eye');
  const wheel =
    pick(root, 'cockpit.wheel') === undefined
      ? {
          x: eye.x + COCKPIT_WHEEL_OFFSET.x,
          y: eye.y + COCKPIT_WHEEL_OFFSET.y,
          z: eye.z + COCKPIT_WHEEL_OFFSET.z,
        }
      : vec3(root, 'cockpit.wheel');
  const wheelRadius = optNum(root, 'cockpit.wheelRadius') ?? DEFAULT_COCKPIT_WHEEL_RADIUS;
  if (!(wheelRadius >= 0.05 && wheelRadius <= 0.3)) fail('cockpit.wheelRadius');
  const lockDeg = optNum(root, 'cockpit.lockDeg') ?? DEFAULT_COCKPIT_LOCK_DEG;
  if (!(lockDeg >= 90 && lockDeg <= 1080)) fail('cockpit.lockDeg');
  return { eye, wheel, wheelRadius, lockDeg };
}

function posNum(root: unknown, path: string): number {
  const v = num(root, path);
  if (!(v > 0)) fail(path);
  return v;
}

const HYBRID_FIELDS = [
  'mgukW', 'batteryJ', 'deployJPerLap', 'harvestJPerLap', 'overtakeExtraJ', 'minSpeedMs',
  'taperStartMs', 'taperEndMs', 'overtakeTaperStartMs', 'overtakeTaperEndMs',
  'regenW', 'superClipW', 'liftHarvestW',
] as const;

function hybridSpec(root: unknown): HybridSpec | undefined {
  const raw = pick(root, 'hybrid');
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null) fail('hybrid');
  const out = {} as Record<(typeof HYBRID_FIELDS)[number], number>;
  for (const f of HYBRID_FIELDS) out[f] = posNum(root, `hybrid.${f}`);
  if (!(out.taperStartMs < out.taperEndMs)) fail('hybrid.taperEndMs');
  if (!(out.overtakeTaperStartMs < out.overtakeTaperEndMs)) fail('hybrid.overtakeTaperEndMs');
  return out;
}

function activeAeroSpec(root: unknown): ActiveAeroSpec | undefined {
  const raw = pick(root, 'activeAero');
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null) fail('activeAero');
  const dragScale = posNum(root, 'activeAero.dragScale');
  if (dragScale > 1) fail('activeAero.dragScale');
  const downforceScale = posNum(root, 'activeAero.downforceScale');
  if (downforceScale > 1) fail('activeAero.downforceScale');
  const transitionS = posNum(root, 'activeAero.transitionS');
  return { dragScale, downforceScale, transitionS };
}

function boxInertia(massKg: number, half: Vec3): Vec3 {
  const w = half.x * 2;
  const h = half.y * 2;
  const d = half.z * 2;
  return {
    x: (massKg * (h * h + d * d)) / 12,
    y: (massKg * (w * w + d * d)) / 12,
    z: (massKg * (w * w + h * h)) / 12,
  };
}

function wheelPositions(root: unknown): [number, number, number][] {
  const v = pick(root, 'wheels.positions');
  if (!Array.isArray(v)) fail('wheels.positions');
  return (v as unknown[]).map((row): [number, number, number] => {
    const p = numList(row, 'wheels.positions', 3);
    return [p[0], p[1], p[2]];
  });
}

export function parseCarSpec(json: unknown): CarSpec {
  const id = str(json, 'id');
  const name = str(json, 'name');
  const category = enumStr(json, 'category', CATEGORIES);
  const modelUrl = str(json, 'model.url');
  const drive = enumStr(json, 'drive', ['rwd']);

  const massKg = num(json, 'chassis.massKg');
  const cgHeight = num(json, 'chassis.cgHeight');
  const explicitInertia =
    pick(json, 'chassis.inertia') === undefined ? null : vec3(json, 'chassis.inertia');
  const halfExtents = vec3(json, 'chassis.halfExtents');
  const inertia = explicitInertia ?? boxInertia(massKg, halfExtents);

  const positions = wheelPositions(json);
  const radius = num(json, 'wheels.radius');
  const width = num(json, 'wheels.width');
  const wheelInertia = optNum(json, 'wheels.inertia') ?? WHEEL_INERTIA_DEFAULT;

  const front = axle(json, 'suspension.front');
  const rear = axle(json, 'suspension.rear');

  const steering = {
    maxAngleLow: num(json, 'steering.maxAngleLow'),
    maxAngleHigh: num(json, 'steering.maxAngleHigh'),
    fullSpeed: num(json, 'steering.fullSpeed'),
    rate: num(json, 'steering.rate'),
  };

  const optPressureKpa = num(json, 'tyres.optPressureKpa');
  const pressureKpa = optNum(json, 'tyres.pressureKpa') ?? optPressureKpa;
  const compounds = {
    soft: compound(json, 'tyres.compounds.soft'),
    medium: compound(json, 'tyres.compounds.medium'),
    hard: compound(json, 'tyres.compounds.hard'),
  };

  const aero = {
    cda: num(json, 'aero.cda'),
    claFront: num(json, 'aero.claFront'),
    claRear: num(json, 'aero.claRear'),
    rideHeightSens: num(json, 'aero.rideHeightSens'),
    wingStep: {
      claFront: num(json, 'aero.wingStep.claFront'),
      claRear: num(json, 'aero.wingStep.claRear'),
      cda: num(json, 'aero.wingStep.cda'),
    },
  };

  const engine = {
    torqueCurve: numPairs(json, 'engine.torqueCurve'),
    idleRpm: num(json, 'engine.idleRpm'),
    launchRpm: num(json, 'engine.launchRpm'),
    limiterRpm: num(json, 'engine.limiterRpm'),
    inertia: num(json, 'engine.inertia'),
    brakingTorque: num(json, 'engine.brakingTorque'),
  };

  const sound = carSound(json);

  const gearbox = {
    ratios: numArray(json, 'gearbox.ratios'),
    final: num(json, 'gearbox.final'),
    reverse: num(json, 'gearbox.reverse'),
    upRpm: num(json, 'gearbox.upRpm'),
    downRpm: num(json, 'gearbox.downRpm'),
    shiftTime: num(json, 'gearbox.shiftTime'),
    efficiency: num(json, 'gearbox.efficiency'),
  };

  const diff = {
    type: enumStr(json, 'diff.type', ['open', 'lsd', 'locked']),
    preload: num(json, 'diff.preload'),
    lockPower: num(json, 'diff.lockPower'),
    lockCoast: num(json, 'diff.lockCoast'),
  };

  const brakes = {
    maxTorque: num(json, 'brakes.maxTorque'),
    bias: num(json, 'brakes.bias'),
  };
  const aids = {
    abs: { enabled: bool(json, 'aids.abs.enabled'), slip: num(json, 'aids.abs.slip') },
    tc: { enabled: bool(json, 'aids.tc.enabled'), slip: num(json, 'aids.tc.slip') },
  };
  const fuel = {
    capacityL: num(json, 'fuel.capacityL'),
    densityKgL: num(json, 'fuel.densityKgL'),
    bsfc: num(json, 'fuel.bsfc'),
    startL: num(json, 'fuel.startL'),
  };

  const cockpit = cockpitSpec(json);
  const hybrid = hybridSpec(json);
  const activeAero = activeAeroSpec(json);

  const setup = {
    frontWing: range(json, 'setup.frontWing'),
    rearWing: range(json, 'setup.rearWing'),
    brakeBias: range(json, 'setup.brakeBias'),
    finalDrive: range(json, 'setup.finalDrive'),
    arbFront: range(json, 'setup.arbFront'),
    arbRear: range(json, 'setup.arbRear'),
    rideHeight: range(json, 'setup.rideHeight'),
    tyrePressureKpa: range(json, 'setup.tyrePressureKpa'),
  };
  const presets = {
    stable: preset(json, 'stable'),
    balanced: preset(json, 'balanced'),
    aggressive: preset(json, 'aggressive'),
  };

  return {
    id,
    name,
    category,
    model: { url: modelUrl },
    drive,
    chassis: { massKg, cgHeight, inertia, halfExtents },
    wheels: { positions, radius, width, inertia: wheelInertia },
    suspension: { front, rear },
    steering,
    tyres: { optPressureKpa, pressureKpa, compounds },
    aero,
    engine,
    sound,
    gearbox,
    diff,
    brakes,
    aids,
    fuel,
    cockpit,
    ...(hybrid ? { hybrid } : {}),
    ...(activeAero ? { activeAero } : {}),
    setup,
    presets,
  };
}
