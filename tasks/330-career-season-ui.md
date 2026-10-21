# 330 — Career menu, season hub and event flow

Status: pending
Phase: 3
Depends on: 280, 324, 325, 326, 327, 328, 329
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The main menu "Career" button starts or resumes a Latin F4 Cup season: season hub, one C0 weekend per event, results saved after every session.

## Context

Design: `docs/design/c1-season.md` (330). Task 280 (`tasks/280-quick-weekend-ui.md`, possibly still in progress) provides the weekend flow: `WeekendHub` `#weekend-hub`, `HudSession` `#hud-session`, the in-memory `Weekend` session loop in `src/main.ts`, `RaceConfig.gridOrder/session`, `window.__SIMGAME__.weekend` (`index`, `grid`, `results`, `endSession()`). Reuse them; do not duplicate the session loop. Imports (do not redefine): `parseSeries` (324); `createSeason`, `aiPace`, `eventSeed`, `SeasonState`, `PlayerInfo` (325); `eventWeekend`, `submitSession` (326); `IdbStore`, `serializeSeason`, `parseSeason`, `SaveStore` (327); `RaceConfig.aiPace` (328); `seasonHubView` (329); `generateGrid`, `NameList` (`src/race/drivers.ts`); `parseWeekendFormat`, `parsePointsTable` (274). Data: `/career/series/f4-latam.json`, `/career/formats.json`, `/career/points.json`, `/career/grids.json`, `/career/names/<CODE>.json`, `/tracks/index.json`. Guides: `ai/guides/testing.md`.

## Files

- `src/ui/career/careerStart.ts` — create: `#career-start` form.
- `src/ui/career/seasonHub.ts` — create: `#season-hub` view (renders a `SeasonHubView`).
- `src/ui/menu.ts` — modify: main-menu "Career" button.
- `src/main.ts` — modify: season ownership, event flow, save calls, debug hook.
- `tests/e2e/acceptance/330-career-season-ui.spec.ts` — create (acceptance worker).
- Protected: 095 and 280 e2e specs stay unchanged and must pass.

## Steps

```ts
// window.__SIMGAME__.season?: { round: number; pending: number; trackId: string; state: SeasonState }  (getters; typed in main.ts Window)
```

1. `Career` on the main menu opens `#career-start`: inputs first name, last name; nationality select with one option per code ARG AUS BEL BRA CAN CHN COL DEU ESP FRA GBR ITA JPN MEX NLD USA (hard-coded list; default MEX); format select (series formats, names from formats.json); difficulty select (easy/medium/hard/expert, default medium); `Start season`; `Continue season` only if the `IdbStore` has a save; `Back`. Empty names fall back to `Player` / `Driver`.
2. Start: load the names for `gridsSeries` mix nationalities, `generateGrid(11, seed, mix, names)`, `createSeason` (year 2027, number 7, random seed), save, show `#season-hub`. Continue: `parseSeason`; a corrupt save shows a message in `#career-start` and offers nothing else.
3. `#season-hub` renders `seasonHubView` (track names from `/tracks/index.json`): `.season-calendar-row` with `data-status`, `.season-driver-row` (class `is-player` on the player), `.season-team-row`, `#season-champion` only when done, buttons `#season-next` (not rendered/hidden when done) and `#season-menu` (back to main menu).
4. Next event = the C0 weekend path (280) on `calendar[round]`: `carId` from series, `aiCount` 11, state difficulty, `seed = eventSeed(state, round)`, `gridOrder = eventWeekend(...).gridFor()`, `aiPace` from `aiPace(state, series)` (329/328), car names from `drivers[k]`. Every submitted session calls `submitSession` and then saves; the in-memory `Weekend` is `eventWeekend(...)` so resume with pending sessions continues at the next session (quali order → grid).
5. The weekend hub shown after the last session of a career event has a `Back to season` button (instead of the Quick-weekend `Menu` flow) returning to `#season-hub`; quick weekends keep their 280 hub unchanged.
6. Debug hook `season` as typed above; `weekend` hook from 280 unchanged. `pending` = `state.pending.length`.

Conventions: save failures log to console and never block play; the player is always car 0; unknown `trackId` in a loaded save throws `Invalid save` (327) and is shown as the corrupt-save message.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `/` (empty IndexedDB) | click Career | `#career-start` with nationality options ≥ 16 (MEX selected), 3 format options, no Continue |
| AT2 | AT1, name Test Driver, format short | Start season | `#season-hub`: 6 calendar rows (first `next`), 12 driver rows all 0 points, exactly 1 `.is-player` containing "Test Driver", 6 team rows |
| AT3 | AT2 | click `#season-next` | `#hud-session` visible; `season.trackId` mexico; weekend index 0 |
| AT4 | AT3 | `weekend.endSession()` twice, then `Back to season` | season hub: row 1 `done`, row 2 `next`; `season.round` 1 |
| AT5 | AT4 | reload, Career | Continue visible; click → season hub row 1 `done`, row 2 `next` |
| AT6 | AT5 | Next event, `endSession()` once, reload, Career, Continue, Next event | weekend index 1; `weekend.grid` deep-equals `weekend.results[0].order` (from save) |
| AT7 | track select | open | 095/280 quick race and quick weekend unchanged (verification gate: existing 095 and 280 e2e specs pass) |

## Acceptance criteria

- [ ] All AT rows pass in `tests/e2e/acceptance/330-career-season-ui.spec.ts`.
- [ ] 095 and 280 e2e specs still pass.
- [ ] No `three` import in `careerStart.ts` / `seasonHub.ts`; the weekend session loop is reused, not copied.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 330-
```

## Out of scope

- Contracts, offers, reputation, money, multiple seasons, neural AI in career, simulating skipped events, export/import file, liveries per team.
- Changing `src/career/*`, `RaceGame` or `Weekend` internals, or the 280 quick-weekend behaviour.
