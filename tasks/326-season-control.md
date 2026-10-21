# 326 — Season controller and standings

Status: pending
Phase: 3
Depends on: 325
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure, immutable season controller: weekend replay, session submission, event records, driver and team standings.

## Context

No `three`, no DOM. Design: `docs/design/c1-season.md`. Types from `src/career/season.ts` (325: `SeasonState`, `EventRecord`), `SeriesDef` (324), `Weekend`/`SessionResult` from `src/career/weekend.ts`, `WeekendFormat`/`PointsTable` from `src/career/types.ts`. Car index = driver index. Guide: `ai/guides/testing.md`.

## Files

- `src/career/seasonControl.ts` — create
- `tests/unit/acceptance/326-season-control.test.ts` — create (acceptance worker); edge tests by tester-pre.

## Steps

```ts
export function currentRound(s: SeasonState): number;
export function seasonDone(s: SeasonState, series: SeriesDef): boolean;
export function eventWeekend(s: SeasonState, format: WeekendFormat, tables: Record<string, PointsTable>): Weekend;
export function submitSession(s: SeasonState, series: SeriesDef, format: WeekendFormat, tables: Record<string, PointsTable>, r: SessionResult): SeasonState;
export interface DriverStanding { car: number; points: number; wins: number; position: number }
export interface TeamStanding { teamId: string; points: number; position: number }
export function driverStandings(s: SeasonState): DriverStanding[];
export function teamStandings(s: SeasonState, series: SeriesDef): TeamStanding[];
```

1. `currentRound` = `events.length`; `seasonDone` = `events.length >= series.calendar.length`.
2. `eventWeekend` = new `Weekend(format, s.drivers.length, tables)` with every `s.pending` result re-submitted in order.
3. `submitSession` is pure (input state and `r` unchanged; returns new state with copied arrays). Appends `r` to `pending`; if the replayed weekend is then `done`, append `{ round: currentRound, sessions: pending, points: weekend.totals() }` to `events` and set `pending` to `[]`. Throws `Error` when the season is done; invalid `r` throws via `Weekend.submit`.
4. Event finishing order = `order` of the event's last session. `wins` = number of events where the driver finished 1st.
5. `driverStandings`: total points per car = sum of `events[i].points`; sorted by points desc; tie → countback of event finishing positions (more 1st places, then more 2nd, …); then lower car index. Returns all drivers, `position` 1-based.
6. `teamStandings`: team points = sum of its drivers' points; sorted points desc; tie → best driver position among its drivers (lower wins), then `series.teams` order. All teams returned, `position` 1-based.

Conventions: positions 1-based; ties resolved only as stated (no randomness); inputs never mutated; invalid input throws.

Test series for AT1–AT5: 2 teams A, B (4 cars: car 1, 2 in A; car 3, 0 in B), 2 events; format `t` = [qualifying 10 min, race 5 laps `standard10`]. All qualifying results: order [0,1,2,3], bestLaps [90, 91, 92, 93], all classified, FL null.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | new season | submit Q of event 1 | events [], pending length 1, currentRound 0; eventWeekend index 1, gridFor [0,1,2,3]; input state unchanged |
| AT2 | AT1 | submit race {order [2,0,1,3], all classified, FL car 2} | events[0].points [18,15,26,12]; pending []; currentRound 1 |
| AT3 | AT2 | event 2: Q, then race {order [0,1,3,2], classified [t,t,t,f], FL car 3} | events[1].points [25,18,0,16]; seasonDone true; driverStandings car order [0,1,3,2], points [43,33,28,26], wins car 0 = 1, car 2 = 1 |
| AT4 | AT3 | teamStandings | [B 71, A 59] |
| AT5 | AT3 | submitSession | throws |
| AT6 | 3 teams (6 cars), 2 events, format `t`, qualifying as above (order [0..5]), FL null: race 1 order [0,1,2,3,4,5], race 2 order [2,3,1,4,5,0], all classified | driverStandings | car order [2,0,1,3,4,5]; points [40,33,33,30,22,18] (car 0 ahead of car 1 on wins) |

## Acceptance criteria

- [ ] All AT rows pass; no `three` import; `submitSession` leaves its input deep-equal to before the call.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Save/load (327), view model (329), UI, AI pace, simulating skipped events, reading JSON.
