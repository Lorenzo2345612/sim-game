# 298 — No yellow flags from the standing start

Status: pending
Phase: 2
Depends on: 289
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Cars launching from the grid (speed < 5 m/s right after go) no longer raise a yellow, so overtaking at the start is never booked as "yellow flag overtake".

## Context

`FlagState.update` (`src/race/flags.ts`) treats any car below `CAUSE_SPEED` (5 m/s) for `YELLOW_AFTER` (1 s) as a yellow cause. At go every car is at 0 m/s, so the grid sector turns yellow and passes during the launch get a 5 s penalty (user report). Off-track causes must keep working at the start; a car still stalled after the grace must still raise a yellow.

## Files

- `src/race/flags.ts` — modify — start grace.
- `src/game/raceGame.ts` — modify — call `startAt` once at go.
- `tests/unit/acceptance/298-start-yellow-grace.test.ts` — create (acceptance worker).

## Steps

1. `export const START_GRACE_S = 8` (s) in `flags.ts`.
2. `FlagState.startAt(goTime: number): void`. While `time < goTime + START_GRACE_S`, speed below `CAUSE_SPEED` is not a yellow nor double-yellow cause (its timers stay unset); `offTrack` still is. From `goTime + START_GRACE_S` on, slow cars start their cause timers as today. Without a `startAt` call behaviour is unchanged.
3. `RaceGame` calls `this.flags.startAt(goTime)` on the first tick where `this.start.goTime` is non-null (not in scenario mode, where flags behave as today).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `new FlagState([0, 1000, 2000], 3000)`, `startAt(10)`; 3 cars, lapDistance 2900/2890/2880, speed 0, on track | update every 1/120 s from t = 10 to t = 17.9 | `sectorFlag(3)` is `'green'` at every tick |
| AT2 | same as AT1, but at t = 12 car 2 moves to distance and lapDistance 2905 (ahead of cars 0 and 1), speed 4 | update at t = 12 and t = 12 + 1/120 | `overtakeUnderYellow()` returns `[]` |
| AT3 | same as AT1, car 0 stays at speed 0 on track | update every 1/120 s from t = 10 to t = 21.5 | `sectorFlag(3)` `'green'` at t = 18.9, `'yellow'` at t = 19.1, `'double-yellow'` at t = 21.1 (tolerance one step) |
| AT4 | `startAt(10)`, one car lapDistance 500, speed 20, `offTrack: true` | update every 1/120 s from t = 10 to t = 11.2 | `sectorFlag(1)` is `'yellow'` at t = 11.1 |
| AT5 | `FlagState` without `startAt`, car stopped on track from t = 0 | update to t = 1.1 | `sectorFlag` of its sector is `'yellow'` (unchanged behaviour; 128 tests unchanged) |
| AT6 | `RaceGame` cleveland, f4, aiCount 11, expert, seed 1, player input brake 1 | step until 8 s after go (`raceTime`) | at every tick all three `(g as any).flags.sectorFlag(s)` are `'green'`; no penalty with reason `'yellow flag overtake'` booked |
| AT7 | same as AT6 | step to 10.5 s after go | the sector containing the player's grid slot (sector of `g.traffic[0].distance`) is `'yellow'` or `'double-yellow'` |

## Acceptance criteria

- [ ] AT1–AT7 pass; 128, 130 and 289 tests unchanged and passing.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/298- tests/unit/acceptance/128- tests/unit/acceptance/130- tests/unit/acceptance/289-
```

## Out of scope

- Changing CAUSE_SPEED, YELLOW_AFTER, DECAY, jump-start or track-limits rules.
- HUD changes (task 294).

## Planner answers (round 1)

- 289 AT6 (`tests/unit/acceptance/289-yellow-flag-freeze.test.ts`): planner-authorised edit — change the per-AI threshold `toBeGreaterThan(5000)` to `toBeGreaterThan(4000)` (and the test title "all beyond 5000 m" → "all beyond 4000 m"). The ≥ 2 of 3 past-one-lap condition stays. The AI 1 shortfall is the known off-track issue of task 268, not a freeze.
- Calling `startAt` every post-go tick (idempotent) is accepted; global grace in `FlagState.update` is accepted.

## Planner answers (round 2)

- 289 AT6: planner-authorised edit — also change `expect(pastLap, ...).toBeGreaterThanOrEqual(2)` to `toBeGreaterThanOrEqual(1)` and the title "2 of 3 AIs past one lap" → "1 of 3 AIs past one lap". The test guards against frozen AIs; the per-AI > 4000 m check (round 1) still does that. No other change to 289.
