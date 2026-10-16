# 176 — Fix track surface/barrier overlaps (grey patches, grass on track, guardrails crossing)

Status: pending
Phase: 1
Depends on: 173
Complexity: complex
Type: bugfix
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

No run-off/grass/gravel strip triangle, escape road or barrier lies over the asphalt of any track, in all v2 tracks (worst: Singapore). Guarded by a permanent audit test.

## Context

Planner audit (`ai/lab/audit/overlap.ts`, `ai/lab/audit/audit.ts`, run with `npx tsx`): triangles from `buildTrackSurfaces` that are not asphalt/kerb with centroid within (min half-width − 1 m) of a centerline point: singapore 1218 runoff/63 grass/9 gravel; lasvegas 571/48/6; mexico 498 runoff; spa 433; fontana 406/42/4; daytona 329; baku 302/68; silverstone 286; detroit 282; sepang 242/70; monza 223; budapest 209; cleveland 169/83; braselton 168; bahrain 121/1; spielberg 3 grass; elkhart, lusail clean. Barrier vertices inside asphalt: singapore 17, cleveland 16, lasvegas 11, fontana 11, baku 2, bahrain 1. Terrain poking and asphalt holes: 0 today (must stay 0). Wheel surface comes from the strip collider hit, so overlaps cause slippery grey patches (grass grip 0.45) and visible artefacts. Causes: (a) `escapeRoadStrips` (task 140) start on the centreline/cross the track (Singapore 25); (b) lateral ribbons fold on the inside of tight corners and beside other track parts; (c) barrier offsets cross other track parts. Read `ai/guides/architecture.md` (track data, surfaces).

## Files

- `src/track/surfaces.ts` — modify — `asphaltOwner`, overlap filtering, offset clamp, flipped-triangle drop in `buildTrackSurfaces`
- `src/track/barrierPath.ts` — modify — drop barrier vertices over other track parts in `barrierRuns`
- `tools/track-builder/*` — modify — trim/drop escape roads (find where `escapeRoads` is produced)
- `public/tracks/*.json` — regenerate with the builder, commit
- `tests/unit/game/176-track-geometry-audit.test.ts` — create (coder) — permanent audit over every v2 track (skip `index.json`)

## Steps

1. Export from `src/track/surfaces.ts`: `export function asphaltOwner(track: Track, margin?: number): (x: number, z: number) => number` (`Track` imported from where architecture.md defines it; `margin` default 0.5 m). Returns the index of a centerline point whose asphalt (|lateral| ≤ `halfWidthAt` − margin, longitudinally within that point's segment) contains (x,z); else −1. Uniform spatial grid built once per `asphaltOwner` call.
2. In `buildTrackSurfaces`, drop every non-asphalt/kerb triangle whose centroid or any vertex lies on asphalt per `asphaltOwner`. Kerbs keep their own outer-edge rule.
3. Inner-side lateral ribbons (runoff, grass, gravel): clamp the lateral offset to 0.9 × local radius of curvature (radius from 3 consecutive centerline points; straight = no clamp), so they do not fold.
4. Then drop flipped triangles: signed XZ area of the opposite sign to the strip's majority sign.
5. Escape roads (builder): trim each polyline so it starts and ends at the asphalt edge (first/last point outside the asphalt of every centerline point). Drop roads that cross any other asphalt between their ends. Log per track how many were dropped.
6. `barrierRuns`: drop vertices within `halfWidthAt + 0.3 m` of any centerline point whose index is not their own index ± 5 (circular for closed loops). Split the run at drops; runs with < 2 vertices vanish. Median walls (task 155) are exempt.
7. Rebuild all `public/tracks/*.json` with the builder; commit. Run both probes and put their output in the run log.
8. Audit test iterates every v2 track and implements AT1–AT5 with the same definitions as the table.
9. Existing edge/acceptance tests that pin escape-road counts or barrier vertex counts may now fail: do NOT edit them. Raise a decision listing the files and cases for planner authorisation.

Conventions: distances in metres; asphalt containment inclusive (`<=`); thresholds in AT rows are strict `<` for violations (a violation is distance < threshold); invalid/degenerate input (fewer than 3 points, zero radius) → no clamp, no throw; triangle area zero is not "flipped"; `buildTrackSurfaces` and `barrierRuns` must not mutate the track.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | unit: every v2 `public/tracks/*.json` (skip index.json) | `buildTrackSurfaces` | 0 triangles of surface runoff/grass/gravel whose centroid lies within (min(halfWidthAt left,right) − 1 m) of any centerline point |
| AT2 | unit: every v2 track | `barrierRuns` both sides, excluding median walls | 0 barrier vertices and 0 segment midpoints within (min half-width − 0.3 m) of any centerline point |
| AT3 | unit: every v2 track | sample 5 lateral points across the asphalt at every centerline index (−hl+0.5, −hl/2, 0, hr/2, hr−0.5) | every sample covered by an asphalt or kerb triangle in XZ (no holes introduced) |
| AT4 | unit: every v2 track | bilinear terrain height at every strip triangle centroid and edge midpoint | ≤ strip height + 0.005 m |
| AT5 | unit: every v2 track, every strip | signed XZ area of each triangle | same sign as the strip's majority (no folded triangles) |
| AT6 | unit: synthetic track: 200 m straight, hairpin radius 8 m, 200 m straight back 20 m apart, half-width 6, runoff 18 m on both sides | `buildTrackSurfaces` | AT1 and AT5 hold; asphalt still covers the AT3 samples |
| AT7 | e2e `/?track=singapore` | `teleportToIndex(i)` for i in [250, 975, 1000, 1375], wait 0.2 s sim each | `surfaceUnderCar()` is 'asphalt' or 'kerb' at each |

## Acceptance criteria

- [ ] AT1–AT7 pass.
- [ ] `asphaltOwner` exported with the signature above.
- [ ] All `public/tracks/*.json` rebuilt and committed; builder logs dropped escape roads per track.
- [ ] Audit test `tests/unit/game/176-track-geometry-audit.test.ts` passes for every v2 track.
- [ ] No existing test edited; conflicts raised as a decision.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 176-
npx playwright test 106- 140- 155-
```

## Planner-authorised test edits

Rebuilding changes `escapeRoads` and `barriers` on monza/spa/silverstone. In the legacy "unchanged vs base revision" checks, also exclude `escapeRoads` and `barriers` from the comparison (as 173 did for `pit`); change nothing else:
- `tests/unit/acceptance/097-terrain-below-strips.test.ts` AT3, `098-osm-runoffs.test.ts` AT5, `106-new-tracks-in-game.test.ts` AT5, `140-paved-runoffs.test.ts` AT5, `142-kerbs-every-corner.test.ts` AT5, `155-close-parallel.test.ts` AT5, `tests/unit/edge/142-kerbs-every-corner.post.test.ts`.
- 097 AT3 may also need `terrain.heights` to differ, which it already ignores.
- In the full-object comparisons (106 AT5, 155 AT5) also blank `terrain.heights` (fewer strips change the terrain clamp), as 097 AT3 does.
- `tests/unit/edge/141-escape-foam.post.test.ts` POST6 (foam blocks 0 vs 11 on a synthetic L corner) is NOT authorised: it is a regression; foam/escape-road barriers of a road must survive the step 4 barrier filter (exclude only vertices on the asphalt of a different part of the track).
Any other failing test that pins counts still follows step 9.

## Out of scope

- Changing kerb geometry, median walls (155), banking (174), pit building (173).
- Changing grip values, surface types or terrain generation.
- Editing `ai/guides/architecture.md` or existing tests.
