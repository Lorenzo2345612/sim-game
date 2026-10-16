# 210 — Reverse speed cap and gamepad trigger deadzone

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: fix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Reverse gear is limited to 30 km/h, and resting noise on the gamepad triggers no longer blocks auto-reverse.

## Context

User: "se volvió a desconectar la reversa". Two causes found:
- `Gearbox.driveTorque` (`src/physics/gearbox.ts`) holds the `REVERSE_MAX_SPEED_MS = 30 / 3.6` cap, but `VehicleModel` (`src/physics/vehicleModel.ts`, around line 437–457) computes drive torque itself and never calls it. Reverse reaches about 69 km/h.
- Auto-reverse (178) needs `throttle < 0.05`. `GamepadInput` (`src/input/gamepad.ts`) passes trigger values raw, and `mergeInputs` takes the larger magnitude, so a connected pad whose RT rests at 0.05–0.1 (generic Xbox 360 clones) blocks reverse even when the player uses the keyboard.

## Files

- `src/physics/gearbox.ts`: modify (export `REVERSE_MAX_SPEED_MS`).
- `src/physics/vehicleModel.ts`: modify (apply the cap).
- `src/input/gamepad.ts`: modify (trigger deadzone).
- `tests/unit/acceptance/210-reverse-cap-trigger-deadzone.test.ts`: create (acceptance worker).

## Steps

1. Export `REVERSE_MAX_SPEED_MS` from `src/physics/gearbox.ts`.
2. In `VehicleModel`, when `gear === -1` and `forwardSpeed <= -REVERSE_MAX_SPEED_MS`, the positive engine torque `te` is set to 0 (engine braking stays). Forward speed is negative when the car moves backwards (local -Z is forward).
3. In `src/input/gamepad.ts`, export `TRIGGER_DEADZONE = 0.1`. A throttle or brake trigger value below it becomes exactly 0; values at or above it pass unchanged (no rescale).
4. Nothing else changes: steering deadzone, button mapping and `mergeInputs` stay as they are.

## Acceptance tests (defined by the planner with Opus, before coding)

Unit rows follow `tests/unit/acceptance/178-auto-reverse.test.ts` (Elkhart + `public/cars/f4.json`, auto gearbox, `Game.step`) and `tests/unit/acceptance/046-gamepad.test.ts` (fake pads).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | resting game (178 harness) | full brake for 10 s | gear is -1; `getCurrentState().forwardSpeed` is ≥ -(30/3.6 + 0.5) at every step and < -5 at the end |
| AT2 | AT1 end state | full brake for 5 s more | `forwardSpeed` stays in [-(30/3.6 + 0.5), -5] |
| AT3 | fake pad, throttle button value 0.08, brake 0.09 | `GamepadInput` read | throttle 0, brake 0 |
| AT4 | fake pad, throttle 0.1, brake 0.8 | read | throttle 0.1, brake 0.8 (unchanged) |
| AT5 | resting game; each step input = `mergeInputs(keyboard {brake 1}, gamepad read of a pad with throttle 0.08)` | 1.5 s | gear is -1 |
| AT6 | `REVERSE_MAX_SPEED_MS`, `TRIGGER_DEADZONE` imports | — | `30/3.6` (1e-12) and `0.1` |

Existing tests that must still pass: `045-gearbox`, `046-gamepad`, `178-auto-reverse` (unit acceptance) and `tests/unit/physics/*`.
