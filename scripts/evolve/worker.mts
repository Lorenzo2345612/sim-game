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
import { LOOK, PROD, N_IN, forward } from './policy.mts';

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

const cars: VehicleModel[] = [];
for (let k = 0; k < slots; k++) {
  const v = new VehicleModel(world, spec, spawn);
  configureVehicle(v, track.id);
  const body: any = v.body;
  for (let c = 0; c < body.numColliders(); c++) {
    const col = body.collider(c);
    const g = col.collisionGroups() >>> 0;
    const member = g >>> 16;
    col.setCollisionGroups(((member << 16) | ((g & 0xffff) & ~member)) >>> 0);
  }
  cars.push(v);
}
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

function poseAt(s: number) {
  if (s === 0) return spawn;
  const a = pointAt(s, 0), b = pointAt(s + 2, a[2]);
  const i = a[2] as number;
  const elev = track.elevation?.[i] ?? 0;
  return { position: { x: a[0], y: elev + 0.61, z: a[1] }, yaw: Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])) };
}

function episode(genomes: Float64Array[], start: number, secs: number, epi: number) {
  const pose = poseAt(start);
  const m = genomes.length;
  const alive = new Array(m).fill(true);
  const dist = new Float64Array(m), lastS = new Float64Array(m), best = new Float64Array(m), stallT = new Float64Array(m);
  const lapT = new Float64Array(m).fill(0), offT = new Float64Array(m);
  for (let k = 0; k < slots; k++) {
    cars[k].reset(pose);
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
      if (k >= m || !alive[k]) { v.setInput(parked); v.prePhysicsStep(FIXED_DT); continue; }
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
        x[o] = (hwR[i] - p.lateral) / 10;
        x[o + 1] = (hwL[i] + p.lateral) / 10;
        x[o + 2] = av.y / 2;
        x[o + 3] = Math.abs(vf) > 2 ? Math.atan2(vr, Math.abs(vf)) : 0;
        x[o + 4] = 1;
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
      if (dist[k] >= L && lapT[k] === 0) lapT[k] = t;
      if (dist[k] > best[k] + 3) { best[k] = dist[k]; stallT[k] = 0; } else stallT[k] += FIXED_DT;
      const q = st.rotation, upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      const lim = p.lateral > 0 ? hwR[p.index] : hwL[p.index];
      offT[k] = Math.abs(p.lateral) > lim + 0.5 ? offT[k] + FIXED_DT : 0;
      if (offT[k] > 0.5 || upY < 0.5 || stallT[k] > 4 || dist[k] < best[k] - 30) {
        alive[k] = false;
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
  return { best, lapT };
}

parentPort!.on('message', (msg: any) => {
  if (msg.type !== 'eval') return;
  const genomes: Float64Array[] = msg.genomes.map((g: number[]) => Float64Array.from(g));
  const fitness = new Array(genomes.length).fill(0), dist = new Array(genomes.length).fill(0);
  let lapT: number[] = [];
  msg.starts.forEach((s: number, e: number) => {
    const r = episode(genomes, s, msg.secs, e);
    for (let k = 0; k < genomes.length; k++) {
      fitness[k] += r.best[k] + (r.lapT[k] > 0 ? (msg.secs - r.lapT[k]) * 30 : 0);
      if (e === 0) dist[k] = r.best[k];
    }
    if (e === 0) lapT = Array.from(r.lapT);
  });
  parentPort!.postMessage({ type: 'done', fitness, best: dist, lapT });
});
parentPort!.postMessage({ type: 'ready', lapLength: L });
