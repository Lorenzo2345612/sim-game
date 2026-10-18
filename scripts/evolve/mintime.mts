// Minimum-lap-time line: per-index lateral offsets (within edges − 1 m) optimised for a quasi-steady-state (QSS) lap time.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const G = 9.81, RHO = 1.225, K = 5; // curvature from points i±K (~10 m)

export interface QssCar { m: number; muLat: number; claSum: number; cda: number; rearShare: number; drive: (v: number) => number }

// Grip scaled so the zero-downforce lateral limit is 1.5 g (same cue level as the trainer's vProf); medium compound.
export function qssCar(spec: any): QssCar {
  const m = spec.chassis.massKg + spec.fuel.startL * spec.fuel.densityKgL;
  const muLat = 1.5;
  const claSum = spec.aero.claFront + spec.aero.claRear;
  const tc: [number, number][] = spec.engine.torqueCurve, lim = spec.engine.limiterRpm, r = spec.wheels.radius;
  const eff = spec.gearbox.efficiency ?? 1, fin = spec.gearbox.final;
  const torque = (rpm: number) => {
    if (rpm <= tc[0][0]) return tc[0][1];
    for (let i = 1; i < tc.length; i++) if (rpm <= tc[i][0]) { const t = (rpm - tc[i - 1][0]) / (tc[i][0] - tc[i - 1][0]); return tc[i - 1][1] + t * (tc[i][1] - tc[i - 1][1]); }
    return tc[tc.length - 1][1];
  };
  const drive = (v: number) => {
    let best = 0;
    for (const g of spec.gearbox.ratios) {
      const rpm = (Math.max(v, 1) / r) * g * fin * 60 / (2 * Math.PI);
      if (rpm > lim) continue;
      best = Math.max(best, (torque(rpm) * g * fin * eff) / r);
    }
    return best;
  };
  return { m, muLat, claSum, cda: spec.aero.cda, rearShare: 0.55, drive };
}

function curvatures(px: Float64Array, pz: Float64Array, out: Float64Array): void {
  const n = px.length;
  for (let i = 0; i < n; i++) {
    const a = (i - K + n) % n, c = (i + K) % n;
    const ax = px[a], az = pz[a], bx = px[i], bz = pz[i], cx = px[c], cz = pz[c];
    const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
    out[i] = (2 * Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax))) / Math.max(ab * bc * ca, 1e-6);
  }
}

// QSS lap time with friction ellipse; fills v (speed per index) if given.
export function qssLap(car: QssCar, px: Float64Array, pz: Float64Array, v?: Float64Array): number {
  const n = px.length, kap = new Float64Array(n), ds = new Float64Array(n), vmax = new Float64Array(n), vv = v ?? new Float64Array(n);
  curvatures(px, pz, kap);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; ds[i] = Math.hypot(px[j] - px[i], pz[j] - pz[i]); }
  const aD = (0.5 * RHO * car.claSum) / car.m, aDrag = (0.5 * RHO * car.cda) / car.m;
  for (let i = 0; i < n; i++) { // mu (g + aD v²) = kappa v²
    const den = kap[i] - car.muLat * aD;
    vmax[i] = den <= 1e-6 ? 95 : Math.min(95, Math.sqrt((car.muLat * G) / den));
  }
  const lim = (u: number) => car.muLat * (G + aD * u * u);
  let i0 = 0; for (let i = 1; i < n; i++) if (vmax[i] < vmax[i0]) i0 = i;
  vv[i0] = vmax[i0];
  for (let s = 1; s <= n; s++) { // forward: traction/power limited
    const i = (i0 + s - 1) % n, j = (i0 + s) % n, u = vv[i];
    const tot = lim(u), ay = kap[i] * u * u, rem = Math.sqrt(Math.max(0, 1 - (ay / tot) ** 2));
    const trac = Math.min(car.drive(u) / car.m, tot * car.rearShare) * rem - aDrag * u * u;
    vv[j] = Math.min(vmax[j], Math.sqrt(Math.max(1, u * u + 2 * trac * ds[i])));
  }
  for (let pass = 0; pass < 2; pass++) for (let s = n; s >= 1; s--) { // backward: braking
    const i = (i0 + s - 1) % n, j = (i0 + s) % n, u = vv[j];
    const tot = lim(u), ay = kap[j] * u * u, rem = Math.sqrt(Math.max(0, 1 - (ay / tot) ** 2));
    const dec = tot * rem + aDrag * u * u;
    vv[i] = Math.min(vv[i], Math.sqrt(u * u + 2 * dec * ds[i]));
  }
  let t = 0;
  for (let i = 0; i < n; i++) t += (2 * ds[i]) / Math.max(vv[i] + vv[(i + 1) % n], 0.5);
  return t;
}

export interface MinTimeLine { pts: [number, number][]; v: number[]; tRacing: number; tMin: number; maxRatio: number }

// q0: starting offsets (racing line), lo/hi: offset bounds (already include the car margin). nx/nz: unit right normals.
export function optimiseLine(car: QssCar, cl: [number, number][], nx: Float64Array, nz: Float64Array, q0: Float64Array, lo: Float64Array, hi: Float64Array): MinTimeLine {
  const n = cl.length, q = Float64Array.from(q0), px = new Float64Array(n), pz = new Float64Array(n);
  const place = () => { for (let i = 0; i < n; i++) { px[i] = cl[i][0] + nx[i] * q[i]; pz[i] = cl[i][1] + nz[i] * q[i]; } };
  place();
  const tRacing = qssLap(car, px, pz);
  let best = tRacing;
  const W = 12, bump = new Float64Array(2 * W + 1);
  for (let k = -W; k <= W; k++) bump[k + W] = Math.exp(-(k * k) / (2 * (W / 2.5) ** 2));
  let step = 0.6;
  for (let sweep = 0; sweep < 60 && step > 0.02; sweep++) {
    const start = best;
    for (let c = 0; c < n; c += 3) for (const dir of [1, -1]) {
      const old: number[] = [];
      for (let k = -W; k <= W; k++) {
        const i = (c + k + n) % n; old.push(q[i]);
        q[i] = Math.max(lo[i], Math.min(hi[i], q[i] + dir * step * bump[k + W]));
        px[i] = cl[i][0] + nx[i] * q[i]; pz[i] = cl[i][1] + nz[i] * q[i];
      }
      const t = qssLap(car, px, pz);
      if (t < best - 1e-6) { best = t; break; }
      for (let k = -W; k <= W; k++) {
        const i = (c + k + n) % n; q[i] = old[k + W];
        px[i] = cl[i][0] + nx[i] * q[i]; pz[i] = cl[i][1] + nz[i] * q[i];
      }
    }
    if (start - best < 0.01) step /= 2;
  }
  place();
  const v = new Float64Array(n), tMin = qssLap(car, px, pz, v);
  let maxRatio = 0;
  for (let i = 0; i < n; i++) maxRatio = Math.max(maxRatio, q[i] >= 0 ? q[i] / Math.max(hi[i], 1e-6) : q[i] / Math.min(lo[i], -1e-6));
  return { pts: Array.from({ length: n }, (_, i) => [px[i], pz[i]] as [number, number]), v: Array.from(v), tRacing, tMin, maxRatio };
}

export function cachedLine(root: string, key: string, build: () => MinTimeLine): MinTimeLine {
  const dir = join(root, 'scripts/evolve/lines'), f = join(dir, `${key}-mintime.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const r = build();
  mkdirSync(dir, { recursive: true });
  writeFileSync(f, JSON.stringify(r));
  return r;
}

// Builds (or loads) the min-time line for a parsed track + car spec, starting from the classic AI's racing line.
export async function minTimeFor(root: string, track: any, spec: any, carId: string): Promise<MinTimeLine> {
  const { computeRacingLine } = await import('../../src/ai/racingLine');
  const { halfWidthAt } = await import('../../src/track/surfaces');
  return cachedLine(root, `${track.id}-${carId}`, () => {
    const cl: [number, number][] = track.centerline, n = cl.length;
    const rl = computeRacingLine(cl, track.widthMeters / 2);
    const nx = new Float64Array(n), nz = new Float64Array(n), q0 = new Float64Array(n), lo = new Float64Array(n), hi = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = cl[(i - 1 + n) % n], b = cl[(i + 1) % n], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
      nx[i] = -tz / l; nz[i] = tx / l;
      lo[i] = -(halfWidthAt(track, 'left', i) - 1); hi[i] = halfWidthAt(track, 'right', i) - 1;
      const lat = (rl.points[2 * i] - cl[i][0]) * nx[i] + (rl.points[2 * i + 1] - cl[i][1]) * nz[i];
      q0[i] = Math.max(lo[i], Math.min(hi[i], lat));
    }
    return optimiseLine(qssCar(spec), cl, nx, nz, q0, lo, hi);
  });
}
