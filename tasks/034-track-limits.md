# 034 — Invalidate laps when all wheels leave the track

Status: pending
Phase: 1
Depends on: 033
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

A lap becomes invalid as soon as all four wheels are off the track, is not counted as a lap time, and the HUD data exposes the validity.

## Context

`LapTimer` already keeps an internal `invalid` flag (set when driving backwards over the line) and skips `lapCompleted` for invalid laps; reuse it. Wheel surfaces come from `Vehicle.getWheelSurfaces()` (task 033). A wheel is on track when its surface is `'asphalt'` or `'kerb'`; `'grass'`, `'gravel'` and `'runoff'` are off track. Acceptance tests: Vitest in `tests/unit/acceptance/034-track-limits.test.ts`; they may stub wheel surfaces with `vi.spyOn(Vehicle.prototype, 'getWheelSurfaces')` and drive a `Game` built from a Phase 0 track.

## Files

- `src/core/types.ts` — modify (extend `LapEvent`)
- `src/track/lapTimer.ts` — modify
- `src/game/game.ts` — modify
- `tests/unit/track/lapTimerInvalid.test.ts` — create
- Planner-authorised edits to protected tests (only these, minimal): `tests/unit/acceptance/008-track-progress-lap-timer.test.ts`, `tests/unit/edge/008-track-progress-lap-timer.test.ts`, `tests/unit/edge/008-track-progress-lap-timer.post.test.ts` — their `sig()` helpers handle the new `lapInvalidated` event; `tests/unit/edge/017-game-core.test.ts` EDGE7 expected literal gains `valid: true`. Reviewers must accept exactly these edits.

## Steps

```ts
// core/types.ts: add to the LapEvent union
| { type: 'lapInvalidated'; lap: number }
// lapTimer.ts
get valid(): boolean;                 // true unless the running lap is invalid
invalidate(): LapEvent[];             // [] if no lap running (lap 0) or already invalid; else marks invalid, returns [{type:'lapInvalidated', lap}]
// game.ts: LapInfo gains
valid: boolean;
```

- `Game.step`, after the physics step: if `getWheelSurfaces()` has no `'asphalt'`/`'kerb'` entry, push `lapTimer.invalidate()` events into the game events (drained by `drainEvents`). Emitted once per lap: the flag resets when the next lap starts (existing behaviour).
- An invalid lap completing emits no `lapCompleted`, leaves `bestLapTime` and `lastLapTime` unchanged, and the next lap starts valid (existing behaviour, must keep working).
- `getLapInfo().valid` mirrors `lapTimer.valid`; `reset()` of the timer makes it true.
- Before the first lap starts (lap 0) nothing is invalidated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/034-track-limits.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | lap started; all 4 wheels on grass for 1 step | `game.step` | current lap marked invalid; event `lapInvalidated` once |
| AT2 | 3 wheels on grass, 1 on kerb | step | lap still valid |
| AT3 | invalid lap completed | lap end | `lapCompleted` not emitted (or emitted with `valid: false`), best lap unchanged |
| AT4 | invalid lap, next lap clean | next completion | counted normally |

## Acceptance criteria

- [ ] All rows in `tests/unit/acceptance/034-track-limits.test.ts` pass.
- [ ] Existing lap timer and game tests pass unchanged; code consuming `LapEvent` still typechecks.
- [ ] `lapTimerInvalid.test.ts`: `invalidate()` at lap 0 returns `[]`; second call in the same lap returns `[]`; `valid` is true again after the next `lapStarted`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- HUD display of invalid laps (task 048).
- Time penalties or warnings.
- Loading track physics in `Game.create` (task 043).
