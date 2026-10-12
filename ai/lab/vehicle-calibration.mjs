// Planner-side Rapier experiment: measures 0-100, top speed, braking, cornering and high-speed stability
// for the car constants below. Edit the constants, run, copy verified values into ai/guides/architecture.md.
// Run from repo root after `npm install`: node ai/lab/vehicle-calibration.mjs
import RAPIER from '@dimforge/rapier3d-compat';

const DT = 1 / 120, RHO = 1.225;
const CAR = {
  mass: 650, half: [0.8, 0.2, 2.0], radius: 0.33, rest: 0.12, travel: 0.1,
  stiffness: 60, compression: 4.4, relaxation: 2.3, frictionSlip: 2.2, sideStiffness: 1.0,
  wheels: [[-0.8, 0, -1.3], [0.8, 0, -1.3], [-0.8, 0, 1.25], [0.8, 0, 1.25]],
  power: 130000, maxForce: 6000, brakeMax: 20, steerLow: 0.35, steerHigh: 0.10, cda: 0.9, cla: 2.0,
};

await RAPIER.init();

function makeCar() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.6, 0).setCanSleep(false));
  world.createCollider(RAPIER.ColliderDesc.cuboid(...CAR.half).setMass(CAR.mass), body);
  const v = world.createVehicleController(body);
  for (const [x, y, z] of CAR.wheels) v.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, CAR.rest, CAR.radius);
  for (let i = 0; i < 4; i++) {
    v.setWheelSuspensionStiffness(i, CAR.stiffness); v.setWheelSuspensionCompression(i, CAR.compression);
    v.setWheelSuspensionRelaxation(i, CAR.relaxation); v.setWheelFrictionSlip(i, CAR.frictionSlip);
    v.setWheelMaxSuspensionTravel(i, CAR.travel); v.setWheelSideFrictionStiffness(i, CAR.sideStiffness);
  }
  return { world, body, v };
}

function forwardSpeed(b) {
  const l = b.linvel(), q = b.rotation();
  return -(l.x * 2 * (q.x * q.z + q.w * q.y) + l.y * 2 * (q.y * q.z - q.w * q.x) + l.z * (1 - 2 * (q.x * q.x + q.y * q.y)));
}

function step(car, throttle, brake, steer) {
  const { world, body, v } = car;
  const sp = forwardSpeed(body);
  const force = throttle * Math.min(CAR.maxForce, CAR.power / Math.max(sp, 1));
  v.setWheelEngineForce(2, force / 2); v.setWheelEngineForce(3, force / 2);
  for (let i = 0; i < 4; i++) v.setWheelBrake(i, brake * CAR.brakeMax);
  const maxSteer = CAR.steerLow + (CAR.steerHigh - CAR.steerLow) * Math.min(Math.abs(sp) / 60, 1);
  v.setWheelSteering(0, -steer * maxSteer); v.setWheelSteering(1, -steer * maxSteer);
  const l = body.linvel(), s = Math.hypot(l.x, l.y, l.z);
  if (s > 0.01) { const k = 0.5 * RHO * CAR.cda * s * DT; body.applyImpulse({ x: -l.x * k, y: -l.y * k, z: -l.z * k }, true); }
  body.applyImpulse({ x: 0, y: -0.5 * RHO * CAR.cla * sp * sp * DT, z: 0 }, true);
  v.updateVehicle(DT); world.step();
}

let car = makeCar(), t = 0, t100 = null;
for (; t < 60; t += DT) { step(car, 1, 0, 0); if (t100 === null && forwardSpeed(car.body) >= 27.78) t100 = t; }
console.log(`0-100: ${t100?.toFixed(2)} s | top: ${(forwardSpeed(car.body) * 3.6).toFixed(1)} km/h | rest y: ${car.body.translation().y.toFixed(3)}`);

car = makeCar();
for (let k = 0; k < 1200; k++) step(car, 1, 0, 0);
const v0 = forwardSpeed(car.body); let n = 0;
while (forwardSpeed(car.body) > 5 && n < 2400) { step(car, 0, 1, 0); n++; }
console.log(`brake=1 decel: ${((v0 - forwardSpeed(car.body)) / (n * DT)).toFixed(1)} m/s² from ${(v0 * 3.6).toFixed(0)} km/h`);

car = makeCar(); let flipped = false;
for (let k = 0; k < 120 * 20; k++) {
  step(car, 1, 0, k > 120 * 12 ? 1 : 0);
  const q = car.body.rotation(); if (1 - 2 * (q.x * q.x + q.z * q.z) < 0.5) flipped = true;
}
console.log(`full steer at speed: ${(forwardSpeed(car.body) * 3.6).toFixed(0)} km/h, yaw rate ${car.body.angvel().y.toFixed(3)}, flipped ${flipped}`);
