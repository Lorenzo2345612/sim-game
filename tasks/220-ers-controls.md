# 220 — Overtake and ERS mode controls

Status: pending
Phase: 3
Depends on: 215
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Keyboard and gamepad produce `overtake` (held) and `ersCycle` (edge) in `DriverInput`, and `mergeInputs` combines them.

## Context

`DriverInput.overtake?` and `ersCycle?` exist after task 215 (`src/core/types.ts`). Verified unused today: `Space`, `KeyB` (keyboard.ts uses W/A/S/D, arrows, KeyR; main.ts keydown uses Escape, KeyC/Q/E/M/I) and pad buttons 0 and 3 (gamepad.ts uses 4, 5, 6, 7, 8). No pause-menu controls list exists (menu.ts has none), so no text to update. Edge style: copy `shiftUp` (gamepad `prevShiftUp`/pending) and keyboard `resetPending` (ignores `event.repeat` and already-pressed codes).

## Files

- `src/input/keyboard.ts` — modify: `Space` held → `overtake: true`; `KeyB` keydown (no repeat, not already pressed) → `ersCycle: true` for exactly one `update()`. Always return both fields as booleans.
- `src/input/gamepad.ts` — modify: button 0 held → `overtake`; button 3 rising edge → `ersCycle` for one read (constants named like the existing `BUTTON_*`); `mergeInputs`: `overtake` and `ersCycle` = `(a.x ?? false) || (b.x ?? false)`.
- `src/main.ts` — modify only if the merged input is not already passed whole to the game (line ~686); otherwise untouched.
- `tests/unit/acceptance/220-ers-controls.test.ts` — create (from the table).

## Steps

1. Keyboard `Space`: call `preventDefault` when available (page scroll), like the arrows.
2. Gamepad edge uses the same `getInput()` call model as shift buttons; no new public methods.
3. `mergeInputs` output keeps every existing key and adds `overtake` and `ersCycle` as booleans.

Conventions: booleans only (never undefined in outputs of keyboard/gamepad/merge); edge = one read per press; blur clears held keys (existing).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | KeyboardInput, Space down | read twice | overtake true both times; after Space up → false/undefined |
| AT2 | KeyB down (one keydown, held) | read three times | ersCycle true on the first read only |
| AT3 | fake pad button 0 pressed | GamepadInput read twice | overtake true both |
| AT4 | fake pad button 3 pressed and held 3 updates | reads | ersCycle true on the first only; release and press → true again |
| AT5 | `mergeInputs` | keyboard {overtake false}, pad {overtake true, ersCycle true} | overtake true, ersCycle true; both absent → falsy |

## Acceptance criteria

- [ ] AT1–AT5 pass; existing input tests pass except the planner-authorised edit below.
- [ ] `tests/unit/input/gamepad.test.ts` line ~219 (`toEqual` of the full merged object) must also include `overtake: false, ersCycle: false` (planner-authorised, that assertion only).

## Verification

```
npm run typecheck
npm run lint
npm test

```

## Out of scope

Rumble, menu navigation by these buttons, rebinding UI, wheel/FFB, any ERS logic (216/219), HUD (223), remapping existing keys.
