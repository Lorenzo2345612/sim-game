// Evaluates a batch of genomes in one Rapier world (cars collide; --racecraft adds frozen opponents and racecraft scoring).
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
import { halfWidthAt, hasKerb } from '../../src/track/surfaces';
import { N_IN, forward } from './policy.mts';
import { NeuralFeatures, racingTargetPoints, type NeuralCarState } from '../../src/ai/neuralFeatures';
import { minTimeFor } from './mintime.mts';
import { splitGenome, X_LOOK, N_X, N_XW } from './genome.mts';
import { aheadIndices } from '../../src/ai/residualPolicy';
import { N_HID } from '../../src/ai/neuralPolicy';
import { trackLimits } from './limits.mts';
import { applySetup, defaultSetup } from '../../src/physics/setup';
import { padGenome } from '../../src/ai/neuralPolicy';
import { RacecraftTracker, racecraftFitness, RC_W, type RaceCar } from './racecraft.mts';
import type { Telemetry } from '../../src/physics/vehicleModel';
import { AiDriver, type AiObservation } from '../../src/ai/aiDriver';
import { computeRacingLine } from '../../src/ai/racingLine';
import { speedProfile, carLimitsFromSpec } from '../../src/ai/speedProfile';
import { NEURAL_GRIP_MARGIN } from '../../src/game/raceGame';

const { root, trackId, carId, slots, line = 'center', racecraft = false, residual = false, res = { offset: 3.5, up: 0.06, down: 0.06 }, rcw = {}, oppFront = 0, lineW = 0 } = workerData as { lineW?: number; oppFront?: number; rcw?: Partial<typeof RC_W>; root: string; trackId: string; carId: string; slots: number; line?: string; racecraft?: boolean; residual?: boolean; res?: { offset: number; up: number; down: number } };
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
const hwL: number[] = [], hwR: number[] = [], kL: boolean[] = [], kR: boolean[] = [];
for (let i = 0; i < n; i++) { hwL.push(halfWidthAt(track, 'left', i)); hwR.push(halfWidthAt(track, 'right', i)); kL.push(hasKerb(track, 'left', i)); kR.push(hasKerb(track, 'right', i)); }
// Speed profile (brake cue) and lookups: same extraction the in-game neural AI uses (task 269).
const mt = line === 'mintime' ? await minTimeFor(root, track, spec, carId) : null;
const lineArg = mt ? { points: mt.pts, mintimeSpeed: mt.v }
  : line === 'racing' ? { points: racingTargetPoints(cl, hwL, hwR, kL, kR) } : undefined;
Object.assign(RC_W, rcw);
const features = new NeuralFeatures(cl, hwL, hwR, lineArg);
// Residual mode: the classic AiDriver drives (as in RaceGame); the network only sets its lateral offset and pace.
const cLine = computeRacingLine(cl, track.widthMeters / 2);
const cLim = carLimitsFromSpec(spec, spec.fuel.startL * spec.fuel.densityKgL);
const cSpeeds = speedProfile(cLine, { ...cLim, muLat: cLim.muLat * NEURAL_GRIP_MARGIN, muLong: cLim.muLong * NEURAL_GRIP_MARGIN });
const drivers: AiDriver[] = [];
// Extra residual inputs: centerline index X_LOOK metres ahead of each index.
const ahead = X_LOOK.map((d) => aheadIndices(cum, n, d));
const xe = new Float64Array(N_X), lastOut = new Float64Array(slots * 2), BIAS = N_IN * N_HID;
// forward() reads N_IN inputs only: extra contributions are folded into the hidden biases of a per-car copy.
function foldExtra(wk: Float64Array, w: Float64Array, ex: Float64Array): void {
  for (let h = 0; h < N_HID; h++) { let s = w[BIAS + h]; for (let j = 0; j < N_X; j++) s += ex[h * N_X + j] * xe[j]; wk[BIAS + h] = s; }
}
const obs: AiObservation = { x: 0, z: 0, yaw: 0, speed: 0 };
function newDriver(): AiDriver {
  const d = new AiDriver(cLine, cSpeeds, { speedScale: 1 });
  d.setSteerCurve(spec.steering.maxAngleLow, spec.steering.maxAngleHigh, spec.steering.fullSpeed);
  return d;
}

// Fresh car per episode (VehicleModel.reset keeps fuel, tyre wear/temps and gearbox state).
// Cars collide with each other (traffic). Fuel load, compound and wear rate are randomised per car and episode.
const COMPOUNDS = ['soft', 'medium', 'hard'] as const;

const muMed = spec.tyres.compounds.medium.mu0;
let FUEL_MIN_L = 18; // set after the lap length is known: measured ~0.225 L/km at Monza (F4), sized for 12 laps
const carMu = new Float64Array(slots), carFuel0 = new Float64Array(slots);
const carSpec: any[] = Array.from({ length: slots }, () => spec); // per-slot setup applied
const carCompound: (typeof COMPOUNDS[number])[] = new Array(slots).fill('medium');
let evalCompound: (typeof COMPOUNDS[number]) | null = null; // set per eval: every car on the same compound (fair ranking)
function makeCar(pose: any, k: number): VehicleModel {
  const startL = FUEL_MIN_L + Math.random() * (spec.fuel.capacityL - FUEL_MIN_L);
  const v = new VehicleModel(world, { ...carSpec[k], fuel: { ...spec.fuel, startL } }, pose);
  configureVehicle(v, track.id);
  const c = evalCompound ?? COMPOUNDS[Math.floor(Math.random() * 3)];
  v.setCompound(c);
  carCompound[k] = c;
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
const tels: Telemetry[] = cars.map(() => undefined as unknown as Telemetry);
const limits = cars.map(() => trackLimits());
const inputs = cars.map(() => ({ throttle: 0, brake: 0, steer: 0, reset: false }));
const parked = { throttle: 0, brake: 1, steer: 0, reset: false };

function pointAt(s: number, idxHint: number, pts: [number, number][] = cl): [number, number, number] {
  s = ((s % L) + L) % L;
  let i = idxHint;
  for (let g = 0; g < n && !(cum[i] <= s && s < cum[i + 1]); g++) i = (i + 1) % n;
  const t = (s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-9);
  const a = pts[i], b = pts[(i + 1) % n];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), i];
}

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
const startOff = new Float64Array(slots); // race distance at the start (pack rows behind the leader)
// oppFront: with that probability the frozen opponents start ahead of every trainee (overtaking practice).
function startPoses(start: number, nT: number, m: number): any[] {
  let order = Array.from({ length: slots }, (_, k) => k).sort(() => Math.random() - 0.5);
  if (m > nT && Math.random() < oppFront) {
    const nO = m - nT, shuf = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i).sort(() => Math.random() - 0.5);
    const ro = shuf(0, nO), rt = shuf(nO, m), rp = shuf(m, slots);
    order = Array.from({ length: slots }, (_, k) => (k < nT ? rt[k] : k < m ? ro[k - nT] : rp[k - m]));
  }
  order.forEach((r, k) => { startOff[k] = start === 0 ? -r : -(r >> 1) * 9 - (r & 1) * 0.1; });
  return order.map((r) => (start === 0 ? grid[r] : poseAt(start - (r >> 1) * 9, r & 1 ? 2.5 : -2.5)));
}
// Racecraft: preallocated per-step race state and contact probe.
const raceCars: RaceCar[] = Array.from({ length: slots }, () => ({ dist: 0, speed: 0, running: false }));
let nShow = slots; // cars posted to the viewer (trainees only)
const cinfo = { fwdGap: 0, latGap: 0, closing: 0 };
let touching = false;
const onManifold = (mf: any) => { for (let i = 0, c = mf.numContacts(); i < c; i++) if (mf.contactDist(i) < 0.01) { touching = true; return; } };
function relInfo(k: number, j: number, vk: any, vj: any): void { // j relative to k in k's frame (forward = local -Z)
  const q = state[k].rotation, pk = state[k].position, pj = state[j].position;
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const rx = 1 - 2 * (q.y * q.y + q.z * q.z), rz = 2 * (q.x * q.z - q.w * q.y);
  const dx = pj.x - pk.x, dz = pj.z - pk.z;
  cinfo.fwdGap = dx * fx + dz * fz; cinfo.latGap = dx * rx + dz * rz;
  cinfo.closing = (vk.x - vj.x) * fx + (vk.z - vj.z) * fz;
}

// Reused per-decision state: the others list holds the nearest alive cars, self excluded.
const othersPool = Array.from({ length: slots }, () => ({ position: { x: 0, y: 0, z: 0 }, linvel: { x: 0, y: 0, z: 0 } }));
const others: typeof othersPool = [];
const carState: NeuralCarState = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  forwardSpeed: 0,
  linvel: { x: 0, y: 0, z: 0 },
  angvel: { x: 0, y: 0, z: 0 },
  progress: { index: 0, distance: 0, lateral: 0 },
  fuelMassKg: 0,
  tempFrontC: 0,
  tempRearC: 0,
  optTempC: 0,
  tempWindowC: 0,
  wearMean: 0,
  offWheels: 0,
  compoundGrip: 0,
  others,
};

function carNear(k: number, m: number, dist: Float64Array, alive: boolean[]): boolean {
  const dk = startOff[k] + dist[k];
  for (let j = 0; j < m; j++) if (j !== k && alive[j] && Math.abs(startOff[j] + dist[j] - dk) < 30) return true;
  return false;
}
// Body sideslip angle (rad, 0..π) above 5 m/s; 0 when slower.
function sideslip(k: number): number {
  const q = state[k].rotation, v = cars[k].body.linvel();
  if (v.x * v.x + v.z * v.z < 25) return 0;
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y)), rx = 1 - 2 * (q.y * q.y + q.z * q.z), rz = 2 * (q.x * q.z - q.w * q.y);
  return Math.atan2(Math.abs(v.x * rx + v.z * rz), v.x * fx + v.z * fz);
}
function episode(genomes: Float64Array[], extras: Float64Array[], setups: any[], start: number, secs: number, epi: number, raceLaps: number, lapW: number, rc: RacecraftTracker | null, nT: number) {
  const poses = startPoses(start, nT, genomes.length);
  const m = genomes.length;
  const wk = genomes.map((g) => Float64Array.from(g));
  lastOut.fill(0);
  const alive = new Array(m).fill(true);
  const dist = new Float64Array(m), lastS = new Float64Array(m), best = new Float64Array(m), stallT = new Float64Array(m);
  const finishT = new Float64Array(m), lapT = new Float64Array(m).fill(0), laps = new Float64Array(m), lapStart = new Float64Array(m), lapBonus = new Float64Array(m), over = new Float64Array(m), invalidLaps = new Float64Array(m), lineShort = new Float64Array(m);
  for (let k = 0; k < slots; k++) {
    dropCar(cars[k]);
    carSpec[k] = k < m ? applySetup(spec, setups[k]) : spec;
    limits[k] = trackLimits();
    cars[k] = makeCar(poses[k], k);
    if (k >= m) parkCar(cars[k]);
    progress[k].reset();
    drivers[k] = newDriver();
    state[k] = cars[k].getState(state[k] ?? undefined);
    const p = progress[k].update(state[k].position.x, state[k].position.z);
    lastS[k] = p.distance;
  }
  const steps = Math.round(secs / FIXED_DT);
  let lastPost = 0;
  const pos = new Float32Array(nShow * 4);
  for (let step = 0; step < steps; step++) {
    let anyAlive = false;
    for (let k = 0; k < slots; k++) {
      const v = cars[k];
      if (k >= m || !alive[k]) continue;
      anyAlive = true;
      if (step % 4 === 0) {
        const st = state[k];
        const p = progress[k].update(st.position.x, st.position.z);
        const body: any = v.body;
        const lv = body.linvel(), av = body.angvel();
        carState.position = st.position;
        carState.rotation = st.rotation;
        carState.forwardSpeed = st.forwardSpeed;
        carState.linvel = lv;
        carState.angvel = av;
        carState.progress = p;
        carState.fuelMassKg = (cars[k] as any).tank?.massKg ?? 0;
        carState.compoundGrip = carMu[k];
        const tel = (tels[k] = v.getTelemetry(tels[k]));
        const w = tel.wheels, cs = carSpec[k].tyres.compounds[carCompound[k]];
        let off = 0;
        for (let j = 0; j < 4; j++) if (w[j].surface !== 'asphalt' && w[j].surface !== 'kerb') off++;
        carState.tempFrontC = (w[0].tempC + w[1].tempC) / 2;
        carState.tempRearC = (w[2].tempC + w[3].tempC) / 2;
        carState.optTempC = cs.optTempC;
        carState.tempWindowC = cs.tempWindowC;
        carState.wearMean = (w[0].wear + w[1].wear + w[2].wear + w[3].wear) / 4;
        carState.offWheels = off;
        limits[k].step(off, 4 * FIXED_DT);
        let oc = 0;
        for (let j = 0; j < slots; j++) {
          if (j === k || !alive[j]) continue;
          const sj = state[j].position, oj = othersPool[oc];
          others[oc++] = oj;
          oj.position.x = sj.x; oj.position.y = sj.y; oj.position.z = sj.z;
          const lvj = (cars[j].body as any).linvel();
          oj.linvel.x = lvj.x; oj.linvel.y = lvj.y; oj.linvel.z = lvj.z;
        }
        others.length = oc;
        features.fill(x, carState);
        if (residual) {
          const i = p.index;
          X_LOOK.forEach((_, a) => { const j = ahead[a][i]; xe[2 * a] = (hwR[j] - p.lateral) / 10; xe[2 * a + 1] = (hwL[j] + p.lateral) / 10; });
          xe[N_X - 2] = lastOut[2 * k]; xe[N_X - 1] = lastOut[2 * k + 1];
          foldExtra(wk[k], genomes[k], extras[k]);
        }
        forward(wk[k], x, out);
        lastOut[2 * k] = out[0]; lastOut[2 * k + 1] = out[1];
        const inp = inputs[k];
        if (residual) {
          drivers[k].setLateralOffset(out[0] * res.offset);
          drivers[k].setSpeedScale(1 + (out[1] > 0 ? res.up : res.down) * out[1]);
        } else {
          inp.steer = out[0];
          inp.throttle = out[1] > 0 ? out[1] : 0;
          inp.brake = out[1] < 0 ? -out[1] : 0;
        }
      }
      if (residual) {
        const st = state[k], q = st.rotation;
        const fx = -2 * (q.w * q.y + q.x * q.z), fz = -1 + 2 * (q.x * q.x + q.y * q.y);
        obs.x = st.position.x; obs.z = st.position.z; obs.yaw = Math.atan2(-fx, -fz); obs.speed = st.forwardSpeed;
        drivers[k].update(obs, FIXED_DT, inputs[k]);
      }
      v.setInput(inputs[k]);
      v.prePhysicsStep(FIXED_DT);
    }
    if (!anyAlive) break;
    world.step();
    const t = (step + 1) * FIXED_DT;
    if (rc) {
      for (let k = 0; k < m; k++) {
        if (!alive[k]) continue;
        const ck: any = cars[k], pk = state[k].position;
        for (let j = k + 1; j < m; j++) {
          if (!alive[j]) continue;
          const pj = state[j].position, dx = pj.x - pk.x, dz = pj.z - pk.z;
          if (dx * dx + dz * dz > 36) continue;
          touching = false;
          world.contactPair(ck.chassisCollider, (cars[j] as any).chassisCollider, onManifold);
          if (!touching) continue;
          const vk = ck.body.linvel(), vj = (cars[j].body as any).linvel();
          relInfo(k, j, vk, vj); rc.contact(k, j, cinfo);
          relInfo(j, k, vj, vk); rc.contact(j, k, cinfo);
        }
      }
    }
    for (let k = 0; k < m; k++) {
      if (!alive[k]) continue;
      const st = (state[k] = cars[k].getState(state[k]));
      const p = progress[k].update(st.position.x, st.position.z);
      let ds = p.distance - lastS[k];
      if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
      lastS[k] = p.distance;
      dist[k] += ds;
      over[k] += Math.max(0, st.forwardSpeed - features.speedAt(p.index) - 3) * FIXED_DT;
      // --line-w: metres short of the racing line where it runs near an edge (|offset| > 4 m), only with no car within 30 m.
      if (lineW > 0) { const lo = cLine.offsets[p.index]; if (Math.abs(lo) > 4 && !carNear(k, m, dist, alive)) lineShort[k] += Math.max(0, Math.abs(lo) - Math.sign(lo) * p.lateral) * FIXED_DT; }
      if (dist[k] >= (laps[k] + 1) * L) { // lap completed: fastest single lap and a bonus per lap (faster = more)
        const lt = t - lapStart[k];
        lapStart[k] = t; laps[k]++;
        const valid = limits[k].lapValid;
        limits[k].newLap();
        if (!valid) invalidLaps[k]++;
        else if (lapT[k] === 0 || lt < lapT[k]) lapT[k] = lt;
        if (process.env.EVO_DEBUG) console.log(`car ${k} lap ${laps[k]} ${lt.toFixed(1)} s fuel used ${(carFuel0[k] - ((cars[k] as any).tank?.litres ?? 0)).toFixed(2)} L`);
        if (valid) lapBonus[k] += 500 + Math.max(0, 200 - lt) * lapW;
        if (raceLaps > 0 && laps[k] >= raceLaps) { finishT[k] = t + 5 * invalidLaps[k]; alive[k] = false; parkCar(cars[k]); continue; } // race finished
      }
      if (dist[k] > best[k] + 3) { best[k] = dist[k]; stallT[k] = 0; } else stallT[k] += FIXED_DT;
      const q = st.rotation, upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      if (limits[k].eliminated || upY < 0.5 || stallT[k] > 4 || dist[k] < best[k] - 30) {
        alive[k] = false;
        rc?.noteElimination(k);
        parkCar(cars[k]); // eliminated cars leave the world so they do not block the others
        if (process.env.EVO_DEBUG) console.log(`car ${k} out t=${t.toFixed(2)} up=${upY.toFixed(2)} stall=${stallT[k].toFixed(1)} dist=${dist[k].toFixed(1)} lat=${p.lateral.toFixed(1)} v=${st.forwardSpeed.toFixed(1)}`);
      }
    }
    if (rc) {
      for (let k = 0; k < m; k++) { const c = raceCars[k]; c.dist = startOff[k] + dist[k]; c.speed = state[k].forwardSpeed; c.running = alive[k]; c.slip = alive[k] ? sideslip(k) : 0; }
      rc.step(FIXED_DT, raceCars);
    }
    const now = performance.now();
    if (now - lastPost > 50) {
      lastPost = now;
      for (let k = 0; k < nShow; k++) {
        const st = state[k], q = st.rotation;
        pos[4 * k] = st.position.x; pos[4 * k + 1] = st.position.z;
        pos[4 * k + 2] = Math.atan2(-1 + 2 * (q.x * q.x + q.y * q.y), -2 * (q.w * q.y + q.x * q.z));
        pos[4 * k + 3] = alive[k] ? 1 : 0;
      }
      parentPort!.postMessage({ type: 'pos', t, epi, pos: Array.from(pos) });
    }
  }
  // finishing order: finishers by time, then race distance
  const raceD = Array.from({ length: m }, (_, k) => startOff[k] + dist[k]);
  const order = Array.from({ length: m }, (_, k) => k).sort((a, b) => (finishT[a] > 0 && finishT[b] > 0 ? finishT[a] - finishT[b] : finishT[a] > 0 ? -1 : finishT[b] > 0 ? 1 : raceD[b] - raceD[a]));
  const finishPos = new Int32Array(m);
  order.forEach((k, i) => { finishPos[k] = i; });
  return { best, lapT, over, laps, lapBonus, finishT, invalidLaps, finishPos, lineShort };
}

parentPort!.on('message', (msg: any) => {
  if (msg.type !== 'eval') return;
  const split = msg.genomes.map((g: number[]) => splitGenome(g, spec));
  const nT = split.length; // trainees first, then frozen opponents (racecraft)
  nShow = nT;
  evalCompound = msg.compound ?? null;
  const opp = (msg.opponents ?? []).slice(0, slots - nT) as { weights: number[]; setup?: any; extra?: number[] }[];
  const genomes: Float64Array[] = [...split.map((s: any) => s.weights), ...opp.map((o) => padGenome(o.weights)!)];
  const extras: Float64Array[] = [...split.map((s: any) => s.extra), ...opp.map((o) => { const e = new Float64Array(N_XW); if (o.extra) e.set(o.extra.slice(0, N_XW)); return e; })];
  const setups = [...split.map((s: any) => s.setup), ...opp.map((o) => o.setup ?? defaultSetup(spec))];
  const rcStats = { passes: new Array(nT).fill(0), lost: new Array(nT).fill(0), faults: new Array(nT).fill(0), crashFaults: new Array(nT).fill(0), defends: new Array(nT).fill(0), yellowFaults: new Array(nT).fill(0), incidents: new Array(nT).fill(0), spins: new Array(nT).fill(0), lineShort: new Array(nT).fill(0) };
  let invalidLaps: number[] = [];
  const fitness = new Array(nT).fill(0), dist = new Array(nT).fill(0);
  let lapT: number[] = [], laps: number[] = [], finishT: number[] = [];
  const race = msg.race as { laps: number; speedW: number; overW: number; lapW: number };
  msg.episodes.forEach((ep: { start: number; secs: number }, e: number) => {
    const rc = racecraft ? new RacecraftTracker(genomes.length, L) : null;
    const r = episode(genomes, extras, setups, ep.start, ep.secs, e, e === 0 ? race.laps : 0, race.lapW, rc, nT);
    for (let k = 0; k < nT; k++) {
      const base = r.best[k] - race.overW * r.over[k] - lineW * r.lineShort[k] + r.lapBonus[k] + (r.finishT[k] > 0 ? (ep.secs - r.finishT[k]) * race.speedW : 0);
      fitness[k] += rc ? racecraftFitness(base, r.finishPos[k], genomes.length, rc.passes[k], rc.lost[k], rc.faults[k], rc.crashFaults[k], rc.defends[k], rc.yellowFaults[k], rc.incidents[k]) : base;
      if (rc) { rcStats.passes[k] += rc.passes[k]; rcStats.lost[k] += rc.lost[k]; rcStats.faults[k] += rc.faults[k]; rcStats.crashFaults[k] += rc.crashFaults[k]; rcStats.defends[k] += rc.defends[k]; rcStats.yellowFaults[k] += rc.yellowFaults[k]; rcStats.incidents[k] += rc.incidents[k]; rcStats.spins[k] += rc.spins[k]; }
      rcStats.lineShort[k] += r.lineShort[k];
      if (e === 0) dist[k] = r.best[k];
    }
    if (e === 0) { const c = (a: ArrayLike<number>) => Array.from(a).slice(0, nT); lapT = c(r.lapT); laps = c(r.laps); finishT = c(r.finishT); invalidLaps = c(r.invalidLaps); }
  });
  parentPort!.postMessage({ type: 'done', fitness, best: dist, lapT, laps, finishT, invalidLaps, ...rcStats });
});
parentPort!.postMessage({ type: 'ready', lapLength: L });
