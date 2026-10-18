// Neuroevolution trainer with a live viewer at http://127.0.0.1:8770
// npx tsx scripts/evolve/evolve.mts [--track monza] [--car f4] [--pop 100] [--workers 10] [--secs 60] [--laps 10] [--gens 1000] [--resume path]
// Grid episode grows with progress up to --laps laps; random-start episodes last --secs.
import { Worker } from 'node:worker_threads';
import { createServer, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrackData } from '../../src/track/parseTrackData';
import { halfWidthAt } from '../../src/track/surfaces';
import { N_W, N_IN, randomGenome, padGenome, gauss, mulberry32 } from './policy.mts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const trackId = arg('track', 'monza'), carId = arg('car', 'f4');
const POP = Number(arg('pop', '100')), W = Number(arg('workers', '10')), SECS = Number(arg('secs', '60'));
const MAX_LAPS = Number(arg('laps', '10')), GENS = Number(arg('gens', '1000'));
const SPEED_AT = Number(arg('speed-at', '4')); // mean grid distance (laps, 5-gen average) that switches fitness to speed
const RACE = { growth: { laps: MAX_LAPS, speedW: 30, overW: 2, lapW: 20 }, speed: { laps: MAX_LAPS, speedW: 120, overW: 0.3, lapW: 100 } };
const modelDir = join(here, 'models', `${trackId}-${carId}`);
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
let gen = 0;
let pop: Float64Array[] = [];
const resume = arg('resume', ''); // one genome file, or several comma-separated (seeds a mixed population)
const seeds = resume ? resume.split(',').filter((f) => existsSync(f)).map((f) => JSON.parse(readFileSync(f, 'utf8'))) : [];
let snap: any = null; // pop.json snapshot: whole population + trainer state
if (seeds.length === 1 && seeds[0].pop) { snap = seeds[0]; seeds.splice(0, 1, ...snap.pop.map((w: number[]) => ({ weights: w }))); }
const bases = seeds.map((g) => padGenome(g.weights)).filter((b): b is Float64Array => !!b);
if (bases.length) {
  pop.push(...bases.slice(0, POP));
  gen = snap ? snap.gen + 1 : Math.max(...seeds.map((g) => g.gen ?? -1)) + 1;
  for (let i = 0; pop.length < POP; i++) pop.push(mutate(bases[i % bases.length], 0.1));
  console.log(`seeded from ${bases.length} genome(s), ${seeds[0].weights.length} -> ${N_W} weights`);
} else if (resume) console.log('resume skipped: no usable genome');
if (!pop.length) for (let i = 0; i < POP; i++) pop.push(randomGenome(rand));

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
let eliteSlots: number[] = [];
const clients = new Set<ServerResponse>();
const history: { gen: number; best: number; mean: number; bestLap: number; laps: number }[] = [];
let sigma = 0.25, lapLength = 0, allTimeBest = 0, simT = 0;
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
  res.end(readFileSync(join(here, req.url?.startsWith('/multi') ? 'multi.html' : 'viewer.html')));
}).listen(PORT, '127.0.0.1', () => console.log(`viewer: http://127.0.0.1:${PORT}  run: ${runDir}`));
setInterval(() => send('pos', { gen, t: simT, e: eliteSlots, p: Array.from(positions, (v) => Math.round(v * 10) / 10) }), 66);

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

let perm: number[] = []; // slot -> pop index (genomes shuffled across worlds every generation)
function evalAll(): Promise<{ fitness: number[]; best: number[]; lapT: number[]; laps: number[]; finishT: number[] }> {
  perm = pop.map((_, i) => i);
  for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  eliteSlots = perm.map((p, slot) => (p < ELITE ? slot : -1)).filter((x) => x >= 0);
  const shuffled = perm.map((i) => pop[i]);
  return Promise.all(workers.map((wk, w) => new Promise<any>((ok) => {
    const batch = shuffled.slice(w * per, (w + 1) * per);
    const h = (m: any) => { if (m.type === 'done') { wk.off('message', h); ok(m); } };
    wk.on('message', h);
    wk.postMessage({ type: 'eval', episodes, race: speedPhase ? RACE.speed : RACE.growth, genomes: batch.map((g) => Array.from(g)) });
  }))).then((rs) => ({ fitness: rs.flatMap((r) => r.fitness), best: rs.flatMap((r) => r.best), lapT: rs.flatMap((r) => r.lapT), laps: rs.flatMap((r) => r.laps), finishT: rs.flatMap((r) => r.finishT) })).then((r) => {
    const un = (a: number[]) => { const o = new Array(POP); perm.forEach((p, slot) => { o[p] = a[slot]; }); return o; };
    return { fitness: un(r.fitness), best: un(r.best), lapT: un(r.lapT), laps: un(r.laps), finishT: un(r.finishT) };
  });
}

let episodes: { start: number; secs: number }[] = [];
let gridSecs = Math.max(150, lapLength / 20), refLap = 0, topLaps = 0; // first grid episode fits ~1.5 laps at early pace
let speedPhase = seeds.some((g) => g.phase === 'speed') || !!snap?.speedPhase;
if (snap) ({ refLap, topLaps, sigma } = snap);
const meanLaps: number[] = [];
mkdirSync(modelDir, { recursive: true });
const hof: Record<string, any> = existsSync(join(modelDir, 'index.json')) ? JSON.parse(readFileSync(join(modelDir, 'index.json'), 'utf8')).models ?? {} : {};
// Hall of fame: first genome to finish the full race in each 1 s bucket of average lap; difficulty = pace relative to the fastest.
function saveModel(i: number, finish: number) {
  const avg = finish / MAX_LAPS, key = String(Math.floor(avg));
  if (hof[key]) return;
  const file = `race-${key}s-gen${gen}.json`;
  writeFileSync(join(modelDir, file), JSON.stringify({ gen, nIn: N_IN, track: trackId, car: carId, raceLaps: MAX_LAPS, raceTime: finish, avgLap: avg, bestLap: lastR.lapT[i], weights: Array.from(pop[i]) }));
  hof[key] = { file, avgLap: avg, gen };
  const all = Object.values(hof).sort((a: any, b: any) => a.avgLap - b.avgLap) as any[];
  const pick = (f: number) => all.reduce((b, m) => (Math.abs(m.avgLap - all[0].avgLap * f) < Math.abs(b.avgLap - all[0].avgLap * f) ? m : b)).file;
  const difficulties = { expert: all[0].file, hard: pick(1.03), medium: pick(1.07), easy: pick(1.12) };
  writeFileSync(join(modelDir, 'index.json'), JSON.stringify({ track: trackId, car: carId, difficulties, models: hof }, null, 1));
  console.log(`model saved ${file} (avg lap ${avg.toFixed(2)} s)`);
}
let lastR: any = null;
for (; gen < GENS; ) {
  const t0 = Date.now();
  // grid episode: room for two more laps than the best managed (capped at MAX_LAPS), plus 2 short random starts
  if (refLap) gridSecs = topLaps >= MAX_LAPS ? MAX_LAPS * refLap * 1.25 : Math.min(MAX_LAPS * refLap * 1.1, (Math.ceil(topLaps) + 2) * refLap * 1.15);
  episodes = [{ start: 0, secs: gridSecs }, { start: Math.floor(rand() * lapLength), secs: SECS }, { start: Math.floor(rand() * lapLength), secs: SECS }];
  const r = await evalAll();
  lastR = r;
  const order = r.fitness.map((f, i) => i).sort((a, b) => r.fitness[b] - r.fitness[a]);
  const bestI = order[0];
  const mean = r.best.reduce((a, b) => a + b, 0) / POP;
  const laps = r.lapT.filter((t) => t > 0);
  const bestLap = laps.length ? Math.min(...laps) : 0;
  topLaps = Math.max(...r.laps, topLaps - 0.5); // slow decay: one bad generation does not shrink the grid episode
  if (bestLap) refLap = refLap ? Math.max(bestLap, Math.min(refLap, bestLap * 1.3)) : bestLap * 1.3;
  meanLaps.push(mean / lapLength);
  const avg5 = meanLaps.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, meanLaps.length);
  if (!speedPhase && meanLaps.length >= 5 && avg5 >= SPEED_AT) { speedPhase = true; allTimeBest = -Infinity; console.log(`speed phase from gen ${gen + 1} (mean ${avg5.toFixed(1)} laps)`); }
  const finishers = r.finishT.map((t, i) => [t, i]).filter(([t]) => t > 0).sort((a, b) => a[0] - b[0]);
  if (finishers.length) saveModel(finishers[0][1], finishers[0][0]);
  history.push({ gen, best: r.best[bestI], mean, bestLap, laps: topLaps });
  console.log(`gen ${gen} best ${r.best[bestI].toFixed(0)} m mean ${mean.toFixed(0)} m laps ${laps.length} topLaps ${topLaps}${bestLap ? ` bestLap ${bestLap.toFixed(2)} s` : ''} finished ${finishers.length}${finishers.length ? ` raceT ${finishers[0][0].toFixed(0)} s` : ''}${speedPhase ? ' SPEED' : ''} grid ${gridSecs.toFixed(0)} s sigma ${sigma.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const champ = { gen, phase: speedPhase ? 'speed' : 'growth', nIn: N_IN, track: trackId, car: carId, distance: r.best[bestI], lapTime: r.lapT[bestI], laps: r.laps[bestI], fitness: r.fitness[bestI], weights: Array.from(pop[bestI]) };
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
  writeFileSync(join(runDir, 'pop.json'), JSON.stringify({ gen, speedPhase, refLap, topLaps, sigma, pop: pop.map((g) => Array.from(g)) }));
  gen++;
}
console.log(`finished ${GENS} generations`);
process.exit(0);
