export interface BlockMode {
  hz: number;
  q: number;
  gainDb: number;
}

export interface TurboLayer {
  centerHz: number;
  spanHz: number;
  gain: number;
  lagS: number;
}

export interface WhineLayer {
  order: number;
  gain: number;
  source: 'rpm' | 'wheel';
  minSpeedMs: number;
}

export interface EngineSynthSpec {
  firingDeg: number[];
  bank: number[];
  pipeM: [number, number];
  tailM: number;
  gasSpeedMs: number;
  pulseDeg: number;
  jitterDeg: number;
  jitterAmp: number;
  intakeHz: number;
  intakeMix: number;
  block: BlockMode[];
  lowpassHz: number;
  drive: number;
  turbo: TurboLayer | null;
  whine: WhineLayer | null;
  crackle: number;
  limiterHz: number;
  gainDb: number;
}

export const SYNTH_DEFAULTS: Omit<
  EngineSynthSpec,
  'firingDeg' | 'bank' | 'pipeM' | 'tailM' | 'intakeMix' | 'crackle'
> = {
  gasSpeedMs: 480,
  pulseDeg: 110,
  jitterDeg: 0.2,
  jitterAmp: 0.05,
  intakeHz: 300,
  block: [],
  lowpassHz: 6000,
  drive: 1.2,
  turbo: null,
  whine: null,
  limiterHz: 15,
  gainDb: 0,
};

export function evenFiring(cylinders: number): number[] {
  const out = new Array<number>(cylinders);
  for (let i = 0; i < cylinders; i++) out[i] = (720 * i) / cylinders;
  return out;
}

export function legacySynthSpec(s: {
  cylinders: number;
  exhaustLengthM: number;
  intakeMix: number;
  crackle: number;
}): EngineSynthSpec {
  const firingDeg = evenFiring(s.cylinders);
  const half = s.exhaustLengthM / 2;
  return {
    firingDeg,
    bank: firingDeg.map((_, i) => i % 2),
    pipeM: [half, half],
    tailM: half,
    gasSpeedMs: SYNTH_DEFAULTS.gasSpeedMs,
    pulseDeg: SYNTH_DEFAULTS.pulseDeg,
    jitterDeg: SYNTH_DEFAULTS.jitterDeg,
    jitterAmp: SYNTH_DEFAULTS.jitterAmp,
    intakeHz: SYNTH_DEFAULTS.intakeHz,
    intakeMix: s.intakeMix,
    block: [],
    lowpassHz: SYNTH_DEFAULTS.lowpassHz,
    drive: SYNTH_DEFAULTS.drive,
    turbo: null,
    whine: null,
    crackle: s.crackle,
    limiterHz: SYNTH_DEFAULTS.limiterHz,
    gainDb: SYNTH_DEFAULTS.gainDb,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function inRange(v: unknown, lo: number, hi: number, loInclusive = true): boolean {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  return loInclusive ? v >= lo && v <= hi : v > lo && v <= hi;
}

function numField(
  r: Record<string, unknown>,
  key: string,
  lo: number,
  hi: number,
  def: number,
  errors: string[],
  loInclusive = true,
): number {
  const v = r[key];
  if (v === undefined) return def;
  if (!inRange(v, lo, hi, loInclusive)) {
    errors.push(`synth.${key} must be a finite number in range`);
    return def;
  }
  return v as number;
}

function parseFiring(v: unknown, def: number[], errors: string[]): number[] {
  if (v === undefined) return [...def];
  if (
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= 12 &&
    v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 720)
  ) {
    return v.map((x) => x as number);
  }
  errors.push('synth.firingDeg must be 1..12 finite numbers in [0, 720)');
  return [...def];
}

function parseBank(v: unknown, firingDeg: number[], errors: string[]): number[] {
  if (v === undefined) return firingDeg.map((_, i) => i % 2);
  if (Array.isArray(v) && v.length === firingDeg.length && v.every((x) => x === 0 || x === 1)) {
    return v.map((x) => x as number);
  }
  errors.push('synth.bank must match firingDeg length with values 0 or 1');
  return firingDeg.map((_, i) => i % 2);
}

function parsePipeM(v: unknown, def: [number, number], errors: string[]): [number, number] {
  if (v === undefined) return [def[0], def[1]];
  if (!Array.isArray(v) || v.length !== 2 || !inRange(v[0], 0, 5, false) || !inRange(v[1], 0, 5, false)) {
    errors.push('synth.pipeM must be two finite numbers in (0, 5]');
    return [def[0], def[1]];
  }
  return [v[0] as number, v[1] as number];
}

function blockNum(
  e: Record<string, unknown>,
  key: string,
  lo: number,
  hi: number,
  i: number,
  errors: string[],
): number | null {
  const v = e[key];
  if (!inRange(v, lo, hi)) {
    errors.push(`synth.block[${i}].${key} must be a finite number in range`);
    return null;
  }
  return v as number;
}

function parseBlock(v: unknown, errors: string[]): BlockMode[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    errors.push('synth.block must be an array');
    return [];
  }
  if (v.length > 6) {
    errors.push('synth.block must have at most 6 entries');
    return [];
  }
  const out: BlockMode[] = [];
  for (let i = 0; i < v.length; i++) {
    const e = v[i];
    if (!isObj(e)) {
      errors.push(`synth.block[${i}] must be an object`);
      continue;
    }
    const hz = blockNum(e, 'hz', 40, 8000, i, errors);
    const q = blockNum(e, 'q', 0.5, 30, i, errors);
    const gainDb = blockNum(e, 'gainDb', -24, 24, i, errors);
    if (hz !== null && q !== null && gainDb !== null) out.push({ hz, q, gainDb });
  }
  return out;
}

function turboNum(
  v: Record<string, unknown>,
  key: string,
  lo: number,
  hi: number,
  errors: string[],
): number | null {
  const x = v[key];
  if (!inRange(x, lo, hi)) {
    errors.push(`synth.turbo.${key} must be a finite number in range`);
    return null;
  }
  return x as number;
}

function parseTurbo(v: unknown, errors: string[]): TurboLayer | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) {
    errors.push('synth.turbo must be an object or null');
    return null;
  }
  const centerHz = turboNum(v, 'centerHz', 500, 12000, errors);
  const spanHz = turboNum(v, 'spanHz', 100, 8000, errors);
  const gain = turboNum(v, 'gain', 0, 0.3, errors);
  const lagS = turboNum(v, 'lagS', 0, 3, errors);
  if (centerHz === null || spanHz === null || gain === null || lagS === null) return null;
  return { centerHz, spanHz, gain, lagS };
}

function whineNum(
  v: Record<string, unknown>,
  key: string,
  lo: number,
  hi: number,
  errors: string[],
  loInclusive = true,
): number | null {
  const x = v[key];
  if (!inRange(x, lo, hi, loInclusive)) {
    errors.push(`synth.whine.${key} must be a finite number in range`);
    return null;
  }
  return x as number;
}

function parseWhine(v: unknown, errors: string[]): WhineLayer | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) {
    errors.push('synth.whine must be an object or null');
    return null;
  }
  const order = whineNum(v, 'order', 0, 100, errors, false);
  const gain = whineNum(v, 'gain', 0, 0.3, errors);
  const minSpeedMs = whineNum(v, 'minSpeedMs', 0, 100, errors);
  const source = v.source;
  if (source !== 'rpm' && source !== 'wheel') {
    errors.push("synth.whine.source must be 'rpm' or 'wheel'");
    return null;
  }
  if (order === null || gain === null || minSpeedMs === null) return null;
  return { order, gain, source, minSpeedMs };
}

export function parseEngineSynth(
  raw: unknown,
  legacy: { cylinders: number; exhaustLengthM: number; intakeMix: number; crackle: number },
): { spec: EngineSynthSpec; errors: string[] } {
  const base = legacySynthSpec(legacy);
  if (!isObj(raw)) return { spec: base, errors: [] };
  const r = raw;
  const errors: string[] = [];
  const firingDeg = parseFiring(r.firingDeg, base.firingDeg, errors);
  const bank = parseBank(r.bank, firingDeg, errors);
  const pipeM = parsePipeM(r.pipeM, base.pipeM, errors);
  const tailM = numField(r, 'tailM', 0, 5, base.tailM, errors, false);
  const gasSpeedMs = numField(r, 'gasSpeedMs', 300, 700, SYNTH_DEFAULTS.gasSpeedMs, errors);
  const pulseDeg = numField(r, 'pulseDeg', 20, 240, SYNTH_DEFAULTS.pulseDeg, errors);
  const jitterDeg = numField(r, 'jitterDeg', 0, 2, SYNTH_DEFAULTS.jitterDeg, errors);
  const jitterAmp = numField(r, 'jitterAmp', 0, 0.3, SYNTH_DEFAULTS.jitterAmp, errors);
  const intakeHz = numField(r, 'intakeHz', 80, 1200, SYNTH_DEFAULTS.intakeHz, errors);
  const intakeMix = numField(r, 'intakeMix', 0, 1, legacy.intakeMix, errors);
  const block = parseBlock(r.block, errors);
  const lowpassHz = numField(r, 'lowpassHz', 800, 20000, SYNTH_DEFAULTS.lowpassHz, errors);
  const drive = numField(r, 'drive', 0.5, 4, SYNTH_DEFAULTS.drive, errors);
  const turbo = parseTurbo(r.turbo, errors);
  const whine = parseWhine(r.whine, errors);
  const crackle = numField(r, 'crackle', 0, 1, legacy.crackle, errors);
  const limiterHz = numField(r, 'limiterHz', 5, 40, SYNTH_DEFAULTS.limiterHz, errors);
  const gainDb = numField(r, 'gainDb', -12, 12, SYNTH_DEFAULTS.gainDb, errors);
  return {
    spec: {
      firingDeg,
      bank,
      pipeM,
      tailM,
      gasSpeedMs,
      pulseDeg,
      jitterDeg,
      jitterAmp,
      intakeHz,
      intakeMix,
      block,
      lowpassHz,
      drive,
      turbo,
      whine,
      crackle,
      limiterHz,
      gainDb,
    },
    errors,
  };
}
