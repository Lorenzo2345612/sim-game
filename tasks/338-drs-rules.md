# 338 — DRS rules module

Status: pending
Phase: 7
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure per-car DRS state machine: detection gap, activation in the zone, closing on brake and disable conditions.

## Context

Design: `docs/design/ow-ladder.md`. No `three`, no DOM, no allocation in `update`. Top-class convention rule (feeder regulation text not found). DRS is a player button: nothing opens it without `request` (no auto-open assist).

## Files

- `src/race/drs.ts` — create
- `tests/unit/acceptance/338-drs-rules.test.ts` — create (acceptance worker)

## Steps

```ts
export interface DrsZone { detection: number; start: number; end: number } // m; detection, start in [0, lapLength), end in (start, lapLength]
export interface DrsCarState { enabled: boolean; open: boolean; gapS: number | null }
export interface DrsCarInput { lapDist: number; lap: number; running: boolean; braking: boolean; throttle: number } // lap 1-based
export interface DrsContext { vsc: boolean; wet: boolean; yellowZones: readonly boolean[]; restartLapsLeft: number }
export class Drs {
  constructor(zones: readonly DrsZone[], lapLength: number, carCount: number);
  update(time: number, cars: readonly DrsCarInput[], ctx: DrsContext): void;
  request(car: number): void;
  state(car: number): Readonly<DrsCarState>;
}
```
1. Detection crossing = lapDist moving from below `detection` to at or above it between two `update` calls (wrap-aware); crossing time = that `time`. `gapS` = own crossing time minus the latest crossing time of another car at that point; null if none.
2. Eligible when `gapS <= 1.0`, `lap >= 3`, `running`, no disable: arms `enabled` for that zone from `start` (inclusive) to `end` (exclusive).
3. `request(car)` while `enabled` sets `open`. `open` clears on `braking`, leaving the zone or any disable; after braking it stays closed until `request` again.
4. Disable: `ctx.vsc`, `ctx.wet`, `restartLapsLeft > 0`; per zone `yellowZones[zoneIndex]`. Clears `enabled` and `open` at once.

Conventions: seconds; gap compare inclusive; `request` outside `enabled` ignored; inputs not mutated; sizes fixed at construction; invalid car index throws RangeError.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/338-drs-rules.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | zone {detection 1000, start 1100, end 1700}, lapLength 3000, 2 cars on lap 3 | car 0 crosses 1000 at t=100.0, car 1 at t=100.8 | state(1).gapS 0.8 (1e-9); state(0).gapS null; at lapDist 1100 state(1).enabled true, state(0).enabled false |
| AT2 | as AT1 | car 1 crosses at t=101.0 / t=101.001 | enabled at 1100: true / false |
| AT3 | as AT1 with car 1 on lap 2 | gap 0.5 | enabled false; same on lap 3 true |
| AT4 | car 1 enabled at lapDist 1200 | request(1); then update with braking true; then request(1) again | open true; open false after braking; open true again (still enabled) |
| AT5 | car 1 open at 1650 | lapDist 1700 | enabled false, open false |
| AT6 | car 1 enabled and open | ctx.vsc true / wet true / restartLapsLeft 1 / yellowZones [true] | enabled and open false each; with all false again, enabled stays false until the next detection crossing |
| AT7 | car 1 not enabled | request(1) | open false |
| AT8 | state(5) with 2 cars | call | throws RangeError |

## Acceptance criteria

- [ ] All ATs pass; no `three` import; no per-call allocation in `update`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Zone derivation (339), vehicle wiring (341), HUD, AI; hand-placed zones; pit-lane DRS; lapped-car filtering.
