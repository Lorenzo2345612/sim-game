# 128 — Yellow and blue flags

Status: pending
Phase: 2
Depends on: 092, 093
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A pure `FlagState` derives per-sector yellow/double-yellow flags, blue flags for lapped cars and overtakes under yellow from per-tick car data.

## Context

Design: `docs/plans/game-features.md` section 128. Layer `src/race` (pure: only `src/core`; no `three`, no `Math.random`). `FlagCar.distance` = race distance of `Standing.distance` (`src/race/classification.ts`, 092); `lapDistance` in [0, lapLength) from `TrackProgress` (`src/track/trackProgress.ts`). Car index = index in the array passed to `update` (093: player 0). Sector starts = `track.sectors` mapped to metres (`LapTimer` takes the same three distances, `src/track/lapTimer.ts`). Wiring is task 130.

## Files

- `src/race/flags.ts` — create
- `tests/unit/race/flags.test.ts` — create (edge cases)
- `tests/unit/acceptance/128-flags.test.ts` — create (acceptance worker)

## Steps

```ts
export interface FlagCar { distance: number; lapDistance: number; speed: number; offTrack: boolean; retired: boolean }
export type SectorFlag = 'green' | 'yellow' | 'double-yellow';
export class FlagState {
  constructor(sectorBounds: [number, number, number], lapLength: number); // sector start distances in m, first is 0
  update(cars: readonly FlagCar[], time: number): void;
  sectorFlag(sector: 1 | 2 | 3): SectorFlag;   // state as of the last update
  blueFor(car: number): boolean;
  overtakeUnderYellow(): { car: number; passed: number }[]; // drains: entries are returned once
}
```

- A car's sector = the last bound `<= lapDistance`.
- Yellow cause: `offTrack || speed < 5` continuously for `>= 1 s` (per car). Double-yellow cause: `speed < 5 && !offTrack` continuously for `>= 3 s`. Retired cars count as causes by the same rules.
- A sector shows double-yellow while a double-yellow cause was seen within the last 2 s, else yellow while any cause was seen within the last 2 s (`time − lastSeen < 2`), else green.
- `blueFor(X)`: true when some running car Y (`!retired`, Y ≠ X) satisfies `Y.distance − X.distance > lapLength / 2` AND Y is behind X on track by `0 <= (X.lapDistance − Y.lapDistance) mod lapLength <= 200` m. Retired X → false.
- Overtake: between consecutive updates two running cars swap order by `distance` (strict, ties are not swaps) and both cars' sectors currently show non-green → one entry `{ car: overtaker, passed: overtaken }`, reported once (cleared when read).

Conventions: sector argument outside 1..3 and unknown car index → `RangeError`; boundaries as written (`>=`, `<`, `<=`); non-finite car fields make that car ignored; `update` does not mutate `cars`; no per-call allocation except the returned array of `overtakeUnderYellow`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | car stopped (speed 0, offTrack true) in sector 2 for 1.5 s | sectorFlag | s2 yellow, s1/s3 green |
| AT2 | car stopped on track 3.5 s | sectorFlag | double-yellow |
| AT3 | cause leaves at t, query t + 1.9 / t + 2.1 | sectorFlag | yellow / green |
| AT4 | Y race distance 5900, X 1150, lapLength 5000 (Y 250 m behind on track) / 150 m behind | blueFor(X) | false / true |
| AT5 | two cars swap order inside a yellow sector | overtakeUnderYellow | one entry {car: overtaker, passed: other} |

## Acceptance criteria

- [ ] All AT rows pass; edge tests pass (drain-once, retired cars, wrap-around of `lapDistance`).
- [ ] `src/race/flags.ts` has no `three`/Rapier import and no `Math.random`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Penalties for overtaking, AI reactions, HUD icons (task 130).
- Safety car / VSC (task 129).
- Detecting `offTrack` (the caller supplies it).
