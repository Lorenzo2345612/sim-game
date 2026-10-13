# 078 — Add reverse gear

Status: pending
Phase: 1
Depends on: 054
Complexity: standard
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The car can reverse: gear −1 (shown as 'R'), engaged by holding the brake at standstill (auto) or by shifting down from gear 1 (manual).

## Context

Extends `Gearbox` (src/physics/gearbox.ts, task 045), used by `Vehicle` (src/physics/vehicle.ts) and the HUD gear text (`HudV2`, task 054 wiring). Today `Gearbox.update` forces gear 1 when `speedMs < 0` and `MIN_GEAR = 1`; that must change. Speeds in `Gearbox` are signed forward speed (m/s, negative = backwards).

## Files

- `src/physics/gearbox.ts` — modify — reverse logic, new methods.
- `src/physics/vehicle.ts` — modify — use the new methods for engine force/brake.
- `src/ui/hudV2.ts` — modify — gear text 'R' when gear is −1.
- `tests/unit/acceptance/078-reverse-gear.test.ts`, `tests/e2e/acceptance/078-reverse-gear.spec.ts` — create (acceptance worker).

## Steps

1. Constants in gearbox.ts (local): `REVERSE_RATIO = 3.0`, `REVERSE_MAX_SPEED_MS = 30 / 3.6`, `STOP_SPEED_MS = 0.5`, `REVERSE_HOLD_S = 0.4`.
2. New signatures on `Gearbox`:
```ts
update(speedMs: number, dt?: number, input?: { throttle: number; brake: number }): void;
driveTorque(engineTorqueNm: number, input: { throttle: number; brake: number }, speedMs: number): number;
brakeRequest(input: { throttle: number; brake: number }): number;
```
   `input` omitted = no pedals. `shiftUp`/`shiftDown` signature gets optional `speedMs?: number` (default 0 if omitted... shiftDown without speed uses the last speed passed to `update`).
3. Auto: with |speed| < 0.5, brake ≥ 0.5 and throttle < 0.05 held continuously for 0.4 s (timer resets when any condition breaks) → gear −1. In −1: throttle ≥ 0.5 while |speed| < 0.5 → gear 1. No automatic up/down shifting while in −1; remove the "speed < 0 → gear 1" rule.
4. Manual: `shiftDown` at gear 1 with |speed| < 0.5 → −1; at gear 1 with |speed| ≥ 0.5 stays 1; `shiftUp` at −1 → 1; −1 is never skipped by other shifts.
5. `driveTorque`: gear > 0 unchanged semantics (engineTorque × throttle × ratio × final); gear −1: −engineTorque × brake × REVERSE_RATIO × final, and 0 when backwards speed > 30 km/h (speedMs ≤ −REVERSE_MAX_SPEED_MS) ; throttle contributes nothing in −1. `brakeRequest`: gear −1 returns `input.throttle`, otherwise `input.brake`.
6. `rpm(speedMs)` in gear −1 uses REVERSE_RATIO; `rpmFor` unchanged.
7. Vehicle: pass pedals to `gearbox.update`; in gear −1 engine force = −(brake × same force cap as forward), wheel brake from `brakeRequest`. Forward behaviour unchanged.
8. HUD: gear text 'R' for −1, otherwise the number.

Conventions: speed magnitude tests use |forward speed| m/s; the 30 km/h limit applies to backward speed; timers reset when the condition breaks; no rounding; thresholds inclusive as written (≥ 0.5 brake, < 0.5 speed).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/078-reverse-gear.test.ts` (AT1–AT5) and `tests/e2e/acceptance/078-reverse-gear.spec.ts` (AT6) before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | auto, speed 0, brake 1, throttle 0 | 0.35 s / 0.45 s of updates (dt 1/120) | gear 1 / gear −1 |
| AT2 | gear −1, brake 1, rpm in torque band | drive torque | < 0 (backwards); throttle 1 gives drive torque 0 and a brake request 1 |
| AT3 | gear −1, throttle 0.6, speed 0.2 | update | gear 1 |
| AT4 | manual, gear 1 | shiftDown at speed 0.3 / at speed 5 | −1 / 1; shiftUp at −1 → 1 |
| AT5 | gear −1, speed 31 km/h backwards | drive torque | 0 |
| AT6 | e2e: `/?track=monza`, ready | hold ArrowDown 3 s | `getSpeedKmh()` > 3 and the car moved backwards (carPosition projected on the start heading decreased by > 1 m); HUD gear text 'R' |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Existing gearbox, vehicle and HUD tests still pass.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Phase 1.5 in-house powertrain (tasks 062–066): it must keep the same input semantics using `CarSpec.gearbox.reverse`; not implemented here.
- Reverse lights, audio changes, gamepad mapping changes, camera changes.
