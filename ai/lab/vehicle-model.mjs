// Planner lab: proves ai/guides/vehicle-dynamics.md numerically (Rapier chassis + 4 ray casts + our tyre/powertrain model).
// Run from repo root: node ai/lab/vehicle-model.mjs [test ...]   (tests: stress accel brake skid brakesteer standstill slope ride lowspeed drop stint)
// Lab code, not production. Spec: ai/lab/f4-carspec.json (CarSpec structure of the guide + lab extras noted in the report).
import RAPIER from '@dimforge/rapier3d-compat';
import fs from 'node:fs';

const BASE = JSON.parse(fs.readFileSync(new URL('./f4-carspec.json', import.meta.url), 'utf8'));
// SPEC_PATCH='{"engine":{"launchRpm":4500}}' deep-merges over the JSON for quick sweeps.
const merge = (a, b) => { for (const k in b) a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge(a[k] ?? {}, b[k]) : b[k]; return a; };
if (process.env.SPEC_PATCH) merge(BASE, JSON.parse(process.env.SPEC_PATCH));
const DT = 1 / 120, RHO = 1.225, G = 9.81, V_LOW = BASE.lab?.vLow ?? 1.5, RELAX = BASE.lab?.relax ?? 0.25, AMBIENT = 25;
const RPM = 30 / Math.PI; // rad/s -> rpm
await RAPIER.init();

// ---- vector helpers (lab code: allocation is fine) ----
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a) || 1; return mul(a, 1 / n); };
const rot = (q, v) => {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const V3 = (a) => ({ x: a[0], y: a[1], z: a[2] });
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerpCurve = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]); }
  return pts[pts.length - 1][1];
};
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- tyre (pure) ----
const magic = (B, C, E, s) => { const bs = B * s; return Math.sin(C * Math.atan(bs - E * (bs - Math.atan(bs)))); };
function tyreForces(P, Fz, grip, kappa, alpha, out) {
  if (Fz <= 0) { out[0] = out[1] = 0; return out; }
  const mu = P.mu0 * Math.max(0.3, 1 - P.loadSens * (Fz - P.Fz0) / P.Fz0) * grip;
  const D = mu * Fz;
  let sx = magic(P.Bx, P.Cx, P.Ex, kappa), sy = magic(P.By, P.Cy, P.Ey, alpha);
  const s = Math.hypot(sx, sy), k = s > 1 ? 1 / s : 1; // friction ellipse
  out[0] = D * sx * k; out[1] = -D * sy * k; // fx along wheel forward, fy along wheel right
  return out;
}
const tempFactor = (P, T) => 1 - Math.min(0.25, ((T - P.optTempC) / P.tempWindowC) ** 2 * 0.25);
const wearFactor = (P, W) => 1 - P.wearGripLoss * W - (W > P.cliffWear ? 0.15 * (W - P.cliffWear) / (1 - P.cliffWear) : 0);
const pressureFactor = (spec, p) => Math.max(0.9, 1 - 0.002 * (p - spec.tyres.optPressureKpa) ** 2 / 10);

// ---- car ----
function makeCar(spec, o = {}) {
  const slope = o.slope ?? 0, y0 = o.y0 ?? spec.chassis.cgHeight, v0 = o.v0 ?? 0;
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  const qs = { x: Math.sin(slope / 2), y: 0, z: 0, w: Math.cos(slope / 2) };
  const n0 = rot(qs, [0, 1, 0]);
  world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 0.5, 20000).setTranslation(...mul(n0, -0.5)).setRotation(qs));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...mul(n0, y0)).setRotation(qs).setCanSleep(false));
  const he = spec.chassis.halfExtents, cg = spec.chassis.cgHeight;
  world.createCollider(RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z).setTranslation(0, -cg + 0.06 + he.y, 0).setDensity(0), body);
  const startL = o.startL ?? spec.fuel.startL;
  const c = {
    spec, world, body, t: 0, steer: 0, gear: 1, shiftT: 0, fuelKg: startL * spec.fuel.densityKgL, massSet: -1, rpm: spec.engine.idleRpm,
    comp: o.compound ?? 'medium', press: o.press ?? spec.tyres.optPressureKpa, throttleEff: 0, brakeIn: 0, tcCut: false,
    ax: [0, 0, 0], wheels: [], mount: [], x0: [], P: spec.tyres.compounds[o.compound ?? 'medium'],
    abs: o.abs ?? spec.aids.abs.enabled, tc: o.tc ?? spec.aids.tc.enabled, bias: o.bias ?? spec.brakes.bias,
  };
  // static compression from corner loads (no aero), mount height = restLength - x0 above hub
  const pos = spec.wheels.positions, L = pos[2][2] - pos[0][2];
  const frontShare = pos[2][2] / L; // weight on front axle = b/L
  for (let i = 0; i < 4; i++) {
    const s = i < 2 ? spec.suspension.front : spec.suspension.rear;
    const share = (i < 2 ? frontShare : 1 - frontShare) / 2;
    const x0 = spec.chassis.massKg * G * share / s.springRate;
    c.x0.push(x0);
    c.mount.push([pos[i][0], pos[i][1] + s.restLength - x0, pos[i][2]]);
    c.wheels.push({ omega: v0 / spec.wheels.radius, alphaS: 0, x: x0, T: o.T0 ?? c.P.optTempC, W: 0, kappa: 0, grip: 1, fx: 0, fy: 0, fz: 0, hit: true });
  }
  if (v0 > 0) { body.setLinvel(V3(rot(qs, [0, 0, -v0])), true); c.gear = pickGear(spec, v0); }
  applyMass(c);
  return c;
}
function pickGear(spec, v) {
  const gb = spec.gearbox;
  for (let g = gb.ratios.length; g >= 1; g--) { const rpm = v / spec.wheels.radius * gb.ratios[g - 1] * gb.final * RPM; if (rpm < gb.upRpm - 300 && rpm > gb.downRpm) return g; }
  return 1;
}
function applyMass(c) {
  const m = c.spec.chassis.massKg + c.fuelKg;
  if (Math.abs(m - c.massSet) < 0.05) return;
  c.massSet = m; const k = m / c.spec.chassis.massKg, I = c.spec.chassis.inertia;
  c.body.setAdditionalMassProperties(m, { x: 0, y: 0, z: 0 }, { x: I.x * k, y: I.y * k, z: I.z * k }, { x: 0, y: 0, z: 0, w: 1 }, true);
}

const ft = [0, 0], ft2 = [0, 0];
function step(c, inp) {
  const { spec, body, world } = c, R = spec.wheels.radius, st = spec.steering, ae = spec.aero;
  const p = body.translation(), q = body.rotation(), lv = body.linvel(), av = body.angvel();
  const Pw = [p.x, p.y, p.z], Vw = [lv.x, lv.y, lv.z], Ww = [av.x, av.y, av.z];
  const Vp = [Vw[0], Vw[1] - G * DT, Vw[2]]; // velocity predicted after gravity: tyre slip uses it (else a steady creep of g*sin(slope)*dt remains)
  const up = rot(q, [0, 1, 0]), fwdB = rot(q, [0, 0, -1]);
  const speed = norm(Vw), vfwd = dot(Vw, fwdB);
  const mass = c.massSet;
  // steering
  const maxA = st.maxAngleLow + (st.maxAngleHigh - st.maxAngleLow) * Math.min(1, speed / st.fullSpeed);
  const tgt = clamp(inp.steer, -1, 1) * maxA;
  c.steer += clamp(tgt - c.steer, -st.rate * DT, st.rate * DT);

  // suspension + ground
  const ws = c.wheels;
  let meanX = 0;
  for (let i = 0; i < 4; i++) {
    const w = ws[i], s = i < 2 ? spec.suspension.front : spec.suspension.rear;
    const origin = add(Pw, rot(q, c.mount[i]));
    const hit = world.castRayAndGetNormal(new RAPIER.Ray(V3(origin), V3(mul(up, -1))), s.restLength + R, true, undefined, undefined, undefined, body);
    w.hit = !!hit;
    if (!hit) { w.x = 0; w.fz = 0; w.n = up; w.cp = null; w.xraw = 0; w.xdot = 0; continue; }
    const d = hit.timeOfImpact;
    w.cp = add(origin, mul(up, -d)); w.n = [hit.normal.x, hit.normal.y, hit.normal.z];
    w.xraw = s.restLength + R - d;
    const vm = add(Vw, cross(Ww, sub(origin, Pw)));
    w.xdot = -dot(vm, up);
    w.x = clamp(w.xraw, 0, s.travel);
    const spring = s.springRate * w.x + (w.xraw > s.travel ? s.bumpStopRate * (w.xraw - s.travel) : 0);
    w.fzBase = spring + (w.xdot > 0 ? s.bumpDamping : s.reboundDamping) * w.xdot;
  }
  for (let a = 0; a < 2; a++) {
    const l = ws[a * 2], r = ws[a * 2 + 1], s = a ? spec.suspension.rear : spec.suspension.front;
    const arb = s.arb * (l.x - r.x);
    if (l.hit) l.fz = Math.max(0, l.fzBase + arb);
    if (r.hit) r.fz = Math.max(0, r.fzBase - arb);
  }
  for (let i = 0; i < 4; i++) meanX += (ws[i].x - c.x0[i]) / 4;

  // aero (applied at axle centres / CoM)
  const sens = ae.rideHeightSens * (-meanX);
  const q2 = 0.5 * RHO * speed * speed;
  const pos = spec.wheels.positions;
  const downF = q2 * Math.max(0, ae.claFront + sens * 0.4), downR = q2 * Math.max(0, ae.claRear + sens * 0.6);
  body.applyImpulseAtPoint(V3(mul(up, -downF * DT)), V3(add(Pw, rot(q, [0, 0, pos[0][2]]))), true);
  body.applyImpulseAtPoint(V3(mul(up, -downR * DT)), V3(add(Pw, rot(q, [0, 0, pos[2][2]]))), true);
  if (speed > 0.01) body.applyImpulse(V3(mul(Vw, -q2 * ae.cda / speed * DT)), true);

  // powertrain
  const en = spec.engine, gb = spec.gearbox;
  const omegaDrv = Math.max(0, (ws[2].omega + ws[3].omega) / 2);
  let thr = clamp(inp.throttle, 0, 1);
  if (c.tc && c.tcCut) thr *= 0.5;
  const ratioTot = gb.ratios[c.gear - 1] * gb.final;
  const rpmRaw = omegaDrv * ratioTot * RPM;
  let rpm = Math.max(rpmRaw, en.idleRpm);
  if (c.gear === 1) rpm = Math.max(rpm, en.idleRpm + thr * (en.launchRpm - en.idleRpm));
  c.rpm = rpm;
  const slipping = rpm > rpmRaw + 1;
  if (c.shiftT > 0) c.shiftT -= DT;
  else if (rpmRaw > gb.upRpm && c.gear < gb.ratios.length) { c.gear++; c.shiftT = gb.shiftTime; }
  else if (rpmRaw < gb.downRpm && c.gear > 1) { c.gear--; c.shiftT = gb.shiftTime; }
  let Te = 0;
  if (c.shiftT <= 0) {
    if (c.fuelKg <= 0) Te = 0;
    else if (rpmRaw > en.limiterRpm) Te = 0;
    else Te = lerpCurve(en.torqueCurve, rpm) * thr - en.brakingTorque * (1 - thr) * clamp((rpmRaw - en.idleRpm) / 1500, 0, 1);
  }
  if (Te > 0 && c.fuelKg > 0) {
    c.fuelKg = Math.max(0, c.fuelKg - spec.fuel.bsfc * Te * rpm / RPM / 3.6e9 * DT);
  }
  const Tout = Te * ratioTot * gb.efficiency;
  const Iw = spec.wheels.inertia;
  const Ired = (c.shiftT > 0 || slipping) ? 0 : ratioTot * ratioTot * en.inertia / 2;
  // diff
  const dif = spec.diff; let Tl = Tout / 2, Tr = Tout / 2;
  if (dif.type !== 'open') {
    const lock = dif.type === 'locked' ? 1 : (Tout >= 0 ? dif.lockPower : dif.lockCoast);
    const lim = dif.preload + lock * Math.abs(Tout);
    const Tc = clamp(50 * (ws[2].omega - ws[3].omega), -lim, lim);
    Tl -= Tc; Tr += Tc;
  }
  const Tdrive = [0, 0, Tl, Tr];
  // brakes
  const pedal = clamp(inp.brake, 0, 1), bk = spec.brakes;
  const share = [c.bias / 2, c.bias / 2, (1 - c.bias) / 2, (1 - c.bias) / 2];
  c.tcCut = false;
  for (let i = 0; i < 4; i++) {
    const w = ws[i], P = c.P, axleP = P;
    let Tb = pedal * bk.maxTorque * share[i];
    if (c.abs && speed > 3 && w.kappa < -spec.aids.abs.slip) Tb *= 0.5;
    const I = Iw + (i >= 2 ? Ired : 0);
    let fx = 0, fy = 0;
    if (w.hit) {
      // wheel frame
      const dl = i < 2 ? c.steer : 0;
      const fw = rot(q, [-Math.sin(dl), 0, -Math.cos(dl)]);
      const n = w.n;
      const f = unit(sub(fw, mul(n, dot(n, fw)))), rt = cross(f, n);
      const vc = add(Vp, cross(Ww, sub(add(w.cp, mul(up, R)), Pw))); // slip velocity at the hub, not at the ground point
      const vl = dot(vc, f), vt = dot(vc, rt), Ve = Math.max(Math.abs(vl), V_LOW);
      w.alphaS += (Math.atan2(vt, Ve) - w.alphaS) * (1 - Math.exp(-DT * Ve / RELAX));
      w.grip = tempFactor(P, w.T) * wearFactor(P, w.W) * pressureFactor(spec, c.press);
      const kap = (om) => (om * R - vl) / Ve;
      const Fx = (sl) => tyreForces(P, w.fz, w.grip, sl / Ve, w.alphaS, ft)[0];
      // Longitudinal slip is stiff (>1000/s at low speed): solve the implicit step  s1 = sFree - dt*c*Fx(s1)  by bisection on [0, sFree].
      // c = R^2/I (wheel) + 4/m (chassis, common-mode worst case). Forces on wheel and chassis are the same Fx(s1).
      const solve = (sFree, cc) => { let lo = 0, hi = sFree; for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if ((mid - sFree + DT * cc * Fx(mid)) * Math.sign(sFree) > 0) hi = mid; else lo = mid; } return Fx((lo + hi) / 2); };
      const s0 = w.omega * R - vl, sgn = Math.abs(w.omega) < 1e-4 ? 0 : Math.sign(w.omega);
      const cc = R * R / I + 4 / mass;
      let fxN = solve(s0 + DT * R * (Tdrive[i] - Tb * sgn) / I, cc);
      let omN = w.omega + DT / I * (Tdrive[i] - Tb * sgn - R * fxN);
      if (Tb > 0 && (sgn === 0 || omN * w.omega < 0)) {
        const fl = solve(-vl, 4 / mass), net = Tdrive[i] - R * fl; // wheel locked
        if (Math.abs(net) <= Tb) { omN = 0; fxN = fl; }
        else if (sgn === 0) { omN = DT / I * (net - Math.sign(net) * Tb); fxN = fl; }
      }
      fx = fxN;
      tyreForces(P, w.fz, w.grip, kap(w.omega), w.alphaS, ft); fy = ft[1];
      w.omega = omN;
      w.kappa = kap(omN);
      const mw = mass / 4;
      if (fx * vl < 0) fx = Math.sign(fx) * Math.min(Math.abs(fx), mw * Math.abs(vl) / DT);
      if (fy * vt < 0) fy = Math.sign(fy) * Math.min(Math.abs(fy), mw * Math.abs(vt) / DT);
      w.fx = fx; w.fy = fy;
      const F = add(add(mul(n, w.fz), mul(f, fx)), mul(rt, fy));
      body.applyImpulseAtPoint(V3(mul(F, DT)), V3(w.cp), true);
      // thermal + wear
      const pw = Math.abs(fx * (omN * R - vl)) + Math.abs(fy * vt);
      w.T += (P.heatCoef * c.press / spec.tyres.optPressureKpa * pw - P.coolCoef * (w.T - AMBIENT) * (1 + 0.05 * speed)) * DT;
      w.W = Math.min(1, w.W + P.wearRate * pw * DT);
      if (i >= 2 && w.kappa > spec.aids.tc.slip) c.tcCut = true;
    } else {
      // airborne: wheel spins freely, brake still slows it
      let om = w.omega + DT * (Tdrive[i]) / I;
      const dec = DT * Tb / I; om = Math.abs(om) <= dec ? 0 : om - Math.sign(om) * dec;
      w.omega = om; w.kappa = 0; w.fx = w.fy = 0;
      w.T += -P.coolCoef * (w.T - AMBIENT) * (1 + 0.05 * speed) * DT;
    }
  }
  c.brakeIn = pedal;
  applyMass(c);
  world.step();
  c.t += DT;
}

// ---- sensing ----
function sense(c) {
  const b = c.body, p = b.translation(), q = b.rotation(), lv = b.linvel(), av = b.angvel();
  const fwd = rot(q, [0, 0, -1]), up = rot(q, [0, 1, 0]), V = [lv.x, lv.y, lv.z];
  const speed = Math.hypot(lv.x, lv.z), vfwd = dot(V, fwd);
  const hd = Math.atan2(-fwd[0], -fwd[2]); // heading about +Y (left positive)
  let beta = 0;
  if (speed > 3) { const vd = Math.atan2(-lv.x, -lv.z); beta = Math.atan2(Math.sin(hd - vd), Math.cos(hd - vd)); }
  return { p: [p.x, p.y, p.z], q, V, fwd, up, speed, vfwd, yawRate: av.y, beta, finite: [p.x, p.y, p.z, lv.x, lv.y, lv.z, av.x, av.y, av.z].every(Number.isFinite) };
}
const KMH = 3.6;

// ---- tests ----
const results = [];
const rec = (name, value, unit, ok, note = '') => { results.push({ name, value, unit, ok, note }); };

function tAccel(spec) {
  const c = makeCar(spec, { T0: 90 });
  let t100 = null, vmax = 0, bad = false;
  for (let k = 0; k < 120 * 80; k++) {
    step(c, { throttle: 1, brake: 0, steer: 0 });
    const s = sense(c); if (!s.finite) { bad = true; break; }
    if (t100 === null && s.vfwd >= 100 / KMH) t100 = c.t;
    vmax = Math.max(vmax, s.vfwd);
  }
  const s = sense(c);
  rec('0-100 km/h', t100?.toFixed(2), 's', t100 > 3.4 && t100 < 4.2 && !bad, '3.4-4.2');
  rec('vmax', (s.vfwd * KMH).toFixed(1), 'km/h', s.vfwd * KMH >= 215 && s.vfwd * KMH <= 235, `215-235 (gear ${c.gear}, ${c.rpm.toFixed(0)} rpm)`);
}
function holdSpeed(c, v, ticks, steer = 0) {
  for (let k = 0; k < ticks; k++) { const s = sense(c); step(c, { throttle: clamp(0.3 + 0.15 * (v - s.vfwd), 0, 1), brake: s.vfwd > v + 2 ? 0.3 : 0, steer }); }
}
function tBrake(spec) {
  for (const abs of [false, true]) {
  const c = makeCar(spec, { v0: 150 / KMH, T0: 90, abs });
  holdSpeed(c, 150 / KMH, 120);
  const s0 = sense(c).p; let n = 0;
  while (sense(c).vfwd > 0.3 && n < 120 * 20) { step(c, { throttle: 0, brake: 1, steer: 0 }); n++; }
  const s = sense(c), d = norm(sub(s.p, s0));
  rec(`braking 150->0 ABS ${abs ? 'on' : 'off'}`, d.toFixed(1), 'm', d <= 60, `<=60 (t=${(n * DT).toFixed(2)} s, mean ${(41.67 ** 2 / 2 / d / G).toFixed(2)} g)`);
  }
}
function tSkid(spec) {
  const R0 = 100, c = makeCar(spec, { v0: 12, T0: 90 });
  const ctr = [-R0, 0, 0];
  let vt = 12, best = 0, bestV = 0, ended = 'time', ie = 0;
  const L = spec.wheels.positions[2][2] - spec.wheels.positions[0][2];
  for (let k = 0; k < 120 * 200; k++) {
    const s = sense(c), rad = sub(s.p, ctr); rad[1] = 0;
    const r = norm(rad), e = r - R0, tan = cross([0, 1, 0], unit(rad));
    const herr = Math.atan2(cross(s.fwd, tan)[1], dot(s.fwd, tan));
    ie = clamp(ie + e * DT, -3, 3);
    const delta = Math.atan(L / R0) + 0.04 * e + 0.01 * ie + 1.0 * herr;
    const maxA = spec.steering.maxAngleLow + (spec.steering.maxAngleHigh - spec.steering.maxAngleLow) * Math.min(1, s.speed / spec.steering.fullSpeed);
    vt += 0.25 * DT;
    step(c, { throttle: clamp(0.3 + 0.2 * (vt - s.speed), 0, 1), brake: 0, steer: delta / maxA });
    if (!s.finite) { ended = 'NaN'; break; }
    if (Math.abs(e) > 8) { ended = `radius lost at ${(s.speed * KMH).toFixed(0)} km/h`; break; }
    const ay = s.speed * s.speed / R0 / G;
    if (Math.abs(e) < 4 && ay > best) { best = ay; bestV = s.speed; }
  }
  rec('skidpad R=100', best.toFixed(2), 'g', best >= 1.5 && best <= 2.2, `1.5-2.2 (@${(bestV * KMH).toFixed(0)} km/h, ${ended})`);
}
function runBrakeSteer(spec, opts) {
  const c = makeCar(spec, { v0: 150 / KMH, T0: 90, ...opts });
  holdSpeed(c, 150 / KMH, 120);
  let maxBeta = 0, bad = false, maxYaw = 0;
  for (let k = 0; k < 240; k++) {
    step(c, { throttle: 0, brake: 1, steer: 1 });
    const s = sense(c); if (!s.finite) { bad = true; break; }
    maxBeta = Math.max(maxBeta, Math.abs(s.beta)); maxYaw = Math.max(maxYaw, Math.abs(s.yawRate));
  }
  return { maxBeta: maxBeta * 180 / Math.PI, maxYaw, bad, v: sense(c).speed * KMH };
}
function tBrakeSteer(spec) {
  const a = runBrakeSteer(spec, { abs: true, bias: 0.6 });
  rec('brake+steer 150 ABS on, bias 0.6', a.maxBeta.toFixed(1), 'deg', a.maxBeta < 30 && !a.bad, `<30 (yaw max ${a.maxYaw.toFixed(2)} rad/s, ${a.v.toFixed(0)} km/h left)`);
  for (const [abs, bias] of [[false, 0.5], [false, 0.6], [true, 0.5], [false, 0.3], [true, 0.3]]) {
    const r = runBrakeSteer(spec, { abs, bias });
    rec(`  info: ABS ${abs ? 'on' : 'off'}, bias ${bias}`, r.maxBeta.toFixed(1), 'deg', !r.bad, `report only (yaw max ${r.maxYaw.toFixed(2)} rad/s)`);
  }
}
function drift(c, ticks, inp) {
  const p0 = sense(c).p; let m = 0;
  for (let k = 0; k < ticks; k++) { step(c, inp); m = Math.max(m, norm(sub(sense(c).p, p0))); }
  return norm(sub(sense(c).p, p0));
}
function tStandstill(spec) {
  const c = makeCar(spec);
  drift(c, 240, { throttle: 0, brake: 0, steer: 0 });
  const d = drift(c, 1200, { throttle: 0, brake: 0, steer: 0 });
  rec('standstill flat drift', (d * 100).toFixed(2), 'cm/10s', d < 0.01, '<1 cm');
}
function tSlope(spec) {
  const c = makeCar(spec, { slope: Math.atan(0.05) });
  const d0 = drift(c, 240, { throttle: 0, brake: 1, steer: 0 });
  const d = drift(c, 1200, { throttle: 0, brake: 1, steer: 0 });
  rec('5% slope full brake drift', (d * 100).toFixed(2), 'cm/10s', d < 0.05, `<5 cm (first 2 s settle: ${(d0 * 100).toFixed(1)} cm)`);
}
function tRide(spec) {
  const c = makeCar(spec, { y0: spec.chassis.cgHeight + 0.02 });
  for (let k = 0; k < 240; k++) step(c, { throttle: 0, brake: 0, steer: 0 });
  const e1 = sense(c).p[1] - spec.chassis.cgHeight;
  for (let k = 0; k < 240; k++) step(c, { throttle: 0, brake: 0, steer: 0 });
  const e2 = sense(c).p[1] - spec.chassis.cgHeight;
  rec('static ride height err @2 s', (e1 * 1000).toFixed(2), 'mm', Math.abs(e1) < 0.005, `<5 (@4 s ${(e2 * 1000).toFixed(2)})`);
}
function tLowSpeed(spec) {
  const c = makeCar(spec, { v0: 5 / KMH, T0: 90 });
  const yr = []; let bad = false;
  for (let k = 0; k < 120 * 6; k++) {
    const s = sense(c);
    step(c, { throttle: clamp(0.15 + 0.3 * (5 / KMH - s.speed), 0, 1), brake: 0, steer: 1 });
    if (!s.finite) { bad = true; break; }
    yr.push(s.yawRate);
  }
  const a = yr.slice(240); let ss = 0, mx = 0;
  for (let i = 2; i < a.length; i++) { const d2 = a[i] - 2 * a[i - 1] + a[i - 2]; ss += d2 * d2; mx = Math.max(mx, Math.abs(d2)); }
  const rms = Math.sqrt(ss / (a.length - 2)), mean = a.reduce((x, y) => x + y, 0) / a.length;
  rec('5 km/h full lock yaw jitter', rms.toFixed(5), 'rad/s/tick^2', rms < 0.002 && !bad, `rms 2nd diff <0.002 (mean yaw ${mean.toFixed(3)} rad/s, max ${mx.toFixed(4)})`);
}
function tDrop(spec) {
  const c = makeCar(spec, { y0: spec.chassis.cgHeight + 0.5 });
  let bad = false, maxV = 0, maxW = 0, minY = 9, flipped = false;
  for (let k = 0; k < 120 * 5; k++) {
    step(c, { throttle: 0, brake: 0, steer: 0 });
    const s = sense(c); if (!s.finite) { bad = true; break; }
    maxV = Math.max(maxV, norm(s.V)); minY = Math.min(minY, s.p[1]); if (s.up[1] < 0.9) flipped = true;
    maxW = Math.max(maxW, ...c.wheels.map((w) => Math.abs(w.omega)));
  }
  const s = sense(c), settle = s.p[1] - spec.chassis.cgHeight;
  rec('drop 0.5 m', `${(settle * 1000).toFixed(1)}`, 'mm err', !bad && !flipped && Math.abs(settle) < 0.005 && maxV < 8, `no NaN/flip, vmax ${maxV.toFixed(1)} m/s, min y ${minY.toFixed(3)}, wheel w max ${maxW.toFixed(2)}, lateral drift ${(Math.hypot(s.p[0], s.p[2]) * 100).toFixed(1)} cm`);
}
function tStint(spec) {
  const c = makeCar(spec, { T0: 60, v0: 20 });
  const fuel0 = c.fuelKg; let bad = false, maxBeta = 0, maxSpeed = 0;
  for (let k = 0; k < 120 * 90; k++) {
    const t = (c.t % 15), s = sense(c);
    let inp;
    if (t < 5) inp = { throttle: 1, brake: 0, steer: 0 };
    else if (t < 7.5) inp = { throttle: 0, brake: 0.8, steer: 0 };
    else if (t < 12) inp = { throttle: clamp(0.3 + 0.2 * (22 - s.speed), 0, 1), brake: 0, steer: 0.45 * Math.sign(Math.sin(c.t / 15 * 4)) };
    else inp = { throttle: clamp(0.3 + 0.2 * (30 - s.speed), 0, 1), brake: 0, steer: -0.2 };
    step(c, inp);
    if (!s.finite) { bad = true; break; }
    maxSpeed = Math.max(maxSpeed, s.speed);
  }
  const T = c.wheels.map((w) => w.T.toFixed(0)).join('/'), Wr = c.wheels.map((w) => (w.W * 100).toFixed(2)).join('/');
  const avgT = c.wheels.reduce((a, w) => a + w.T, 0) / 4;
  rec('stint 90 s tyre temp FL/FR/RL/RR', T, 'C', !bad && avgT > 70 && avgT < 120, `start 60, plausible 70-120; wear% ${Wr}`);
  rec('stint 90 s fuel used', (fuel0 - c.fuelKg).toFixed(3), 'kg', fuel0 - c.fuelKg > 0.1 && fuel0 - c.fuelKg < 2, `vmax ${(maxSpeed * KMH).toFixed(0)} km/h, mass ${c.massSet.toFixed(1)} kg`);
}

function tStress(spec) {
  const c = makeCar(spec, { v0: 200 / KMH, T0: 90 }); let bad = false, flipped = false, maxYaw = 0, ph = 0;
  for (let k = 0; k < 120 * 40; k++) {
    const t = c.t, s = sense(c);
    ph += 2 * Math.PI * (0.5 + 3 * (t / 40)) * DT; // chirp 0.5 -> 3.5 Hz steering
    const brk = Math.sin(t * 0.7) > 0.7;
    step(c, { throttle: brk ? 0 : 1, brake: brk ? 1 : 0, steer: Math.sign(Math.sin(ph)) * (t < 20 ? 1 : 0.5) * (Math.sin(t) > 0 ? 1 : 0.4) });
    if (!s.finite) { bad = true; break; }
    if (s.up[1] < 0.7) flipped = true; maxYaw = Math.max(maxYaw, Math.abs(s.yawRate));
  }
  rec('stress chirp steer + brake/throttle 40 s', bad ? 'NaN' : 'finite', '', !bad && !flipped, `flipped ${flipped}, max yaw ${maxYaw.toFixed(2)} rad/s, final ${(sense(c).speed * KMH).toFixed(0)} km/h`);
}
const TESTS = { stress: tStress, accel: tAccel, brake: tBrake, skid: tSkid, brakesteer: tBrakeSteer, standstill: tStandstill, slope: tSlope, ride: tRide, lowspeed: tLowSpeed, drop: tDrop, stint: tStint };
const want = process.argv.slice(2);
for (const [name, fn] of Object.entries(TESTS)) if (!want.length || want.includes(name)) fn(clone(BASE));
const w = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${String(r.value).padStart(9)} ${r.unit.padEnd(12)} ${r.note}`);
const failed = results.filter((r) => !r.ok && !r.name.startsWith('  info'));
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
