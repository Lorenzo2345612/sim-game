# 178 — Auto-mode reverse (standstill brake engages reverse)

Status: pending
Phase: 1
Depends on: 065
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

In the default automatic gearbox, holding the brake at standstill engages reverse (as before task 065), and throttle at standstill leaves it, without VehicleModel physics depending on pedals for gear changes.

## Context

Bug: reverse never engages in auto mode. Task 065 made `VehicleModel.step` call `gb.update(forwardSpeed, dt)` without pedals (`src/physics/vehicleModel.ts` ~line 426) because 065 AT3 (`tests/unit/acceptance/065-*.test.ts`, "full brake on a 5% slope drifts less than 5 cm in 10 s") holds the brake at standstill on a VehicleModel and must stay braked. That test must keep passing unchanged. Manual mode (`shiftDown()` at standstill) works and must not change. Fix: the UX rule lives in `Game.step` (`src/game/game.ts`); VehicleModel only exposes a way to set the gear. In reverse the brake pedal drives backwards and throttle brakes (existing behaviour, unchanged). HUD already shows "R" for gear -1.

## Files

- `src/physics/gearbox.ts` — modify — export `STOP_SPEED_MS`, `REVERSE_HOLD_S`; add `setReverse`; remove the dead pedal-driven reverse logic only if nothing else uses it, otherwise leave it
- `src/physics/vehicleModel.ts` — modify — add `setReverse`, `gearMode`
- `src/game/game.ts` — modify — hold timer + reverse rule in `step`
- `tests/unit/acceptance/178-auto-reverse.test.ts` — create (acceptance) — AT1-AT6

## Steps

1. Gearbox: `setReverse(on: boolean): void` — works in any mode; `true` → gear -1, `false` → gear 1 (`MIN_GEAR`); resets the internal reverse hold timer. Export the two constants (values unchanged: 0.5 m/s, 0.4 s).
2. VehicleModel: `setReverse(on: boolean): void` (delegates) and `gearMode(): GearboxMode` (returns the gearbox mode). `VehicleModel.step` keeps calling `gb.update(forwardSpeed, dt)` without pedals; do not reintroduce pedal-driven gear changes there.
3. Game.step, before `vehicle.setInput`, only when `gearMode() === 'auto'`; speed = `this.current.forwardSpeed` (previous step), pedals from `input`:
   - `hold` = |speed| < `STOP_SPEED_MS` and `input.brake >= 0.5` and `input.throttle < 0.05` and `gear() >= 1`. If not hold, timer = 0; else timer += `FIXED_DT`; when timer >= `REVERSE_HOLD_S` → `setReverse(true)`, timer = 0.
   - If `gear() === -1`, |speed| < `STOP_SPEED_MS` and `input.throttle >= 0.5` → `setReverse(false)`.
   - Timer is a private numeric field of Game, reset on `input.reset` and when mode is not auto. No allocations per step.
4. If an existing Game-level test holds brake at standstill > 0.4 s in auto mode and expects to stay stopped, stop and escalate; do not edit it.

Conventions: speeds in m/s, time in s; `<` and `>=` exactly as written; invalid input not applicable; Game does not mutate `input`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | Game on elkhart, car f4 (as in `tests/unit/acceptance/070-wing-setup.test.ts`), auto mode, at rest after 1 s of no input | brake 1, throttle 0 for 0.5 s (60 steps) | `game.gear() === -1` |
| AT2 | AT1 state | brake 1 for 3 s more | car displacement projected on its forward direction (local -Z at start) ≤ -5 m |
| AT3 | AT2 state | brake 0, throttle 1 until \|v\| < 0.5 m/s (≤ 4 s), then throttle 1 for 3 s | gear becomes 1 after stopping; final forward displacement from the stop point ≥ 5 m |
| AT4 | Game at 15 m/s forward in auto mode | brake 1, throttle 0 | `gear() ≥ 1` on every step while \|v\| ≥ 0.5 m/s |
| AT5 | Game at rest, manual mode (`setGearMode('manual')`) | brake 1 for 2 s | `gear() === 1` |
| AT6 | Game at rest, manual mode | `shiftDown()` then brake 1 for 3 s | `gear() === -1` and forward displacement ≤ -5 m (manual reverse unchanged) |
| AT7 | existing 065 AT3 slope-hold test | run | still passes unchanged |

## Acceptance criteria

- [ ] AT1-AT7 pass; `tests/unit/acceptance/178-auto-reverse.test.ts` covers AT1-AT6.
- [ ] `VehicleModel.step` does not read pedals for gear changes.
- [ ] No existing test edited.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Manual-mode behaviour, HUD, audio, reverse-light visuals, gear ratios/torque in reverse, gamepad/keyboard bindings, reverse speed limits.
