# Career C0 — race weekend (milestone M3.1, tasks 274–280) — planner design, Opus

Goal: a "Quick weekend" from the track menu: practice / qualifying (timed, best valid lap) / optional sprint / race, grid from qualifying, points, event standings, hub screen between sessions. Pure logic in `src/career/` and `src/race/` (no `three`, no DOM); UI in `src/ui/`. Names stay `You` / `AI n` (C1 adds names).

Existing facts (survey 2026-10-18): `RaceGame.create(track, spec, RaceConfig, options)`; player = car 0, AI k = car k+1; grid hard-coded (player last, `slot = i===0 ? grid[aiCount] : grid[i-1]`); `RaceClassification.standings(): Standing[]` (`lap` = current lap, completed laps = `lap - 1` once started; `finished`, `bestLap`, `penalty`); `countWheelsOff(surfaces)` in `src/race/trackLimits.ts`; results screen `src/ui/results.ts`; quick race via URL params in `src/main.ts` (`raceConfigFromQuery`).

## Tasks

| # | Title | Files | Deps | Cx |
|---|---|---|---|---|
| 274 | Weekend formats and points tables | `src/career/types.ts`, `src/career/points.ts`, `public/career/points.json`, `public/career/formats.json` | — | simple |
| 275 | Weekend controller | `src/career/weekend.ts` | 274 | complex |
| 276 | RaceGame grid order | `src/game/raceGame.ts` | — | simple |
| 277 | Qualifying classification | `src/race/qualifying.ts` | — | complex |
| 278 | RaceGame timed sessions (practice, qualifying) | `src/game/raceGame.ts` | 276, 277 | complex, heavy |
| 279 | Session results adapters | `src/career/sessionResult.ts` | 274, 277 | simple |
| 280 | Quick weekend menu, hub screen, session HUD | `src/ui/weekendHub.ts`, `src/ui/menu.ts`, `src/main.ts`, `src/ui/hudSession.ts` | 275, 278, 279 | complex, heavy |

Parallel: 274, 276, 277 at once; then 275, 279; 278 after 276+277; 280 last.

## 274 contract

```ts
export type SessionKind = 'practice' | 'qualifying' | 'sprint' | 'race';
export type GridRule = 'qualifying' | 'reverse-top8' | 'sprint-result';
export interface SessionSpec { kind: SessionKind; minutes?: number; laps?: number; points?: string; grid?: GridRule; polePoints?: number }
export interface WeekendFormat { id: string; name: string; sessions: SessionSpec[] }
export interface PointsTable { id: string; positions: number[]; fastestLap?: { points: number; maxPosition: number } }
export function parsePointsTable(json: unknown): PointsTable;
export function parseWeekendFormat(json: unknown, tables: Record<string, PointsTable>): WeekendFormat;
export function pointsFor(table: PointsTable, position: number, classified: boolean, fastestLap: boolean): number; // position 1-based
```
Rules: practice/qualifying need `minutes` > 0 and no `laps`; sprint/race need `laps` ≥ 1 and a known `points` id; `grid` defaults to `'qualifying'` for sprint/race; `polePoints` only on qualifying. Positions non-increasing, all ≥ 0. Unclassified → 0 (no fastest-lap point). Errors: `Error('Invalid weekend format: <field>')` / `Error('Invalid points table: <field>')`.
Data: `standard10` = [25,18,15,12,10,8,6,4,2,1] + fastestLap {1, 10}; `sprint8` = [8,7,6,5,4,3,2,1]. Formats: `short` (Q 10 min; race 5 laps standard10), `standard` (P 20; Q 15; race 10 laps standard10), `sprint` (P 20; Q 15 polePoints 2; sprint 6 laps sprint8 grid reverse-top8; race 10 laps standard10 grid qualifying).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | standard10 | pointsFor P1 / P10 / P11, classified, no FL | 25 / 1 / 0 |
| AT2 | standard10 | P3+FL, P1+FL, P11+FL (classified) | 16, 26, 0 |
| AT3 | standard10 | P5 unclassified with FL | 0 |
| AT4 | sprint8 | P8, P9 with FL true | 1, 0 (no FL rule) |
| AT5 | `public/career/points.json`, `formats.json` | parse all | tables standard10, sprint8; formats short, standard, sprint with session kinds exactly as listed above |
| AT6 | format JSON variants | sessions [] / kind 'warmup' / race points 'nope' / qualifying with laps 5 / race without laps / polePoints on race | each throws an Error whose message starts `Invalid weekend format` |
| AT7 | points JSON | positions [10, 12] / [5, -1] / missing id | throws `Invalid points table` |

## 275 contract

```ts
export interface SessionResult { order: number[]; bestLaps: (number | null)[]; classified: boolean[]; fastestLapCar: number | null }
export class Weekend {
  constructor(format: WeekendFormat, carCount: number, tables: Record<string, PointsTable>);
  get index(): number; get current(): SessionSpec | null; get done(): boolean;
  gridFor(): number[];            // car indices, pole first, for the current session
  submit(r: SessionResult): number[]; // points per car scored in this session; advances index
  totals(): number[]; standings(): number[]; result(i: number): SessionResult | undefined;
}
```
Rules: `order` = car indices in classification order (authoritative); `bestLaps`/`classified` indexed by car. Grid for practice/qualifying and when no qualifying happened: `[0..n-1]`. `qualifying`: last qualifying order with timed cars (bestLap ≠ null) first in that order, untimed after by car index. `reverse-top8`: first min(8, timed) timed cars of qualifying reversed, then the rest of the qualifying grid. `sprint-result`: last sprint order. Pole points: qualifying `order[0]` if its bestLap ≠ null. Points sessions: `pointsFor(table, pos, classified[car], car === fastestLapCar)`. Standings: totals desc; tie → finishing positions in points sessions sorted ascending, compared lexicographically (lower wins); then car index. Throws: submit when done; order not a permutation of 0..n-1; arrays of wrong length; constructor if `sprint-result` has no earlier sprint.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `sprint` format, 4 cars | new | index 0, current.kind practice, gridFor [0,1,2,3] |
| AT2 | after practice submit (any valid) | submit Q {order [1,3,0,2], bestLaps [92.0, 90.5, null, 91.0]} | returns [0,2,0,0]; totals [0,2,0,0]; index 2 |
| AT3 | after AT2 | gridFor (sprint) | [0,3,1,2] |
| AT4 | after AT3 | submit sprint {order [3,0,1,2], classified all true, fastestLapCar 0} | returns [7,6,5,8]; totals [7,8,5,8]; standings [3,1,0,2] |
| AT5 | after AT4 | gridFor (race) | [1,3,0,2] |
| AT6 | after AT5 | submit race {order [1,0,3,2], classified [true,true,false,true], fastestLapCar 2} | returns [18,25,0,15]; totals [25,33,5,23]; standings [1,0,3,2]; done true; current null |
| AT7 | same as AT6 but fastestLapCar 0 | submit race | car 0 scores 19, total 26 |
| AT8 | done weekend / order [0,0,1,2] / bestLaps length 3 | submit | throws |
| AT9 | format {race 3 laps standard10} 3 cars | gridFor | [0,1,2] |
| AT10 | `standard`, 3 cars, Q bestLaps all null, order [2,1,0] | race gridFor | [0,1,2] |
| AT11 | format [race grid sprint-result] | constructor | throws |

## 276 contract

`RaceConfig.gridOrder?: number[]` — `gridOrder[p]` = car at grid position p (slots from `gridSlots(track, carCount)`). Absent → current behaviour. Invalid (length ≠ carCount, duplicate, out of range) → `create` rejects with an Error containing `gridOrder`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza, aiCount 3, gridOrder [2,0,3,1], seed 1 | create, getStates (no step) | car 2 at slot 0, car 0 slot 1, car 3 slot 2, car 1 slot 3 (x,z within 0.05 m of `gridSlots(track,4)[p].position`) |
| AT2 | monza, aiCount 3, no gridOrder | create | car 0 at slot 3, car k+1 at slot k (0.05 m) |
| AT3 | gridOrder [0,1,2] / [0,0,1,2] / [0,1,2,4] with aiCount 3 | create | rejects, message contains `gridOrder` |

Existing 091/093 tests unchanged.

## 277 contract

```ts
export interface QualiStanding { car: number; position: number; bestLap: number | null; laps: number; lastLap: number | null; lastValid: boolean | null; done: boolean }
export class QualifyingClassification {
  constructor(carCount: number, lapLength: number, durationS: number);
  update(car: number, lapDistance: number, time: number, wheelsOff: number, dt: number): void;
  retire(car: number): void;
  get finished(): boolean; standings(): QualiStanding[];
}
export const QUALI_GRACE_S = 300; export const OFF_LIMIT_S = 0.25;
```
Rules: forward crossing = lapDistance drops by more than lapLength/2 between updates; backward crossing = rises by more than lapLength/2 → current lap void, next forward crossing restarts timing (no lap counted). First forward crossing starts timing (out-lap untimed). Each later forward crossing completes a lap: `laps++`, `lastLap = time − start`; valid unless 4 wheels were off continuously ≥ `OFF_LIMIT_S` (accumulated with `dt`, reset when wheelsOff < 4) during it. bestLap = min valid lap. A car's first forward crossing at time ≥ durationS completes its lap (if timing) and sets `done`. `retire` → done. `finished` = all done, or any update with time ≥ durationS + QUALI_GRACE_S (then all done). Order: bestLap asc (null last); tie → earlier time the best was set; then car index. Positions 1-based.

| ID | Given (lapLength 1000, duration 600, 2 cars, updates every 0.05 s) | When | Then |
|---|---|---|---|
| AT1 | car 0 crosses at t=1 (990→5) and at t=61 | standings | car 0 laps 1, bestLap 60 (1e-6), lastValid true; car 1 bestLap null |
| AT2 | lap with wheelsOff 4 for 0.30 s continuous | lap completes | laps 1, bestLap null, lastValid false |
| AT3 | lap with two 0.20 s 4-off spells separated by on-track | lap completes | valid |
| AT4 | invalid lap then 58 s valid lap; separate car: 60 then 62 valid | standings | bests 58 and 60 |
| AT5 | lap started at 545, crossing at 605 | — | lap counted (60 s), done true; finished false while car 1 not done |
| AT6 | car 1 retire() after AT5 | — | finished true |
| AT7 | car never crosses | update at t=900.0 | finished true, that car done, bestLap null |
| AT8 | timing started t=1; backward crossing (5→995) at t=30, then forward crossings at 70 and 130 | — | no lap from the voided one; laps 1 with lastLap 60 |
| AT9 | both cars best 60.0, car 1 set it earlier | standings | car 1 position 1 |

## 278 contract

`RaceConfig.session?: { kind: 'race' | 'practice' | 'qualifying'; minutes?: number }` (default race). New getters: `sessionFinished` (race → `raceFinished`; timed → QualifyingClassification `finished`), `timeLeft` (timed: max(0, minutes·60 − simTime); race: null), `qualiStandings(): QualiStanding[]` (timed only, else []). Timed sessions: no start lights (`startLights()` phase `'go'` from t=0), no jump-start penalty, the car at grid position p is held (throttle 0, brake 1) until simTime ≥ 2.0·p s; classification fed every step with each car's lap distance, `countWheelsOff` and FIXED_DT; AI stuck respawn unchanged. Race session unchanged.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza, aiCount 3, qualifying 1 min, seed 1, player brake 1 | t=0 | startLights phase 'go'; timeLeft 60 |
| AT2 | same | step to 3.9 s / 6.0 s | car at grid position 2 (car 3) moved < 0.2 m at 3.9 s, > 0.5 m at 6.0 s; car 1 (pos 0) moved > 0.5 m by 1.5 s |
| AT3 | same | step to 10 s | timeLeft 50 (1e-6) |
| AT4 | monza, aiCount 1 (classic, expert), qualifying 1 min, player brake 1 | step until sessionFinished (cap 361 s) | finished by simTime ≤ 360.02 s; AI laps ≥ 1 and (bestLap null or 60 ≤ bestLap ≤ 240); player laps 0, bestLap null, done |
| AT5 | race session (no `session`) | create | startLights phase 'grid' at t=0; timeLeft null; qualiStandings [] |

## 279 contract

```ts
export function raceSessionResult(st: readonly Standing[], laps: number): SessionResult;
export function qualiSessionResult(st: readonly QualiStanding[]): SessionResult;
```
Race: order = standings order; classified = finished or completed laps (`lap − 1`, min 0) ≥ ceil(0.9·laps); bestLaps from `bestLap`; fastestLapCar = classified car with minimal bestLap (tie → better position), null if none. Quali: order by position; bestLaps; classified all true; fastestLapCar null.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 3 standings: car 2 finished best 61, car 0 finished best 60.5, car 1 lap 9 (laps 10) best 59 unfinished | raceSessionResult(…, 10) | order [2,0,1]; classified [true, false, true] (car 1: 8 completed < 9); fastestLapCar 0 |
| AT2 | car 1 lap 10 (9 completed) unfinished, laps 10 | — | classified true for car 1 (9 ≥ 9) |
| AT3 | nobody classified | — | fastestLapCar null |
| AT4 | quali standings positions car 1, car 0 (null best) | qualiSessionResult | order [1,0], bestLaps [null, x], classified [true,true], fastestLapCar null |

## 280 contract (UI, e2e)

Track select: "Quick weekend" button next to quick race, with format select (short/standard/sprint; names from formats.json), race laps (sprint laps = ceil(laps/2)), AI count, difficulty, AI driver. URL `?weekend=<formatId>&track=…&laps=…&ai=…&diff=…[&aidriver=neural]`. Main keeps one in-memory `Weekend`; each session = `RaceGame.create` with `session` and `gridOrder = weekend.gridFor()`; when `sessionFinished` (or the player finished a race), build the result with 279, `submit`, show `#weekend-hub` (sessions list with done/next, last session table pos/name/best lap/time-or-gap/points, event standings pos/name/points, buttons `Continue` and `Menu`; after the last session title "Weekend complete" and no Continue). HUD `#hud-session` in timed sessions: `mm:ss` time left, player best lap and position. Pause menu "End session" in timed sessions ends it with current standings. Debug hook `window.__SIMGAME__.weekend = { index, grid, results, endSession() }` (endSession works for every session kind; race → current standings via 279).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `/?weekend=short&track=monza&laps=1&ai=3&diff=medium` | load, 2 s | `#hud-session` visible, text has `m:ss` ≤ 10:00; `__SIMGAME__.weekend.index` 0 |
| AT2 | AT1 | `endSession()` | `#weekend-hub` visible; 2 session rows (first done); standings 4 rows; Continue visible |
| AT3 | AT2 | click Continue | `weekend.index` 1; `weekend.grid` deep-equals `weekend.results[0].order` |
| AT4 | AT3 | `endSession()` | hub shows "Weekend complete"; no Continue; Menu returns to track select |
| AT5 | track select | open | Quick weekend control with 3 format options; existing 095 quick race unchanged |
