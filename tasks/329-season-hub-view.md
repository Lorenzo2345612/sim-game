# 329 — Season hub view model

Status: pending
Phase: 3
Depends on: 326
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A pure function turns a `SeasonState` into the display data of the season hub (calendar, driver and team standings, champion), so the UI only renders.

## Context

Design: `docs/design/c1-season.md` (329). Imports (do not redefine): `SeasonState` from `src/career/season.ts` (325); `SeriesDef` from `src/career/series.ts` (324); `driverStandings`, `teamStandings`, `currentRound`, `seasonDone` from `src/career/seasonControl.ts` (326). No `three`, no DOM. Test fixtures: the 326 test series (teams A, B; events named E1, E2) and the 326 AT2/AT3 states.

## Files

- `src/career/seasonView.ts` — create.
- `tests/unit/acceptance/329-season-hub-view.test.ts` — create (acceptance worker).

## Steps

```ts
export interface SeasonHubView {
  title: string; round: number; rounds: number; done: boolean; champion: string | null;
  calendar: { round: number; name: string; track: string; status: 'done' | 'next' | 'upcoming'; winner: string | null }[];
  drivers: { position: number; name: string; team: string; points: number; isPlayer: boolean }[];
  teams: { position: number; name: string; points: number }[];
}
export function seasonHubView(s: SeasonState, series: SeriesDef, trackNames: Readonly<Record<string, string>>): SeasonHubView;
```

- `title` = `${series.name} ${s.year}`. `rounds` = calendar length. `round` = 1-based next event (= `rounds` when done). `done` = `seasonDone`.
- `calendar[i].round` = i + 1; `name` = event name; `track` = `trackNames[trackId] ?? trackId`; status `done` for i < events.length, `next` for i = events.length (none when done), else `upcoming`.
- `winner` = full name of the first car in the `order` of the event's last session (`events[i].sessions` last), `null` when not done.
- Driver name = `first last`. `drivers` follow `driverStandings` order; `team` = team name; `isPlayer` from `SeasonDriver`. `teams` follow `teamStandings` order with team names.
- `champion` = leader's name when done, else `null`.

Conventions: pure, inputs not mutated; positions 1-based as given by the standings.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 326 AT2 state (test series, event names E1, E2) | view | round 2, rounds 2, done false; calendar statuses [done, next]; calendar[0].winner = drivers[2] name; champion null |
| AT2 | 326 AT3 state | view | done true; champion = drivers[0] name; drivers rows points [43,33,28,26] with isPlayer only on the first; teams [B 71, A 59] (team names) |
| AT3 | new season | view | round 1; statuses [next, upcoming]; all driver points 0, winners null |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/329-season-hub-view.test.ts`.
- [ ] No `three` or DOM import in `seasonView.ts`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Rendering, CSS, localisation, formatting of points or times.
- Changing standings logic or `SeasonState`.
