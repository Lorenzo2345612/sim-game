# 219 — Hybrid and active aero in the vehicle and game

Status: pending
Phase: 1
Depends on: 215, 216, 217, 218
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`VehicleModel` and `Game` run the ERS and active aero for cars whose spec has them; every other car behaves exactly as before.

## Context

Powertrain block is in `src/physics/vehicleModel.ts` (~lines 437-476: `thr`, `rpmVal`, `te`, `driveActive`, `tIn`, `brakeTorques`); `aeroForces` call at ~line 543; `setInput` (~209) copies only throttle/brake/steer, `getTelemetry` (~600), `reset` (~670). `Game` is `src/game/game.ts` (`step` ~122, `Game.create(track, spec, tune?)`, `teleportToIndex`, `lapStarted` handled in `step`). `Telemetry` re-exported by `src/physics/vehicle.ts`. Types: tasks 215 (`hybridTypes.ts`), `Ers` (216), `deriveAeroZones`/`inAeroZone` (217), `ActiveAero` + `aeroForces(..., activeBlend)` (218).

## Files

- `src/physics/vehicleModel.ts` — modify
- `src/game/game.ts` — modify
- `tests/unit/acceptance/219-hybrid-integration.test.ts` — create (acceptance worker)

## Steps

1. `VehicleModel` creates `Ers` when `spec.hybrid`, `ActiveAero` when `spec.activeAero`; otherwise neither, and behaviour is unchanged for every existing car (no extra work, no telemetry).
2. New public methods: `setAeroZone(inZone: boolean): void` (default false), `ersNewLap(): void` (→ `ers.newLap()`). `reset()` also resets ERS and active aero. `setInput` also stores `overtake` (default false) and `ersCycle`.
3. Each step: rising edge of `input.ersCycle` → `ers.cycleMode()`. ERS input: speedMs = forwardSpeed when gear >= 1, drive active (`driveScale > 0`) and tank not empty, else 0; throttle = TC-scaled throttle (`thr`); brake = `input.brake`; overtake = `input.overtake ?? false`.
4. MGU-K torque at the crank tK = powerW / omegaE, omegaE = max(rpmVal, idleRpm) / RPM_PER_RPS, added to the engine torque `te` after the engine-brake ramp and drive gating; fuel burn uses the engine torque only (before adding tK).
5. Brake-by-wire: while harvesting with brake >= 0.05 (powerW < 0), each rear friction brake torque is reduced by |tK * ratioTot * efficiency| / 2, clamped >= 0.
6. Active aero: `activeAero.update(zoneFlag, input.throttle, input.brake, dt)`; pass its blend as the 6th arg of `aeroForces`.
7. Telemetry: `ers` (socFrac, powerW, mode, overtake = overtakeActive, clipping, lapDeployJ, lapHarvestJ, deployCapJ) and `aero` {blend, inZone}, only for cars that have them; reuse the objects (no allocation per call; reuse `out` when given).
8. `Game`: computes `deriveAeroZones(track.centerline)` once in `create`; accessor `aeroZones(): readonly AeroZone[]`; each `step` before the vehicle step (the `prePhysicsStep` call) calls `vehicle.setAeroZone(inAeroZone(zones, lastDistance, progress.length))`, where `lastDistance` is a new field holding the last `sample.distance` (0 at start and after reset); on `lapStarted` call `vehicle.ersNewLap()`. Add `Game` passthrough only if needed by tests.
9. Test harness: flat-ground `Vehicle` like `tests/unit/calibration/f4.test.ts`; "hybrid f4" = f4.json + hybrid block (shared constants of 216 but mgukW 100000, regenW 100000, superClipW 100000) + activeAero {0.7, 0.6, 0.4}.

Conventions: no rounding; telemetry objects mutated in place when `out` is passed; input object never mutated; plain f4 results must be bit-identical to before.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/219-hybrid-integration.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | plain f4 | 2 s full throttle | `getTelemetry().ers` and `.aero` undefined |
| AT2 | plain f4 vs hybrid f4 (zone off) | 6 s full throttle from rest | hybrid speed ≥ plain + 5 km/h; hybrid `ers.socFrac` < 1; `lapDeployJ` = (1 − socFrac)·4e6 − lapHarvestJ (±1e3 J) |
| AT3 | both after AT2-style run to 150 km/h | full brake to < 20 km/h | hybrid `lapHarvestJ` > 0 and soc rose; hybrid stopping distance within ±5 % of plain f4 |
| AT4 | hybrid f4, 50 km/h | `ersCycle` true for 10 consecutive steps, then false, then true 1 step | mode balance → attack (once) → charge |
| AT5 | hybrid f4 | after AT2 run, `reset(spawn)` | socFrac 1, lapDeployJ 0, aero blend 0 |
| AT6 | hybrid f4, `setAeroZone(true)` | full throttle 1 s from 50 m/s | `aero.blend` 1; then brake 1: blend 0 after 0.4 s (±1 step) |
| AT7 | hybrid f4, zone forced on vs forced off | 25 s full throttle from rest | top speed on ≥ off + 3 km/h |
| AT8 | `Game` on Elkhart with hybrid f4 (`Game.create(track, spec)`) | `aeroZones()` | ≥ 1 zone, equal to `deriveAeroZones(track.centerline)` |
| AT9 | AT8 game, `teleportToIndex` 30 m before the line, full throttle until a `lapStarted` event | after the event | `ers.lapDeployJ` < 1e5 (reset at the line) and socFrac unchanged by the reset |

## Acceptance criteria

- [ ] Acceptance table passes.
- [ ] Existing suites (065, 066, 061, 070, 017, 178) still pass without edits.
- [ ] `getTelemetry().ers`/`.aero` are undefined for plain f4.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- OW-26 car JSON (221), controls (220), HUD (223), AI driver use of overtake, sound, any change to gearbox or tyre code.
