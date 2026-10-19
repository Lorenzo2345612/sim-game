# 296 — Driver names in the race UI
Status: pending
Phase: 2
Depends on: 291, 294, 295
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal
AI cars show generated driver names: 3-letter code in the timing tower, full name in results and the 291 recap, initial + surname in race control messages. The player stays 'You'.

## Context
Cars are named 'You' / `AI ${car}` today (`carName` in `src/ui/raceControl.ts`, `resultRows` in `src/main.ts`). Grid generation, `seriesForTrack` and the JSON data come from task 295 (`src/race/drivers.ts`, `public/career/`). Car i >= 1 maps to grid[i - 1]. Race config already has `seed` and track id.

## Files
- `src/ui/raceControl.ts`, `src/ui/raceHud.ts` — modify.
- `src/main.ts` — modify — grid loading, names wiring, debug hook.
- `tests/unit/acceptance/296-driver-names-race-ui.test.ts`, `tests/e2e/acceptance/296-driver-names-race-ui.spec.ts` — create (acceptance worker).

## Steps
```ts
// raceControl.ts
export function raceControlMessage(e: PenaltyEntry, name: (car: number) => string = carName): string | null;
// raceHud.ts: RaceHudData gains `names?: readonly string[]` (index = car)
// __SIMGAME__.raceDrivers(): { car: number; first: string; last: string; code: string; nat: string }[]  (AI cars only)
```
1. `raceControlMessage` uses `name(e.car).toUpperCase()`; behaviour without the argument is unchanged (294).
2. Tower shows `names[car]` when present, else today's text.
3. Before the race starts, `main.ts` fetches `/career/grids.json`, picks `seriesForTrack(grids, trackId)`, fetches `/career/names/<NAT>.json` for each nat in that mix, then `generateGrid(aiCount, seed, mix, names)`.
4. Tower `names`: 'You' for car 0, `code` for AI. Results rows and the 291 recap: `${first} ${last}`. Race control name fn: 'You' for car 0, `shortName` for AI.
5. Any fetch failure (grids or a names file): fall back to the current 'AI n' naming everywhere; the race still runs.
6. Add `raceDrivers` to the `__SIMGAME__` type and object.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | penalty entry car 3, 5 s, `'track limits'`; name = `c => (c === 3 ? 'D. Ruiz' : 'You')` | `raceControlMessage(e, name)` | `'5 SECOND TIME PENALTY FOR D. RUIZ - TRACK LIMITS'`; without `name` unchanged from 294 |
| AT2 | e2e 1366×768 `/?race=1&track=mexico&ai=5&laps=3&seed=1`, 3 s after load | `__SIMGAME__.raceDrivers()` and `#race-tower` rows | 5 drivers; ≥ 1 with `nat === 'MEX'`; every AI row name equals its `code`; player row `You`; no row text matches `/AI \d+/` |
| AT3 | same with `track=monza&seed=1` | `raceDrivers()` | 5 drivers, every `nat` in the f4-europe mix; list differs from AT2's |
| AT4 | as AT2, then `__SIMGAME__.finishRaceNow()` | results screen | every AI name cell equals `${first} ${last}`; none matches `/AI \d+/` |
| AT5 | as AT2, `__SIMGAME__.forceTrackLimits(4, 2)` | within 1 s | `#race-control` contains `TRACK LIMITS` and `FOR ` + `${first[0]}. ${last}`.toUpperCase() of car 2 |
| AT6 | as AT2 with `/career/grids.json` blocked (route abort) | 3 s after load | race runs; tower AI rows read `AI n` (fallback) |

## Acceptance criteria
- [ ] All AT rows pass; 291 and 294 acceptance tests still pass.
- [ ] `npm run build` succeeds.

## Verification
```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/296- tests/unit/acceptance/295- tests/unit/acceptance/294- tests/unit/acceptance/291-
npm run build
npx playwright test 296-
```

## Out of scope
- Player name setting, livery numbers on cars, nationality flags in UI, career persistence, team names, editing the name data.
