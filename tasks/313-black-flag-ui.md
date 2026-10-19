# 313 — Black flag in race control, announcements and results

Status: pending
Phase: 2
Depends on: 312, 296, 304
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A black-flag disqualification and a black-and-white final warning show in race control, the player announcement and the results; a disqualified AI car disappears from the track.

## Context

- 311 adds `PenaltyEntry.kind: 'black flag'` and `PenaltyEntry.finalWarning?: true` (in `src/race/penalties.ts`); 312 adds `RaceGame.isDisqualified(car: number): boolean`. 296 adds `raceControlMessage(e, name = carName)`. 304 adds `ResultStatus = 'finished' | 'running' | 'dnf'` and `ResultsRow.status` in `src/ui/results.ts`.
- Existing selectors: race-control panel `#race-control` (panel text holds every message); announcement `#penalty-announce` with children `.pen-announce-title`, `.pen-announce-value`, `.pen-announce-reason` (hides after a timer, so e2e must observe it, e.g. MutationObserver); results `#results` (`display: flex` when shown), rows `#results tbody tr`, time cell = 3rd `td`.
- `syncToasts` (`src/main.ts` ~1314) loops new book entries: `raceControlMessage` -> `pushRaceControl`; player entries then announce (`announcePenalty`) or toast. AI meshes: `aiCars[k].root` (car `k+1`). Results are shown from the tick via `showResults()` when `raceGame.raceFinished || player.finished`.

## Files

- `src/ui/raceControl.ts` — modify.
- `src/ui/results.ts` — modify.
- `src/main.ts` — modify.
- `tests/unit/acceptance/313-black-flag-ui.test.ts`, `tests/e2e/acceptance/313-black-flag-ui.spec.ts` — create (acceptance worker).

## Steps

```ts
// raceControl.ts
export function finalWarningMessage(e: PenaltyEntry, name: (car: number) => string = carName): string | null;
// results.ts
export type ResultStatus = 'finished' | 'running' | 'dnf' | 'dsq';
// __SIMGAME__ type and object gain:
carVisible(car: number): boolean   // car >= 1: aiCars[car-1].root.visible; 0: player mesh root.visible
```
1. `raceControlMessage`: kind `'black flag'` -> `BLACK FLAG FOR <NAME> - DISQUALIFIED - <REASON>`, uppercase, `<NAME>` = `name(e.car).toUpperCase()`. Other kinds unchanged.
2. `finalWarningMessage`: `e.finalWarning === true` -> `BLACK AND WHITE FLAG FOR <NAME> - <REASON>` (uppercase); otherwise null.
3. `penaltyAnnouncement`: kind `'black flag'` -> `{ title: 'BLACK FLAG', value: 'DISQUALIFIED', reason: capitalised reason }`.
4. `syncToasts`: per new entry push `raceControlMessage` then `finalWarningMessage` (each when non-null). Player black flag uses the announcement only (no toast).
5. `Results.show`: status `'dsq'` -> time cell `'DSQ'` (status wins over `totalTime`).
6. `resultRows` (`main.ts`): status `'dsq'` when `raceGame.isDisqualified(car)`, checked before the other statuses.
7. Each frame: AI mesh `root.visible = !raceGame.isDisqualified(k + 1)`. Call `showResults()` also when `raceGame.isDisqualified(0)` (same path as player finished).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | entry `{car:3, kind:'black flag', seconds:0, reason:'track limits', time:50}` | `raceControlMessage(e)` | `` `BLACK FLAG FOR ${carName(3).toUpperCase()} - DISQUALIFIED - TRACK LIMITS` `` |
| AT2 | penalty entry car 3, 5 s, 'track limits', `finalWarning: true` | `finalWarningMessage(e)`; `raceControlMessage(e)` | `` `BLACK AND WHITE FLAG FOR ${carName(3).toUpperCase()} - TRACK LIMITS` ``; time-penalty message unchanged (`'5 SECOND TIME PENALTY FOR …'`) |
| AT3 | same entry without `finalWarning`; a warning entry | `finalWarningMessage` | null for both |
| AT4 | black flag entry car 0 reason 'VSC delta' | `penaltyAnnouncement(e)` | `{title:'BLACK FLAG', value:'DISQUALIFIED', reason:'VSC delta'}` |
| AT5 | `new Results(document.body)` | `show` a row `{status:'dsq', totalTime:null, …}` | time cell `'DSQ'` |
| AT6 | page `/?race=1&track=cleveland&ai=3&laps=3`, 3 s sim after lights out | `forceTrackLimits(7, 2)` | within 2 s wall: race-control panel text contains `'BLACK FLAG'` and `'BLACK AND WHITE FLAG'`; `carVisible(2)` false; `carVisible(1)` true |
| AT7 | same page | `forceTrackLimits(7)` (player) | `#results` visible within 2 s wall; last results row time cell `'DSQ'`; announcement title `'BLACK FLAG'` was shown |
| AT8 | — | run 294 and 304 unit and e2e acceptance | pass |

## Acceptance criteria

- [ ] All AT rows pass; 294 and 304 acceptance tests still pass.
- [ ] `grep -n "AI \${" src/ui/raceControl.ts` shows only `carName` builds names.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 313- 294- 304-
```

## Out of scope

- Flag graphics, sounds, qualifying, rejoin, DSQ rules (312), driver-name logic (296), results refresh logic (304).
