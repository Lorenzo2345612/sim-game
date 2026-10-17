import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { EngineVoice } from './voice-h5';
import { parseEngineSynth } from '/home/blort/dev/sim-game/src/audio/soundSpec';
const ROOT = '/home/blort/dev/sim-game', OUT = process.argv[2];
const FS = 48000, BLOCK = 128;
const ids = ['f4', 'gt3-a', 'gt3-b', 'gt3-c', 'gt3-d', 'lmp2-a', 'hyper-a', 'ow26'];
interface P { drive: number; comb: number; intake: number; block: number; tick: number; crackle: number; turbo: number; whine: number; bass: number }
const PRESETS: Record<string, P> = {
  [process.env.NAME ?? 'H']: { drive: 2.0, comb: 0.2, intake: 0.35, block: 0.4, tick: 0.3, crackle: 1, turbo: 1, whine: 0.5, bass: 0.5 },
};
class BQ { b0 = 0; b1 = 0; b2 = 0; a1 = 0; a2 = 0; x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  bp(f: number, q: number) { const w = 2 * Math.PI * Math.min(f, 0.45 * FS) / FS, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0; return this; }
  lp(f: number) { const w = 2 * Math.PI * Math.min(f, 0.45 * FS) / FS, al = Math.sin(w) / Math.SQRT2, a0 = 1 + al, c = Math.cos(w);
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this; }
  ls(f: number, db: number) { const A = Math.pow(10, db / 40), w = 2 * Math.PI * f / FS, c = Math.cos(w), s = Math.sin(w) / 2 * Math.SQRT2, sa = 2 * Math.sqrt(A) * s;
    const a0 = (A + 1) + (A - 1) * c + sa; this.b0 = A * ((A + 1) - (A - 1) * c + sa) / a0; this.b1 = 2 * A * ((A - 1) - (A + 1) * c) / a0;
    this.b2 = A * ((A + 1) - (A - 1) * c - sa) / a0; this.a1 = -2 * ((A - 1) + (A + 1) * c) / a0; this.a2 = ((A + 1) + (A - 1) * c - sa) / a0; return this; }
  run(x: number) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; } }
let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
function wav(path: string, x: Float32Array) {
  let pk = 1e-9; for (const v of x) pk = Math.max(pk, Math.abs(v));
  const g = 1.3 + 0 * pk, b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(FS, 24); b.writeUInt32LE(FS * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i] * g)) * 32767), 44 + i * 2);
  writeFileSync(path, b);
}
for (const [pname, P] of Object.entries(PRESETS)) {
  mkdirSync(`${OUT}/${pname}`, { recursive: true });
  for (const id of ids) {
    const car = JSON.parse(readFileSync(`${ROOT}/public/cars/${id}.json`, 'utf8'));
    const s = car.sound, e = car.engine;
    if (id === 'gt3-d') s.synth.firingDeg = [0, 72, 144, 216, 288, 360, 432, 504, 576, 648];
    const PK = Number(process.env.PIPE_K ?? 1); s.synth.pipeM = s.synth.pipeM.map((x: number) => Math.min(5, x * PK)); s.synth.tailM = Math.min(5, s.synth.tailM * PK);
    s.synth.drive = s.synth.turbo ? P.drive * 0.7 : P.drive;
    const { spec } = parseEngineSynth(s.synth, { cylinders: s.cylinders, exhaustLengthM: s.exhaustLengthM, intakeMix: s.intakeMix, crackle: s.crackle });
    const v = new EngineVoice(spec, FS, 1);
    const fire = spec.firingDeg, nc = fire.length, turbo = spec.turbo;
    const inBP = new BQ().bp(spec.intakeHz, 4), inBP2 = new BQ().bp(spec.intakeHz * 2.7, 6);
    const blk = [new BQ().bp(780, 12), new BQ().bp(1650, 14), new BQ().bp(2900, 10)];
    const tickBP = new BQ().bp(3800, 3), crBP = new BQ().bp(1200, 1.2), tuBP = new BQ().bp(3000, 8), bass = new BQ().ls(Number(process.env.BASS_HZ ?? 180), Number(process.env.BASS_DB ?? 3.5));
    const lim = e.limiterRpm, idle = e.idleRpm, T = 11.5, n = Math.round(T * FS), y = new Float32Array(n), buf = new Float32Array(BLOCK);
    const MUF: Record<string, [number, number, number]> = { f4: [5000, 0, 0.8], 'hyper-a': [3500, 0, 0.6], ow26: [3000, 0, 0.6] };
    const [mHz, mS, MUFG] = MUF[id] ?? [20000, 0, 1]; const maN = Math.max(1, Math.round(mS * FS)), ma = new Float64Array(maN); let mi = 0;
    const mufA = new BQ().lp(mHz), mufB = new BQ().lp(mHz);
    const bovBP = new BQ().bp(id === 'hyper-a' ? 3000 : 4500, 2), flBP = new BQ().bp(2000, 2), wgBP = new BQ().bp(3500, 1.5);
    const POPRATE = id === 'ow26' ? 3 : id === 'hyper-a' ? 4 : 14, POPAMP = id === 'ow26' ? 1.2 : 2.2; let lastPop = -1, boostAtLift = 0, tval = 0;
    let rpm = idle, thrS = 0, boost = 0, ang = 0, whPh = 0, tuPh = 0, popEnv = 0, liftT = -10, prevThr = 0, tickEnv = 0, prev = 0;
    for (let i = 0; i < n; i += BLOCK) {
      const t = i / FS; let tr = idle, thr = 0, limiter = false;
      if (t < 1.5) thr = 0.05;
      else if (t < 6.5) { const u = (t - 1.5) / 5; tr = idle + (lim - idle) * Math.pow(u, 0.8); thr = 1; }
      else if (t < 7.5) { limiter = Math.floor(t * 15) % 2 === 1; tr = lim - 120 * (limiter ? 1 : 0); thr = 1; }
      else if (t < 10.5) { const u = (t - 7.5) / 3; tr = lim - (lim - idle) * (1 - Math.pow(1 - u, 2)); }
      else thr = 0.05;
      if (prevThr > 0.5 && thr < 0.1) { liftT = t; boostAtLift = boost; } prevThr = thr;
      v.setControl({ rpm: tr, load: limiter ? 0.1 : thr, throttle: thr, wheelSpeedMs: 0, limiter });
      v.render(buf);
      for (let k = 0; k < BLOCK && i + k < n; k++) {
        rpm += (tr - rpm) * 0.001; thrS += (thr - thrS) * 0.002;
        boost += ((turbo ? thr * Math.min(1, rpm / (0.6 * lim)) : 0) - boost) / ((turbo?.lagS ?? 0.3) * FS);
        const a0 = ang; ang = (ang + rpm * 6 / FS) % 720;
        let ex = buf[k];
        if (turbo) { ma[mi] = ex; mi = (mi + 1) % maN; let sm = 0; for (let q = 0; q < maN; q++) sm += ma[q]; ex = mufB.run(mufA.run(sm / maN)) * MUFG; }
        ex = bass.run(ex);
        let gate = 0, ev = false;
        for (let c = 0; c < nc; c++) {
          const ph = ((ang - fire[c] - 360 + 1440) % 720) / 180; if (ph < 1) gate += Math.sin(Math.PI * ph) ** 2;
          const f = fire[c]; if ((a0 <= f && ang > f) || (ang < a0 && (f > a0 || f <= ang))) ev = true;
        }
        if (ev) tickEnv = 1; tickEnv *= 0.995;
        let o = ex;
        if (P.intake) { const nz = rnd() * gate; o += P.intake * (0.25 + thrS) * (inBP.run(nz) * 0.6 + inBP2.run(nz) * 0.25); }
        if (P.block) { const d = ex - prev; o += P.block * 0.5 * (blk[0].run(d) + 0.7 * blk[1].run(d) + 0.4 * blk[2].run(d)); }
        prev = ex;
        if (P.tick) o += P.tick * 0.05 * tickBP.run(rnd() * tickEnv) * (0.3 + rpm / lim);
        if (P.turbo && turbo) { const fc = turbo.centerHz + turbo.spanHz * boost; tuBP.bp(fc, 8); tuPh += 2 * Math.PI * fc * 1.4 / FS;
          o += P.turbo * boost * (0.03 * tuBP.run(rnd()) + 0.012 * Math.sin(tuPh)); }
        if (P.whine && (id === 'ow26' || id === 'lmp2-a' || id === 'hyper-a' || id === 'f4')) { whPh += 2 * Math.PI * (rpm / 60) * 9.3 / FS; o += P.whine * 0.025 * Math.sin(whPh); }
        if (P.crackle && ev) { const since = t - liftT; const rate = POPRATE * (rpm / lim) * Math.exp(-since / 0.8);
          if (since > 0.08 && since < 2.2 && rpm > 3500 && t - lastPop > 0.025 && Math.random() < rate / (rpm / 60 * nc / 2)) {
            v.pop(POPAMP * (0.6 + 0.8 * Math.random()), (0.002 + 0.003 * Math.random()) * Number(process.env.POPW ?? 1)); lastPop = t; } }
        if (turbo) { const tr0 = tval; const since = t - liftT;
          if (since >= 0 && since < 0.8 && boostAtLift > 0.3) {
            if (id === 'f4') { const env = Math.exp(-since / 0.12) * boostAtLift; const flut = since > 0.05 && since < 0.35 ? 0.5 + 0.5 * Math.cos(2 * Math.PI * 10 * since) : 0;
              o += 0.06 * env * bovBP.run(rnd()) + 0.08 * flut * Math.exp(-since / 0.2) * flBP.run(rnd()); }
            if (id === 'hyper-a') o += 0.02 * Math.exp(-since / 0.05) * boostAtLift * bovBP.run(rnd());
            if (id === 'ow26') o += 0.05 * Math.exp(-since / 0.1) * boostAtLift * wgBP.run(rnd() * (0.5 + 0.5 * Math.sin(ang * Math.PI / 120)));
          } void tr0; }
        y[i + k] = Math.tanh(o * 1.5) / 1.5;
      }
    }
    wav(`${OUT}/${pname}/${id}.wav`, y);
  }
  console.log('done', pname);
}
