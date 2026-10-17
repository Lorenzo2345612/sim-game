import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const FS = 48000;
const SCENARIOS: Record<string, number> = { idle: 2, mid: 2, redline: 2, sweep: 5, lift: 2 };
const FILES = [
  'f4-idle.wav',
  'f4-mid.wav',
  'f4-redline.wav',
  'f4-sweep.wav',
  'f4-lift.wav',
  'f4.json',
];
const RUN_TIMEOUT = 180_000;

interface ScenarioMetrics {
  peak: number;
  rms: number;
  dcMean: number;
  f0Hz: number | null;
}

interface MetricsJson {
  car: string;
  sampleRate: number;
  scenarios: Record<string, ScenarioMetrics>;
}

function render(outDir: string, car: string) {
  return spawnSync('npm', ['run', '-s', 'audio:render', '--', '--car', car, '--out', outDir], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT,
  });
}

function parseWav(buf: Buffer): {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bits: number;
  seconds: number;
} {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
  let audioFormat = -1;
  let channels = -1;
  let sampleRate = -1;
  let bits = -1;
  let dataBytes = -1;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      audioFormat = buf.readUInt16LE(pos + 8);
      channels = buf.readUInt16LE(pos + 10);
      sampleRate = buf.readUInt32LE(pos + 12);
      bits = buf.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      dataBytes = size;
    }
    pos += 8 + size + (size % 2);
  }
  const frameBytes = (channels * bits) / 8;
  return {
    audioFormat,
    channels,
    sampleRate,
    bits,
    seconds: dataBytes > 0 && frameBytes > 0 ? dataBytes / (sampleRate * frameBytes) : -1,
  };
}

describe('232 engine render tool acceptance', () => {
  let outDir: string;
  let run: ReturnType<typeof render>;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'simgame-232-'));
    run = render(outDir, 'f4');
  }, RUN_TIMEOUT);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('AT1: exits 0 and writes the five wavs plus the metrics json', () => {
    expect(run.status).toBe(0);
    for (const f of FILES) expect(existsSync(join(outDir, f)), f).toBe(true);
  });

  it('AT2: wavs are RIFF PCM 16-bit mono 48000 Hz with scenario durations ± 1 %', () => {
    for (const [name, seconds] of Object.entries(SCENARIOS)) {
      const w = parseWav(readFileSync(join(outDir, `f4-${name}.wav`)));
      expect(w.audioFormat, name).toBe(1);
      expect(w.channels, name).toBe(1);
      expect(w.sampleRate, name).toBe(FS);
      expect(w.bits, name).toBe(16);
      expect(Math.abs(w.seconds - seconds) / seconds, name).toBeLessThanOrEqual(0.01);
    }
  });

  it('AT3: per-scenario peak ≤ 0.9 and |dcMean| < 1e-3; mid.f0Hz within 1 % of 0.6·limiterRpm/60·cyl/2', () => {
    const metrics = JSON.parse(readFileSync(join(outDir, 'f4.json'), 'utf8')) as MetricsJson;
    for (const name of Object.keys(SCENARIOS)) {
      const s = metrics.scenarios[name];
      expect(s.peak, `${name}.peak`).toBeLessThanOrEqual(0.9);
      expect(Math.abs(s.dcMean), `${name}.dcMean`).toBeLessThan(1e-3);
    }
    const car = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as {
      engine: { limiterRpm: number };
      sound: { cylinders: number };
    };
    const expectedF0 = (0.6 * car.engine.limiterRpm * car.sound.cylinders) / (60 * 2);
    const midF0 = metrics.scenarios.mid.f0Hz;
    expect(midF0).not.toBeNull();
    expect(Math.abs((midF0 ?? 0) - expectedF0) / expectedF0).toBeLessThanOrEqual(0.01);
  });

  it(
    'AT4: two runs of the same car produce byte-identical outputs',
    () => {
      const dirA = mkdtempSync(join(tmpdir(), 'simgame-232-a-'));
      const dirB = mkdtempSync(join(tmpdir(), 'simgame-232-b-'));
      try {
        expect(render(dirA, 'f4').status).toBe(0);
        expect(render(dirB, 'f4').status).toBe(0);
        for (const f of FILES) {
          const a = readFileSync(join(dirA, f));
          const b = readFileSync(join(dirB, f));
          expect(a.equals(b), f).toBe(true);
        }
      } finally {
        rmSync(dirA, { recursive: true, force: true });
        rmSync(dirB, { recursive: true, force: true });
      }
    },
    2 * RUN_TIMEOUT,
  );

  it(
    'AT5: unknown car exits non-zero and names the id on stderr',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'simgame-232-unknown-'));
      try {
        const r = render(dir, 'nope');
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('nope');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    RUN_TIMEOUT,
  );
});
