# 098 — Gravel traps from OpenStreetMap, run-off rule only for real corners

Status: pending
Phase: 1
Depends on: 097
Complexity: complex
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer (complex adds tester-pre and tester)

## Goal

Run-off areas follow the real circuits: gravel traps come from OSM polygons; the invented rule only fills real corners that OSM lacks, and near-straight sweepers get no asphalt strips.

## Context

Today `detectRunoffs` (`tools/track-builder/corners.ts`) puts a run-off outside every bend with radius < CORNER_RADIUS (400 m): gravel 18 m if min radius < 150 m, else 12 m asphalt. The user sees odd asphalt beside straights (Monza 369–733, Curva Grande). Research: `docs/research/osm-runoff.md`. Extracts: `assets/source/osm/<track>-areas.json` (`features[]`: `id`, `kind`, `closed`, `tags`, `ring` = [lon, lat][]; ODbL). Gravel = closed features with `natural=sand|shingle` or `surface=gravel|sand`. Project rings with `projectLonLat` and the same origin the builder uses for the track GeoJSON (`bboxCenter` of its coordinates).

## Files

- `tools/track-builder/corners.ts` — modify (`detectRunoffs` gains optional gravel polygons)
- `tools/track-builder/osmAreas.ts` — create (load + project gravel polygons)
- `tools/track-builder/buildTrack.ts` — modify (read `<id>-areas.json` when present)
- `public/tracks/monza.json`, `spa.json`, `silverstone.json` — regenerate
- `tests/unit/track/osmRunoffs.test.ts` — create (edge cases)
- Planner-authorised minimal edits only where pinned run-off counts/positions of real tracks change: tests under `tests/unit/acceptance/` and `tests/unit/edge/` that read `public/tracks/*.json` run-offs (026 AT5 already updated by the planner)

## Steps

```ts
export function detectRunoffs(points: Point2[], gravel?: Point2[][], halfWidth?: number /* 6 */, kerbs?: TrackSegment[]): RunoffSegment[];
export function loadGravelPolygons(areasJsonPath: string, origin: LonLat): Point2[][]; // [] if the file is missing
```

- OSM gravel: per centerline index and side, the lateral line from the outer edge (half + KERB_WIDTH where a kerb covers the index, else half) out to half + 40 m; if it crosses a gravel polygon, extent = farthest crossing − edge, clamped to [4, 40]. Consecutive indices with an extent form a run (drop runs < 5 indices); width = median extent rounded to 1 m; start a new run where an extent differs from the current run's median by > 6 m.
- Fallback rule (only for corner runs with min radius < 150 m, outside side, when no OSM gravel run on that side overlaps [start − 15, end + 15]): min radius < 100 m → gravel 18 m, else paved `runoff` 12 m, spanning [start − 15, end + 15]. No run-off for corners with min radius ≥ 150 m.
- Kerbs, centerline, elevation unchanged; barriers, terrain and trees follow from the builder's existing rules.

Conventions: deterministic; wrap indices; polygons are closed rings (first point may repeat); output sorted by start.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | ring R 400 (~2 m spacing), halfWidth 6, no kerbs; one gravel polygon = annular sector on the outer side from radius 408 to 428 between the angles of indices 100 and 200 | detectRunoffs | exactly one run-off: outer side, gravel, start 100 ± 1, end 200 ± 1, width 22 ± 1; no fallback run-offs (radius 400 ≥ 150) |
| AT2 | rings R 90 / R 120 / R 200, no polygons | detectRunoffs | R 90: one gravel 18 m on the outside; R 120: one paved `runoff` 12 m on the outside; R 200: none |
| AT3 | rebuilt monza.json, spa.json, silverstone.json | read run-offs | every paved `runoff` segment contains an index whose centerline radius (Menger, ±3 points) is < 150 m; Monza has no paved run-off overlapping indices 369..733 |
| AT4 | rebuilt monza.json | read run-offs | ≥ 8 gravel segments, each overlapping (lateral line test above) an OSM gravel polygon or a corner with radius < 100 m |
| AT5 | rebuilt tracks vs the previous JSON (git HEAD before the task) | compare | centerline, elevation, kerbs, pit identical |

## Acceptance criteria

- [ ] AT1–AT5 pass; all other tests pass (protected tests edited only as listed in Files).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Barriers from OSM, grass areas, per-index variable run-off width in the renderer, rendering changes.
