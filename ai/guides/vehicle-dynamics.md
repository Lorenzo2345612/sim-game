# Vehicle dynamics (Phase 1.5)

In-house vehicle model replacing Rapier's `DynamicRayCastVehicleController`. Rapier keeps: the chassis rigid body, collisions, and ray casts to find the ground. Everything else is ours, in pure functions (no `three`, no Rapier) so it is unit-testable.

## Frames and units

SI everywhere. Body frame: +X right, +Y up, −Z forward. Wheel order FL, FR, RL, RR. Positive steer = left. Simulation at `FIXED_DT = 1/120` s, one sub-step per tick. Reference implementation and calibrated F4 data: `ai/lab/vehicle-model.mjs`, `ai/lab/f4-carspec.json` (run `node ai/lab/vehicle-model.mjs`; all targets pass). Rapier: ray casts with `castRayAndGetNormal(…, filterExcludeRigidBody = chassis)`, chassis collider density 0 + `setAdditionalMassProperties` (re-called when fuel mass changes), forces via `applyImpulseAtPoint(F·dt, point)` before `world.step()`.

## Car definition (`CarSpec`)

One JSON per car in `public/cars/<id>.json`, typed by `src/physics/carSpec.ts`. Every physical parameter lives here; code holds no per-car numbers. Unknown future fields (damage) are optional.

- `chassis`: `massKg` (with driver, no fuel), `cgHeight` (m above ground at static ride height), `inertia` {x, y, z} kg·m² (if absent: box formula from `halfExtents`), `halfExtents`.
- `wheels`: hub `positions[4]` (body frame relative to the CoM at static ride height: y = radius − cgHeight, e.g. F4 0, GT3 −0.06), `radius`, `width`, `inertia` kg·m² (one wheel incl. brake, default 1.2).
- `suspension.front|rear`: `springRate` N/m (wheel rate), `bumpDamping`, `reboundDamping` N·s/m, `restLength`, `travel` m, `bumpStopRate` N/m, `arb` N/m (anti-roll wheel-rate).
- `steering`: `maxAngleLow`, `maxAngleHigh` rad, `fullSpeed` m/s (linear blend), `rate` rad/s (max steer slew).
- `tyres`: `compounds.soft|medium|hard` → `TyreCompound` (below), `optPressureKpa`.
- `aero`: `cda` m², `claFront`, `claRear` m² (lift area, downforce positive), `rideHeightSens` (ClA gain per metre of ride-height reduction).
- `engine`: `torqueCurve` [[rpm, N·m], …] (linear interpolation), `idleRpm`, `launchRpm`, `limiterRpm`, `inertia`, `brakingTorque` N·m (engine braking at closed throttle).
- `gearbox`: `ratios[]`, `final`, `reverse`, `upRpm`, `downRpm`, `shiftTime` s (no drive torque while shifting), `efficiency`.
- `diff`: `type` 'open' | 'lsd' | 'locked', `preload` N·m, `lockPower`, `lockCoast` (0..1).
- `brakes`: `maxTorque` N·m (sum of four wheels at full pedal), `bias` (front share 0..1).
- `aids`: `abs` {enabled, slip}, `tc` {enabled, slip}.
- `fuel`: `capacityL`, `densityKgL` (0.745), `bsfc` g/kWh, `startL`.
- `setup`: ranges for the adjustable parameters (see Setups).
- `drive`: 'rwd' (all Phase 1.5 cars).

## Tyre model (pure)

Simplified Pacejka "magic formula" per axis with a friction-ellipse combination:

- Slip velocities use the **hub** velocity `v + ω_body × (hub − CoM)` (hub = contact point + up·r), evaluated with the gravity-predicted chassis velocity `v + g·dt`. vx = along the wheel's forward axis, vlat = along its right axis.
- Slip ratio κ = (ω·r − vx) / max(|vx|, V_LOW); slip angle target α* = atan2(vlat, max(|vx|, V_LOW)); relaxation `α += (α* − α)·(1 − exp(−dt·max(|vx|, V_LOW)/RELAX))`, RELAX = 0.25 m, V_LOW = 1.5 m/s. Lateral force to the right = −Fy_pure(α).
- Pure forces: F = D·sin(C·atan(B·s − E·(B·s − atan(B·s)))), s = κ (long.) or α (lat.), D = μ·Fz.
- μ = mu0 · (1 − loadSens·(Fz − Fz0)/Fz0) · surfaceGrip · tempFactor · wearFactor · pressureFactor.
- Combined: if (Fx0/Dx)² + (Fy0/Dy)² > 1, scale both by the inverse square root (friction ellipse).
- `TyreCompound`: `mu0`, `Fz0`, `loadSens`, `Bx, Cx, Ex`, `By, Cy, Ey`, `optTempC`, `tempWindowC`, `heatCoef`, `coolCoef`, `wearRate`, `wearGripLoss`, `cliffWear`.
- Temperature: dT/dt = heatCoef·|Fx·vslipx + Fy·vslipy| − coolCoef·(T − ambient)·(1 + 0.05·|v|); ambient 25 °C, start 70 °C (warmers). tempFactor = 1 − min(0.25, ((T − optTempC)/tempWindowC)²·0.25).
- Wear W ∈ [0, 1]: dW/dt = wearRate·|F·vslip|·wearMultiplier. wearFactor = 1 − wearGripLoss·W, minus an extra 0.15·(W − cliffWear)/(1 − cliffWear) when W > cliffWear.
- pressureFactor = 1 − 0.002·(p − optPressureKpa)²/10 (clamped ≥ 0.9); pressure also scales heatCoef by p/optPressureKpa.

## Wheel and suspension (pure + one ray per wheel)

- Ray from the hub's top mount straight down the body −Y, length `restLength + radius`. No hit → airborne (Fz = 0, wheel spins freely).
- Compression x = restLength − (hitDistance − radius), clamped to [0, travel]; past travel add `bumpStopRate`·excess. Damping uses bump or rebound by sign of dx/dt.
- Anti-roll per axle: F_arb = arb·(x_left − x_right), added to the left wheel's load and subtracted from the right's.
- Fz = max(0, spring + damper + arb). Forces applied at the contact point: Fz along the ground normal, tyre forces in the wheel's ground plane.
- Static compression x0 = Fz_static/springRate per wheel; ray origin = hub + up·(restLength − x0) so the spec'd ride height is the rest state.
- **Longitudinal force and wheel spin are solved implicitly** (explicit Euler is unstable at 120 Hz): with slip velocity s = ω·r − vx, sFree = s0 + dt·r·(T_drive − T_brake·sgn ω)/I and c = r²/I + 4/m (m = total mass incl. fuel), solve s1 = sFree − dt·c·Fx(s1) (3–4 Newton steps with bisection fallback on [0, sFree]); apply that Fx to both the wheel (ω += dt/I·(T − r·Fx)) and the chassis.
- Locked wheel: if braking and ω is 0 or would cross 0, solve with s = −vx and c = 4/m; keep ω = 0 while |T_drive − r·Fx| ≤ T_brake, else restart with net − sign(net)·T_brake.
- Safety clamp: no single tyre force may reverse its contact velocity within one step: |F| ≤ (m/4)·|v|/dt.
- I_effective of a driven wheel adds the reflected engine inertia ratio_total²·I_engine/2, except while the clutch slips or the box is shifting.

## Powertrain, brakes, aids (pure)

- Engine rpm from the driven wheels' mean ω through gear and final; in 1st gear the clutch slips: rpm = max(rpmRaw, idle + throttle·(launchRpm − idle)) (`engine.launchRpm`, F4 4000). Torque = curve(rpm)·throttle; cut at `limiterRpm`; closed throttle gives −brakingTorque.
- Gearbox: auto/manual as task 045, generalised to `CarSpec.gearbox`; no drive during `shiftTime`.
- Diff: open = equal split; lsd = coupling torque clamp(K·Δω, ±(preload + lock·|T_in|)), K = 30 N·m·s/rad (explicit limit is I_w/(2·dt) = 72), `lockPower` on drive, `lockCoast` off throttle; locked = lsd with lock 1 (no implicit solve in Phase 1.5).
- Brakes: per-wheel torque = pedal·maxTorque·(bias/2 front, (1 − bias)/2 rear).
- ABS (only above 3 m/s): when a wheel's κ < −abs.slip, halve its brake torque that step. TC: when a driven wheel's κ > tc.slip, scale throttle by 0.5 that step. F4: abs.slip 0.12, tc.slip 0.20.

## Aero and fuel (pure)

- Downforce front/rear = ½·ρ·ClA·v² applied at the front/rear axle centres; ClA grows by `rideHeightSens`·(static ride height − current mean ride height). Drag = ½·ρ·CdA·v² at the CoM, opposite the velocity.
- Fuel flow kg/s = bsfc·max(0, P_engine)/3.6e9 · fuelMultiplier; fuel mass is added to the chassis (Rapier additional mass); empty tank → no drive torque.

## Setups

Eight numbers in six UI groups: `frontWing`, `rearWing` (integer steps → ClA and CdA deltas per step from the car file), `brakeBias`, `finalDrive`, `arbFront`, `arbRear`, `rideHeight` (offset m), `tyrePressureKpa`. Each has min, max, step and default in `CarSpec.setup`; presets `stable`, `balanced`, `aggressive` are value sets in the same file. `applySetup(spec, setup) → CarSpec` is pure (returns a new spec); saved per car+track in localStorage.

## Calibration targets

Per car (lab: `lab.targets` in each `ai/lab/<id>-carspec.json`; `SPEC=path node ai/lab/vehicle-model.mjs`). GT3 (`ai/lab/gt3-carspec.json`): 0–100 3.0–3.8 s; vmax 265–295; braking 200→0 ≤ 110 m; skidpad 1.4–1.9 g; brake+steer no spin; fuel 1.5–2.5 L/min at race pace. Wing steps use `aero.wingStep` {claFront, claRear, cda} (task 058 naming).

### F4

0–100 km/h 3.4–4.2 s; vmax 215–235 km/h; braking 150→0 ≤ 60 m; steady skidpad (R 100 m) 1.5–2.2 g; brake + full steer at 150 km/h for 2 s: no spin (heading vs velocity < 30°); standstill on flat: drift < 1 cm in 10 s; on a 5 % slope with full brake: drift < 5 cm in 10 s; static ride height within 5 mm of spec after settling 2 s.

Known limitation: a locked wheel keeps ~67 % lateral grip through the friction ellipse (forgiving, sim-cade); revisit with combined-slip weighting if lock-ups feel too safe.
