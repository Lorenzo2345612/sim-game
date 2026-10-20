# 316 — Grandstands must not sit on the track

Status: pending
Phase: 2
Depends on: none
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

No grandstand footprint comes closer than 5 m to the track edge on any shipped track; stands that overlap the track are pushed away from it at load time.

## Context

User report: grandstands sit on the track (e.g. Mexico). Cause: `extraGrandstands` (`src/track/trackStyleWiring.ts`) places the stand on the straight chord between start and end, which cuts through the track when the section curves; one builder stand also overlaps. Measured clearances (m): budapest stand #2 −4.5, budapest extra −3.2, lusail extra −5.8, mexico extra −3.1 (style stand 560–640 left), sepang extra −7.2, singapore extra −5.6. Footprint convention (`grandstandFootprint`): local X ∈ ±length/2, Z ∈ [0, rows×0.9]; world = (x + lx·cos yaw + lz·sin yaw, z − lx·sin yaw + lz·cos yaw); front faces local −Z (toward the track), rows extend to +Z (away).

## Files

- `src/track/placement.ts` — modify: add the exports below.
- `src/main.ts` — modify: the two grandstand loops (~lines 1096 and 1104) become one loop over `placedGrandstands(track, trackStyle)`; `stats.style.extraGrandstands` and `stats.grandstands` keep their current meaning (input counts).
- `tests/unit/acceptance/316-grandstands-clear-of-track.test.ts` — create (acceptance worker).

## Steps

```ts
import type { Grandstand, TrackDataV2 } from '../core/types';
import type { ResolvedTrackStyle } from './trackStyle';
export const STAND_MIN_CLEAR_M = 5;
export const STAND_MAX_PUSH_M = 80;
export function standClearance(track: TrackDataV2, g: Grandstand): number;
export function clearGrandstand(track: TrackDataV2, g: Grandstand): Grandstand | null;
export function placedGrandstands(track: TrackDataV2, style: ResolvedTrackStyle): Grandstand[];
```

1. `standClearance`: sample the footprint on a 21×5 grid (21 points along local X, 5 along local Z, both including the edges); for each sample, distance to the nearest centerline point minus max(`halfWidthAt` left, right) at that point; return the minimum over all samples.
2. `clearGrandstand`: if `standClearance >= STAND_MIN_CLEAR_M` return `g` itself (same object). Otherwise move x,z along world (sin yaw, cos yaw) in 1 m steps (1..80) until clearance >= 5; return a new object with only x,z changed. Return `null` if still not clear after `STAND_MAX_PUSH_M`.
3. `placedGrandstands`: `[...track.grandstands, ...extraGrandstands(track, style)]` mapped through `clearGrandstand`, nulls dropped. Import `extraGrandstands` from `./trackStyleWiring` (it does not import `placement`, no cycle).

Conventions: clearance boundary inclusive (`>=` is clear); step count is an integer metre; inputs are never mutated; no stand is rotated or resized; load-time only (allocations fine).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | every `public/tracks/*.json` track with its `*.style.json` when present | `placedGrandstands(track, style)` | every stand `standClearance ≥ 5` m (−1e-6) |
| AT2 | same tracks | `placedGrandstands` | count equals `track.grandstands.length + extraGrandstands(...).length` (no stand dropped on any shipped track) |
| AT3 | same tracks | `clearGrandstand(track, g)` for each input stand with `standClearance(track, g) ≥ 5` | returns the same object (`toBe`) |
| AT4 | the mexico extra stand 560–640 left | `clearGrandstand` | non-null; yaw, lengthMeters, rows, roof unchanged; displacement parallel to (sin yaw, cos yaw) (perpendicular component ≤ 1e-6), length an integer in [1, 80] |
| AT5 | synthetic circle track (64 points, radius 40 m, width 12, all other fields as `tests/unit/acceptance/022-fixture-trackdatav2.ts`) and a stand at the centre, length 400, rows 10, yaw 0 | `clearGrandstand` | `null` |

## Acceptance criteria

- [ ] AT1–AT5 pass; 183, 189, 193, 196, 197, 200, 234, 235 and 249 acceptance tests still pass.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/316- tests/unit/acceptance/183- tests/unit/acceptance/189- tests/unit/acceptance/193- tests/unit/acceptance/196- tests/unit/acceptance/197- tests/unit/acceptance/200- tests/unit/acceptance/234- tests/unit/acceptance/235- tests/unit/acceptance/249-
```

## Out of scope

- Builder or track JSON changes, splitting stands to follow curves, other props, barrier/pit clearance.
