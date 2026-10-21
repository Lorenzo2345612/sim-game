// Probe: like race-residual plus toggles that swap game parts for the trainer's (--tline --nokeep --norules --tune). Headless RaceGame race through the game's residual neural mode (classic AiDriver + net lateral offset/pace).
// Usage: npx tsx scripts/evolve/race-residual.mts <model.json> [--track id] [--mix all|half|none] [--laps 5] [--ai 11] [--seed 1] [--compound hard]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RaceGame } from '../../src/game/raceGame';
import { parseCarSpec } from '../../src/physics/carSpec';
import { parseTrackData } from '../../src/track/parseTrackData';
import { FIXED_DT } from '../../src/core/constants';
import { padGenome } from '../../src/ai/neuralPolicy';
import { parseResidualModel } from '../../src/ai/residualPolicy';
import { AiDriver } from '../../src/ai/aiDriver';
import { computeRacingLine } from '../../src/ai/racingLine';
import { speedProfile, carLimitsFromSpec } from '../../src/ai/speedProfile';
import { AI_GRIP_MARGIN } from '../../src/game/raceGame';
import { NEURAL_GRIP_MARGIN } from '../../src/game/raceGame';
import { RacecraftTracker, type RaceCar } from './racecraft.mts';
import { minTimeFor } from './mintime.mts';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const root = join(import.meta.dirname, '../..');
const j = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const model = JSON.parse(readFileSync(argv[0], 'utf8'));
const MIX = arg('mix', 'half'), LAPS = Number(arg('laps', '5')), AI = Number(arg('ai', '11')), SEED = Number(arg('seed', '1')), COMPOUND = arg('compound', 'hard');
const trackId = arg('track', model.track ?? 'cleveland'), carId = model.car ?? 'f4';
const track = parseTrackData(j(`public/tracks/${trackId}.json`));
const spec = parseCarSpec(j(`public/cars/${carId}.json`));
const mt = await minTimeFor(root, track, (spec as any).spec ?? spec, carId); // cached in scripts/evolve/lines (same line the trainer uses)
const w = padGenome(model.weights)!;
const residual = parseResidualModel(model);
if (!residual) throw new Error('not a residual model');

// The game's residual mode (RaceGame neuralResidual); 'half' turns even AIs back to classic, 'none' all.
const g: any = await RaceGame.create(track, spec, { trackId, carId, laps: LAPS, aiCount: AI, difficulty: 'expert', seed: SEED },
  { compound: COMPOUND as any, wear: 1, fuel: 1, aiDriver: 'neural', neuralModels: { expert: w }, neuralSetups: { expert: model.setup },
    neuralResidual: { expert: residual }, neuralLine: { kind: 'mintime', pts: mt.pts, v: mt.v } });
const cl = track.centerline, n = cl.length;
const isRes = (k: number) => MIX === 'all' || (MIX === 'half' && k % 2 === 0);
g.ais.forEach((ai: any, k: number) => { if (!isRes(k)) delete ai.residual; });
const has = (f: string) => argv.includes(`--${f}`);
if (has('tline')) { // trainer's classic line and speed profile (no margin / per-index half widths)
  const tl = computeRacingLine(cl, track.widthMeters / 2), lim = carLimitsFromSpec(spec, spec.fuel.startL * spec.fuel.densityKgL);
  const sp = speedProfile(tl, { ...lim, muLat: lim.muLat * NEURAL_GRIP_MARGIN, muLong: lim.muLong * NEURAL_GRIP_MARGIN });
  g.ais.forEach((ai: any) => { const d = new AiDriver(tl, sp, { speedScale: 1 }); d.setSteerCurve(spec.steering.maxAngleLow, spec.steering.maxAngleHigh, spec.steering.fullSpeed); ai.driver = d; });
}
if (has('nostab')) { g.updateAiDynamics = () => {}; g.observations.forEach((o: any) => { delete o.rearSlip; delete o.yawRate; delete o.steerAngle; }); } // trainer obs has no slip/yaw feed (AiDriver stability aid off)
if (has('nokeep')) g.keepOnTrack = () => {};
if (has('norules')) { g.applyRulesReaction = () => {}; g.updateTrafficCaution = () => {}; g.followForNeural = () => {}; }


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
    touch: touches[k], pen: g.penalties.total(r.car), strikes: g.penalties.entries ? g.penalties.entries.length : undefined, passes: rc.passes[k], lost: rc.lost[k], faults: rc.faults[k], crashF: rc.crashFaults[k], out: !!out_[k], wings: +(dm.frontWing + dm.rearWing).toFixed(2) };
});
console.log(JSON.stringify({ model: argv[0].split('/').pop(), track: trackId, mix: MIX, seed: SEED, laps: LAPS, simT: +g.simTime.toFixed(0), rows }));
