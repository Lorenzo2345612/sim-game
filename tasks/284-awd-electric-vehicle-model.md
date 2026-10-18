# 284 — AWD electric drive in VehicleModel

Status: pending
Phase: 7
Depends on: 281, 282, 283
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

When `spec.electric` is present, `VehicleModel` drives all four wheels from per-axle motors with a battery, power modes, attack mode and regen braking. Combustion cars behave exactly as today.

## Context

Design: `docs/design/m7.1-electric.md`. Current drive path: `src/physics/vehicleModel.ts` "Powertrain, brakes and aids" block (~L578-660): gearbox, `engineTorque`, `diffSplit` on rear wheels `wheels[2]`/`wheels[3]` only, `brakeTorques(...)` into `this.brakeT`, `solveIn.driveTorque` set only for i = 2, 3. Existing hybrid ERS (`spec.hybrid`, `src/physics/ers.ts`) is untouched and unused by electric cars. Imports: `motorWheelTorque, splitPower, regenSplit, Battery` from `./electric`; `AttackMode` from `./attackMode`.

## Files

- `src/physics/vehicleModel.ts` — modify
- `tests/unit/acceptance/284-awd-electric-vehicle-model.test.ts` — create (from the table; uses a `CarSpec` built from the f4/ow26 test spec with `drive: 'awd'` and the eow `electric` values: rear {350e3,557,20000,7.8,350e3}, front {250e3,400,20000,7.8,350e3}, batteryJ 184.5e6, efficiency 0.95, modes {450e3, 600e3}, attack {2, 240}, mass 954, gearbox ratios [1] final 7.8)

## Steps

Public additions:
```ts
setLap(lap: number): void; // default lap 1
// Telemetry gains:
electric?: { socFrac: number; powerW: number; mode: 'race' | 'attack'; attackLeftS: number; activationsLeft: number };
```
1. Model keeps its own sim time (sum of step dt) and, when electric, a `Battery(batteryJ)` and an `AttackMode(attack.activations, attack.durationS)`. All allocated in the constructor; nothing allocated per step.
2. Drive: no gear shifting (telemetry `gear` = 1 forward; reverse via the existing reverse logic as today). Per axle: torque = `motorWheelTorque(axleMotor, meanAxleWheelOmega, axleCapW, throttle)`, where throttle is the pedal times `tcScale` using all four wheel kappas, and caps = `splitPower(spec.electric.modes[mode], front, rear)`. Split left/right with `diffSplit(spec.diff, ...)` for both axles. Front wheels receive drive torque via `solveIn.driveTorque`.
3. Mode: the `overtake` input rising edge calls `attack.tryActivate(lap, false, time)`; power mode = `attack.mode(time)`.
4. Battery: drain by Σ(drive torque·|ω|) of positive terms / efficiency; charge by regen Σ(regenNm·|ω|)·efficiency. Battery empty → both axle drive torques 0.
5. Brake: per-axle request from the existing `brakeTorques` output (sum of both wheels of the axle) passes through `regenSplit` (batteryFull = battery.full); the friction remainder is shared back to the two wheels in the original proportion; regen torque is applied to the wheels as braking torque (not subject to ABS); ABS applies to the friction part only.
6. Telemetry `electric.powerW` = net battery power (positive = discharging); `attackLeftS`/`activationsLeft` from `AttackMode`. `telemetry.ers` stays undefined.

Conventions: step dt is fixed `FIXED_DT`; negative speeds use |ω| for torque/power; no per-frame object allocation.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given (flat physics world as in vehicle.test.ts, eow spec from 283 AT2 values, race mode) | When | Then |
|---|---|---|---|
| AT1 | standstill, full throttle | step until 27.78 m/s | reached between 1.5 and 2.8 s |
| AT2 | full throttle 30 s | speed | 75–92.6 m/s; front and rear drive torque both > 0 at t = 1 s |
| AT3 | full throttle 10 s from standstill | battery | socJ drop 2.5–4.8 MJ |
| AT4 | 55 m/s, full brake 2 s | battery | socJ rises; friction torque < requested on both axles at t = 0.1 s |
| AT5 | attack activated at lap 2 (setLap(2), overtake edge) at 40 m/s full throttle | 3 s | mean drive power > race-mode run by ≥ 15 % |
| AT6 | battery start 100 J | full throttle 2 s | speed < 1 m/s after battery empties (drive 0) |
| AT7 | f4, ow26 | existing physics tests | unchanged |

## Acceptance criteria

- [ ] All ATs pass; all existing tests in `tests/unit` stay green without edits.
- [ ] Combustion path executes the same code as before when `spec.electric` is undefined.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- `eow.json` (286), HUD/main.ts wiring of `setLap` and telemetry (286), AI, audio, pit boost, active diff, coast regen, rolling-start power caps, battery-temperature derating.
