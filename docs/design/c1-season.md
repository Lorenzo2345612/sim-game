# Career C1 — single season (milestone M3.2, tasks 324–330) — planner design, Opus

Goal: Career button → new season in the fictional "Latin F4 Cup" (6 events, 6 teams × 2 cars, player in the last team), each event a C0 weekend, season hub with calendar and driver/team standings, IndexedDB save/resume between sessions. Pure logic in `src/career/` (no `three`, no DOM); UI in `src/ui/career/`. Builds on C0 (274–280) and `generateGrid` (`src/race/drivers.ts`).

Car index = season driver index: car 0 = player = `drivers[0]`, car k = `drivers[k]`.

## Tasks

| # | Title | Files | Deps | Cx |
|---|---|---|---|---|
| 324 | Series data and parser | `src/career/series.ts`, `public/career/series/f4-latam.json` | — | simple |
| 325 | Season creation, AI pace, event seed | `src/career/season.ts` | 324 | simple |
| 326 | Season controller and standings | `src/career/seasonControl.ts` | 325 | complex |
| 327 | Season save codec and stores | `src/career/save.ts` | 325 | simple |
| 328 | RaceConfig per-AI pace | `src/game/raceGame.ts` | 262 | simple |
| 329 | Season hub view model | `src/career/seasonView.ts` | 326 | simple |
| 330 | Career menu, season hub and event flow | `src/ui/career/careerStart.ts`, `src/ui/career/seasonHub.ts`, `src/ui/menu.ts`, `src/main.ts` | 280, 326, 327, 328, 329 | complex, heavy |

Parallel: 324 and 328; then 325; then 326 and 327; 329; 330 last.

## 324 contract

```ts
export interface TeamDef { id: string; name: string; colour: string; perf: number }
export interface EventDef { trackId: string; name: string }
export interface SeriesDef { id: string; name: string; carId: string; gridsSeries: string; formats: string[]; teams: TeamDef[]; calendar: EventDef[] }
export function parseSeries(json: unknown, trackIds: readonly string[], formatIds: readonly string[]): SeriesDef;
```
Rules: ≥ 2 teams, team ids unique, `perf` in [0.9, 1.0], `colour` `#rrggbb`; calendar 1–12 events, each `trackId` in `trackIds`, `name` non-empty; `formats` non-empty, each in `formatIds`; `carId`, `gridsSeries`, `name`, `id` non-empty. Errors `Error('Invalid series: <field>')`.
Data `f4-latam`: name "Latin F4 Cup", carId `f4`, gridsSeries `f4-latam`, formats [short, standard, sprint]; 6 fictional brand-neutral teams with perf 1.00, 0.995, 0.99, 0.985, 0.98, 0.975 (in that order); calendar mexico, braselton, ermita-federal, elkhart, cleveland, ermita-centro (finale), event names fictional.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `public/career/series/f4-latam.json`, ids from `public/tracks/index.json`, formats from `formats.json` | parse | 6 teams with perf [1, 0.995, 0.99, 0.985, 0.98, 0.975]; calendar trackIds exactly [mexico, braselton, ermita-federal, elkhart, cleveland, ermita-centro]; formats [short, standard, sprint]; carId f4 |
| AT2 | f4-latam variants | 1 team / duplicate team id / perf 1.01 / colour `red` / trackId `nowhere` / 0 events / 13 events / format `endurance` / formats [] | each throws, message starts `Invalid series` |

## 325 contract

```ts
export interface SeasonDriver extends Driver { teamId: string; skill: number; isPlayer: boolean }
export interface EventRecord { round: number; sessions: SessionResult[]; points: number[] }
export interface SeasonState { version: 1; seriesId: string; formatId: string; difficulty: Difficulty; seed: number; year: number; drivers: SeasonDriver[]; events: EventRecord[]; pending: SessionResult[] }
export interface PlayerInfo { first: string; last: string; nat: string; number: number }
export function createSeason(series: SeriesDef, opts: { formatId: string; difficulty: Difficulty; seed: number; year: number; player: PlayerInfo }, ai: readonly Driver[]): SeasonState;
export function aiPace(state: SeasonState, series: SeriesDef): number[]; // by car index; [0] = 1
export function eventSeed(state: SeasonState, round: number): number;
```
Rules: seats = 2 per team in data order. `ai.length` must equal 2·teams − 1 and `formatId` be in `series.formats`, else throw `Error('Invalid season: <field>')`. `drivers[0]` = player (team = last team, `skill` 1, code = first 3 letters of `last` upper-case). `drivers[k]` (k ≥ 1) = `ai[k−1]`, team index `floor((k−1)/2)`. AI `skill` = 0.985 + 0.015·u, u = k-th draw (k = 1..) of mulberry32(seed) (same PRNG as `src/race/drivers.ts`, export it there if needed). `aiPace[k]` = team perf × skill. `eventSeed` = FNV-1a 32-bit of the UTF-8 string `${seed}|${year}|${seriesId}|${round}`. `events` and `pending` start empty.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | f4-latam, 11 AI drivers, seed 7, year 2027, format short | createSeason | 12 drivers; drivers[0] isPlayer, team = 6th team id, skill 1; drivers[1], [2] on the first team, drivers[11] on the 6th; drivers[k] names = ai[k−1] |
| AT2 | AT1 | aiPace | length 12; [0] = 1; every [k] in [team perf × 0.985, team perf] (1e-12); same seed → identical array; seed 8 → differs |
| AT3 | AT1 | eventSeed round 0 / 1 / 5 | 2835877001 / 2819099382 / 2886209858 |
| AT4 | 10 AI drivers / format `endurance` | createSeason | throws `Invalid season` |

## 326 contract

```ts
export function currentRound(s: SeasonState): number;          // = events.length
export function seasonDone(s: SeasonState, series: SeriesDef): boolean;
export function eventWeekend(s: SeasonState, format: WeekendFormat, tables: Record<string, PointsTable>): Weekend; // new Weekend with s.pending re-submitted
export function submitSession(s: SeasonState, series: SeriesDef, format: WeekendFormat, tables: Record<string, PointsTable>, r: SessionResult): SeasonState;
export interface DriverStanding { car: number; points: number; wins: number; position: number }
export interface TeamStanding { teamId: string; points: number; position: number }
export function driverStandings(s: SeasonState): DriverStanding[];
export function teamStandings(s: SeasonState, series: SeriesDef): TeamStanding[];
```
Rules: `submitSession` is pure (input state unchanged, returns a new state). It appends `r` to `pending`; when the replayed weekend is then done, it appends `{ round, sessions: pending, points: weekend.totals() }` to `events` and clears `pending`. Throws when the season is done. Event finishing order = `order` of the event's last session. Driver standings: points desc; tie → countback of event finishing positions (more 1st places, then more 2nd places, …); then car index. `wins` = count of event finishing position 1. Team points = sum of its drivers' points; tie → best driver position (lower wins), then data order. Positions 1-based.

Test series for AT1–AT5: 2 teams A, B (4 cars: car 1, 2 in A; car 3, 0 in B), 2 events; format `t` = [qualifying 10 min, race 5 laps standard10]. All qualifying results: order [0,1,2,3], bestLaps [90, 91, 92, 93], all classified, FL null.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | new season | submit Q of event 1 | events [], pending length 1, currentRound 0; eventWeekend index 1, gridFor [0,1,2,3]; input state unchanged |
| AT2 | AT1 | submit race {order [2,0,1,3], all classified, FL car 2} | events[0].points [18,15,26,12]; pending []; currentRound 1 |
| AT3 | AT2 | event 2: Q, then race {order [0,1,3,2], classified [t,t,t,f], FL car 3} | events[1].points [25,18,0,16]; seasonDone true; driverStandings car order [0,1,3,2], points [43,33,28,26], wins car 0 = 1, car 2 = 1 |
| AT4 | AT3 | teamStandings | [B 71, A 59] |
| AT5 | AT3 | submitSession | throws |
| AT6 | 3 teams (6 cars), 2 events, format `t`, qualifying as above (order [0..5]), FL null: race 1 order [0,1,2,3,4,5], race 2 order [2,3,1,4,5,0], all classified | driverStandings | car order [2,0,1,3,4,5]; points [40,33,33,30,22,18] (car 0 ahead of car 1 on wins) |

## 327 contract

```ts
export const SAVE_VERSION = 1;
export function serializeSeason(s: SeasonState): string;
export function parseSeason(text: string, series: SeriesDef): SeasonState;
export interface SaveStore { load(): Promise<string | null>; save(text: string): Promise<void>; clear(): Promise<void> }
export class MemoryStore implements SaveStore {}
export class IdbStore implements SaveStore { constructor(dbName?: string) } // default db 'simgame', store 'career', key 'season'
```
Rules: `parseSeason` throws `Error('Invalid save: <field>')` on bad JSON, `version` ≠ 1, `seriesId` ≠ series.id, `formatId` not in series.formats, drivers length ≠ 2·teams, unknown teamId, `isPlayer` not exactly drivers[0], `events.length` > calendar length, `events[i].round` ≠ i, points or session arrays with length ≠ drivers. `IdbStore.save` copies the previous value to key `season-backup` in the same transaction. IdbStore is exercised by the 330 e2e only (no IndexedDB in Vitest).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 326 AT3 state | parseSeason(serializeSeason(s)) | deep-equals s |
| AT2 | serialized AT1 with: `{` / version 2 / seriesId `x` / 3 drivers / drivers[1].isPlayer true / events[0].round 1 / events[0].points length 3 | parseSeason | each throws, message starts `Invalid save` |
| AT3 | MemoryStore | load / save('a') then load / clear then load | null / 'a' / null |

## 328 contract

`RaceConfig.aiPace?: number[]` — by car index (length = aiCount + 1, [0] ignored), multiplies each AI's base speed scale (same place as `scenario.speedScales`); residual neural AI: multiplies the net's `scale`. Absent → unchanged. Wrong length or any AI value outside (0.8, 1.05] → `create` rejects with an Error containing `aiPace`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza, aiCount 1, medium, seed 3, player brake 1; runs with aiPace [1, 1] and [1, 0.9] | step 90 s each | AI distance ratio (0.9 run / 1.0 run) in [0.80, 0.98] |
| AT2 | same, aiPace [1, 1] vs no aiPace | step 20 s | AI state identical (position within 1e-9) |
| AT3 | aiPace [1] / [1, 0.5] / [1, 1.1] with aiCount 1 | create | rejects, message contains `aiPace` |

## 329 contract

```ts
export interface SeasonHubView {
  title: string; round: number; rounds: number; done: boolean; champion: string | null;
  calendar: { round: number; name: string; track: string; status: 'done' | 'next' | 'upcoming'; winner: string | null }[];
  drivers: { position: number; name: string; team: string; points: number; isPlayer: boolean }[];
  teams: { position: number; name: string; points: number }[];
}
export function seasonHubView(s: SeasonState, series: SeriesDef, trackNames: Readonly<Record<string, string>>): SeasonHubView;
```
Rules: title `${series.name} ${year}`; `round` 1-based next event (= rounds when done); names `first last`; team = team name; `track` = trackNames[trackId] ?? trackId; winner = name of the event finishing order's first car; champion = driver standings leader's name when done, else null.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 326 AT2 state (test series, event names E1, E2) | view | round 2, rounds 2, done false; calendar statuses [done, next]; calendar[0].winner = drivers[2] name; champion null |
| AT2 | 326 AT3 state | view | done true; champion = drivers[0] name; drivers rows points [43,33,28,26] with isPlayer only on the first; teams [B 71, A 59] (team names) |
| AT3 | new season | view | round 1; statuses [next, upcoming]; all driver points 0, winners null |

## 330 contract (UI, e2e)

Main menu "Career" → `#career-start`: first/last name inputs, nationality select (one option per `public/career/names/*.json` code, default MEX), format select (series formats), difficulty select, `Start season`; if a save exists also `Continue season`. Start: AI = `generateGrid(11, seed, mix of series.gridsSeries, names)`, `createSeason` (year 2027, number 7, seed random), save. `#season-hub` renders `seasonHubView` (`.season-calendar-row` with `data-status`, `.season-driver-row` (`.is-player`), `.season-team-row`, `#season-champion` when done, buttons `#season-next` (hidden when done) and `#season-menu`). Next event = C0 weekend (280 path) on `calendar[round]` with carId, aiCount 11, difficulty, `seed = eventSeed`, `gridOrder = eventWeekend(...).gridFor()`, `aiPace`, car names from season drivers; every submitted session → `submitSession` + save; weekend hub after the last session shows `Back to season` → season hub. Resume with pending sessions continues the weekend at the next session. Debug hook `window.__SIMGAME__.season = { round, pending, trackId, state }` (weekend hook from 280 unchanged).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `/` (empty IndexedDB) | click Career | `#career-start` with nationality options ≥ 16 (MEX selected), 3 format options, no Continue |
| AT2 | AT1, name Test Driver, format short | Start season | `#season-hub`: 6 calendar rows (first `next`), 12 driver rows all 0 points, exactly 1 `.is-player` containing "Test Driver", 6 team rows |
| AT3 | AT2 | click `#season-next` | `#hud-session` visible; `season.trackId` mexico; weekend index 0 |
| AT4 | AT3 | `weekend.endSession()` twice, then `Back to season` | season hub: row 1 `done`, row 2 `next`; `season.round` 1 |
| AT5 | AT4 | reload, Career | Continue visible; click → season hub row 1 `done`, row 2 `next` |
| AT6 | AT5 | Next event, `endSession()` once, reload, Career, Continue, Next event | weekend index 1; `weekend.grid` deep-equals `weekend.results[0].order` (from save) |
| AT7 | track select | open | 095/280 quick race and quick weekend unchanged (verification gate: existing 095 and 280 e2e specs pass) |

Out of scope (later phases): contracts, offers, reputation, money, multiple seasons, neural AI in career, sim of skipped events, export/import file, liveries per team.
