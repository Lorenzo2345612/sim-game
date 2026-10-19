# 304 — Race results: penalties added, running cars not DNF

Status: pending
Phase: 2
Depends on: 303
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The race results show the player's time with penalties added, and cars still running when the player finishes are not marked DNF.

## Context

- `src/main.ts` ~1740: `if (raceGame.raceFinished || player?.finished === true) showResults();`. `showResults` (~1919) sets `paused = true`, freezing the sim, so every AI that has not crossed the line keeps `totalTime === null`.
- `src/ui/results.ts:47` prints `'DNF'` whenever `totalTime === null` and prints raw `totalTime` without the penalty (`compare` in `src/race/classification.ts` already sorts by `totalTime + penalty`).
- `resultRows()` (`src/main.ts:327`) builds `ResultsRow` from `Standing`.
- AI cars use `AiDriver` (`src/ai/aiDriver.ts`, created ~`raceGame.ts:438`); `stopped[car] === 1` marks a car taken out (`debugStopCar` / damage).

## Files

- `src/ui/results.ts` — modify — status, time cell, `update`.
- `src/main.ts` — modify — do not pause, periodic update, debug hook.
- `src/game/raceGame.ts` — modify — autopilot, `isRetired`.
- `tests/unit/acceptance/304-race-results.test.ts` — create (acceptance worker).
- `tests/e2e/acceptance/304-race-results.spec.ts` — create (acceptance worker).

## Contract

```ts
// src/ui/results.ts
export type ResultStatus = 'finished' | 'running' | 'dnf';
// ResultsRow gains: status: ResultStatus
// Results class gains: update(rows: readonly ResultsRow[]): void  // refresh table body only; buttons untouched
// src/game/raceGame.ts (RaceGame)
setPlayerAutopilot(on: boolean): void
isRetired(car: number): boolean // stopped[car] === 1
```

## Rules

- Time cell: finished → `formatLapTime(totalTime + penalty)`; running → `'Running'`; dnf → `'DNF'`. Penalty cell unchanged.
- `status` in `resultRows()`: `'finished'` if `totalTime !== null`; else `'dnf'` if `raceGame.isRetired(car)`; else `'running'`.
- Autopilot: in race mode car 0 is driven by its own classic `AiDriver` (same line/speeds as the AI, speedScale 0.8, no extra traffic logic beyond what `AiDriver` requires) whenever `setPlayerAutopilot(true)` was called OR car 0 has finished; the `step(input)` player input is then ignored. Car 0 still counts for physics, collisions and flags. Autopilot stays on after finishing.
- `main.ts`: when results appear, do not pause the simulation (race continues behind the overlay; audio may stay muted). While results are shown and `!raceGame.raceFinished`, call `results.update(resultRows(...))` at most every 0.5 s wall time; once `raceFinished`, do one last update, then pause. Restart/Menu work at any time.
- Debug hook `window.__SIMGAME__.debugAutopilot(on: boolean)` → `raceGame.setPlayerAutopilot(on)`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `new Results(document.body)` (jsdom) | `show([{position:1, name:'You', totalTime:600, bestLap:95, penalty:5, penaltyReasons:['track limits'], status:'finished'}], handlers)` | time cell text equals `formatLapTime(605)`; penalty cell `'5 s (track limits)'` |
| AT2 | same | `show` with rows status `'running'` (totalTime null) and `'dnf'` (totalTime null) | time cells `'Running'` and `'DNF'` |
| AT3 | after AT1 | `update(rows)` with 2 rows | tbody has 2 rows; `.results-actions` buttons are the same element instances as before `update` |
| AT4 | `Classification`, 2 cars, car 0 finishes at 600 s with `addPenalty(0, 5)`, car 1 finishes at 603 s | `standings()` | car 1 position 1, car 0 position 2 |
| AT5 | `RaceGame` cleveland, f4, aiCount 3, laps 1, expert, seed 1, `setPlayerAutopilot(true)` | step with input `{throttle 0, brake 1}` until car 0 standing `finished` (cap 400 s sim) | car 0 finishes; then step on (cap 200 s more) until `raceFinished`: true, and every car is finished or `isRetired` |
| AT6 | as AT5 at the tick car 0 finishes | `setPlayerAutopilot(false)`, step 30 s with input `{throttle 0, brake 1}` | car 0 position moved > 300 m along the track (autopilot stays on after finishing) |
| AT7 | as AT5 before go, `debugStopCar(2)` | read `isRetired(2)`, `isRetired(1)` | true, false |
| AT8 | page `/?race=1&track=cleveland&ai=3&laps=3`, 3 s sim after lights out | `finishRaceNow()` | `#results` visible; no time cell reads `'DNF'`; at least 3 read `'Running'`; `getSimTime()` grows ≥ 1 s within the next 5 s wall time |
| AT9 | — | run 095, 130 and 207 e2e acceptance specs | pass |

## Acceptance criteria

- [ ] AT1–AT9 pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 304- 095- 130- 207-
```

## Out of scope

- Gap/interval column, lap-down notation, podium screen.
- Changing classification rules.
