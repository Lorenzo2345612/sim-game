// Neuroevolution trainer with a live viewer at http://127.0.0.1:8770
// npx tsx scripts/evolve/evolve.mts [--track monza] [--car f4] [--pop 100] [--workers 10] [--secs 60] [--laps 10] [--gens 1000] [--line center|racing|mintime] [--resume path] [--racecraft [--opponents 6]]
// Grid episode grows with progress up to --laps laps; random-start episodes last --secs.
import { Worker } from 'node:worker_threads';
import { createServer, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrackData } from '../../src/track/parseTrackData';
import { halfWidthAt } from '../../src/track/surfaces';
import { parseCarSpec } from '../../src/physics/carSpec';
import { minTimeFor } from './mintime.mts';
import { N_W, N_IN, randomGenome, gauss, mulberry32 } from './policy.mts';
import { N_SET, joinGenome, splitGenome } from './genome.mts';
import { pickOpponents } from './racecraft.mts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const trackId = arg('track', 'monza'), carId = arg('car', 'f4');
const POP = Number(arg('pop', '100')), W = Number(arg('workers', '10')), SECS = Number(arg('secs', '60'));
const MAX_LAPS = Number(arg('laps', '10')), GENS = Number(arg('gens', '1000'));
const LINE = (['racing', 'mintime'] as const).find((l) => l === arg('line', 'center')) ?? 'center'; // look-ahead targets + speed profile source
const SPEED_AT = Number(arg('speed-at', '4')); // mean grid distance (laps, 5-gen average) that switches fitness to speed
const SPEED_LAPS = Number(arg('speed-laps', String(MAX_LAPS))); // shorter races in the speed phase = more selections per hour
const EVALS = Number(arg('evals', '1')); // independent evaluations per generation (fresh conditions), fitness summed
const MUT = { growth: 0.3, speed: Number(arg('speed-mut', '0.3')) }; // fraction of weights mutated per child
const RACE = { growth: { laps: MAX_LAPS, speedW: 30, overW: 2, lapW: 20 }, speed: { laps: SPEED_LAPS, speedW: 120, overW: 0, lapW: 100 } };
const tag = `${trackId}-${carId}${LINE === 'center' ? '' : `-${LINE}`}`;
const modelDir = join(here, 'models', arg('model-dir', tag)); // e.g. scratch/<tag> keeps a fork out of export-models
const PORT = Number(arg('port', '8770'));
const RESIDUAL = process.argv.includes('--residual'); // classic AiDriver drives, the net sets offset + pace
const RACECRAFT = process.argv.includes('--racecraft'), OPP = RACECRAFT ? Number(arg('opponents', '6')) : 0; // pack starts, frozen hall-of-fame opponents, racecraft fitness
const ELITE = Math.max(2, Math.round(POP * 0.05)), PARENTS = Math.max(4, Math.round(POP * 0.2));
const rand = mulberry32(Date.now() & 0xffffffff);
const runDir = join(here, 'runs', `${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(runDir, { recursive: true });

// Track outline for the viewer
const track: any = parseTrackData(JSON.parse(readFileSync(join(root, `public/tracks/${trackId}.json`), 'utf8')));
if (LINE === 'mintime') { // build the cached line once before the workers read it
  const ps: any = parseCarSpec(JSON.parse(readFileSync(join(root, `public/cars/${carId}.json`), 'utf8')));
  const t0 = Date.now(), mt = await minTimeFor(root, track, ps.spec ?? ps, carId);
  console.log(`mintime line: QSS racing ${mt.tRacing.toFixed(2)} s -> mintime ${mt.tMin.toFixed(2)} s, max offset/limit ${mt.maxRatio.toFixed(3)} (${Date.now() - t0} ms)`);
}
const carSpec: any = (() => { const ps: any = parseCarSpec(JSON.parse(readFileSync(join(root, `public/cars/${carId}.json`), 'utf8'))); return ps.spec ?? ps; })();
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
const bases = seeds.map((g) => { try { return g.weights.length === N_W + N_SET ? Float64Array.from(g.weights) : joinGenome(g.weights); } catch { return null; } }).filter((b): b is Float64Array => !!b);
if (bases.length) {
  pop.push(...bases.slice(0, POP));
  gen = snap ? snap.gen + 1 : Math.max(...seeds.map((g) => g.gen ?? -1)) + 1;
  for (let i = 0; pop.length < POP; i++) pop.push(mutate(bases[i % bases.length], 0.1));
  console.log(`seeded from ${bases.length} genome(s), ${seeds[0].weights.length} -> ${N_W + N_SET} genes`);
} else if (resume) console.log('resume skipped: no usable genome');
if (!pop.length) for (let i = 0; i < POP; i++) {
  const w = randomGenome(rand);
  if (RESIDUAL) { for (let j = 0; j < N_W; j++) w[j] *= 0.1; w[N_W - 1] = 0; } // start close to the classic driver
  pop.push(joinGenome(w));
}

function mutate(g: Float64Array, sigma: number, frac = 0.3): Float64Array {
  const c = Float64Array.from(g);
  for (let i = 0; i < N_W + N_SET; i++) if (rand() < frac) c[i] += (i >= N_W ? 3 : 1) * sigma * gauss(rand);
  return c;
}
function cross(a: Float64Array, b: Float64Array): Float64Array {
  const c = new Float64Array(N_W + N_SET);
  for (let i = 0; i < N_W + N_SET; i++) c[i] = rand() < 0.5 ? a[i] : b[i];
  return c;
}

// Viewer state + SSE
let eliteSlots: number[] = [];
const clients = new Set<ServerResponse>();
const history: any[] = []; // per-generation stats for the viewer, persisted to runDir/history.json
let bestGen = -1;
let sigma = 0.25, lapLength = 0, allTimeBest = 0, simT = 0;
const per = Math.ceil(POP / W);
const positions = new Float32Array(POP * 4);
const send = (ev: string, data: unknown) => { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };
createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(res);
    res.write(`event: init\ndata: ${JSON.stringify({ left, right, trackId: LINE === 'racing' ? `${trackId} (trazada ideal)` : LINE === 'mintime' ? `${trackId} (tiempo mínimo)` : trackId, carId, pop: POP, elite: ELITE, history, models: hof })}\n\n`);
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
  const wk = new Worker(join(here, 'worker.mts'), { execArgv: ['--import', 'tsx'], workerData: { root, trackId, carId, slots: per + OPP, line: LINE, racecraft: RACECRAFT, residual: RESIDUAL } });
  wk.on('message', (m: any) => {
    if (m.type === 'ready') { lapLength = m.lapLength; ok(); }
    if (m.type === 'pos') { positions.set(m.pos, w * per * 4); if (w === 0) simT = m.t; }
  });
  wk.on('error', (e) => { console.error('worker', w, e); process.exit(1); });
  workers.push(wk);
})));
console.log(`${W} workers ready, pop ${POP}, ${N_W} weights + ${N_SET} setup genes, lap ${lapLength.toFixed(0)} m, line ${LINE}${RACECRAFT ? `, racecraft (${OPP} opponents per world)` : ''}`);

const oppCache = new Map<string, { weights: number[]; setup?: unknown }>();
function opponents(): { weights: number[]; setup?: unknown }[] { // frozen hall-of-fame models within 3 s of the fastest
  if (!OPP) return [];
  const all = Object.values(hof) as any[];
  if (!all.length) return RESIDUAL ? Array.from({ length: OPP }, () => ({ weights: new Array(N_W).fill(0) })) : []; // plain classic drivers
  const bestAvg = Math.min(...all.map((m) => m.avgLap));
  return pickOpponents(all, bestAvg, OPP, rand).map((m) => {
    if (!oppCache.has(m.file)) { const j = JSON.parse(readFileSync(join(modelDir, m.file), 'utf8')); oppCache.set(m.file, { weights: j.weights, setup: j.setup }); }
    return oppCache.get(m.file)!;
  });
}
const KEYS = ['fitness', 'best', 'lapT', 'laps', 'finishT', 'invalidLaps', 'passes', 'lost', 'faults', 'crashFaults'] as const;
type EvalR = Record<(typeof KEYS)[number], number[]>;
let perm: number[] = []; // slot -> pop index (genomes shuffled across worlds every generation)
function evalAll(): Promise<EvalR> {
  perm = pop.map((_, i) => i);
  for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  eliteSlots = perm.map((p, slot) => (p < ELITE ? slot : -1)).filter((x) => x >= 0);
  const shuffled = perm.map((i) => pop[i]);
  return Promise.all(workers.map((wk, w) => new Promise<any>((ok) => {
    const batch = shuffled.slice(w * per, (w + 1) * per);
    const h = (m: any) => { if (m.type === 'done') { wk.off('message', h); ok(m); } };
    wk.on('message', h);
    wk.postMessage({ type: 'eval', episodes, race: speedPhase ? RACE.speed : RACE.growth, genomes: batch.map((g) => Array.from(g)), opponents: opponents() });
  }))).then((rs) => {
    const un = (a: number[]) => { const o = new Array(POP).fill(0); perm.forEach((p, slot) => { o[p] = a[slot] ?? 0; }); return o; };
    return Object.fromEntries(KEYS.map((k) => [k, un(rs.flatMap((r) => r[k] ?? []))])) as EvalR;
  });
}

let episodes: { start: number; secs: number }[] = [];
let gridSecs = Math.max(150, lapLength / 20), refLap = 0, topLaps = 0; // first grid episode fits ~1.5 laps at early pace
let speedPhase = seeds.some((g) => g.phase === 'speed') || !!snap?.speedPhase;
if (snap) ({ refLap, topLaps, sigma } = snap);
if (snap) { const hf = join(dirname(resume), 'history.json'); if (existsSync(hf)) history.push(...JSON.parse(readFileSync(hf, 'utf8'))); }
const meanLaps: number[] = [];
mkdirSync(modelDir, { recursive: true });
const hof: Record<string, any> = existsSync(join(modelDir, 'index.json')) ? JSON.parse(readFileSync(join(modelDir, 'index.json'), 'utf8')).models ?? {} : {};
// Hall of fame: first genome to finish the full race in each 1 s bucket of average lap; difficulty = pace relative to the fastest.
function saveModel(i: number, finish: number) {
  const RL = raceLaps(), avg = finish / RL, key = String(Math.floor(avg));
  if (hof[key] && (hof[key].rc || !RACECRAFT)) return; // racecraft models replace plain ones in their bucket
  const sp = splitGenome(pop[i], carSpec);
  const file = `race-${key}s-gen${gen}.json`;
  writeFileSync(join(modelDir, file), JSON.stringify({ gen, nIn: N_IN, line: LINE, track: trackId, car: carId, raceLaps: RL, raceTime: finish, avgLap: avg, bestLap: lastR.lapT[i], ...(RESIDUAL ? { residual: true } : {}), weights: Array.from(sp.weights), setup: sp.setup }));
  hof[key] = { file, avgLap: avg, gen, ...(RACECRAFT ? { rc: true } : {}) };
  const all = Object.values(hof).sort((a: any, b: any) => a.avgLap - b.avgLap) as any[];
  const pick = (f: number) => all.reduce((b, m) => (Math.abs(m.avgLap - all[0].avgLap * f) < Math.abs(b.avgLap - all[0].avgLap * f) ? m : b)).file;
  const difficulties = { expert: all[0].file, hard: pick(1.03), medium: pick(1.07), easy: pick(1.12) };
  writeFileSync(join(modelDir, 'index.json'), JSON.stringify({ track: trackId, car: carId, line: LINE, difficulties, models: hof }, null, 1));
  send('models', hof);
  console.log(`model saved ${file} (avg lap ${avg.toFixed(2)} s)`);
}
let lastR: any = null;
const raceLaps = () => (speedPhase ? SPEED_LAPS : MAX_LAPS);
// EVALS > 1: fitness summed, distance averaged, fastest lap kept, race time/laps only when every run finished (worst case)
async function evalN() {
  let acc: EvalR | null = null;
  for (let e = 0; e < EVALS; e++) {
    const r = await evalAll();
    if (!acc) { acc = r; continue; }
    for (let i = 0; i < POP; i++) {
      acc.fitness[i] += r.fitness[i]; acc.best[i] = (acc.best[i] * e + r.best[i]) / (e + 1);
      acc.lapT[i] = acc.lapT[i] > 0 && r.lapT[i] > 0 ? Math.min(acc.lapT[i], r.lapT[i]) : 0;
      acc.laps[i] = Math.min(acc.laps[i], r.laps[i]);
      acc.invalidLaps[i] += r.invalidLaps[i];
      for (const k of ['passes', 'lost', 'faults', 'crashFaults'] as const) acc[k][i] += r[k][i];
      acc.finishT[i] = acc.finishT[i] > 0 && r.finishT[i] > 0 ? Math.max(acc.finishT[i], r.finishT[i]) : 0;
    }
  }
  return acc!;
}
for (; gen < GENS; ) {
  const t0 = Date.now();
  // grid episode: room for two more laps than the best managed (capped at MAX_LAPS), plus 2 short random starts
  if (refLap) gridSecs = topLaps >= raceLaps() ? raceLaps() * refLap * 1.25 : Math.min(raceLaps() * refLap * 1.1, (Math.ceil(topLaps) + 2) * refLap * 1.15);
  episodes = [{ start: RACECRAFT ? 1 + Math.floor(rand() * (lapLength - 1)) : 0, secs: gridSecs }, { start: Math.floor(rand() * lapLength), secs: SECS }, { start: Math.floor(rand() * lapLength), secs: SECS }];
  const r = await evalN();
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
  const finishers = r.finishT.map((t, i) => [t, i]).filter(([t, i]) => t > 0 && r.invalidLaps[i] === 0 && r.faults[i] === 0 && r.crashFaults[i] === 0).sort((a, b) => a[0] - b[0]);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const rcLine = RACECRAFT ? ` passes ${sum(r.passes)} faults ${sum(r.faults)} crash ${sum(r.crashFaults)} champ ${r.passes[bestI]}/${r.faults[bestI]}` : '';
  if (finishers.length) saveModel(finishers[0][1], finishers[0][0]);
  const anyFin = r.finishT.map((t, i) => [t, i]).filter(([t]) => t > 0).sort((a, b) => a[0] - b[0]);
  const sortedLaps = [...laps].sort((a, b) => a - b);
  if (r.fitness[bestI] >= allTimeBest) bestGen = gen;
  history.push({
    gen, best: r.best[bestI], mean, bestLap, laps: topLaps, medLap: sortedLaps.length ? sortedLaps[sortedLaps.length >> 1] : 0,
    carsWithLap: laps.length, lapsDone: sum(r.laps), raceLaps: raceLaps(), finished: finishers.length, finishedAny: anyFin.length,
    raceAvg: finishers.length ? finishers[0][0] / raceLaps() : 0, raceAvgAny: anyFin.length ? anyFin[0][0] / raceLaps() : 0,
    passes: sum(r.passes), faults: sum(r.faults), crash: sum(r.crashFaults),
    champ: { passes: r.passes[bestI], faults: r.faults[bestI], crash: r.crashFaults[bestI], laps: r.laps[bestI], lap: r.lapT[bestI] },
    sigma, secs: (Date.now() - t0) / 1000, speed: speedPhase, bestGen,
  });
  console.log(`gen ${gen} best ${r.best[bestI].toFixed(0)} m mean ${mean.toFixed(0)} m laps ${laps.length} topLaps ${topLaps}${bestLap ? ` bestLap ${bestLap.toFixed(2)} s` : ''} finished ${finishers.length}${finishers.length ? ` raceT ${finishers[0][0].toFixed(0)} s` : ''}${speedPhase ? ' SPEED' : ''} grid ${gridSecs.toFixed(0)} s${rcLine} sigma ${sigma.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const champ = { gen, phase: speedPhase ? 'speed' : 'growth', nIn: N_IN, line: LINE, track: trackId, car: carId, distance: r.best[bestI], lapTime: r.lapT[bestI], laps: r.laps[bestI], fitness: r.fitness[bestI], weights: Array.from(pop[bestI]) };
  writeFileSync(join(runDir, `gen-${String(gen).padStart(4, '0')}.json`), JSON.stringify(champ));
  if (r.fitness[bestI] >= allTimeBest) { allTimeBest = r.fitness[bestI]; writeFileSync(join(runDir, 'best.json'), JSON.stringify(champ)); }
  writeFileSync(join(runDir, 'history.json'), JSON.stringify(history));
  send('gen', history[history.length - 1]);
  // Next generation: elites unchanged (drawn first, gold in the viewer), rest from top parents
  const next: Float64Array[] = order.slice(0, ELITE).map((i) => pop[i]);
  while (next.length < POP) {
    const a = pop[order[Math.floor(rand() * PARENTS)]], b = pop[order[Math.floor(rand() * PARENTS)]];
    next.push(mutate(rand() < 0.5 ? cross(a, b) : a, sigma, speedPhase ? MUT.speed : MUT.growth));
  }
  pop = next;
  sigma = Math.max(0.06, sigma * 0.985);
  writeFileSync(join(runDir, 'pop.json'), JSON.stringify({ gen, line: LINE, speedPhase, refLap, topLaps, sigma, pop: pop.map((g) => Array.from(g)) }));
  gen++;
}
console.log(`finished ${GENS} generations`);
process.exit(0);
