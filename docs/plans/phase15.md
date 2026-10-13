# Phase 1.5 — Vehicle dynamics: task contracts and acceptance tables (planner)

Design: `ai/guides/vehicle-dynamics.md`. Reference implementation: `ai/lab/vehicle-model.mjs`; calibrated data: `ai/lab/f4-carspec.json`. All modules below except 065 and 070 are pure (no `three`, no Rapier). Spec writers: copy each table verbatim into the spec; signatures are the contract.

## 058 — CarSpec type, loader and F4 data (simple; deps none)
Files: `src/physics/carSpec.ts` (types of the guide's CarSpec incl. `engine.launchRpm`, `setup`, `presets`; `parseCarSpec(json: unknown): CarSpec` throws `Error` naming the first missing/invalid field; fills `chassis.inertia` from the box formula when absent), `public/cars/f4.json` (from `ai/lab/f4-carspec.json` plus `id 'f4'`, `name 'F4'`, `category 'open-wheel'`, `model {url '/models/f4.glb'}`; compounds: medium = lab values; soft = medium with mu0 ×1.06, wearRate ×2, optTempC 85; hard = mu0 ×0.95, wearRate ×0.5, optTempC 95; `setup` ranges: frontWing/rearWing int 0–10 default 5 with `aero.wingStep` {claFront 0.06, claRear 0.09, cda 0.015} per step from default, brakeBias 0.50–0.70 step 0.01 default 0.60, finalDrive 3.2–3.8 step 0.05 default 3.5, arbFront/arbRear 6000–40000 N/m step 1000 defaults 18000/12000, rideHeight −0.02–+0.02 m step 0.002 default 0, tyrePressureKpa 120–160 step 1 default 140; `presets` stable/balanced/aggressive).
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `public/cars/f4.json` | `parseCarSpec` | returns; massKg 650, 4 wheel positions, compounds soft/medium/hard, 8 setup entries each with min < default < max (or min ≤ default ≤ max) |
| AT2 | f4 json without `chassis.massKg` | `parseCarSpec` | throws, message contains `chassis.massKg` |
| AT3 | f4 json without `chassis.inertia`, halfExtents {0.8, 0.2, 2.0}, mass 650 | parse | inertia.x = 650·(0.4²+4²)/12 ± 1e-6 (box: Ix = m·(h²+d²)/12 with full sizes) |
| AT4 | f4 json | compare with `ai/lab/f4-carspec.json` | every numeric field present in the lab file is equal |
| AT5 | each preset | values | every value within its setup range |

## 059 — Tyre forces (complex; deps 058)
`src/physics/tyre.ts`: `magic(B, C, E, D, s): number`; `tyreMu(c: TyreCompound, fz: number, factor: number): number` (= mu0·(1 − loadSens·(fz − Fz0)/Fz0)·factor); `tyreForces(c, fz, kappa, alpha, factor, out): {fx, fy}` (pure forces + friction ellipse; fy is the force for positive α, caller negates for right-positive); `relaxAlpha(alpha, target, vx, dt): number`.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | medium compound, fz = Fz0, factor 1 | kappa 0, alpha 0 | fx = 0, fy = 0 |
| AT2 | same | sweep kappa 0…0.5 | max fx ≤ mu0·Fz0 + 1e-6 and ≥ 0.98·mu0·Fz0; peak at kappa in [0.06, 0.16] |
| AT3 | same | kappa ±0.1 | fx(−0.1) = −fx(0.1) |
| AT4 | same | sweep alpha 0…0.4 rad | peak fy in [0.98, 1.0]·mu0·Fz0 at alpha in [0.10, 0.20] rad |
| AT5 | fz = 2·Fz0 | kappa at peak | peak fx = mu0·(1 − loadSens)·2·Fz0 ± 1 % |
| AT6 | kappa 0.1 and alpha 0.15 (both near peak) | combined | (fx/Dx)² + (fy/Dy)² ≤ 1 + 1e-9 and both nonzero |
| AT7 | factor 0.5 | any slip | forces exactly half of factor 1 (ellipse inactive case kappa 0.02, alpha 0) |
| AT8 | `relaxAlpha(0, 0.1, 60, 1/120)` | once | = 0.1·(1 − exp(−(1/120)·60/0.25)) ± 1e-12; with vx 0 uses V_LOW 1.5 |
| AT9 | fz 0 or negative | `tyreForces` | fx = fy = 0, no NaN |

## 060 — Tyre temperature, wear, pressure (complex; deps 058)
`src/physics/tyreState.ts`: `interface TyreState { tempC: number; wear: number }`; `newTyreState(): TyreState` (70 °C, 0); `updateTyreState(s, c, slipPower W, speed, dt, wearMult, pressureKpa, optPressureKpa): void`; `tempFactor(c, tempC)`, `wearFactor(c, wear)`, `pressureFactor(p, opt)`; `gripFactor(c, s, p, opt) = tempFactor·wearFactor·pressureFactor`.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | medium, T = optTempC | `tempFactor` | 1 |
| AT2 | T = optTempC ± tempWindowC | tempFactor | 0.75 ± 1e-9 both sides; T = opt ± 3·window → 0.75 (floor) |
| AT3 | wear 0 / 0.5 / 1.0, cliff 0.8, gripLoss 0.25 | wearFactor | 1 / 0.875 / 1 − 0.25 − 0.15 = 0.60 (± 1e-9) |
| AT4 | slipPower 0, speed 0, T 90 | update 600 s (dt 1/120) | T → 25 ± 2 °C monotonically, wear unchanged |
| AT5 | slipPower 20 kW constant, speed 30 | update 60 s | T rises, wear = wearRate·20000·60 ± 1 % |
| AT6 | wearMult 3 vs 1 | same run | wear ratio 3 ± 1 % |
| AT7 | pressure opt, opt ± 10, opt + 40 | pressureFactor | 1, 0.98 (1 − 0.002·100/10), 0.9 (floor) |
| AT8 | wear never | any input | wear clamped to [0, 1], no NaN |

## 061 — Suspension, anti-roll and aero (complex; deps 058)
`src/physics/suspension.ts`: `staticCompression(fzStatic, springRate)`; `suspensionForce(axle, x, xDot): number` (spring + bump/rebound damping + bump stop past travel; ≥ 0); `antiRoll(arb, xLeft, xRight): number` (added to left, subtracted from right). `src/physics/aero.ts`: `aeroForces(spec, speedMs, rideDrop m, setup?) → {front, rear, drag}` N.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | k 52000, x 0.02, xDot 0 | suspensionForce | 1040 N |
| AT2 | xDot +0.1 vs −0.1 | force | uses bumpDamping for positive, reboundDamping for negative |
| AT3 | x = travel + 0.01 | force | includes bumpStopRate·0.01 |
| AT4 | strong rebound (x 0.001, xDot −1) | force | 0 (never pulls) |
| AT5 | arb 18000, xL 0.03, xR 0.01 | antiRoll | +360 (left gets +360, right −360) |
| AT6 | F4, 50 m/s, rideDrop 0, default setup | aero | front = ½·1.225·0.8·2500 = 1225 N ± 1e-6; rear 1837.5; drag ½·1.225·0.8·2500 |
| AT7 | rearWing default + 2 steps | aero | claRear + 2·0.09 and cda + 2·0.015 reflected |
| AT8 | speed 0 | aero | all zero |

## 062 — Powertrain (complex; deps 058, 045)
`src/physics/powertrain.ts`: `engineTorque(engine, rpm, throttle): number` (curve interp, limiter cut, closed throttle −brakingTorque); `engineRpm(spec, gear, drivenOmega, throttle): number` (launch rule in 1st); `diffSplit(diff, tIn, omegaL, omegaR, onThrottle): [number, number]`. Generalise task 045's `Gearbox` to take `CarSpec.gearbox` (keep its defaults working for existing callers) and honour `shiftTime` (`driveScale` 0 while shifting).
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | F4 curve | rpm between two points | linear interpolation exact; below first / above last point → clamp to end values |
| AT2 | rpm ≥ limiterRpm, throttle 1 | engineTorque | 0 |
| AT3 | throttle 0, rpm 5000 | engineTorque | −brakingTorque |
| AT4 | gear 1, omega 0, throttle 1 | engineRpm | launchRpm (4000); throttle 0 → idleRpm |
| AT5 | gear 3, omega 50 rad/s | engineRpm | 50·ratio3·final·60/(2π) ± 1e-6 |
| AT6 | open diff, tIn 400, ωL ≠ ωR | split | [200, 200] |
| AT7 | lsd preload 50, lock 0.3, tIn 400, Δω large | split | difference capped at 2·(50 + 0.3·400) total transfer; sum = 400 |
| AT8 | Gearbox with F4 params, upshift | during shiftTime 0.15 s | driveScale 0; after, 1 |

## 063 — Brakes, ABS/TC, fuel (complex; deps 058)
`src/physics/brakes.ts`: `brakeTorques(brakes, pedal, bias, out: number[4])`; `absScale(abs, kappa, speed): number` (0.5 or 1); `tcScale(tc, drivenKappas: number[]): number`. `src/physics/fuel.ts`: `fuelFlowKgS(bsfc, powerW, mult)`; `class FuelTank { massKg; litres; constructor(spec, startL?); burn(powerW, dt, mult): void; empty(): boolean }`.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | maxTorque 4200, pedal 1, bias 0.6 | brakeTorques | [1260, 1260, 840, 840] |
| AT2 | pedal 0.5 | same | halves |
| AT3 | ABS slip 0.12, kappa −0.2, speed 10 | absScale | 0.5; speed 2 → 1; kappa −0.05 → 1; abs disabled → 1 |
| AT4 | TC slip 0.2, kappas [0.1, 0.3] | tcScale | 0.5; [0.1, 0.1] → 1 |
| AT5 | bsfc 250 g/kWh, 100 kW, mult 1 | fuelFlowKgS | 250·100/3.6e6 kg/s ± 1e-9 |
| AT6 | tank 20 L, density 0.745 | burn at 100 kW for 60 s, mult 2 | mass drop = 2·AT5·60 ± 1e-6; never below 0; `empty()` when 0 |
| AT7 | negative power (engine braking) | burn | no fuel used |

## 064 — Implicit wheel solver (complex; deps 059)
`src/physics/wheelSolver.ts`: `solveWheel(p: WheelSolveInput, out: WheelSolveOutput): void` — inputs: omega, r, inertia, driveTorque, brakeTorque, vx, fz, compound, factor, alpha, massShare (= total mass/4), dt; outputs: omega1, fx, fy, locked. Implements the guide's implicit solve, locked-wheel rule and safety clamp.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | free rolling ω·r = vx = 30, no torques | solve | fx ≈ 0 (|fx| < 1 N), ω unchanged ± 1e-6 |
| AT2 | brake torque huge, vx 30 | solve | locked = true, omega1 = 0, fx < 0 and |fx| ≤ mu·fz·1.0001 |
| AT3 | vx 0, ω 0, brake on, drive 0 | solve | omega1 0, |fx| ≤ (m/4)·|v|/dt = 0 → fx 0 |
| AT4 | drive torque 2000 N·m, vx 0, ω 0 | 120 steps (chassis vx updated by fx/(m/4)·dt each step) | no oscillation: ω monotonic non-decreasing; κ settles near the peak slip (0.06–0.25) |
| AT5 | any input from a 10 000-case random sweep (seeded) | solve | outputs finite; |fx| ≤ mu·fz·(1 + 1e-6) |
| AT6 | ω would cross zero under braking | solve | omega1 = 0 exactly, never sign-flipped |

## 065 — Vehicle model on Rapier (complex, Models: heavy; deps 058–064, 033, 045)
Replace `DynamicRayCastVehicleController` in `src/physics/vehicle.ts` with the guide's model; keep the public `Vehicle` API (constructor now takes `CarSpec`; `setInput`, `getState`, reset, wheel surfaces, gear/rpm/shift) and add `getTelemetry(out)`: per-wheel `{fz, kappa, alpha, tempC, wear, surface}`, `fuelKg`, `rpm`, `gear`. Surface grip from task 033 multiplies the tyre factor.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | flat ground, F4, spawn 0.02 m high | 2 s idle | ride height within 5 mm of static; no NaN |
| AT2 | flat, standstill, no input | 10 s | drift < 1 cm |
| AT3 | 5 % slope, full brake | 10 s | drift < 5 cm |
| AT4 | drop from 0.5 m | 3 s | settles, no NaN, not flipped |
| AT5 | full throttle on flat | 6 s | speed > 100 km/h; wheels' kappa finite |
| AT6 | telemetry | any tick | 4 wheels with fz ≥ 0 summing to (m+fuel)·g ± 5 % at rest |
| AT7 | existing Phase 0/1 vehicle and e2e tests | run | pass (update thresholds only where the spec's new targets replace them) |

## 066 — Calibration suite and F4 tuning (complex, Models: heavy; deps 065)
`tests/unit/calibration/f4.test.ts` drives the real `Vehicle` headless with scripted inputs. Tune only `public/cars/f4.json` (never test thresholds).
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | flat, full throttle, TC on | 0→100 km/h | 3.4–4.2 s |
| AT2 | full throttle 30 s | vmax | 215–235 km/h |
| AT3 | 150 km/h, full brake, ABS on | to stop | ≤ 60 m |
| AT4 | constant-radius 100 m (closed-loop steer on lateral error), speed ramp | max steady lateral accel | 1.5–2.2 g |
| AT5 | 150 km/h, full brake + full left steer 2 s, bias 0.6, ABS on | heading vs velocity | < 30° |
| AT6 | 5 km/h full lock 5 s | yaw-rate second difference RMS | < 0.05 rad/s³ |
| AT7 | 90 s mixed stint (seeded script) | end | tyre temps 60–120 °C; wear 0.5–5 %; fuel decreased |
| AT8 | same scenario as lab | each metric | within 15 % of `node ai/lab/vehicle-model.mjs` results |

## 067 — Setups (simple; deps 058)
`src/physics/setup.ts`: `type Setup` (8 numbers), `defaultSetup(spec)`, `presetSetup(spec, name)`, `clampSetup(spec, s)`, `applySetup(spec, s): CarSpec` (new object; wings → aero via `wingStep`, bias, final, arbs, rideHeight shifts wheel hub y and cgHeight, pressure into tyres), `saveSetup(carId, trackId, s, storage)`, `loadSetup(carId, trackId, spec, storage): Setup` (storage = `Pick<Storage, 'getItem'|'setItem'>`).
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | default setup | applySetup | deep-equal to the input spec's physical values |
| AT2 | rearWing +2 | applySetup | aero.claRear += 0.18, cda += 0.03; input spec unchanged |
| AT3 | brakeBias 0.55, finalDrive 3.6 | apply | brakes.bias 0.55, gearbox.final 3.6 |
| AT4 | rideHeight −0.01 | apply | every hub y −0.01, cgHeight −0.01 |
| AT5 | out-of-range values / non-step values | clampSetup | clamped to [min, max] and rounded to step |
| AT6 | save then load same car+track | storage mock | equal; other track → default; corrupt JSON → default |
| AT7 | `presetSetup('stable')` | values | equals `spec.presets.stable` |

## 068 — Setup screen (simple; deps 067, 044)
DOM panel opened from the pause menu (044): 6 groups (Wings front/rear, Brake bias, Final drive, Anti-roll front/rear, Ride height, Tyre pressure), sliders bound to `Setup`, preset buttons, Apply restarts the session with the setup.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e: pause → Setup | open | 8 sliders with the spec's min/max/step; values = saved or default |
| AT2 | e2e: set rear wing 7, Apply | reload page | rear wing slider shows 7 (persisted per car+track) |
| AT3 | e2e: preset Stable | click | sliders equal `presets.stable` |
| AT4 | e2e: Esc | in panel | closes panel, back to pause menu, no console errors |

## 069 — HUD tyres and fuel (simple; deps 048, 065)
HUD widget: four tyre boxes coloured by temperature (blue < opt − window/2, green within, red > opt + window/2) with wear %, and fuel litres + estimated laps (fuel / mean per-lap burn, "—" before the first lap).
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: temps [60, 90, 120, 90], opt 90, window 40 | colour | blue, green, red, green |
| AT2 | unit: fuel 10 L, mean lap 2.5 L | text | "10.0 L · 4.0 laps"; no laps completed → "10.0 L · —" |
| AT3 | e2e: game running | HUD | `.tyres` has 4 boxes and `.fuel` visible inside the viewport |

## 070 — Game integration (complex, Models: heavy; deps 065–069, 054, 057)
Game loads `public/cars/<id>.json` (default f4), applies the saved setup, uses compound choice (default medium) and global multipliers `wear`/`fuel` (options, default 1), exposes `__SIMGAME__.telemetry()` and `getHeading()`.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/?track=monza` | 5 s throttle | speed > 100 km/h, `telemetry().wheels` length 4 with finite values, fuel decreasing |
| AT2 | e2e: setup rear wing max vs min (via storage) | top speed after 20 s | max wing slower by > 3 km/h |
| AT3 | e2e: `?wear=5` vs `?wear=1`, same 30 s script | wear ratio | in [4, 6] |
| AT4 | milestone-review handling script | brake+steer test | no spin |
| AT5 | all unit and e2e tests | run | pass |
