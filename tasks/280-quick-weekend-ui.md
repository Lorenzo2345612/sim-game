# 280 — Quick weekend menu, hub screen, session HUD

Status: pending
Phase: 3
Depends on: 274, 275, 276, 278, 279
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The player can start a "Quick weekend" from the track select and play its sessions in sequence, with a hub screen between sessions showing results, points and event standings.

## Context

Design: `docs/design/c0-weekend.md` (280). Imports (do not redefine): `Weekend`, `SessionResult` (275); `parseWeekendFormat`, `parsePointsTable`, `WeekendFormat` (274; data fetched from `/career/formats.json`, `/career/points.json`); `raceSessionResult`, `qualiSessionResult` (279); `RaceGame` with `RaceConfig.session`/`gridOrder`, `sessionFinished`, `timeLeft`, `qualiStandings()` (276, 278). Integration points: `Menu.showTrackSelect` / `showQuickRace` / `showPause` in `src/ui/menu.ts`; `startQuickRace`, `raceConfigFromQuery`, `showResults`, `resultRows`, `window.__SIMGAME__` in `src/main.ts`; `formatLapTime` in `src/ui/formatTime.ts`. Names stay `You` / `AI n`. Guides: `ai/guides/testing.md`.

## Files

- `src/ui/weekendHub.ts` — create: `WeekendHub` DOM overlay `#weekend-hub`.
- `src/ui/hudSession.ts` — create: `HudSession` DOM element `#hud-session`.
- `src/ui/weekendHub.css` — create: styles for both (imported by the two modules).
- `src/ui/menu.ts` — modify: "Quick weekend" control, `WeekendOptions`, pause "End session".
- `src/main.ts` — modify: URL parsing, `Weekend` ownership, session loop, debug hook.
- `tests/e2e/acceptance/280-quick-weekend-ui.spec.ts` — create (acceptance worker).
- Protected 095 and 171 e2e tests stay unchanged and must pass.

## Steps

```ts
export interface WeekendOptions { formatId: string; trackId: string; laps: number; aiCount: number; difficulty: Difficulty; aiDriver: 'classic' | 'neural' }
// Menu.showTrackSelect gains an optional 3rd param: onQuickWeekend?: (o: WeekendOptions) => void
// Menu.showPause handlers gain: onEndSession?: () => void   (button "End session" only when provided)
// window.__SIMGAME__.weekend?: { index: number; grid: number[]; results: SessionResult[]; endSession(): void }  (getters; also in the `Window` typing in main.ts)
```

1. Track select: "Quick weekend" button next to "Quick race" opens a panel with format select (options from formats.json names; ids short/standard/sprint), laps, AI count, difficulty, AI driver (same controls and clamping as quick race), and Start / Back.
2. URL: `?weekend=<formatId>&track=…&laps=…&ai=…&diff=…[&aidriver=neural]` (+ `car`). Start does `history.pushState` like `startQuickRace`. Unknown `formatId` → `Error('Unknown weekend format: <id>')`.
3. `main.ts` keeps one in-memory `Weekend` (carCount = ai + 1) across sessions. Each session = `RaceGame.create` with `session` (kind/minutes from the `SessionSpec`; sprint uses kind `'race'` with `laps = ceil(laps/2)`, race kind uses `laps`) and `gridOrder = weekend.gridFor()`.
4. Session end: timed → `sessionFinished`; race/sprint → existing finish condition (`raceFinished` or player finished). Build the result with 279 (timed: `qualiSessionResult(qualiStandings())`; race/sprint: `raceSessionResult(standings(), laps)`; practice uses the quali adapter), call `weekend.submit`, pause the sim, show `#weekend-hub`.
5. `#weekend-hub`: sessions list (one row per session: kind, done/next marker); last session table (pos, name, best lap via `formatLapTime`, time-or-gap, points scored); event standings (pos, name, total points; one row per car); buttons `Continue` (next session: new RaceGame, hide hub) and `Menu` (back to track select). After the last session: title "Weekend complete", no Continue.
6. `#hud-session` (timed sessions only; hidden in races): time left as `m:ss`, player best lap, player position (`qualiStandings`).
7. Pause menu in timed sessions shows "End session": ends the session with current standings (same path as step 4).
8. Debug hook `window.__SIMGAME__.weekend`: `index` = `weekend.index`; `grid` = `weekend.gridFor()` of the running session at its start; `results` = submitted results in order; `endSession()` works for every kind (race → current standings via 279).

Conventions: laps clamp as in quick race (1..50); `ceil` for sprint laps; unknown query values fall back as in `raceConfigFromQuery`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `/?weekend=short&track=monza&laps=1&ai=3&diff=medium` | load, 2 s | `#hud-session` visible, text has `m:ss` ≤ 10:00; `__SIMGAME__.weekend.index` 0 |
| AT2 | AT1 | `endSession()` | `#weekend-hub` visible; 2 session rows (first done); standings 4 rows; Continue visible |
| AT3 | AT2 | click Continue | `weekend.index` 1; `weekend.grid` deep-equals `weekend.results[0].order` |
| AT4 | AT3 | `endSession()` | hub shows "Weekend complete"; no Continue; Menu returns to track select |
| AT5 | track select | open | Quick weekend control with 3 format options; existing 095 quick race unchanged |

## Acceptance criteria

- [ ] All AT rows pass in `tests/e2e/acceptance/280-quick-weekend-ui.spec.ts`.
- [ ] 095 and 171 e2e acceptance specs still pass.
- [ ] No `three` import in `weekendHub.ts` / `hudSession.ts`; no per-frame allocation in HUD update.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 280-
```

## Out of scope

- Career/championship persistence, driver names, team data (C1).
- Changing `Weekend`, adapters or `RaceGame` internals.
- Pit stops, tyre choice per session, weekend setup screens, localStorage of results.
- Replays or ghosts for weekend sessions.
