import type { CarSpec, PresetName, SetupKey } from './carSpec';

export type { PresetName };

export type Setup = Record<SetupKey, number>;
export type SetupStorage = Pick<Storage, 'getItem' | 'setItem'>;

const KEYS: readonly SetupKey[] = [
  'frontWing',
  'rearWing',
  'brakeBias',
  'finalDrive',
  'arbFront',
  'arbRear',
  'rideHeight',
  'tyrePressureKpa',
];

export function defaultSetup(spec: CarSpec): Setup {
  const out = {} as Setup;
  for (const k of KEYS) out[k] = spec.setup[k].default;
  return out;
}

export function presetSetup(spec: CarSpec, name: PresetName): Setup {
  return { ...spec.presets[name] };
}

export function clampSetup(spec: CarSpec, s: Setup): Setup {
  const out = {} as Setup;
  for (const k of KEYS) {
    const r = spec.setup[k];
    const v = s[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      out[k] = r.default;
      continue;
    }
    const c = Math.min(Math.max(v, r.min), r.max);
    // Snap to grid, then drop ULP noise so on-step values round-trip exactly.
    out[k] = Number((r.min + Math.round((c - r.min) / r.step) * r.step).toPrecision(12));
  }
  return out;
}

export function applySetup(spec: CarSpec, s: Setup): CarSpec {
  const out = structuredClone(spec);
  const dF = s.frontWing - spec.setup.frontWing.default;
  const dR = s.rearWing - spec.setup.rearWing.default;
  out.aero.claFront += dF * spec.aero.wingStep.claFront;
  out.aero.claRear += dR * spec.aero.wingStep.claRear;
  out.aero.cda += (dF + dR) * spec.aero.wingStep.cda;
  out.brakes.bias = s.brakeBias;
  out.gearbox.final = s.finalDrive;
  out.suspension.front.arb = s.arbFront;
  out.suspension.rear.arb = s.arbRear;
  for (const pos of out.wheels.positions) pos[1] += s.rideHeight;
  out.chassis.cgHeight += s.rideHeight;
  out.tyres.pressureKpa = s.tyrePressureKpa;
  return out;
}

export function saveSetup(
  carId: string,
  trackId: string,
  s: Setup,
  storage: SetupStorage,
): void {
  try {
    storage.setItem(`setup:${carId}:${trackId}`, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

function parseStored(raw: string | null): Setup | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const obj = v as Record<string, unknown>;
  const out = {} as Setup;
  for (const k of KEYS) {
    const n = obj[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[k] = n;
  }
  return out;
}

export function loadSetup(
  carId: string,
  trackId: string,
  spec: CarSpec,
  storage: SetupStorage,
): Setup {
  let raw: string | null = null;
  try {
    raw = storage.getItem(`setup:${carId}:${trackId}`);
  } catch {
    /* treat as missing */
  }
  return clampSetup(spec, parseStored(raw) ?? defaultSetup(spec));
}
