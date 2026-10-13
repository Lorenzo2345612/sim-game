# 095 — Quick race menu and results

Status: pending
Phase: 2
Depends on: 044, 073, 092, 093, 094
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The start menu offers "Quick race" with its options, and a results overlay appears when the race ends.

## Context

Menu: `src/ui/menu.ts` (044, extended by 073 with the car picker). Race: `RaceGame` and `RaceConfig` (093, `src/game/raceGame.ts`), standings from `RaceClassification` (092). Query params override the menu for tests: `?race=1&ai=N&laps=N&diff=easy|medium|hard|expert` (already parsed by 093's `main.ts`, together with `track`, `car`, `seed`; 095 only adds invalid-value fallback and menu pre-fill); invalid values fall back to defaults. Acceptance tests: Playwright `tests/e2e/acceptance/095-quick-race-menu.spec.ts`.

## Files

- `src/ui/menu.ts` — modify: Quick race panel
- `src/ui/results.ts` — create
- `src/main.ts` — modify: start a race from the menu, show results, `__SIMGAME__.finishRaceNow()`

## Steps

```ts
export interface ResultsRow { position: number; name: string; totalTime: number | null; bestLap: number | null; penalty: number }
export class Results {
  constructor(parent: HTMLElement);
  show(rows: readonly ResultsRow[], handlers: { onRestart(): void; onMenu(): void }): void;
  hide(): void;
}
```

1. Menu: a "Quick race" button opens a panel with the existing track and car pickers plus `#qr-laps` (number, 1–50, default 5), `#qr-ai` (number, 0–15, default 11), `#qr-diff` (select easy/medium/hard/expert, default medium) and a Start button `#qr-start`. Out-of-range numbers are clamped.
2. Results: root `#results` (`display: none` when hidden); one `<tr>` per car sorted by position with position, name (`You`/`AI n`), total time `m:ss.mmm` (`DNF` when null), best lap (`-` when null), penalty seconds; buttons "Restart" (same `RaceConfig` including seed) and "Menu".
3. Shown when the player finishes (`finished` true for the player) or the race ends (`RaceGame.raceFinished`); Restart reuses `RaceGame.config`.
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
npm run test:e2e
```

## Out of scope

Championship points, saving results, replays, per-car penalties UI beyond the table, pit options, weather, changes to `RaceGame`/`RaceClassification`.
