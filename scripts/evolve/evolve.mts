// Neuroevolution trainer with a live viewer at http://127.0.0.1:8770
// npx tsx scripts/evolve/evolve.mts [--track monza] [--car f4] [--pop 100] [--workers 10] [--secs 60] [--laps 10] [--gens 1000] [--line center|racing|mintime] [--resume path] [--racecraft [--opponents 6]] [--seed N] [--chunk N] [--fault-split] [--league K]
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
import { N_SET, N_G, N_X, joinGenome, fullGenome, splitGenome } from './genome.mts';
import { pickOpponents } from './racecraft.mts';
import { rankSumFitness } from './rank.mts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const TRACKS = arg('tracks', '').split(',').map((t) => t.trim()).filter(Boolean); // multi-track training: every genome races every track, fitness = summed centred ranks
const trackId = TRACKS[0] ?? arg('track', 'monza'), carId = arg('car', 'f4');
if (!TRACKS.length) TRACKS.push(trackId);
const MULTI = TRACKS.length > 1, NT = TRACKS.length;
const VIEW = Math.max(0, TRACKS.indexOf(arg('view-track', trackId))); // the viewer shows this track only
const POP = Number(arg('pop', '100')), W = Number(arg('workers', '10')), SECS = Number(arg('secs', '60'));
const MAX_LAPS = Number(arg('laps', '10')), GENS = Number(arg('gens', '1000'));
const LINE = (['racing', 'mintime'] as const).find((l) => l === arg('line', 'center')) ?? 'center'; // look-ahead targets + speed profile source
const SPEED_AT = Number(arg('speed-at', '4')); // mean grid distance (laps, 5-gen average) that switches fitness to speed
const SPEED_LAPS = Number(arg('speed-laps', String(MAX_LAPS))); // shorter races in the speed phase = more selections per hour
const EVALS = Number(arg('evals', '1')), FIX_COMPOUND = process.argv.includes('--fix-compound'); // independent evaluations per generation (fresh conditions), fitness summed
const MUT = { growth: 0.3, speed: Number(arg('speed-mut', '0.3')) }; // fraction of weights mutated per child
const RACE = { growth: { laps: MAX_LAPS, speedW: 30, overW: 2, lapW: 20 }, speed: { laps: SPEED_LAPS, speedW: 120, overW: 0, lapW: 100 } };
const tag = `${MULTI ? `multi${NT}` : trackId}-${carId}${LINE === 'center' ? '' : `-${LINE}`}`;
const modelDir = join(here, 'models', arg('model-dir', tag)); // e.g. scratch/<tag> keeps a fork out of export-models
const PORT = Number(arg('port', '8770'));
const RESIDUAL = process.argv.includes('--residual'); // classic AiDriver drives, the net sets offset + pace
const MAX_FAULTS = Number(arg('max-faults', '5')); // light at-fault touches allowed per race for a saved model (no caused crashes)
const RES = { offset: Number(arg('res-offset', '3.5')), up: Number(arg('res-up', '0.06')), down: Number(arg('res-down', '0.06')) }; // residual authority: lateral offset (m), pace above/below the classic profile
const RCW = { pos: Number(arg('pos-w', '60')), pass: Number(arg('pass-w', '40')), def: Number(arg('def-w', '0')), yellow: Number(arg('yellow-w', '0')), incident: Number(arg('incident-w', '0')) }; // racecraft weights: net passes, defended attacks, passes under yellow
const RACECRAFT = process.argv.includes('--racecraft'), OPP = RACECRAFT ? Number(arg('opponents', '6')) : 0; // pack starts, frozen hall-of-fame opponents, racecraft fitness
const ELITE = Math.max(2, Math.round(POP * 0.05)), PARENTS = Math.max(4, Math.round(POP * 0.2));
const SEED = arg('seed', ''); // --seed N: deterministic run (trainer rng + per-batch worker rng); default time-seeded
const rand = mulberry32(SEED ? Number(SEED) >>> 0 : Date.now() & 0xffffffff);
const FAULT_SPLIT = process.argv.includes('--fault-split'); // racecraft: at-fault car takes the full contact/incident penalty, the victim <= 20 %
const LEAGUE = Number(arg('league', '0')), LEAGUE_EVERY = 25; // --league K: opponents also drawn from the current elite and the last K best-genome snapshots (one per 25 gens)
const runDir = join(here, 'runs', `${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(runDir, { recursive: true });

// Track outline for the viewer (the --view-track track); every track's min-time line is built/cached once before the workers read it.
const trackData: any[] = TRACKS.map((id) => parseTrackData(JSON.parse(readFileSync(join(root, `public/tracks/${id}.json`), 'utf8'))));
const track: any = trackData[VIEW];
const refTime: number[] = new Array(NT).fill(0); // per-track reference lap (min-time line QSS lap) normalising lap stats across tracks
if (LINE === 'mintime') {
  const ps: any = parseCarSpec(JSON.parse(readFileSync(join(root, `public/cars/${carId}.json`), 'utf8')));
  for (let t = 0; t < NT; t++) {
    const t0 = Date.now(), mt = await minTimeFor(root, trackData[t], ps.spec ?? ps, carId);
    refTime[t] = mt.tMin;
    console.log(`mintime line ${TRACKS[t]}: QSS racing ${mt.tRacing.toFixed(2)} s -> mintime ${mt.tMin.toFixed(2)} s, max offset/limit ${mt.maxRatio.toFixed(3)} (${Date.now() - t0} ms)`);
  }
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
const initRand = mulberry32(0x6e657432); // seeded: expanding v1 seeds gives new hidden units small random inputs (outputs stay 0)
const initNew = () => 0.3 * gauss(initRand);
const bases = seeds.map((g) => { try { return fullGenome(g.weights, g.extra, initNew); } catch { return null; } }).filter((b): b is Float64Array => !!b);
if (bases.length) {
  pop.push(...bases.slice(0, POP));
  gen = snap ? snap.gen + 1 : Math.max(...seeds.map((g) => g.gen ?? -1)) + 1;
  for (let i = 0; pop.length < POP; i++) pop.push(mutate(bases[i % bases.length], 0.1));
  console.log(`seeded from ${bases.length} genome(s), ${seeds[0].weights.length} -> ${N_G} genes`);
} else if (resume) console.log('resume skipped: no usable genome');
if (!pop.length) for (let i = 0; i < POP; i++) {
  const w = randomGenome(rand);
  if (RESIDUAL) { for (let j = 0; j < N_W; j++) w[j] *= 0.1; w[N_W - 1] = 0; } // start close to the classic driver
  pop.push(fullGenome(joinGenome(w)));
}

function mutate(g: Float64Array, sigma: number, frac = 0.3): Float64Array {
  const c = Float64Array.from(g);
  for (let i = 0; i < (RESIDUAL ? N_G : N_W + N_SET); i++) if (rand() < frac) c[i] += (i >= N_W && i < N_W + N_SET ? 3 : 1) * sigma * gauss(rand);
  return c;
}
function cross(a: Float64Array, b: Float64Array): Float64Array {
  const c = new Float64Array(N_G);
  for (let i = 0; i < N_G; i++) c[i] = rand() < 0.5 ? a[i] : b[i];
  return c;
}

// Viewer state + SSE
let eliteSlots: number[] = [];
const clients = new Set<ServerResponse>();
const history: any[] = []; // per-generation stats for the viewer, persisted to runDir/history.json
let bestGen = -1;
let sigma = Number(arg('sigma', '0.25')), lapLengths: number[] = new Array(NT).fill(0), allTimeBest = 0, simT = 0;
// Stagnation kick: no better race avg lap for KICK_AFTER speed-phase gens -> sigma back to KICK_SIGMA.
const KICK_AFTER = Number(arg('kick-after', '0')), KICK_SIGMA = Number(arg('kick-sigma', '0.2'));
let bestAvg = Infinity, lastImprove = -1;
const trackWorkers = Array.from({ length: NT }, (_, t) => Math.max(1, Math.floor(W / NT) + (t < W % NT ? 1 : 0))); // workers per track
const per = trackWorkers.map((n) => Math.ceil(POP / n)); // genomes per worker, per track
const CHUNK = per.map((p) => Math.max(1, Math.min(POP, Number(arg('chunk', String(p)))))); // genomes per world; --chunk < pop/workers gives more tasks than workers (dynamic queue)
const NCH = CHUNK.map((c) => Math.ceil(POP / c));
const positions = new Float32Array(POP * 4);
const send = (ev: string, data: unknown) => { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };
createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(res);
    res.write(`event: init\ndata: ${JSON.stringify({ left, right, trackId: LINE === 'racing' ? `${TRACKS[VIEW]} (trazada ideal)` : LINE === 'mintime' ? `${TRACKS[VIEW]} (tiempo mínimo)` : TRACKS[VIEW], carId, pop: POP, elite: ELITE, history, models: hof })}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(join(here, req.url?.startsWith('/multi') ? 'multi.html' : 'viewer.html')));
}).listen(PORT, '127.0.0.1', () => console.log(`viewer: http://127.0.0.1:${PORT}  run: ${runDir}`));
setInterval(() => send('pos', { gen, t: simT, e: eliteSlots, p: Array.from(positions, (v) => Math.round(v * 10) / 10) }), 66);

// Workers: one pool per track, every worker loads its own track (physics world, line, limits)
const workers: Worker[][] = TRACKS.map(() => []);
const curChunk: number[][] = TRACKS.map((_, t) => new Array(trackWorkers[t]).fill(0)); // chunk each worker is evaluating (viewer slot offset)
await Promise.all(TRACKS.flatMap((tid, t) => Array.from({ length: trackWorkers[t] }, (_, w) => new Promise<void>((ok) => {
  const wk = new Worker(join(here, 'worker.mts'), { execArgv: ['--import', 'tsx'], workerData: { root, trackId: tid, carId, slots: CHUNK[t] + OPP, faultSplit: FAULT_SPLIT, seeded: !!SEED, line: LINE, racecraft: RACECRAFT, residual: RESIDUAL, res: RES, rcw: RCW, oppFront: Number(arg('opp-front', '0')), lineW: Number(arg('line-w', '0')) } });
  wk.on('message', (m: any) => {
    if (m.type === 'ready') { lapLengths[t] = m.lapLength; ok(); }
    if (m.type === 'pos' && t === VIEW) { const o = (curChunk[t][w] * CHUNK[t]) * 4; if (o + m.pos.length <= positions.length) positions.set(m.pos, o); if (w === 0) simT = m.t; }
  });
  wk.on('error', (e) => { console.error('worker', tid, w, e); process.exit(1); });
  workers[t].push(wk);
}))));
lapLengths.forEach((l, t) => { if (!refTime[t]) refTime[t] = l / 45; });
const lapLength = lapLengths[VIEW];
console.log(`${workers.reduce((a, w) => a + w.length, 0)} workers ready over ${NT} track(s) ${TRACKS.join(',')}, pop ${POP}, ${N_W} weights + ${N_SET} setup genes, lap ${lapLengths.map((l) => l.toFixed(0)).join('/')} m, line ${LINE}${RACECRAFT ? `, racecraft (${OPP} opponents per world)` : ''}`);

const oppCache = new Map<string, { weights: number[]; setup?: unknown; extra?: number[] }>();
type Opp = { weights: number[]; setup?: unknown; extra?: number[] };
const league: Opp[] = []; // last LEAGUE best-genome snapshots
const asOpp = (g: Float64Array): Opp => { const sp = splitGenome(g, carSpec); return { weights: Array.from(sp.weights), setup: sp.setup, extra: Array.from(sp.extra) }; };
function opponents(): Opp[] {
  const base = hofOpponents();
  if (!OPP || !LEAGUE) return base;
  // --league: each slot comes from the hall of fame / classic list, the current elite (pop[0..ELITE-1] are last gen's elites) or a snapshot, equally likely among non-empty groups.
  const elite = pop.slice(0, ELITE);
  return base.map((b) => {
    const groups = [0, 1, ...(league.length ? [2] : [])];
    const g = groups[Math.floor(rand() * groups.length)];
    return g === 0 ? b : g === 1 ? asOpp(elite[Math.floor(rand() * elite.length)]) : league[Math.floor(rand() * league.length)];
  });
}
function hofOpponents(): Opp[] { // frozen hall-of-fame models within 3 s of the fastest
  if (!OPP) return [];
  const maxFin = Math.max(0, ...Object.values(hof).map((m: any) => m.nFin ?? NT));
  const all = (Object.values(hof) as any[]).filter((m) => (m.nFin ?? NT) === maxFin);
  if (!all.length) return RESIDUAL ? Array.from({ length: OPP }, () => ({ weights: new Array(N_W).fill(0) })) : []; // plain classic drivers
  const bestAvg = Math.min(...all.map((m) => m.avgLap));
  return pickOpponents(all, bestAvg, OPP, rand).map((m) => {
    if (!oppCache.has(m.file)) { const j = JSON.parse(readFileSync(join(modelDir, m.file), 'utf8')); oppCache.set(m.file, { weights: j.weights, setup: j.setup, extra: j.extra }); }
    return oppCache.get(m.file)!;
  });
}
const KEYS = ['fitness', 'best', 'lapT', 'laps', 'finishT', 'invalidLaps', 'passes', 'lost', 'faults', 'crashFaults', 'defends', 'yellowFaults', 'incidents', 'spins', 'lineShort'] as const;
type EvalR = Record<(typeof KEYS)[number], number[]>;
const COMPOUNDS = ['soft', 'medium', 'hard'] as const;
function evalTrack(t: number, compound?: string): Promise<EvalR> {
  const perm = pop.map((_, i) => i); // slot -> pop index (genomes shuffled across worlds every generation)
  for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  if (t === VIEW) eliteSlots = perm.map((p, slot) => (p < ELITE ? slot : -1)).filter((x) => x >= 0);
  const shuffled = perm.map((i) => pop[i]);
  // Dynamic queue: each worker pulls the next chunk when it finishes one. Chunk contents and opponents are fixed up front
  // (in chunk order), so results do not depend on which worker runs what.
  const chunks = Array.from({ length: NCH[t] }, (_, c) => ({ batch: shuffled.slice(c * CHUNK[t], (c + 1) * CHUNK[t]), opp: opponents() }));
  const results: any[] = new Array(NCH[t]);
  let next = 0;
  const run = (wk: Worker, w: number) => new Promise<void>((ok) => {
    const pull = () => {
      if (next >= NCH[t]) { ok(); return; }
      const c = next++, ch = chunks[c];
      curChunk[t][w] = c;
      const h = (m: any) => { if (m.type === 'done') { wk.off('message', h); results[c] = m; pull(); } };
      wk.on('message', h);
      wk.postMessage({ type: 'eval', episodes: episodes[t], race: speedPhase ? RACE.speed : RACE.growth, genomes: ch.batch.map((g) => Array.from(g)), opponents: ch.opp, compound });
    };
    pull();
  });
  return Promise.all(workers[t].map(run)).then(() => {
    const un = (a: number[]) => { const o = new Array(POP).fill(0); perm.forEach((p, slot) => { o[p] = a[slot] ?? 0; }); return o; };
    const rs = results;
    return Object.fromEntries(KEYS.map((k) => [k, un(rs.flatMap((r) => r[k] ?? []))])) as EvalR;
  });
}

let episodes: { start: number; secs: number }[][] = [];
const gridSecsT = lapLengths.map((l) => Math.max(150, l / 20)), refLapT: number[] = new Array(NT).fill(0), topLapT: number[] = new Array(NT).fill(0); // per track; first grid episode fits ~1.5 laps at early pace // first grid episode fits ~1.5 laps at early pace
let speedPhase = seeds.some((g) => g.phase === 'speed') || !!snap?.speedPhase;
if (MULTI) refLapT.forEach((_, t) => { refLapT[t] = refTime[t] * 1.3; }); // tracks where the seed laps slowly or never still get a grid episode sized from the reference lap
if (snap) { sigma = snap.sigma; refLapT[0] = snap.refLap ?? 0; topLapT[0] = snap.topLaps ?? 0; if (snap.refLaps) snap.refLaps.forEach((v: number, t: number) => { if (t < NT) { refLapT[t] = v; topLapT[t] = snap.topLapsT[t]; } }); }
if (snap) { const hf = join(dirname(resume), 'history.json'); if (existsSync(hf)) history.push(...JSON.parse(readFileSync(hf, 'utf8'))); }
const meanLaps: number[] = [];
mkdirSync(modelDir, { recursive: true });
const hof: Record<string, any> = existsSync(join(modelDir, 'index.json')) ? JSON.parse(readFileSync(join(modelDir, 'index.json'), 'utf8')).models ?? {} : {};
// Hall of fame: first genome to finish the full race in each 1 s bucket of average lap; difficulty = pace relative to the fastest.
function saveModel(i: number, finish: number) {
  const RL = raceLaps(), avg = finish / RL, nFin = lastR.nFin?.[i] ?? NT; // MULTI: avg = mean % of each finished track's reference lap
  const key = `${nFin < NT ? `p${nFin}-` : ''}${Math.floor(avg)}`;
  if (hof[key] && (hof[key].rc || !RACECRAFT)) return; // racecraft models replace plain ones in their bucket
  const sp = splitGenome(pop[i], carSpec);
  const file = `race-${key}s-gen${gen}.json`;
  const trackStats = MULTI ? TRACKS.map((id, t) => ({ id, ref: refTime[t], bestLap: lastR.rt[t].lapT[i], avgLap: lastR.rt[t].finishT[i] / RL })) : null;
  writeFileSync(join(modelDir, file), JSON.stringify({ gen, net: 2, nIn: N_IN, line: LINE, track: trackId, car: carId, raceLaps: RL, raceTime: finish, avgLap: avg, bestLap: lastR.lapT[i], ...(MULTI ? { tracks: TRACKS, trackStats, tracksFinished: nFin, scoreUnit: 'pct of reference lap' } : {}), ...(RESIDUAL ? { residual: true, res: RES, nX: N_X, extra: Array.from(sp.extra) } : {}), weights: Array.from(sp.weights), setup: sp.setup }));
  hof[key] = { file, avgLap: avg, gen, nFin, ...(RACECRAFT ? { rc: true } : {}) };
  // a model that misses a track never outranks one that finishes more tracks; difficulties come from the max-tracks group
  const all = (Object.values(hof) as any[]).sort((a, b) => (b.nFin ?? NT) - (a.nFin ?? NT) || a.avgLap - b.avgLap).filter((m, _, arr) => (m.nFin ?? NT) === (arr[0].nFin ?? NT));
  const pick = (f: number) => all.reduce((b, m) => (Math.abs(m.avgLap - all[0].avgLap * f) < Math.abs(b.avgLap - all[0].avgLap * f) ? m : b)).file;
  const difficulties = { expert: all[0].file, hard: pick(1.03), medium: pick(1.07), easy: pick(1.12) };
  writeFileSync(join(modelDir, 'index.json'), JSON.stringify({ track: trackId, ...(MULTI ? { tracks: TRACKS } : {}), car: carId, line: LINE, difficulties, models: hof }, null, 1));
  send('models', hof);
  console.log(`model saved ${file} (${MULTI ? `${nFin}/${NT} tracks, ${avg.toFixed(2)} % of ref` : `avg lap ${avg.toFixed(2)} s`})`);
}
let lastR: any = null;
const raceLaps = () => (speedPhase ? SPEED_LAPS : MAX_LAPS);
// EVALS > 1: fitness summed, distance averaged, fastest lap kept, race time/laps only when every run finished (worst case)
async function evalTrackN(t: number): Promise<EvalR> {
  let acc: EvalR | null = null;
  const c0 = Math.floor(rand() * 3);
  for (let e = 0; e < EVALS; e++) {
    const r = await evalTrack(t, FIX_COMPOUND ? COMPOUNDS[(c0 + e) % 3] : undefined); // --fix-compound: whole population on one compound per eval
    if (!acc) { acc = r; continue; }
    for (let i = 0; i < POP; i++) {
      acc.fitness[i] += r.fitness[i]; acc.best[i] = (acc.best[i] * e + r.best[i]) / (e + 1);
      acc.lapT[i] = acc.lapT[i] > 0 && r.lapT[i] > 0 ? Math.min(acc.lapT[i], r.lapT[i]) : 0;
      acc.laps[i] = Math.min(acc.laps[i], r.laps[i]);
      acc.invalidLaps[i] += r.invalidLaps[i];
      for (const k of ['passes', 'lost', 'faults', 'crashFaults', 'defends', 'yellowFaults', 'incidents', 'spins', 'lineShort'] as const) acc[k][i] += r[k][i];
      acc.finishT[i] = acc.finishT[i] > 0 && r.finishT[i] > 0 ? Math.max(acc.finishT[i], r.finishT[i]) : 0;
    }
  }
  return acc!;
}
// Multi-track: fitness = sum of per-track centred ranks (selection only). Lap/race scores are the mean % of each track's
// reference lap over the tracks the car completed (nLap/nFin count them; ranking puts more tracks first). Counters are summed.
type Merged = EvalR & { rt: EvalR[]; nLap?: number[]; nFin?: number[] };
function mergeTracks(rt: EvalR[]): Merged {
  if (NT === 1) return Object.assign(rt[0], { rt });
  const m: any = { rt }, RL = raceLaps();
  const zeros = () => new Array(POP).fill(0);
  m.fitness = rankSumFitness(rt.map((r) => r.fitness));
  m.best = zeros(); m.laps = zeros(); m.lapT = zeros(); m.finishT = zeros(); m.nLap = zeros(); m.nFin = zeros();
  for (let i = 0; i < POP; i++) {
    let lp = 0, fn = 0;
    rt.forEach((r, t) => {
      m.best[i] += (r.best[i] / lapLengths[t]) * lapLengths[VIEW] / NT;
      m.laps[i] += r.laps[i] / NT;
      if (r.lapT[i] > 0) { lp += r.lapT[i] / refTime[t]; m.nLap[i]++; }
      if (r.finishT[i] > 0) { fn += r.finishT[i] / RL / refTime[t]; m.nFin[i]++; }
    });
    m.lapT[i] = m.nLap[i] ? (100 * lp) / m.nLap[i] : 0; // % of the reference lap
    m.finishT[i] = m.nFin[i] ? (100 * fn * RL) / m.nFin[i] : 0; // race time whose per-lap average is the % score
  }
  for (const k of KEYS) if (!(k in m)) m[k] = rt.reduce((a, r) => a.map((v, i) => v + r[k][i]), zeros());
  return m;
}
async function evalN() { return mergeTracks(await Promise.all(TRACKS.map((_, t) => evalTrackN(t)))); }
// Rank key (higher is better): more tracks completed first, then lower % of reference. Single track: lap time only.
const lapScore = (r: Merged, i: number) => (r.nLap ? r.nLap[i] * 1000 - r.lapT[i] : 0);
for (; gen < GENS; ) {
  const t0 = Date.now();
  // grid episode: room for two more laps than the best managed (capped at MAX_LAPS), plus 2 short random starts
  episodes = TRACKS.map((_, t) => {
    const refLap = refLapT[t], topLaps = topLapT[t], lapLength = lapLengths[t];
    if (refLap) gridSecsT[t] = topLaps >= raceLaps() ? raceLaps() * refLap * 1.25 : Math.min(raceLaps() * refLap * 1.1, (Math.ceil(topLaps) + 2) * refLap * 1.15);
    return [{ start: RACECRAFT ? 1 + Math.floor(rand() * (lapLength - 1)) : 0, secs: gridSecsT[t] }, { start: Math.floor(rand() * lapLength), secs: SECS }, { start: Math.floor(rand() * lapLength), secs: SECS }];
  });
  const r = await evalN();
  lastR = r;
  const order = r.fitness.map((f, i) => i).sort((a, b) => r.fitness[b] - r.fitness[a]);
  const bestI = order[0];
  const mean = r.best.reduce((a, b) => a + b, 0) / POP;
  const laps = r.lapT.filter((t) => t > 0);
  const bestLap = laps.length ? Math.min(...laps) : 0;
  r.rt.forEach((rr, t) => { // per track: slow decay, one bad generation does not shrink the grid episode
    topLapT[t] = Math.max(...rr.laps, topLapT[t] - 0.5);
    const ls = rr.lapT.filter((v) => v > 0), bl = ls.length ? Math.min(...ls) : 0;
    if (bl) refLapT[t] = refLapT[t] ? Math.max(bl, Math.min(refLapT[t], bl * 1.3)) : bl * 1.3;
  });
  const topLaps = topLapT.reduce((a, b) => a + b, 0) / NT, gridSecs = gridSecsT[VIEW];
  meanLaps.push(mean / lapLength);
  const avg5 = meanLaps.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, meanLaps.length);
  if (!speedPhase && meanLaps.length >= 5 && avg5 >= SPEED_AT) { speedPhase = true; allTimeBest = -Infinity; console.log(`speed phase from gen ${gen + 1} (mean ${avg5.toFixed(1)} laps)`); }
  const finishers = r.finishT.map((t, i) => [t, i]).filter(([t, i]) => t > 0 && r.invalidLaps[i] === 0 && r.faults[i] <= MAX_FAULTS * EVALS * NT && r.crashFaults[i] === 0).sort((a, b) => (r.nFin ? r.nFin[b[1]] - r.nFin[a[1]] : 0) || a[0] - b[0]);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const rcLine = RACECRAFT ? ` passes ${sum(r.passes)} faults ${sum(r.faults)} crash ${sum(r.crashFaults)} def ${sum(r.defends)} yel ${sum(r.yellowFaults)} inc ${sum(r.incidents)} spin ${sum(r.spins)} line ${(sum(r.lineShort) / POP).toFixed(0)} champ ${r.passes[bestI]}/${r.faults[bestI]}` : '';
  if (finishers.length) saveModel(finishers[0][1], finishers[0][0]);
  const anyFin = r.finishT.map((t, i) => [t, i]).filter(([t]) => t > 0).sort((a, b) => a[0] - b[0]);
  const sortedLaps = [...laps].sort((a, b) => a - b);
  const perTrack = TRACKS.map((id, t) => { // per-track lap stats (seconds)
    const rr = r.rt[t], ls = rr.lapT.filter((v) => v > 0).sort((a, b) => a - b);
    return { id, ref: refTime[t], bestLap: ls[0] ?? 0, medLap: ls[ls.length >> 1] ?? 0, champLap: rr.lapT[bestI], champAvg: rr.finishT[bestI] > 0 ? rr.finishT[bestI] / raceLaps() : 0 };
  });
  // best.json / bestGen: single track = fitness champion; multi = most tracks lapped, then lowest mean % of reference (rank-sum fitness is not comparable across gens)
  const bestS = MULTI ? r.fitness.map((_, i) => i).reduce((a, b) => (lapScore(r, b) > lapScore(r, a) ? b : a), 0) : bestI;
  const scoreNow = MULTI ? lapScore(r, bestS) : r.fitness[bestI];
  if (scoreNow >= allTimeBest) bestGen = gen;
  history.push({
    ...(MULTI ? { tracks: perTrack } : {}), gen, best: r.best[bestI], mean, bestLap, laps: topLaps, medLap: sortedLaps.length ? sortedLaps[sortedLaps.length >> 1] : 0,
    carsWithLap: laps.length, lapsDone: sum(r.laps), raceLaps: raceLaps(), finished: finishers.length, finishedAny: anyFin.length,
    raceAvg: finishers.length ? finishers[0][0] / raceLaps() : 0, raceAvgAny: anyFin.length ? anyFin[0][0] / raceLaps() : 0,
    passes: sum(r.passes), faults: sum(r.faults), crash: sum(r.crashFaults),
    champ: { passes: r.passes[bestI], faults: r.faults[bestI], crash: r.crashFaults[bestI], laps: r.laps[bestI], lap: r.lapT[bestI] },
    sigma, secs: (Date.now() - t0) / 1000, speed: speedPhase, bestGen,
  });
  console.log(`gen ${gen} best ${r.best[bestI].toFixed(0)} m mean ${mean.toFixed(0)} m laps ${laps.length} topLaps ${topLaps}${bestLap ? ` bestLap ${bestLap.toFixed(2)} s` : ''} finished ${finishers.length}${finishers.length ? ` raceT ${finishers[0][0].toFixed(0)} s` : ''}${speedPhase ? ' SPEED' : ''} grid ${gridSecs.toFixed(0)} s${rcLine}${MULTI ? ` | ${perTrack.map((q) => `${q.id} best ${q.bestLap.toFixed(1)} med ${q.medLap.toFixed(1)} champ ${q.champLap.toFixed(1)}${q.champAvg ? ` avg ${q.champAvg.toFixed(1)}` : ''}`).join(' | ')} | score ${lapScore(r, bestS).toFixed(1)} (${r.nLap?.[bestS]}/${NT} tracks lapped)` : ''} sigma ${sigma.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (process.env.EVO_FITNESS_LOG) writeFileSync(process.env.EVO_FITNESS_LOG, JSON.stringify(r.fitness) + '\n', { flag: 'a' });
  const champ = { net: 2, gen, phase: speedPhase ? 'speed' : 'growth', nIn: N_IN, line: LINE, track: trackId, car: carId, distance: r.best[bestI], lapTime: r.lapT[bestI], laps: r.laps[bestI], fitness: r.fitness[bestI], weights: Array.from(pop[bestI]) };
  writeFileSync(join(runDir, `gen-${String(gen).padStart(4, '0')}.json`), JSON.stringify(champ));
  if (scoreNow >= allTimeBest) { allTimeBest = scoreNow; writeFileSync(join(runDir, 'best.json'), JSON.stringify(MULTI ? { ...champ, weights: Array.from(pop[bestS]), score: scoreNow, tracksLapped: r.nLap?.[bestS] } : champ)); }
  writeFileSync(join(runDir, 'history.json'), JSON.stringify(history));
  send('gen', history[history.length - 1]);
  // Next generation: elites unchanged (drawn first, gold in the viewer), rest from top parents
  const next: Float64Array[] = order.slice(0, ELITE).map((i) => pop[i]);
  while (next.length < POP) {
    const a = pop[order[Math.floor(rand() * PARENTS)]], b = pop[order[Math.floor(rand() * PARENTS)]];
    next.push(mutate(rand() < 0.5 ? cross(a, b) : a, sigma, speedPhase ? MUT.speed : MUT.growth));
  }
  if (LEAGUE && OPP && gen % LEAGUE_EVERY === 0) {
    league.push(asOpp(pop[bestI])); if (league.length > LEAGUE) league.shift();
    writeFileSync(join(runDir, 'league.json'), JSON.stringify({ gen, snapshots: league }));
    console.log(`league: snapshot of gen ${gen} best (${league.length}/${LEAGUE})`);
  }
  pop = next;
  sigma = Math.max(0.06, sigma * 0.985);
  if (finishers.length && (r.nFin?.[finishers[0][1]] ?? NT) === NT && finishers[0][0] / raceLaps() < bestAvg - 0.2) { bestAvg = finishers[0][0] / raceLaps(); lastImprove = gen; }
  if (lastImprove < 0 && speedPhase) lastImprove = gen;
  if (KICK_AFTER > 0 && speedPhase && gen - lastImprove >= KICK_AFTER) { sigma = KICK_SIGMA; lastImprove = gen; console.log(`kick: sigma ${KICK_SIGMA} (no avg lap gain in ${KICK_AFTER} gens, best ${bestAvg.toFixed(2)} s)`); }
  writeFileSync(join(runDir, 'pop.json'), JSON.stringify({ gen, line: LINE, speedPhase, refLap: refLapT[0], topLaps: topLapT[0], refLaps: refLapT, topLapsT: topLapT, tracks: TRACKS, sigma, pop: pop.map((g) => Array.from(g)) }));
  gen++;
}
console.log(`finished ${GENS} generations`);
process.exit(0);
