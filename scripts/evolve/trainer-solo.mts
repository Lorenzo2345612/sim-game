// Runs one model through the TRAINER episode (worker.mts, solo: no traffic) with fixed compound/fuel/wear.
// Usage: npx tsx scripts/evolve/trainer-solo.mts <model.json> [--laps 3] [--compound hard|medium|soft] [--wear 1] [--fuelL 20] [--setup model|default] [--track cleveland]
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTrackData } from '../../src/track/parseTrackData';
import { parseCarSpec } from '../../src/physics/carSpec';
import { cumulativeLengths } from '../../src/track/centerline';
import { defaultSetup } from '../../src/physics/setup';
import { N_W, padGenome } from '../../src/ai/neuralPolicy';
import { N_SET } from './genome.mts';
const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const root = join(import.meta.dirname, '../..');
const model = JSON.parse(readFileSync(argv[0], 'utf8'));
const trackId = arg('track', model.track ?? 'cleveland'), carId = model.car ?? 'f4', LAPS = Number(arg('laps', '3'));
const track: any = parseTrackData(JSON.parse(readFileSync(join(root, `public/tracks/${trackId}.json`), 'utf8')));
const parsed: any = parseCarSpec(JSON.parse(readFileSync(join(root, `public/cars/${carId}.json`), 'utf8'))), spec = parsed.spec ?? parsed;
const L = cumulativeLengths(track.centerline, true)[track.centerline.length];
const fuelMin = Math.min(spec.fuel.capacityL, Math.max(18, (0.25 * L) / 1000 * 12));
const fuelFrac = (Number(arg('fuelL', String(spec.fuel.startL))) - fuelMin) / (spec.fuel.capacityL - fuelMin);
const compFrac = { soft: 0.1, medium: 0.4, hard: 0.8 }[arg('compound', 'hard') as 'hard'];
const wearFrac = (Number(arg('wear', '1')) - 1) / 4;
const KEYS = ['frontWing', 'rearWing', 'brakeBias', 'finalDrive', 'arbFront', 'arbRear', 'rideHeight', 'tyrePressureKpa'] as const;
const def: any = defaultSetup(spec), st = arg('setup', 'model') === 'default' ? def : { ...def, ...model.setup };
const genes = KEYS.map((k) => { const r = spec.setup[k], d = def[k]; return st[k] >= d ? (r.max > d ? (st[k] - d) / (r.max - d) : 0) : -(d - st[k]) / (d - r.min); });
const genome = [...padGenome(model.weights)!, ...genes, ...model.extra];
void N_W; void N_SET;
const wk = new Worker(join(import.meta.dirname, 'worker.mts'), { execArgv: ['--import', 'tsx', '--import', join(import.meta.dirname, 'fixed-random.mjs')],
  env: { ...process.env, FIXED_RANDOM: `${fuelFrac},${compFrac},${wearFrac}` },
  workerData: { root, trackId, carId, slots: 1, line: 'mintime', racecraft: false, residual: true, res: model.res } });
wk.on('message', (m: any) => {
  if (m.type === 'ready') wk.postMessage({ type: 'eval', episodes: [{ start: 0, secs: LAPS * 150 }], race: { laps: LAPS, speedW: 120, overW: 0, lapW: 100 }, genomes: [genome], opponents: [] });
  if (m.type === 'done') { console.log(JSON.stringify({ model: argv[0].split('/').pop(), compound: arg('compound', 'hard'), wear: arg('wear', '1'), laps: m.laps[0], bestLap: +m.lapT[0].toFixed(2), finishT: +m.finishT[0].toFixed(1), avgLap: +(m.finishT[0] / LAPS).toFixed(2), invalid: m.invalidLaps[0] })); process.exit(0); }
});
wk.on('error', (e) => { console.error(e); process.exit(1); });
