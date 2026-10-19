# 294 — Race control messages, penalty announcement and tower tag in the race HUD
Status: pending
Phase: 2
Depends on: 293
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal
Penalties are visible in the race HUD, broadcast style: (1) a "RACE CONTROL" message panel for every car's time penalty, (2) a big centred announcement when the player gets a time penalty, (3) a penalty tag on timing-tower rows. No FIA/F1 names or logos anywhere (use "RACE CONTROL").

## Context
`src/race/penalties.ts`: `PenaltyEntry {car, kind: 'warning'|'penalty', seconds, reason: PenaltyReason, time}`, `PenaltyReason = 'track limits'|'yellow flag overtake'|'VSC delta'|'jump start'`. `syncToasts` in `src/main.ts` walks new `game.penalties.entries()` and toasts car 0 only. `Standing.penalty` (seconds) is already in `RaceHudData.standings`. Forced strikes: 3 warnings then a 5 s 'track limits' penalty (verified in `trackLimits.ts`: 4 strikes = one penalty, 2 = warnings only). Task 293 fixed HUD overlaps: `#race-control` must not overlap its elements.

## Files
- `src/ui/raceControl.ts` — create — pure, no DOM, imports `PenaltyEntry` from `../race/penalties`.
- `src/ui/raceHud.ts`, `src/ui/raceHud.css` — modify — panel, announcement, tower tag.
- `src/main.ts` — modify — `syncToasts` wiring, debug hook.
- `tests/unit/acceptance/294-race-control.test.ts`, `tests/e2e/acceptance/294-race-control-penalty-hud.spec.ts` — create (acceptance worker).

## Steps
```ts
export function carName(car: number): string; // 'You' for 0, `AI ${car}`
export function raceControlMessage(e: PenaltyEntry): string | null;
export interface PenaltyAnnouncement { title: string; value: string; reason: string }
export function penaltyAnnouncement(e: PenaltyEntry): PenaltyAnnouncement | null;
export function penaltyTag(seconds: number): string;
// raceHud.ts
export function pushRaceControl(text: string): void;
export function announcePenalty(a: PenaltyAnnouncement): void;
```
1. `raceControlMessage`: penalty → `${seconds} SECOND TIME PENALTY FOR ${carName(car).toUpperCase()} - ${reason.toUpperCase()}`; warning → null.
2. `penaltyAnnouncement`: penalty → `{title: 'TIME PENALTY', value: '+5 SECONDS' ('+1 SECOND' when 1), reason: reason with first letter capitalised ('Track limits')}`; warning → null.
3. `penaltyTag`: '' when ≤ 0, else `+${seconds}s` (e.g. '+10s').
4. `pushRaceControl`: element `#race-control` (header line "RACE CONTROL" + message); one message visible at a time, each for RC_SHOW_MS = 6000; FIFO queue, max 5 queued, drop oldest; `display:none` when idle.
5. `announcePenalty`: element `#penalty-announce`, centred horizontally in the upper third, large type, three lines (title, value, reason), black panel / white text with a yellow accent bar, slide/fade-in CSS animation; visible ANNOUNCE_MS = 4000; a new one replaces the current; hidden afterwards.
6. Tower rows get a `.race-row-pen` span with `penaltyTag(st.penalty)`, hidden when empty; cached like the other spans, no per-frame allocation.
7. `clearToasts()` also clears both new elements and the queue.
8. `syncToasts`: for every new entry call `raceControlMessage` → `pushRaceControl` (all cars). Car 0 penalty → `announcePenalty` instead of the '+N s' toast; car 0 warnings keep the existing toast.
9. Debug hook becomes `forceTrackLimits(count: number, car = 0)` (update the `__SIMGAME__` type at ~line 195 too), calling `debugForceTrackLimits(car, count)`.
10. `#race-control` position must not intersect the elements listed in `tests/e2e/293-race-hud-overlaps.spec.ts` (do not edit that file).

Conventions: `seconds` is an integer; text is uppercased with `toUpperCase()`; inputs are not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | entry `{car: 3, kind: 'penalty', seconds: 5, reason: 'track limits', time: 80}` | `raceControlMessage` | `'5 SECOND TIME PENALTY FOR AI 3 - TRACK LIMITS'` |
| AT2 | entry car 0, penalty 10 s, reason `'yellow flag overtake'` | `raceControlMessage` | `'10 SECOND TIME PENALTY FOR YOU - YELLOW FLAG OVERTAKE'` |
| AT3 | any entry with `kind: 'warning'` | `raceControlMessage` and `penaltyAnnouncement` | both `null` |
| AT4 | car 0 penalty 5 s `'track limits'`; and a 1 s `'jump start'` penalty | `penaltyAnnouncement` | `{title: 'TIME PENALTY', value: '+5 SECONDS', reason: 'Track limits'}`; second → value `'+1 SECOND'`, reason `'Jump start'` |
| AT5 | `penaltyTag(0)`, `penaltyTag(5)`, `penaltyTag(10)` | call | `''`, `'+5s'`, `'+10s'` |
| AT6 | e2e 1366×768 `/?race=1&track=cleveland&ai=5&laps=3`, ~6 s after the race starts | `__SIMGAME__.forceTrackLimits(4)` (player gets a time penalty) | within 1 s: `#penalty-announce` visible, its text contains `TIME PENALTY`, `+5 SECONDS`, `Track limits`; `#race-control` visible with `RACE CONTROL` and `FOR YOU - TRACK LIMITS`; the player's tower row `.race-row-pen` reads `+5s` |
| AT7 | as AT6 | 5 s after the call | `#penalty-announce` hidden; 7 s after: `#race-control` hidden; `.race-row-pen` still `+5s` |
| AT8 | as AT6, `forceTrackLimits(4, 2)` (AI 2 penalised) | within 1 s | `#race-control` contains `FOR AI 2 - TRACK LIMITS`; `#penalty-announce` not visible; AI 2's tower row tag `+5s` if that row is shown; `#race-control` rect intersects none of `#hud, .damage-hud, .minimap, #flags, #toasts, .hud2-panel, .tyres, .race-hud-top, #race-tower` |
| AT9 | as AT6, `forceTrackLimits(2)` (warnings only) | within 1 s | a `#toasts` toast `Track limits` is shown (existing behaviour); `#race-control` and `#penalty-announce` not visible |

## Acceptance criteria
- [ ] All AT rows pass.
- [ ] `npm run build` succeeds.
- [ ] No "FIA"/"F1" text in the new UI strings.

## Verification
```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/294-
npm run build
npx playwright test 294-
```

## Out of scope
- Penalty serving in pits, stop-go/drive-through, investigations/"noted" messages, black-and-white flag, sounds, results screen changes, AI behaviour.
