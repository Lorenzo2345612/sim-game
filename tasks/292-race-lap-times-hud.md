# 292 — Current, last and best lap times in the race HUD
Status: pending
Phase: 2
Depends on: 093
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal
In race mode the HUD lap-time boxes stay empty: `src/main.ts` (`getLapInfo`, ~line 789) returns `emptyLapInfo()` whenever `raceGame` is set. After this task the race HUD shows the player's lap, current lap time, last lap and best lap from the race classification.

## Files
- `src/race/classification.ts` — modify — `lapStartTime(car: number): number | null`.
- `src/game/raceGame.ts` — modify — `getLapInfo(car?: number): LapInfo` (type from `src/game/game.ts`).
- `src/main.ts` — modify — race branch of `getLapInfo` uses `raceGame.getLapInfo(0)`.
- `tests/unit/acceptance/292-*.test.ts` — create (acceptance worker).

## Steps
1. `lapStartTime(car)`: the interpolated crossing time that started the car's current lap (the `lapStart` already kept per car); `null` before the first crossing; RangeError like the other per-car methods for bad indices.
2. `RaceGame.getLapInfo(car = 0)`: `lap` = `Standing.lap`; `currentLapTime` = `simTime − lapStartTime(car)` while the car has started a lap and is not finished, else `null`; `lastLapTime` / `bestLapTime` = `Standing.lastLap` / `bestLap`; `valid: true` (races have no lap invalidation). RangeError for car outside 0..carCount−1. No allocation per call beyond the returned object (reuse one object per RaceGame is fine; document it).
3. Ghost delta stays off in race mode (unchanged).

## Acceptance tests (defined by the planner with Opus, before coding)
| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `new RaceClassification(1, 3, 1000)`; `update(0, 950, 10)` | `lapStartTime(0)` | null |
| AT2 | AT1 then `update(0, 50, 11)` | `lapStartTime(0)` | 10.5 (1e-9) |
| AT3 | AT2 then `update(0, 500, 20)`, `update(0, 950, 30)`, `update(0, 50, 31)` | `lapStartTime(0)`; `standings()[0].lastLap` | 30.5 (1e-9); 20 (1e-9) |
| AT4 | Monza, f4, 3 AI, medium, seed 1, player idle (last on grid, never crosses) | step 60 s after go; `getLapInfo(0)` | `{ lap: 0, currentLapTime: null, lastLapTime: null, bestLapTime: null, valid: true }` |
| AT5 | as AT4 | step 60 s after go; `getLapInfo(1)` | lap ≥ 1 and equals the car-1 `standings()` row lap; currentLapTime in (0, 60]; lastLapTime/bestLapTime equal that row's lastLap/bestLap |
| AT6 | as AT4 | `getLapInfo(4)` / `getLapInfo(-1)` | RangeError / RangeError |

## Verification
```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/292- tests/unit/acceptance/093- tests/unit/edge/093-
npm run build
```

## Out of scope
- HUD layout/overlaps, sector times and ghost delta in race mode, practice mode lap timing.
