# 095 — Quick race menu and results

Status: pending
Phase: 2
Depends on: 044, 073, 092, 093, 094, 171
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The start menu offers "Quick race" with its options, and a results overlay appears when the race ends.

## Context

Menu: `Menu` in `src/ui/menu.ts` (044; 073 car picker; 171 redesigned track-select: `showTrackSelect(onSelect)` renders `.track-card` buttons whose click starts the game, plus the car picker; `TRACK_CHOICES`, `CAR_IDS`, `CAR_STORAGE_KEY`). Race: `RaceGame`/`RaceConfig` (093, `src/game/raceGame.ts`), standings `Standing` (092, `src/race/classification`), HUD names as in 094. `main.ts` already parses `?race=1&track=&car=&ai=&laps=&diff=&seed=` (093); 095 adds invalid-value fallback (defaults laps 5, ai 11, diff medium; numbers clamped to the ranges below) and menu pre-fill. Acceptance tests: Playwright `tests/e2e/acceptance/095-quick-race-menu.spec.ts`.

## Files

- `src/ui/menu.ts` - modify: Quick race on the track-select screen
- `src/ui/results.ts` - create
- `src/main.ts` - modify: start a race from the menu, show results, `__SIMGAME__.finishRaceNow()`

## Steps

```ts
export interface QuickRaceOptions { trackId: string; laps: number; aiCount: number; difficulty: Difficulty }
// Menu.showTrackSelect gains an optional second argument:
showTrackSelect(onSelect: (id: string) => void, onQuickRace?: (o: QuickRaceOptions) => void): void;
export interface ResultsRow { position: number; name: string; totalTime: number | null; bestLap: number | null; penalty: number }
export class Results {
  constructor(parent: HTMLElement);
  show(rows: readonly ResultsRow[], handlers: { onRestart(): void; onMenu(): void }): void;
  hide(): void;
}
```

`Difficulty` from `src/ai/traffic`. Existing `showTrackSelect(onSelect)` behaviour and its selectors stay unchanged.

1. Menu: when `onQuickRace` is given, the track-select screen shows a `#quick-race` button that opens a panel `#qr-panel` with `#qr-track` (select over `TRACK_CHOICES`, default last track), the existing car picker choice (read from `CAR_STORAGE_KEY`), `#qr-laps` (number, 1-50, default 5), `#qr-ai` (number, 0-15, default 11), `#qr-diff` (select easy/medium/hard/expert, default medium) and `#qr-start`. Out-of-range numbers are clamped; start calls `onQuickRace`.
2. Results: root `#results` (`display: none` when hidden); one `<tr>` per car sorted by position with position, name (`You`/`AI n`), total time `m:ss.mmm` (`DNF` when null), best lap (`-` when null), penalty seconds; buttons "Restart" (new `RaceGame` with the same `RaceConfig` including seed) and "Menu" (`endSession` + track select).
3. Shown when the player's standing is `finished` or `RaceGame.raceFinished`.
4. `__SIMGAME__.finishRaceNow()` (test hook, race only): marks the race as ended immediately and shows the results with the current standings.

Conventions: time formatting rounds to the nearest millisecond; names as in 094.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e menu | choose Quick race, Spa, 1 lap, 3 opponents, start | URL/state has race with 3 AI; `raceStandings()` 4 entries |
| AT2 | e2e `?race=1&laps=1&ai=1` with a test hook `__SIMGAME__.finishRaceNow()` | call | `#results` visible with 2 rows sorted by position; Restart restarts with the same config |

## Acceptance criteria

- [ ] AT1–AT2 pass; menu e2e tests of 044/073 still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 095-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

Championship points, saving results, replays, per-car penalties UI beyond the table, pit options, weather, changes to `RaceGame`/`RaceClassification`.

Frozen tests: none need editing (`showTrackSelect(onSelect)` keeps its signature and DOM; 044/073/171 e2e rely on it).
