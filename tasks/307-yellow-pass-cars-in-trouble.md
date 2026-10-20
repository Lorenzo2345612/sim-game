# 307 — Passing cars in trouble under yellow is legal

Status: pending
Phase: 2
Depends on: 305
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Passing a car that is in trouble (crashed, off track, crawling, or just respawned) under yellow is legal: no penalty and no give-back.

## Context

User report: crashed cars get put back on track and passing them is penalised.

- `src/game/raceGame.ts` ~677–692: an AI below `STUCK_SPEED_MS` (1 m/s) for `STUCK_RESET_S` (5 s) is teleported by `respawnOnLine(k)` (~1124) onto the centerline at its progress index, from rest.
- Yellow-overtake handling (~1036) skips passed cars that are stopped/finished or slower than `YELLOW_FOLLOW_MIN_MS` (5 m/s, `src/race/yellowCap.ts`). A respawned car exceeds 5 m/s ~1 s after respawn, so passing it books a penalty (after task 305: opens a give-back).
- `FlagCar` per car (~1028) has `offTrack = wheelsOff >= 4` and `speed`.
- Task 305 adds `src/race/giveBack.ts` (`GiveBack.open`, `update(distances, out, time)` voids entries whose passed car is `out`).

## Files

- `src/race/trouble.ts` — create — pure tracker, no imports from `three`.
- `src/game/raceGame.ts` — modify.
- `tests/unit/acceptance/307-yellow-pass-trouble.test.ts` — create (acceptance worker).

## Contract

```ts
export const TROUBLE_HOLD_S = 10;
export class TroubleTracker {
  constructor(count: number);
  mark(car: number, time: number): void;
  update(car: number, offTrack: boolean, speed: number, time: number): void; // marks when offTrack || speed < 5 m/s (CAUSE_SPEED)
  inTrouble(car: number, time: number): boolean; // time < lastMark + TROUBLE_HOLD_S
}
// RaceGame
debugRespawn(car: number): void   // AI car >= 1: calls respawnOnLine(car - 1); RangeError for car 0 / out of range
isInTrouble(car: number): boolean // trouble.inTrouble(car, current time)
```

## Rules

- `RaceGame` calls `trouble.update` for every car each tick after go (same data as the `FlagCar`), and `trouble.mark(car, time)` on every respawn.
- Yellow overtake of passed car p: skip (no give-back opened, no penalty) when `isInTrouble(p)`, in addition to the existing skips.
- GiveBack `out[p]` is also true while p is in trouble (an owed position is voided if the passed car gets into trouble).
- No allocations per tick.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `new TroubleTracker(2)` | `update(0, true, 30, 100)` | `inTrouble(0, 100)` true, `inTrouble(0, 109.99)` true, `inTrouble(0, 110.01)` false; `inTrouble(1, 100)` false |
| AT2 | new tracker | `update(0, false, 4.9, 50)`; `update(1, false, 5, 50)` | `inTrouble(0, 50)` true, `inTrouble(1, 50)` false |
| AT3 | new tracker | `mark(1, 20)`, then `update(1, false, 40, t)` every 1/120 s to t = 31 | `inTrouble(1, 29.9)` true, `inTrouble(1, 30.1)` false |
| AT4 | `RaceGame` cleveland, f4, aiCount 3, expert, seed 1, `setPlayerAutopilot(true)`, step to 30 s after go | `debugRespawn(2)`, then step 9.9 s | `isInTrouble(2)` true right after the call and at every tick of the 9.9 s |
| AT5 | same as AT4 | `debugRespawn(0)`, `debugRespawn(4)` | both throw `RangeError` |
| AT6 | as AT4 right after `debugRespawn(2)` | `debugGiveBack(1, 2)`, then step 12 s | no `'yellow flag overtake'` entry in `penalties.forCar(1)` at the end (the entry is voided because car 2 is in trouble) |
| AT7 | — | regression only, no new test: run 128, 130, 289, 298, 305 unit acceptance tests | pass |

## Acceptance criteria

- [ ] AT1–AT7 pass.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/307- tests/unit/acceptance/128- tests/unit/acceptance/130- tests/unit/acceptance/289- tests/unit/acceptance/298- tests/unit/acceptance/305-
```

## Out of scope

- Changing the respawn trigger, ghosting respawned cars, blue flags.
