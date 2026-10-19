# 291 — Results screen: grid, places gained, overtakes and race recap
Status: pending
Phase: 2
Depends on: 290
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal
The end-of-race results show, per driver, grid position, places gained, overtakes (clean/contact/gift) and positions lost, plus a TV-style recap: highlights and a chronological list of every overtake, filterable by driver.

## Files
- `src/ui/recap.ts` — create — pure formatting (no DOM).
- `src/ui/results.ts`, `src/ui/results.css` — modify — new columns, highlights, recap list, row click filter.
- `src/main.ts` — modify — build rows/recap from `raceGame.overtakes` and `raceGame.gridPosition` (task 290).
- `tests/unit/acceptance/291-*.test.ts` — create (acceptance worker; pure functions only).

## Steps
1. `recap.ts` (types from `src/race/overtakeLog.ts`):
```ts
export function gainText(grid: number, position: number): string;           // '+3' | '-2' | '0'
export function passesText(s: OvertakeSummary): string;                      // `${clean}/${contact}/${gift}`
export function recapLine(e: OvertakeEvent, name: (car: number) => string): string;
export function highlights(grid: readonly number[], position: readonly number[], s: readonly OvertakeSummary[], name: (car: number) => string): string;
export function recapFor(events: readonly OvertakeEvent[], car: number | null): OvertakeEvent[]; // chronological; null = all
```
2. `recapLine`: `L{lap} · {lapDistance/1000 with 2 decimals} km · {passer} passes {passed} for P{position}`, suffix ` (contact)` / ` (gift)` for those kinds.
3. `highlights`: `Most overtakes: {name} ({clean})` from the highest clean count (ties → lowest car index; omitted if all 0), then ` · Most places gained: {name} ({gainText})` from the highest grid − position (ties → lowest car index; omitted if none > 0). Empty string if both omitted.
4. `ResultsRow` gains optional `car`, `grid`, `summary`; `Results.show(rows, handlers, recap?: { events: readonly OvertakeEvent[]; name(car: number): string })`. Columns after Name: Grid, +/−, then existing ones, then Passes (`passesText`, header title "clean/contact/gift") and Lost. Without the new fields cells show `-` and no recap section (old callers unchanged).
5. Recap section under the table: highlights line, then `recapLine` items. Clicking a row filters to `recapFor(events, car)`; clicking the same row again shows all. Names as today (`You`, `AI n`).

## Acceptance tests (defined by the planner with Opus, before coding)
E(t, lap, d, a, b, pos, kind) = `{ t, lap, lapDistance: d, passer: a, passed: b, position: pos, kind }`; name = car 0 → 'You', else `AI ${car}`.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | (5, 2) / (2, 4) / (3, 3) | `gainText` | '+3' / '-2' / '0' |
| AT2 | {clean 3, contact 1, gift 2, lost 0} | `passesText` | '3/1/2' |
| AT3 | E(10, 2, 1234, 1, 0, 3, 'clean') / same with kind 'contact' / 'gift' | `recapLine` | 'L2 · 1.23 km · AI 1 passes You for P3' / 'L2 · 1.23 km · AI 1 passes You for P3 (contact)' / 'L2 · 1.23 km · AI 1 passes You for P3 (gift)' |
| AT4 | events at t 30, 10, 20 involving cars (1,2), (2,3), (3,1) | `recapFor(ev, null)` / `recapFor(ev, 2)` | t order [10, 20, 30] / [10, 30] |
| AT5 | grid [4, 1, 2, 3], position [4, 3, 1, 2], clean [0, 0, 2, 2] | `highlights` | 'Most overtakes: AI 2 (2) · Most places gained: AI 2 (+1)' |
| AT6 | grid = position, all summaries 0 | `highlights` | '' |
| AT7 | input events array | `recapFor` | input array not mutated (same order after the call) |

## Verification
```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/291- tests/unit/edge/130-
npm run build
```

## Out of scope
- Replays/camera of each overtake, live HUD notifications, sim changes, trainer scripts.
