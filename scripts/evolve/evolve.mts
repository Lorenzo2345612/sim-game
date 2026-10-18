// Neuroevolution trainer with a live viewer at http://127.0.0.1:8770
// npx tsx scripts/evolve/evolve.mts [--track monza] [--car f4] [--pop 100] [--workers 10] [--secs 120] [--resume path]
import { Worker } from 'node:worker_threads';
import { createServer, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrackData } from '../../src/track/parseTrackData';
import { halfWidthAt } from '../../src/track/surfaces';
import { N_W, randomGenome, gauss, mulberry32 } from './policy.mts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const trackId = arg('track', 'monza'), carId = arg('car', 'f4');
const POP = Number(arg('pop', '100')), W = Number(arg('workers', '10')), SECS = Number(arg('secs', '120'));
const PORT = Number(arg('port', '8770'));
const ELITE = Math.max(2, Math.round(POP * 0.05)), PARENTS = Math.max(4, Math.round(POP * 0.2));
const rand = mulberry32(Date.now() & 0xffffffff);
const runDir = join(here, 'runs', `${trackId}-${carId}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(runDir, { recursive: true });

// Track outline for the viewer
const track: any = parseTrackData(JSON.parse(readFileSync(join(root, `public/tracks/${trackId}.json`), 'utf8')));
const cl: [number, number][] = track.centerline;
const left: number[][] = [], right: number[][] = [];
for (let i = 0; i < cl.length; i++) {
  const a = cl[(i - 1 + cl.length) % cl.length], b = cl[(i + 1) % cl.length];
  const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
  const rx = -tz / l, rz = tx / l; // right of travel (matches TrackProgress lateral sign)
  const hr = halfWidthAt(track, 'right', i), hl = halfWidthAt(track, 'left', i);
  right.push([cl[i][0] + rx * hr, cl[i][1] + rz * hr]);
  left.push([cl[i][0] - rx * hl, cl[i][1] - rz * hl]);
}

// Population
let pop: Float64Array[] = [];
const resume = arg('resume', '');
if (resume && existsSync(resume)) {
  const g = JSON.parse(readFileSync(resume, 'utf8'));
  const base = Float64Array.from(g.weights);
  pop.push(base);
  while (pop.length < POP) pop.push(mutate(base, 0.1));
} else for (let i = 0; i < POP; i++) pop.push(randomGenome(rand));

function mutate(g: Float64Array, sigma: number): Float64Array {
  const c = Float64Array.from(g);
  for (let i = 0; i < N_W; i++) if (rand() < 0.3) c[i] += sigma * gauss(rand);
  return c;
}
function cross(a: Float64Array, b: Float64Array): Float64Array {
  const c = new Float64Array(N_W);
  for (let i = 0; i < N_W; i++) c[i] = rand() < 0.5 ? a[i] : b[i];
  return c;
}

// Viewer state + SSE
const clients = new Set<ServerResponse>();
const history: { gen: number; best: number; mean: number; bestLap: number }[] = [];
let gen = 0, sigma = 0.25, lapLength = 0, allTimeBest = 0, simT = 0;
const per = Math.ceil(POP / W);
const positions = new Float32Array(POP * 4);
const send = (ev: string, data: unknown) => { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };
createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(res);
    res.write(`event: init\ndata: ${JSON.stringify({ left, right, trackId, carId, pop: POP, elite: ELITE, history })}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(join(here, 'viewer.html')));
}).listen(PORT, '127.0.0.1', () => console.log(`viewer: http://127.0.0.1:${PORT}  run: ${runDir}`));
setInterval(() => send('pos', { gen, t: simT, p: Array.from(positions, (v) => Math.round(v * 10) / 10) }), 66);

// Workers
const workers: Worker[] = [];
await Promise.all(Array.from({ length: W }, (_, w) => new Promise<void>((ok) => {
  const wk = new Worker(join(here, 'worker.mts'), { execArgv: ['--import', 'tsx'], workerData: { root, trackId, carId, slots: per } });
  wk.on('message', (m: any) => {
    if (m.type === 'ready') { lapLength = m.lapLength; ok(); }
    if (m.type === 'pos') { positions.set(m.pos, w * per * 4); if (w === 0) simT = m.t; }
  });
  wk.on('error', (e) => { console.error('worker', w, e); process.exit(1); });
  workers.push(wk);
})));
console.log(`${W} workers ready, pop ${POP}, ${N_W} weights, lap ${lapLength.toFixed(0)} m`);

function evalAll(): Promise<{ fitness: number[]; best: number[]; lapT: number[] }> {
  return Promise.all(workers.map((wk, w) => new Promise<any>((ok) => {
    const batch = pop.slice(w * per, (w + 1) * per);
    const h = (m: any) => { if (m.type === 'done') { wk.off('message', h); ok(m); } };
    wk.on('message', h);
    wk.postMessage({ type: 'eval', secs: SECS, starts, genomes: batch.map((g) => Array.from(g)) });
  }))).then((rs) => ({ fitness: rs.flatMap((r) => r.fitness), best: rs.flatMap((r) => r.best), lapT: rs.flatMap((r) => r.lapT) }));
}

let starts: number[] = [0];
for (;;) {
  const t0 = Date.now();
  starts = [0, Math.floor(rand() * lapLength), Math.floor(rand() * lapLength)]; // grid + 2 random points, same for everyone this generation
  const r = await evalAll();
  const order = r.fitness.map((f, i) => i).sort((a, b) => r.fitness[b] - r.fitness[a]);
  const bestI = order[0];
  const mean = r.best.reduce((a, b) => a + b, 0) / POP;
  const laps = r.lapT.filter((t) => t > 0);
  const bestLap = laps.length ? Math.min(...laps) : 0;
  history.push({ gen, best: r.best[bestI], mean, bestLap });
  console.log(`gen ${gen} best ${r.best[bestI].toFixed(0)} m mean ${mean.toFixed(0)} m laps ${laps.length}${bestLap ? ` bestLap ${bestLap.toFixed(2)} s` : ''} sigma ${sigma.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const champ = { gen, track: trackId, car: carId, distance: r.best[bestI], lapTime: r.lapT[bestI], fitness: r.fitness[bestI], weights: Array.from(pop[bestI]) };
  writeFileSync(join(runDir, `gen-${String(gen).padStart(4, '0')}.json`), JSON.stringify(champ));
  if (r.fitness[bestI] >= allTimeBest) { allTimeBest = r.fitness[bestI]; writeFileSync(join(runDir, 'best.json'), JSON.stringify(champ)); }
  send('gen', history[history.length - 1]);
  // Next generation: elites unchanged (drawn first, gold in the viewer), rest from top parents
  const next: Float64Array[] = order.slice(0, ELITE).map((i) => pop[i]);
  while (next.length < POP) {
    const a = pop[order[Math.floor(rand() * PARENTS)]], b = pop[order[Math.floor(rand() * PARENTS)]];
    next.push(mutate(rand() < 0.5 ? cross(a, b) : a, sigma));
  }
  pop = next;
  sigma = Math.max(0.06, sigma * 0.985);
  gen++;
}
