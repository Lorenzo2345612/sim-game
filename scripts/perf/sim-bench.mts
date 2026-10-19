// Headless 16-car race step cost (CPU ms, robust to host load): mean/p95/p99 per RaceGame.step plus a determinism hash.
// Usage: npx tsx scripts/perf/sim-bench.mts [classic|neural|residual] [--track monza] [--seconds 60] [--ai 15]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RaceGame } from '../../src/game/raceGame';
import { parseCarSpec } from '../../src/physics/carSpec';
import { parseTrackData } from '../../src/track/parseTrackData';
import { FIXED_DT } from '../../src/core/constants';
import { parseNeuralModel } from '../../src/ai/neuralPolicy';
import { parseResidualModel } from '../../src/ai/residualPolicy';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'classic';
const trackId = arg('track', 'monza'), SECONDS = Number(arg('seconds', '60')), AI = Number(arg('ai', '15'));
const root = join(import.meta.dirname, '../..');
const j = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const track = parseTrackData(j(`public/tracks/${trackId}.json`));
const spec = parseCarSpec(j('public/cars/f4.json'));
let options: any = { compound: 'medium', wear: 1, fuel: 1 };
if (mode !== 'classic') {
  const json = j(`public/ai-models/${trackId}-f4/expert.json`), mt = j(`public/ai-models/${trackId}-f4/line-mintime.json`);
  const residual = parseResidualModel(json);
  options = { ...options, aiDriver: 'neural', neuralModels: { expert: parseNeuralModel(json) }, neuralSetups: { expert: json.setup },
    neuralLine: { kind: 'mintime', pts: mt.pts, v: mt.v }, ...(mode === 'residual' && residual ? { neuralResidual: { expert: residual } } : {}) };
}
const g: any = await RaceGame.create(track, spec, { trackId, carId: 'f4', laps: 5, aiCount: AI, difficulty: 'expert', seed: 1 }, options);
const IN = { throttle: 0.6, brake: 0, steer: 0, reset: false };
const warm = Math.round(10 / FIXED_DT), N = Math.round(SECONDS / FIXED_DT), t = new Float64Array(N);
for (let i = 0; i < warm; i++) g.step(IN);
for (let i = 0; i < N; i++) { const c0 = process.cpuUsage(); g.step(IN); const c1 = process.cpuUsage(c0); t[i] = (c1.user + c1.system) / 1000; }
const s = Array.from(t).sort((a, b) => a - b), q = (p: number) => s[Math.min(N - 1, Math.floor(p * N))];
let h = 0; for (const st of g.current) h = (h * 31 + Math.round(st.position.x * 1e4) + Math.round(st.position.z * 1e4)) | 0;
console.log(JSON.stringify({ mode, track: trackId, cars: AI + 1, mean: +(t.reduce((a, b) => a + b, 0) / N).toFixed(3), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[N - 1].toFixed(1), contacts: g.contactCount, hash: h }));
