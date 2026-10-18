// Evaluates a batch of genomes in one Rapier world (cars do not collide with each other).
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXED_DT } from '../../src/core/constants';
import { parseTrackData } from '../../src/track/parseTrackData';
import { parseCarSpec } from '../../src/physics/carSpec';
import { initPhysics, createPhysicsWorld } from '../../src/physics/physicsWorld';
import { VehicleModel } from '../../src/physics/vehicleModel';
import { configureVehicle } from '../../src/game/game';
import { gridSlots } from '../../src/race/grid';
import { TrackProgress } from '../../src/track/trackProgress';
import { cumulativeLengths } from '../../src/track/centerline';
import { halfWidthAt } from '../../src/track/surfaces';
import { LOOK, PROD, N_IN, N_NEAR, forward } from './policy.mts';

const { root, trackId, carId, slots } = workerData as { root: string; trackId: string; carId: string; slots: number };
const track: any = parseTrackData(JSON.parse(readFileSync(join(root, `public/tracks/${trackId}.json`), 'utf8')));
const parsed: any = parseCarSpec(JSON.parse(readFileSync(join(root, `public/cars/${carId}.json`), 'utf8')));
const spec = parsed.spec ?? parsed;
await initPhysics();
const world: any = createPhysicsWorld(track);
const spawn = gridSlots(track, 1)[0];
const cl: [number, number][] = track.centerline;
const n = cl.length;
const cum = cumulativeLengths(cl, true);
const L = cum[n];

const hwL = new Float64Array(n), hwR = new Float64Array(n);
for (let i = 0; i < n; i++) { hwL[i] = halfWidthAt(track, 'left', i); hwR[i] = halfWidthAt(track, 'right', i); }
// Centerline speed profile (brake cue): corner speed sqrt(MU_G/kappa), backward pass with constant decel.
const MU_G = 1.5 * 9.81, DECEL = 11; // overspeed fitness weight comes with each eval (race.overW)
const vProf = new Float64Array(n);

// Fresh car per episode (VehicleModel.reset keeps fuel, tyre wear/temps and gearbox state).
// Cars collide with each other (traffic). Fuel load, compound and wear rate are randomised per car and episode.
const COMPOUNDS = ['soft', 'medium', 'hard'] as const;

const muMed = spec.tyres.compounds.medium.mu0;
let FUEL_MIN_L = 18; // set after the lap length is known: measured ~0.225 L/km at Monza (F4), sized for 12 laps
const carMu = new Float64Array(slots), carFuel0 = new Float64Array(slots);
function makeCar(pose: any, k: number): VehicleModel {
  const startL = FUEL_MIN_L + Math.random() * (spec.fuel.capacityL - FUEL_MIN_L);
  const v = new VehicleModel(world, { ...spec, fuel: { ...spec.fuel, startL } }, pose);
  configureVehicle(v, track.id);
  const c = COMPOUNDS[Math.floor(Math.random() * 3)];
  v.setCompound(c);
  v.setMultipliers(1 + Math.random() * 4, 1);
  carMu[k] = spec.tyres.compounds[c].mu0 / muMed - 1;
  carFuel0[k] = startL;
  return v;
}
function parkCar(v: VehicleModel): void {
  const body: any = v.body;
  if (body.setEnabled) body.setEnabled(false);
  else body.setTranslation({ x: 0, y: -1000, z: 0 }, false);
}
function dropCar(v: VehicleModel): void {
  for (const col of (v as any).detachCols ?? []) if (col) world.removeCollider(col, true);
  world.removeRigidBody(v.body);
}
const cars: VehicleModel[] = [];
for (let k = 0; k < slots; k++) { cars.push(makeCar(spawn, k)); parkCar(cars[k]); }
const progress = cars.map(() => new TrackProgress(cl));
const state: any[] = cars.map(() => null);
const x = new Float64Array(N_IN), out = new Float64Array(2);
const inputs = cars.map(() => ({ throttle: 0, brake: 0, steer: 0, reset: false }));
const parked = { throttle: 0, brake: 1, steer: 0, reset: false };

function pointAt(s: number, idxHint: number): [number, number, number] {
  s = ((s % L) + L) % L;
  let i = idxHint;
  for (let g = 0; g < n && !(cum[i] <= s && s < cum[i + 1]); g++) i = (i + 1) % n;
  const t = (s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-9);
  const a = cl[i], b = cl[(i + 1) % n];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), i];
}

for (let i = 0; i < n; i++) {
  const a = pointAt(cum[i] - 10, i), b = cl[i], c = pointAt(cum[i] + 10, i);
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const kappa = (2 * cross) / Math.max(ab * bc * ca, 1e-6);
  vProf[i] = Math.min(90, Math.sqrt(MU_G / Math.max(kappa, 1e-5)));
}
for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) {
  const j = (i + 1) % n, ds = cum[i + 1] - cum[i];
  vProf[i] = Math.min(vProf[i], Math.sqrt(vProf[j] * vProf[j] + 2 * DECEL * ds));
}

if (process.env.EVO_DEBUG) { const o: string[] = []; for (let i = 0; i < n; i++) if (cum[i] < 1500 && i % 10 === 0) o.push(`${cum[i].toFixed(0)}:${vProf[i].toFixed(0)}`); console.log('vProf', o.join(' ')); }

function poseAt(s: number, lat = 0) {
  const a = pointAt(s, 0), b = pointAt(s + 2, a[2]);
  const i = a[2] as number;
  const elev = track.elevation?.[i] ?? 0;
  const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
  return { position: { x: a[0] - (tz / l) * lat, y: elev + 0.61, z: a[1] + (tx / l) * lat }, yaw: Math.atan2(-tx, -tz) };
}
const grid = gridSlots(track, slots);
FUEL_MIN_L = Math.min(spec.fuel.capacityL, Math.max(18, (0.25 * L) / 1000 * 12));
// Start poses in random order: grid slots, or a staggered two-abreast pack behind a random point.
function startPoses(start: number): any[] {
  const order = Array.from({ length: slots }, (_, k) => k).sort(() => Math.random() - 0.5);
  return order.map((r) => (start === 0 ? grid[r] : poseAt(start - (r >> 1) * 9, r & 1 ? 2.5 : -2.5)));
}

// Traffic sensor: N_NEAR closest alive cars within 60 m → forward gap/50, lateral gap/10, closing speed/20 (zeros if none).
const nd = new Float64Array(64), ni = new Int32Array(64);
let aliveRef: boolean[] = [];
function nearest(k: number, px: number, pz: number, fx: number, fz: number, vf: number, o: number): void {
  let c = 0;
  for (let j = 0; j < aliveRef.length; j++) {
    if (j === k || !aliveRef[j]) continue;
    const sj = state[j].position, dx = sj.x - px, dz = sj.z - pz, d2 = dx * dx + dz * dz;
    if (d2 > 3600) continue;
    nd[c] = d2; ni[c++] = j;
  }
  for (let a = 0; a < N_NEAR; a++) {
    let bi = -1;
    for (let b = 0; b < c; b++) if (ni[b] >= 0 && (bi < 0 || nd[b] < nd[bi])) bi = b;
    const base = o + 3 * a;
    if (bi < 0) { x[base] = 0; x[base + 1] = 0; x[base + 2] = 0; continue; }
    const j = ni[bi]; ni[bi] = -1;
    const sj = state[j].position, dx = sj.x - px, dz = sj.z - pz;
    const lvj = (cars[j].body as any).linvel();
    x[base] = (dx * fx + dz * fz) / 50;
    x[base + 1] = (dx * -fz + dz * fx) / 10;
    x[base + 2] = (vf - (lvj.x * fx + lvj.z * fz)) / 20;
  }
}

function episode(genomes: Float64Array[], start: number, secs: number, epi: number, raceLaps: number, lapW: number) {
  const poses = startPoses(start);
  const m = genomes.length;
  const alive = new Array(m).fill(true);
  aliveRef = alive;
  const dist = new Float64Array(m), lastS = new Float64Array(m), best = new Float64Array(m), stallT = new Float64Array(m);
  const finishT = new Float64Array(m), lapT = new Float64Array(m).fill(0), laps = new Float64Array(m), lapStart = new Float64Array(m), lapBonus = new Float64Array(m), offT = new Float64Array(m), over = new Float64Array(m);
  for (let k = 0; k < slots; k++) {
    dropCar(cars[k]);
    cars[k] = makeCar(poses[k], k);
    if (k >= m) parkCar(cars[k]);
    progress[k].reset();
    state[k] = cars[k].getState(state[k] ?? undefined);
    const p = progress[k].update(state[k].position.x, state[k].position.z);
    lastS[k] = p.distance;
  }
  const steps = Math.round(secs / FIXED_DT);
  let lastPost = 0;
  const pos = new Float32Array(m * 4);
  for (let step = 0; step < steps; step++) {
    let anyAlive = false;
    for (let k = 0; k < slots; k++) {
      const v = cars[k];
      if (k >= m || !alive[k]) continue;
      anyAlive = true;
      if (step % 4 === 0) {
        const st = state[k], q = st.rotation;
        const fx = -2 * (q.w * q.y + q.x * q.z), fz = -1 + 2 * (q.x * q.x + q.y * q.y);
        const rx = -fz, rz = fx;
        const p = progress[k].update(st.position.x, st.position.z);
        const i = p.index;
        const body: any = v.body;
        const lv = body.linvel(), av = body.angvel();
        const vf = lv.x * fx + lv.z * fz, vr = lv.x * rx + lv.z * rz;
        x[0] = st.forwardSpeed / 60;
        let hint = i;
        for (let j = 0; j < LOOK.length; j++) {
          const pt = pointAt(p.distance + LOOK[j], hint);
          hint = pt[2];
          const dx = pt[0] - st.position.x, dz = pt[1] - st.position.z;
          x[1 + j] = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) / Math.PI;
        }
        let o = 1 + LOOK.length;
        for (const j of PROD) x[o++] = x[0] * Math.abs(x[1 + j]) * 4;
        const v30 = vProf[pointAt(p.distance + 30, i)[2]];
        x[o++] = Math.max(-3, Math.min(3, (st.forwardSpeed - vProf[i]) / 10));
        x[o++] = Math.max(-3, Math.min(3, (st.forwardSpeed - v30) / 10));
        x[o++] = vProf[i] / 60;
        x[o] = (hwR[i] - p.lateral) / 10;
        x[o + 1] = (hwL[i] + p.lateral) / 10;
        x[o + 2] = av.y / 2;
        x[o + 3] = Math.abs(vf) > 2 ? Math.atan2(vr, Math.abs(vf)) : 0;
        x[o + 4] = 1;
        o += 5;
        x[o++] = ((cars[k] as any).tank?.massKg ?? 0) / 25;
        x[o++] = carMu[k] * 10;
        nearest(k, st.position.x, st.position.z, fx, fz, vf, o);
        forward(genomes[k], x, out);
        const inp = inputs[k];
        inp.steer = out[0];
        inp.throttle = out[1] > 0 ? out[1] : 0;
        inp.brake = out[1] < 0 ? -out[1] : 0;
      }
      v.setInput(inputs[k]);
      v.prePhysicsStep(FIXED_DT);
    }
    if (!anyAlive) break;
    world.step();
    const t = (step + 1) * FIXED_DT;
    for (let k = 0; k < m; k++) {
      if (!alive[k]) continue;
      const st = (state[k] = cars[k].getState(state[k]));
      const p = progress[k].update(st.position.x, st.position.z);
      let ds = p.distance - lastS[k];
      if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
      lastS[k] = p.distance;
      dist[k] += ds;
      over[k] += Math.max(0, st.forwardSpeed - vProf[p.index] - 3) * FIXED_DT;
      if (dist[k] >= (laps[k] + 1) * L) { // lap completed: fastest single lap and a bonus per lap (faster = more)
        const lt = t - lapStart[k];
        lapStart[k] = t; laps[k]++;
        if (lapT[k] === 0 || lt < lapT[k]) lapT[k] = lt;
        if (process.env.EVO_DEBUG) console.log(`car ${k} lap ${laps[k]} ${lt.toFixed(1)} s fuel used ${(carFuel0[k] - ((cars[k] as any).tank?.litres ?? 0)).toFixed(2)} L`);
        lapBonus[k] += 500 + Math.max(0, 200 - lt) * lapW;
        if (raceLaps > 0 && laps[k] >= raceLaps) { finishT[k] = t; alive[k] = false; parkCar(cars[k]); continue; } // race finished
      }
      if (dist[k] > best[k] + 3) { best[k] = dist[k]; stallT[k] = 0; } else stallT[k] += FIXED_DT;
      const q = st.rotation, upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      const lim = p.lateral > 0 ? hwR[p.index] : hwL[p.index];
      offT[k] = Math.abs(p.lateral) > lim + 0.5 ? offT[k] + FIXED_DT : 0;
      if (offT[k] > 0.5 || upY < 0.5 || stallT[k] > 4 || dist[k] < best[k] - 30) {
        alive[k] = false;
        parkCar(cars[k]); // eliminated cars leave the world so they do not block the others
        if (process.env.EVO_DEBUG) console.log(`car ${k} out t=${t.toFixed(2)} off=${offT[k].toFixed(2)} up=${upY.toFixed(2)} stall=${stallT[k].toFixed(1)} dist=${dist[k].toFixed(1)} lat=${p.lateral.toFixed(1)} v=${st.forwardSpeed.toFixed(1)}`);
      }
    }
    const now = performance.now();
    if (now - lastPost > 50) {
      lastPost = now;
      for (let k = 0; k < m; k++) {
        const st = state[k], q = st.rotation;
        pos[4 * k] = st.position.x; pos[4 * k + 1] = st.position.z;
        pos[4 * k + 2] = Math.atan2(-1 + 2 * (q.x * q.x + q.y * q.y), -2 * (q.w * q.y + q.x * q.z));
        pos[4 * k + 3] = alive[k] ? 1 : 0;
      }
      parentPort!.postMessage({ type: 'pos', t, epi, pos: Array.from(pos) });
    }
  }
  return { best, lapT, over, laps, lapBonus, finishT };
}

parentPort!.on('message', (msg: any) => {
  if (msg.type !== 'eval') return;
  const genomes: Float64Array[] = msg.genomes.map((g: number[]) => Float64Array.from(g));
  const fitness = new Array(genomes.length).fill(0), dist = new Array(genomes.length).fill(0);
  let lapT: number[] = [], laps: number[] = [], finishT: number[] = [];
  const race = msg.race as { laps: number; speedW: number; overW: number; lapW: number };
  msg.episodes.forEach((ep: { start: number; secs: number }, e: number) => {
    const r = episode(genomes, ep.start, ep.secs, e, e === 0 ? race.laps : 0, race.lapW);
    for (let k = 0; k < genomes.length; k++) {
      fitness[k] += r.best[k] - race.overW * r.over[k] + r.lapBonus[k] + (r.finishT[k] > 0 ? (ep.secs - r.finishT[k]) * race.speedW : 0);
      if (e === 0) dist[k] = r.best[k];
    }
    if (e === 0) { lapT = Array.from(r.lapT); laps = Array.from(r.laps); finishT = Array.from(r.finishT); }
  });
  parentPort!.postMessage({ type: 'done', fitness, best: dist, lapT, laps, finishT });
});
parentPort!.postMessage({ type: 'ready', lapLength: L });
