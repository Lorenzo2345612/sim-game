# 011 — Implement the physics vehicle (Rapier raycast vehicle)

Status: done
Phase: 0
Depends on: 002, 010
Complexity: complex
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

A `Vehicle` class that, given a `DriverInput`, applies engine, brake, steering and aerodynamics and exposes a `VehicleState`.

## Context

Read `ai/guides/architecture.md`: "Conventions" (yaw, quaternion forward), "Placeholder car" and "Rapier: verified facts" (all signs and formulas are verified: do not change them). No `three`.

## Files

- `src/physics/vehicle.ts` — create
- `tests/unit/physics/vehicle.test.ts` — create

## Steps

Imports: `RAPIER` from `./physicsWorld`; `VehicleConfig` from `./vehicleConfig`; `DriverInput, SpawnPose, VehicleState` from `../core/types`; `AIR_DENSITY` from `../core/constants`.

```ts
export class Vehicle {
  constructor(world: RAPIER.World, config: VehicleConfig, spawn: SpawnPose);
  setInput(input: DriverInput): void; // stores a COPY (throttle, brake, steer); `reset` is ignored
  prePhysicsStep(dt: number): void;
  getState(out?: VehicleState): VehicleState;
  reset(spawn: SpawnPose): void;
  readonly body: RAPIER.RigidBody;
}
```

1. Constructor: spawn quaternion `q = { x: 0, y: sin(yaw/2), z: 0, w: cos(yaw/2) }`. Body and collider exactly as in "Rapier: verified facts" (the Chassis bullet) (position = `spawn.position`, `setRotation(q)`, `setCanSleep(false)`, collider `cuboid(hx,hy,hz).setMass(massKg)`). `controller = world.createVehicleController(body)`. For each `config.wheelPositions[i]`: `controller.addWheel(pos, {x:0,y:-1,z:0}, {x:1,y:0,z:0}, suspensionRestLength, wheelRadius)`; then `setWheelMaxSuspensionTravel`, `setWheelSuspensionStiffness`, `setWheelSuspensionCompression`, `setWheelSuspensionRelaxation`, `setWheelFrictionSlip`, `setWheelSideFrictionStiffness` with config values (Rapier 0.21 method names; if one does not exist check the `.d.ts` in `node_modules/@dimforge/rapier3d-compat`; do not invent others).
2. `setInput`: copy fields into an internal object (never keep the reference).
3. `prePhysicsStep(dt)`, in this order:
   a. `v = body.linvel()`, `q = body.rotation()`, `fwd = forward(q)` (formula in architecture.md), `forwardSpeed = v·fwd`, `speed = |v|`.
   b. Drag: if `speed > 0.01`: `k = 0.5*AIR_DENSITY*dragAreaCdA*speed*dt`; `body.applyImpulse({x:-v.x*k, y:-v.y*k, z:-v.z*k}, true)`.
   c. Downforce: `body.applyImpulse({x:0, y:-0.5*AIR_DENSITY*liftAreaClA*forwardSpeed²*dt, z:0}, true)`.
   d. `maxSteer = lerp(maxSteerLowSpeed, maxSteerHighSpeed, clamp(|forwardSpeed|/STEER_FULL_SPEED, 0, 1))`, `lerp(a,b,t)=a+(b-a)*t`. `setWheelSteering(0, s)` and `(1, s)` with `s = -input.steer * maxSteer`. Local constant `STEER_FULL_SPEED = 60` (m/s).
   e. `F = input.throttle * min(maxDriveForceN, enginePowerW / max(forwardSpeed, 1))`; `setWheelEngineForce(2, F/2)`, `(3, F/2)`; wheels 0 and 1 get 0.
   f. `setWheelBrake(i, input.brake * brakeMax)` for i = 0..3.
   g. `controller.updateVehicle(dt)`. The caller then calls `world.step()` (this class NEVER calls it).
4. `getState(out?)`: if no `out`, create a new state (4 wheels); otherwise overwrite its fields in place without allocating new objects and return that same `out`. `position`/`rotation` from `body.translation()/rotation()`; `forwardSpeed = linvel·forward(q)`. For each wheel i: chassis-space point `c = controller.wheelChassisConnectionPointCs(i)` with `c.y -= controller.wheelSuspensionLength(i)` (copy to local scalars; do not mutate the returned object). Rotate vector by unit quaternion: `t = 2 * (q.xyz × c)`; `c' = c + q.w*t + (q.xyz × t)`; world position = `c'` + `body.translation()`. `rotation = wheelRotation(i)` (0 if undefined/null), `steering = wheelSteering(i)` (same), `inContact = wheelIsInContact(i)`.
5. `reset(spawn)`: `setTranslation(spawn.position, true)`, `setRotation(q from yaw, true)`, `setLinvel(0,0,0,true)`, `setAngvel(0,0,0,true)`; for i=0..3: `setWheelEngineForce(i,0)`, `setWheelBrake(i,0)`, `setWheelSteering(i,0)`; `body.wakeUp()`; internal input to zeros.

## Tests (`tests/unit/physics/vehicle.test.ts`)

Per-test timeout 20000 ms. `beforeAll(initPhysics)`; each test: `world = createPhysicsWorld()`, `new Vehicle(world, PLACEHOLDER_CAR, {position:{x:0,y:0.6,z:0}, yaw:0})`; `afterEach` `world.free()`. Helper `run(seconds, input)`: per step `vehicle.setInput(input); vehicle.prePhysicsStep(FIXED_DT); world.step();`.
- `settles at rest height with 4 wheels in contact`: zero input 2 s → `y` in [0.33, 0.45] and all 4 wheels `inContact`.
- `accelerates 0-100 km/h in 3.0-4.0 s heading -Z`: throttle 1; count steps until `forwardSpeed >= 27.78` (abort at 8 s); time in [3.0, 4.0]; `position.z < 0`.
- `top speed after 30 s is 55-66 m/s`: throttle 1 for 30 s → forwardSpeed in [55, 66].
- `braking from ~50 m/s decelerates 12-20 m/s²`: throttle 1 until forwardSpeed >= 50; record v0; `brake=1, throttle=0` for 1 s; `(v0 - v1)/1` in [12, 20].
- `steer +1 at ~20 m/s turns right`: throttle 1 until forwardSpeed >= 20, then `steer=1, throttle=0.3` for 1 s: `body.angvel().y < 0` and final `x` > initial `x`.
- `yaw pi/2 spawn accelerates towards -X`: spawn yaw `Math.PI/2`, throttle 1 for 2 s → `x < 0` and `|z| < 1`.
- `reset restores spawn pose and zero velocity`: accelerate 2 s, `reset(spawn)`: position ≈ spawn (±0.01 per axis), `|linvel| < 0.01` and `getState().forwardSpeed` within ±0.01 of 0.
- `getState returns the same out object`: `const out = vehicle.getState(); expect(vehicle.getState(out)).toBe(out)`; `out.wheels.length === 4`.
- `does not flip`: throttle 1 for 20 s, then `steer=1` (throttle 1) for 8 s; at every step the body up-vector y component (`1 - 2*(q.x² + q.z²)`) > 0.5.

Planner decisions (edge cases):
- Before the first `setInput`, the stored input is all zeros (throttle 0, brake 0, steer 0).
- `setInput` clamps: throttle and brake to [0, 1], steer to [-1, 1]; NaN → 0.
- `prePhysicsStep(dt)` with `dt <= 0` or non-finite is a no-op. No special handling for large dt.
- All 4 wheels' `rotation` grows while rolling forward, front included (verified: equal values on all wheels, `ai/lab/front-wheel-rotation.mjs`).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract: the `acceptance` worker writes these rows as `tests/unit/acceptance/011-*.test.ts` before the coder starts. Coder, tester and spec writers must not change them.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | world from 010, `Vehicle(PLACEHOLDER_CAR)` spawned at (0, 0.6, 0) yaw 0, no input | 2 s of steps | body y 0.33–0.45; 4 wheels inContact |
| AT2 | same | full throttle | reaches 27.78 m/s forwardSpeed in 3.0–4.0 s; position z decreasing (moves −Z) |
| AT3 | same | full throttle 30 s | forwardSpeed 55–66 m/s |
| AT4 | at ~50 m/s | brake 1, throttle 0 for 1 s | mean deceleration 12–20 m/s² |
| AT5 | at ~20 m/s | steer +1 for 1 s | angvel.y < 0 and x increased (turns right) |
| AT6 | spawn yaw π/2 | full throttle 2 s | x decreasing, \|z\| < 1 (moves −X) |
| AT7 | moving car | `reset(spawn)` | position = spawn ±0.01; linvel ≈ 0; forwardSpeed 0 ±0.01 |
| AT8 | any | `getState(out)` | returns the same object `out`; wheels length 4 |
| AT9 | full throttle 20 s then steer +1 for 8 s | each step | never flips (body up-vector y > 0.5) |

## Acceptance criteria

- [ ] All tests pass; `typecheck` and `lint` clean.
- [ ] `getState(out)` allocates no new objects (code review).
- [ ] Numeric constants come only from `VehicleConfig`/`constants.ts` (except `STEER_FULL_SPEED`).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Pacejka tyres, gearbox, engine audio, damage, tuning of the config values.
- Calling `world.step()` inside `Vehicle`. Code comments only where logic is non-obvious.
