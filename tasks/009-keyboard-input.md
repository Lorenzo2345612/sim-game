# 009 — Implement keyboard input

Status: done
Phase: 0
Depends on: 002
Roles: coder, tester, reviewer

## Goal

`KeyboardInput` translates keyboard events into a smoothed (ramped) `DriverInput` with edge-triggered reset.

## Context

`input` layer: receives the injected `EventTarget` (does not touch `window`). `DriverInput` comes from `src/core/types.ts` (`throttle`, `brake` in 0..1; `steer` -1 left..+1 right; `reset` boolean). Tests run in Node without DOM.

## Files

- `src/input/keyboard.ts` — create
- `tests/unit/input/keyboard.test.ts` — create

## Steps

1. Export:

```ts
import type { DriverInput } from '../core/types';
export function approach(current: number, target: number, ratePerSecond: number, dt: number): number;
export class KeyboardInput {
  constructor(target: EventTarget);
  update(dt: number): DriverInput;
  dispose(): void; // removes listeners
}
```

2. `approach`: `maxDelta = ratePerSecond * dt`; if `|target - current| <= maxDelta` return `target`; otherwise `current + Math.sign(target - current) * maxDelta`. Never overshoots.
3. Constructor: registers `keydown`, `keyup`, `blur` listeners on `target` (keep the function references, as arrow properties, so they can be removed). Read the code with `(event as KeyboardEvent).code`.
   - `keydown`: add `code` to a `Set<string>` of pressed keys. If `code` is `ArrowUp|ArrowDown|ArrowLeft|ArrowRight` and `typeof event.preventDefault === 'function'`, call `event.preventDefault()`. If `code === 'KeyR'` and `!event.repeat` and `R` was not already pressed → `resetPending = true`. If `event.repeat` is true, ignore it for the edge (still keep the key in the Set).
   - `keyup`: remove `code` from the Set.
   - `blur`: clear the Set (releases all keys).
4. Mapping: throttle `KeyW|ArrowUp`; brake `KeyS|ArrowDown`; left `KeyA|ArrowLeft`; right `KeyD|ArrowRight`; reset `KeyR`.
5. `update(dt)`: targets `tThrottle` 1/0, `tBrake` 1/0, `tSteer = (right?1:0) - (left?1:0)`. Internal state `throttle`, `brake`, `steer` (initially 0):
   - throttle: `approach(throttle, tThrottle, tThrottle > throttle ? 4 : 6, dt)` (rises 4/s, falls 6/s).
   - brake: `approach(brake, tBrake, tBrake > brake ? 6 : 8, dt)` (rises 6/s, falls 8/s).
   - steer: rate 5 if `|tSteer| < |steer|` or `Math.sign(tSteer) !== Math.sign(steer)` and `steer !== 0`; otherwise rate 3. `steer = approach(steer, tSteer, rate, dt)`.
   - `reset = resetPending; resetPending = false`.
   - Return a new object `{ throttle, brake, steer, reset }`.
6. `dispose()`: `removeEventListener` for the three listeners.

## Tests (`tests/unit/input/keyboard.test.ts`)

Helper: `const key = (type: string, code: string, repeat = false) => Object.assign(new Event(type), { code, repeat })`; `target = new EventTarget()`; `target.dispatchEvent(key('keydown','KeyW'))`.

- `approach does not overshoot` → `approach(0.9, 1, 4, 1)` = 1; `approach(0, 1, 4, 0.1)` `toBeCloseTo(0.4, 10)`; `approach(0.2, 0, 6, 1)` = 0; `approach(1, 0, 6, 0.1)` `toBeCloseTo(0.4, 10)`.
- `throttle reaches 1 after 0.25 s holding W` → update(0.25) → throttle `toBeCloseTo(1, 6)`.
- `throttle returns to 0 after releasing W` → hold W 0.25 s, keyup, update(1/6) → throttle `toBeCloseTo(0, 6)`.
- `ArrowUp also drives throttle` → keydown ArrowUp, update(0.25) → throttle ≈1.
- `arrow keys mirror WASD` → ArrowDown, update(1/6) → brake ≈1; ArrowLeft / ArrowRight give steer < 0 / > 0.
- `steer rises at 3 per second` → D, update(0.1) → steer `toBeCloseTo(0.3, 9)`.
- `brake rises at 6 per second` → S, update(1/6) → brake ≈1.
- `steer right reaches 1` → D, update(1/3) → steer ≈1.
- `left and right together give zero steer target` → A+D, update(1) → steer 0.
- `steer returns to 0 at 5 per second` → D, update(1/3), keyup D, update(0.2) → steer ≈0.
- `reset fires once per key press` → keydown KeyR: update → true; update → false (key still pressed); keyup, keydown KeyR: update → true.
- `key repeat does not retrigger reset` → keydown R, update (true), keydown R with `repeat=true`, update → false.
- `blur releases all keys` → W+D, update(1), blur, update(1) → throttle 0, steer 0.
- `dispose removes listeners` → dispose, keydown W, update(1) → throttle 0.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract: the `acceptance` worker writes these rows as `tests/unit/acceptance/009-*.test.ts` before the coder starts. Coder, tester and spec writers must not change them.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | — | `approach(0, 1, 4, 0.1)`, `approach(0.9, 1, 4, 0.1)`, `approach(1, 0, 6, 0.1)` | 0.4, 1 (no overshoot), 0.4 (±1e-9) |
| AT2 | `KeyboardInput` on a `new EventTarget()` | keydown KeyW, then `update(0.25)` | throttle 1 ±1e-9; brake 0; steer 0 |
| AT3 | throttle at 1 | keyup KeyW, `update(1/6)` | throttle 0 ±1e-9 |
| AT4 | — | keydown ArrowUp / ArrowDown / ArrowLeft / ArrowRight | same effect as W / S / A / D |
| AT5 | A and D both held | `update(1)` | steer 0 |
| AT6 | D held | `update(0.1)` | steer 0.3 ±1e-9 (3/s) |
| AT7 | KeyR pressed and held | `update` ×3 | reset true, false, false; after keyup + keydown: true again; keydown with repeat true does not retrigger |
| AT8 | W and D held | dispatch `blur`, `update(1)` | throttle 0 and steer 0 |
| AT9 | `dispose()` called | keydown KeyW, `update(1)` | throttle 0 |

## Acceptance criteria

- [ ] The 14 tests pass; typecheck and lint without errors.
- [ ] `keyboard.ts` does not reference `window` or `document`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Gamepad, key remapping, pause, camera.
- Assigning `reset` to other keys.
- Non-linear smoothing or response curves.
