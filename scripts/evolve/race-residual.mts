// Headless RaceGame race with residual models: classic AiDriver + net lateral offset/pace (same inputs as worker.mts).
// Usage: npx tsx scripts/evolve/race-residual.mts <model.json> [--mix all|half|none] [--laps 5] [--ai 11] [--seed 1] [--compound hard]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RaceGame } from '../../src/game/raceGame';
import { parseCarSpec } from '../../src/physics/carSpec';
import { parseTrackData } from '../../src/track/parseTrackData';
import { FIXED_DT } from '../../src/core/constants';
import { cumulativeLengths } from '../../src/track/centerline';
import { halfWidthAt } from '../../src/track/surfaces';
import { N_IN, N_HID, forward, padGenome } from '../../src/ai/neuralPolicy';
import { X_LOOK, N_X, N_XW } from './genome.mts';
import { AiDriver } from '../../src/ai/aiDriver';
import { computeRacingLine } from '../../src/ai/racingLine';
import { speedProfile, carLimitsFromSpec } from '../../src/ai/speedProfile';
import { AI_GRIP_MARGIN } from '../../src/game/raceGame';
import { RacecraftTracker, type RaceCar } from './racecraft.mts';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const root = join(import.meta.dirname, '../..');
const j = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const model = JSON.parse(readFileSync(argv[0], 'utf8'));
const MIX = arg('mix', 'half'), LAPS = Number(arg('laps', '5')), AI = Number(arg('ai', '11')), SEED = Number(arg('seed', '1')), COMPOUND = arg('compound', 'hard');
const trackId = model.track ?? 'cleveland', carId = model.car ?? 'f4';
const res = model.res ?? { offset: 3.5, up: 0.06, down: 0.06 };
const mt = j(`public/ai-models/${trackId}-${carId}/line-mintime.json`);
const track = parseTrackData(j(`public/tracks/${trackId}.json`));
const spec = parseCarSpec(j(`public/cars/${carId}.json`));
const w = padGenome(model.weights)!;
const ex = new Float64Array(N_XW); if (model.extra) ex.set(model.extra.slice(0, N_XW));

// 'neural' builds the features and applies the model setup to all AI cars; the residual cars then drive the classic path.
const g: any = await RaceGame.create(track, spec, { trackId, carId, laps: LAPS, aiCount: AI, difficulty: 'expert', seed: SEED },
  { compound: COMPOUND as any, wear: 1, fuel: 1, aiDriver: 'neural', neuralModels: { expert: w }, neuralSetups: { expert: model.setup },
    neuralLine: { kind: 'mintime', pts: mt.pts, v: mt.v } });
const cl = track.centerline, n = cl.length, cum = cumulativeLengths(cl, true);
const hwL = Array.from({ length: n }, (_, i) => halfWidthAt(track, 'left', i)), hwR = Array.from({ length: n }, (_, i) => halfWidthAt(track, 'right', i));
const ahead = X_LOOK.map((d) => { const a = new Int32Array(n); for (let i = 0, k = 0; i < n; i++) { if (k < i) k = i; while (cum[k] - cum[i] < d && k < i + n) k++; a[i] = k % n; } return a; });
const isRes = (k: number) => MIX === 'all' || (MIX === 'half' && k % 2 === 0);
const x = new Float64Array(N_IN), out = new Float64Array(2), xe = new Float64Array(N_X), BIAS = N_IN * N_HID;
const wk = Float64Array.from(w);

g.ais.forEach((ai: any, k: number) => {
  const neural = ai.neural; delete ai.neural; // all AIs on the classic path
  if (!isRes(k)) return;
  const d = ai.driver, setOff = d.setLateralOffset.bind(d), setScale = d.setSpeedScale.bind(d), upd = d.update.bind(d);
  let calls = 0, off = 0, pace = 1, last0 = 0, last1 = 0;
  d.setLateralOffset = () => setOff(off); // replaces the traffic offset, as in the trainer
  d.setSpeedScale = (v: number) => setScale((v / ai.baseSpeedScale) * pace); // keeps the damage lift-off
  d.update = (obs: any, dt: number, cmd: any) => {
    if (calls++ % 4 === 0) {
      const s = neural.state;
      g.fillNeuralState(k, s, neural.tel);
      neural.driver.features.fill(x, s);
      const p = s.progress, i = p.index;
      X_LOOK.forEach((_, a) => { const q = ahead[a][i]; xe[2 * a] = (hwR[q] - p.lateral) / 10; xe[2 * a + 1] = (hwL[q] + p.lateral) / 10; });
      xe[N_X - 2] = last0; xe[N_X - 1] = last1;
      for (let h = 0; h < N_HID; h++) { let t = w[BIAS + h]; for (let m = 0; m < N_X; m++) t += ex[h * N_X + m] * xe[m]; wk[BIAS + h] = t; }
      forward(wk, x, out);
      last0 = out[0]; last1 = out[1];
      off = out[0] * res.offset; pace = 1 + (out[1] > 0 ? res.up : res.down) * out[1];
      setOff(off);
    }
    return upd(obs, dt, cmd);
  };
});

// Racecraft stats over the AI cars (car index i = k + 1).
const rc = new RacecraftTracker(AI), cars: RaceCar[] = Array.from({ length: AI }, () => ({ dist: 0, speed: 0, running: true }));
const cinfo = { fwdGap: 0, latGap: 0, closing: 0 };
let touching = false;
const onManifold = (mf: any) => { for (let i = 0, c = mf.numContacts(); i < c; i++) if (mf.contactDist(i) < 0.01) { touching = true; return; } };
function relInfo(a: number, b: number): void {
  const sa = g.current[a], sb = g.current[b], q = sa.rotation;
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const rx = 1 - 2 * (q.y * q.y + q.z * q.z), rz = 2 * (q.x * q.z - q.w * q.y);
  const dx = sb.position.x - sa.position.x, dz = sb.position.z - sa.position.z;
  const va = g.vehicles[a].body.linvel(), vb = g.vehicles[b].body.linvel();
  cinfo.fwdGap = dx * fx + dz * fz; cinfo.latGap = dx * rx + dz * rz; cinfo.closing = (va.x - vb.x) * fx + (va.z - vb.z) * fz;
}
const out_ = new Uint8Array(AI), touches = new Int32Array(AI);
// Player slot driven by a plain classic driver (a parked car trips the race rules); not scored.
const pLim = carLimitsFromSpec(spec, g.vehicles[0].getTelemetry().fuelKg);
const pDrv = new AiDriver(computeRacingLine(cl, track.widthMeters / 2), speedProfile(computeRacingLine(cl, track.widthMeters / 2), { ...pLim, muLat: pLim.muLat * AI_GRIP_MARGIN, muLong: pLim.muLong * AI_GRIP_MARGIN }), { speedScale: 1 });
pDrv.setSteerCurve(spec.steering.maxAngleLow, spec.steering.maxAngleHigh, spec.steering.fullSpeed);
const pObs = { x: 0, z: 0, yaw: 0, speed: 0 }, BR = { throttle: 0, brake: 0, steer: 0, reset: false };
function playerInput(): void {
  const s0 = g.current[0], q = s0.rotation, fx = -2 * (q.w * q.y + q.x * q.z), fz = -1 + 2 * (q.x * q.x + q.y * q.y);
  pObs.x = s0.position.x; pObs.z = s0.position.z; pObs.yaw = Math.atan2(-fx, -fz); pObs.speed = s0.forwardSpeed;
  pDrv.update(pObs, FIXED_DT, BR);
  // Stuck (no reset key here): respawn on the centerline after 5 s, else a stopped car freezes the field under yellow.
  pStuck = Math.abs(s0.forwardSpeed) < 1 ? pStuck + FIXED_DT : 0;
  if (pStuck >= 5) {
    pStuck = 0;
    const i = ((g.indices[0] % n) + n) % n, p = cl[i], nx = cl[(i + 1) % n];
    g.vehicles[0].reset({ position: { x: p[0], y: (track.elevation[i] ?? 0) + 0.61, z: p[1] }, yaw: Math.atan2(-(nx[0] - p[0]), -(nx[1] - p[1])) });
  }
}
let pStuck = 0;
const maxSteps = Math.round((LAPS * 200 + 120) / FIXED_DT);
for (let s = 0; s < maxSteps && !g.raceFinished; s++) {
  playerInput();
  g.step(BR);
  for (let k = 0; k < AI; k++) {
    const i = k + 1, v = g.vehicles[i];
    const gone = g.stopped[i] === 1 || v.damage.detached.some(Boolean);
    if (gone && !out_[k]) { out_[k] = 1; rc.noteElimination(k); }
    cars[k].dist = g.traffic[i].distance; cars[k].speed = g.current[i].forwardSpeed; cars[k].running = !out_[k];
  }
  rc.step(FIXED_DT, cars);
  for (let a = 1; a <= AI; a++) for (let b = a + 1; b <= AI; b++) {
    const pa = g.current[a].position, pb = g.current[b].position, dx = pb.x - pa.x, dz = pb.z - pa.z;
    if (dx * dx + dz * dz > 36) continue;
    touching = false;
    g.world.contactPair(g.vehicles[a].chassisCollider, g.vehicles[b].chassisCollider, onManifold);
    if (!touching) continue;
    touches[a - 1]++; touches[b - 1]++;
    relInfo(a, b); rc.contact(a - 1, b - 1, cinfo);
    relInfo(b, a); rc.contact(b - 1, a - 1, cinfo);
  }
}
const rows = g.standings().filter((r: any) => r.car > 0).map((r: any) => {
  const k = r.car - 1, dm = g.vehicles[r.car].damage;
  return { pos: r.position, car: r.car, type: isRes(k) ? 'RES' : 'cls', lap: r.lap, fin: r.finished, time: r.totalTime && +r.totalTime.toFixed(1), best: r.bestLap && +r.bestLap.toFixed(2),
    touch: touches[k], passes: rc.passes[k], lost: rc.lost[k], faults: rc.faults[k], crashF: rc.crashFaults[k], out: !!out_[k], wings: +(dm.frontWing + dm.rearWing).toFixed(2) };
});
console.log(JSON.stringify({ model: argv[0].split('/').pop(), mix: MIX, seed: SEED, laps: LAPS, simT: +g.simTime.toFixed(0), rows }));
