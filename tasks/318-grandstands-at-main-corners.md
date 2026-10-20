# 318 — Grandstands at the main corners, not only on the start straight

Status: pending
Phase: 2
Depends on: 316
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Every track gets up to 4 extra grandstands on its tightest corners, on the outside, so stands are spread over the lap and not only near the start.

## Context

Planner measurement: the builder puts its three stands at ~0, ~0.1 and ~0.85 of the lap on every track, and style extras/props also cluster near the start. `cornerCurvature(cx, i)` (`src/track/surfaces.ts`) returns `{ side, radius }` of the circle through P[i-1], P[i], P[i+1] (side = side of its centre, i.e. the inside) or null. 316 provides `placedGrandstands`, the contour pieces helper (the run splitter shared with `pitBuildingPieces`), `standClearance`, `clearGrandstand`; `EDGE_OFFSET` and `maxBarrierOffsetAt(track, side, k)` (null when no barrier) live in `src/track/placement.ts`.

## Files

- `src/track/placement.ts` — modify: new `cornerGrandstands`; `placedGrandstands` appends its result before the clearance pass.
- `src/track/trackStyle.ts` — modify: `cornerGrandstands?: boolean` in `ResolvedTrackStyle`, default `true` in `DEFAULT_TRACK_STYLE`, parsed and validated like the other top-level fields (boolean; the unknown-key list includes it).
- `tests/unit/acceptance/318-grandstands-at-main-corners.test.ts` — create (acceptance worker).

## Steps

```ts
export function cornerGrandstands(track: TrackDataV2, style: ResolvedTrackStyle): Grandstand[];
```
1. Returns `[]` when `style.cornerGrandstands === false`.
2. Corner indices: `cornerCurvature(track.centerline, i)` non-null with radius < 120 m. Consecutive indices (circular) form a run; apex = index of the minimum radius in the run.
3. Sort apexes by radius ascending (tie: lower index). Pick greedily; an apex is accepted only if its arc distance (circular, along the centerline) to index 0, to every accepted apex and to the pit range `track.pit.start..end` (0 when inside) is ≥ 12 % of the lap length, and its centerline point is ≥ 150 m (XZ) from every accepted apex's point (spatially adjacent corners, e.g. singapore 976/1788 at 52 m, are skipped). Max 4.
4. Per accepted apex: section = apex ± 40 m of arc. Side = opposite of `cornerCurvature(apex).side`. Build contour pieces with 316's helper, near face at `max(over the section of maxBarrierOffsetAt(track, side, k)) + 3`, or `EDGE_OFFSET` + half width when no barrier covers the section (same per-vertex base as 316). `rows` 10, `roof` false.
5. Drop a corner piece whose centre is < 20 m (XZ) from a piece of an earlier accepted corner (output order).

Conventions: arc distance in metres on the closed ring; threshold `≥` inclusive for the 12 %, `<` strict for radius 120; tracks with no qualifying corner return `[]`; no inputs mutated; output order = acceptance order.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | every shipped track with its style | `placedGrandstands` | ≥ 2 stands whose nearest centerline index is ≥ 12 % of the lap (circular) from index 0 |
| AT2 | every shipped track | `cornerGrandstands` | ≤ 4 distinct corners; each piece belongs to the accepted apex nearest its centre in XZ (not nearest centerline index: at barrier + 3 that lands on another lap stretch); `dot(centre − apex point, outside normal at apex)` > −5 m (hairpin section ends wrap round the apex; bahrain measured −2.88) and XZ distance to the apex point ≤ 150 m |
| AT3 | every shipped track | `placedGrandstands` | all `standClearance ≥ 5` (−1e-6); no two corner-stand pieces from different corners (attributed as in AT2) closer than 20 m centre to centre |
| AT4 | mexico style with `cornerGrandstands: false` | `placedGrandstands` | count equals the 316 count (builder + extras) |
| AT5 | any track | `cornerGrandstands` twice | deep-equal (deterministic) |

## Acceptance criteria

- [ ] AT1–AT5 pass; 316 acceptance tests still pass.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

Builder changes, stand meshes, crowds, changing the builder or style-file stands.

Planner 2026-10-20 (decision 318-coder): step 3 spatial 150 m separation, step 5 drop rule, AT2 attribution by nearest apex in XZ. Acceptance test file is updated to match. 147/254/269/093 failures belong to task 323; ignore.
