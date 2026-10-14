# 165 — Gamepad rumble

Status: pending
Phase: 1
Depends on: 164
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Gamepads vibrate on kerbs, grass, gravel and tyre slip, driven by the 163 feedback channels.

## Context

Depends on 164 only because it also edits `src/main.ts` (serialisation) and reuses its `Feedback` object. `GamepadInput` (`src/input/gamepad.ts`) already takes an optional `getGamepads` constructor arg and has `firstPad()`; tests mock it.

## Files

- `src/input/gamepad.ts` — modify: add rumble.
- `src/main.ts` — modify: each frame `gamepad.rumble(fb.low, fb.high, performance.now())`; while paused or in menus call `gamepad.rumble(0, 0, performance.now())`.
- `tests/unit/acceptance/165-gamepad-rumble.test.ts` — create.

## Steps

```ts
GamepadInput.rumble(low: number, high: number, nowMs: number): void;
GamepadInput.setRumbleEnabled(on: boolean): void; // default true
```

- Uses the first pad's `vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: 120, strongMagnitude: low, weakMagnitude: high })`.
- Values clamped 0..1, non-finite → 0.
- Plays when (now − lastPlay ≥ 50 ms and either value changed by > 0.02 since the last played) or (now − lastPlay ≥ 100 ms and any value > 0). The first non-zero call plays immediately.
- Going from non-zero to (0,0) calls `vibrationActuator.reset()` once immediately; repeated (0,0) does nothing.
- No pad, no actuator, or `playEffect` absent: silent no-op (no throw). Ignore the returned promise rejection.
- `setRumbleEnabled(false)` calls reset if rumble is active and ignores later `rumble` calls.

Conventions: thresholds as written (`≥` for time, `>` for value change); `nowMs` is caller-supplied.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | mock pad with actuator | rumble(0.5, 0.2, 0) | playEffect called once with ('dual-rumble', {startDelay 0, duration 120, strongMagnitude 0.5, weakMagnitude 0.2}) |
| AT2 | after AT1 | rumble(0.8,0.2,30); (0.8,0.2,55); (0.81,0.2,80); (0.81,0.2,155) | playEffect calls: none, one (0.8), none, one (keepalive) → 3 total |
| AT3 | active rumble | rumble(0,0,200); rumble(0,0,400) | reset called exactly once; no extra playEffect |
| AT4 | mock pad | rumble(2, NaN, 0) | strongMagnitude 1, weakMagnitude 0 |
| AT5 | pad without vibrationActuator; or no pads | rumble(0.5,0.5,0) | no throw |
| AT6 | active rumble | setRumbleEnabled(false); rumble(1,1,500) | reset called once; no playEffect after disabling |

## Acceptance criteria

- [ ] All AT rows pass; `tests/unit/input/gamepad.test.ts` and `acceptance/046-gamepad.test.ts` unchanged and passing.
- [ ] Protected tests: none change numbers.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Steering wheels, force feedback, settings UI toggle, trigger rumble, audio.
