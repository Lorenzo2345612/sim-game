# 046 — Gamepad input and input merging

Status: pending
Phase: 1
Depends on: 022
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

A gamepad can drive the car, and keyboard and gamepad can be used together; shift buttons are available as edge events.

## Context

Standard Gamepad mapping: axes[0] = left stick X, buttons[7] = RT, buttons[6] = LT, buttons[4] = LB, buttons[5] = RB. `DriverInput` gains optional `shiftUp?`/`shiftDown?` in task 022. Existing `src/input/keyboard.ts` shows style. `src/input` may use `navigator` (injected getter allowed for tests). Acceptance tests for this task are Vitest in `tests/unit/acceptance/`.

## Files

- `src/input/gamepad.ts` — create.
- `tests/unit/input/gamepad.test.ts` — create — extra edge tests.

## Steps

```ts
import type { DriverInput } from '../core/types';
export const GAMEPAD_DEADZONE = 0.08;
export class GamepadInput {
  constructor(getGamepads?: () => ArrayLike<Gamepad | null>); // default: navigator.getGamepads.bind(navigator)
  update(dt: number): void;
  getInput(): DriverInput;   // throttle, brake in [0,1]; steer in [-1,1]; reset false; shiftUp/shiftDown true for exactly one getInput() after a press edge
}
export function mergeInputs(a: DriverInput, b: DriverInput): DriverInput;
```

- Use the first non-null gamepad. None connected: all zeros, no throw (also if `getGamepads` is missing).
- Steer from axes[0]: `|x| < GAMEPAD_DEADZONE → 0`, otherwise `x` unchanged (no rescale), clamped to [-1, 1]; so 0.5 → 0.5 and 0.05 → 0.
- Triggers use `buttons[i].value` (clamped 0..1).
- Shift buttons 4 (down) and 5 (up): fire once per press (rising edge), not while held.
- `mergeInputs`: per numeric axis the value with the larger magnitude wins; `reset`, `shiftUp`, `shiftDown` are OR-ed.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/046-gamepad.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | mocked `navigator.getGamepads` with axes[0] = 0.5, buttons[7].value = 0.8, buttons[6].value = 0.3 | `GamepadInput.update(dt)` | steer 0.5 (after deadzone mapping), throttle 0.8, brake 0.3 |
| AT2 | axes[0] = 0.05 | update | steer 0 (deadzone 0.08) |
| AT3 | button 4 / 5 pressed | update | shiftDown / shiftUp edge-triggered once per press |
| AT4 | no gamepad | update | all zeros, no throw |
| AT5 | keyboard and gamepad both active | `mergeInputs(k, g)` | per axis the larger magnitude wins |

## Acceptance criteria

- [ ] All AT rows pass; existing code still typechecks with the optional `DriverInput` fields.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wiring into `main.ts` (task 054), rumble, button remapping UI, reset button on the gamepad.

