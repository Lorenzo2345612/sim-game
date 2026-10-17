import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EngineVoice, type VoiceControl } from '../../src/audio/engineVoice';
import { parseCarSpec, type CarSpec } from '../../src/physics/carSpec';

export interface ScenarioMetrics {
  peak: number;
  rms: number;
  dcMean: number;
  f0Hz: number | null;
}

const FS = 48000;
const SEED = 1;
const BLOCK = 128;
const WARM_S = 0.5;
const F0_S = 1.5;
const F0_MIN_LAG_S = 0.0005;
const F0_MAX_LAG_S = 0.03;
const F0_MIN_PEAK = 0.3;

const SCENARIOS = ['idle', 'mid', 'redline', 'sweep', 'lift'] as const;
type ScenarioName = (typeof SCENARIOS)[number];
const DURATION_S: Record<ScenarioName, number> = { idle: 2, mid: 2, redline: 2, sweep: 5, lift: 2 };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const ascii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}

export function f0Autocorr(x: Float32Array, sampleRate: number, expectHz?: number): number | null {
  let minLag = Math.max(1, Math.round(F0_MIN_LAG_S * sampleRate));
  let maxLag = Math.min(Math.round(F0_MAX_LAG_S * sampleRate), x.length - 1);
  if (expectHz !== undefined && expectHz > 0) {
    minLag = Math.max(minLag, Math.floor(sampleRate / (expectHz * 1.25)));
    maxLag = Math.min(maxLag, Math.ceil(sampleRate / (expectHz * 0.75)));
  }
  if (maxLag <= minLag) return null;
  let e0 = 0;
  for (let i = 0; i < x.length; i++) e0 += x[i] * x[i];
  if (!(e0 > 0)) return null;
  const r = new Float64Array(maxLag + 1);
  let rMax = 0;
  let rMaxLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    r[lag] = s / e0;
    if (r[lag] > rMax) {
      rMax = r[lag];
      rMaxLag = lag;
    }
  }
  if (rMax < F0_MIN_PEAK) return null;
  if (expectHz !== undefined && expectHz > 0) return sampleRate / rMaxLag;
  // Without a hint: first local maximum near the global peak, skipping the
  // half-cycle bump (same-bank pulses correlate at 360 deg) and multiples.
  const thr = 0.9 * rMax;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (r[lag] >= thr && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) return sampleRate / lag;
  }
  return null;
}

interface Control {
  rpm: number;
  load: number;
  throttle: number;
  limiter: boolean;
}

function controlAt(name: ScenarioName, t: number, idleRpm: number, limiterRpm: number): Control {
  switch (name) {
    case 'idle':
      return { rpm: idleRpm, load: 0.1, throttle: 0.1, limiter: false };
    case 'mid':
      return { rpm: 0.6 * limiterRpm, load: 1, throttle: 1, limiter: false };
    case 'redline':
      return { rpm: limiterRpm - 200, load: 1, throttle: 1, limiter: false };
    case 'sweep':
      if (t < 4) return { rpm: idleRpm + ((limiterRpm - idleRpm) * t) / 4, load: 1, throttle: 1, limiter: false };
      return { rpm: limiterRpm, load: 1, throttle: 1, limiter: true };
    case 'lift':
      if (t < 0.5) return { rpm: limiterRpm - 500, load: 1, throttle: 1, limiter: false };
      return { rpm: limiterRpm - 500, load: 0, throttle: 0, limiter: false };
  }
}

function renderScenario(name: ScenarioName, car: CarSpec): Float32Array {
  const voice = new EngineVoice(car.sound.synth, FS, SEED);
  const warm = Math.round(WARM_S * FS);
  const n = Math.round(DURATION_S[name] * FS);
  const total = warm + n;
  const full = new Float32Array(total);
  for (let i = 0; i < total; i += BLOCK) {
    const len = Math.min(BLOCK, total - i);
    const t = Math.max(0, (i - warm) / FS);
    const c = controlAt(name, t, car.engine.idleRpm, car.engine.limiterRpm);
    const control: VoiceControl = {
      rpm: c.rpm,
      load: c.load,
      throttle: c.throttle,
      wheelSpeedMs: 0,
      limiter: c.limiter,
    };
    voice.setControl(control);
    voice.render(full.subarray(i, i + len));
  }
  const x = full.slice(warm);
  // The final soft clip leaves a small DC offset the voice's blocker cannot remove.
  let mean = 0;
  for (let i = 0; i < x.length; i++) mean += x[i];
  mean /= x.length;
  for (let i = 0; i < x.length; i++) x[i] -= mean;
  return x;
}

function metricsOf(name: ScenarioName, x: Float32Array, car: CarSpec): ScenarioMetrics {
  let peak = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    sum += x[i];
    sumSq += x[i] * x[i];
  }
  const rpm =
    name === 'idle'
      ? car.engine.idleRpm
      : name === 'mid'
        ? 0.6 * car.engine.limiterRpm
        : name === 'redline'
          ? car.engine.limiterRpm - 200
          : 0;
  const expectHz = rpm > 0 ? (rpm * car.sound.cylinders) / 120 : undefined;
  return {
    peak,
    rms: Math.sqrt(sumSq / x.length),
    dcMean: sum / x.length,
    f0Hz:
      expectHz !== undefined ? f0Autocorr(x.subarray(0, Math.round(F0_S * FS)), FS, expectHz) : null,
  };
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function loadCar(id: string): CarSpec {
  const path = join(ROOT, 'public', 'cars', `${id}.json`);
  if (!existsSync(path)) throw new Error(`Unknown car: ${id}`);
  const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parseCarSpec(json);
}

function parseArgs(argv: string[]): { car: string; out: string } {
  let car = '';
  let out = '.ai/audio';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--car') car = argv[++i] ?? '';
    else if (argv[i] === '--out') out = argv[++i] ?? out;
  }
  if (car === '') throw new Error('Missing required --car <id>');
  return { car, out };
}

function main(): void {
  const { car: id, out } = parseArgs(process.argv.slice(2));
  const car = loadCar(id);
  mkdirSync(out, { recursive: true });
  const scenarios: Record<string, ScenarioMetrics> = {};
  for (const name of SCENARIOS) {
    const x = renderScenario(name, car);
    scenarios[name] = metricsOf(name, x, car);
    writeFileSync(join(out, `${id}-${name}.wav`), encodeWav16(x, FS));
  }
  const metrics = {
    car: id,
    sampleRate: FS,
    scenarios: Object.fromEntries(
      SCENARIOS.map((name) => [
        name,
        {
          peak: round6(scenarios[name].peak),
          rms: round6(scenarios[name].rms),
          dcMean: round6(scenarios[name].dcMean),
          f0Hz: scenarios[name].f0Hz === null ? null : round6(scenarios[name].f0Hz),
        },
      ]),
    ),
  };
  writeFileSync(join(out, `${id}.json`), `${JSON.stringify(metrics, null, 2)}\n`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
