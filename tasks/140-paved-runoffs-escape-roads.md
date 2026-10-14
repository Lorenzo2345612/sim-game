# 140 — Builder: paved run-offs at heavy-braking corners, chicane escape roads, foam barrier placement

Status: pending
Phase: 1
Depends on: 098
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Rebuilt tracks have wide asphalt run-offs outside heavy-braking corners, escape-road polylines at chicanes, and `foam` barrier segments where cars arrive fast. Rendering/colliders are task 141.

## Context

M1.2c. Design: `docs/plans/m1.2c-realism.md` ("140–141"), research `docs/research/runoff-barriers.md` (OSM has no paved run-offs, so rules only; OSM gravel from 098 stays elsewhere). Today `src/main.ts` does `await res.json()` with no parser; this task adds one. All indices are centerline indices, spans wrap modulo n, "start − 25" means index arithmetic (not metres). Outside = opposite to the corner's turn side. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/core/types.ts` — modify: `BarrierSegment.type` adds `'foam'`; add `EscapeRoad`; `TrackDataV2.escapeRoads?: EscapeRoad[]`.
- `src/track/parseTrackData.ts` — create.
- `src/main.ts` — modify: wrap the fetched JSON with `parseTrackData`.
- `tools/track-builder/corners.ts` — modify: export `CornerRun` and `detectCorners` (existing `analyze(points, CORNER_RADIUS)` sorted by `start`; no behaviour change).
- `tools/track-builder/hazards.ts` — create.
- `tools/track-builder/buildTrack.ts` — modify: call the new functions, write `escapeRoads` (always, `[]` if none).
- `public/tracks/*.json` — regenerate with `npm run build:tracks` for ALL ten ids in `tools/track-builder/tracks.json` (monza, spa, silverstone, mexico, daytona, lusail, bahrain, braselton, elkhart, sepang); every one must rebuild without error.
- `tests/unit/acceptance/140-paved-runoffs.test.ts` — create (acceptance worker).
- Minimal planner-authorised edits to existing tests that fail only because of regenerated tracks (new `escapeRoads` field, foam types, fewer gravel/changed run-offs). Candidates: `tests/unit/acceptance/097-terrain-below-strips.test.ts` (AT3 field list: also ignore `escapeRoads`), `tests/unit/acceptance/098-osm-runoffs.test.ts`, `tests/unit/edge/098-osm-runoffs.post.test.ts`, `tests/unit/track/osmRunoffs.test.ts`, `tests/unit/acceptance/077-track-verges.test.ts`, `tests/unit/edge/086-barrier-continuity*.test.ts`, `tests/unit/acceptance/096-surface-transitions.test.ts`. Run `npm test`, fix only failing ones, list every edit in the report.

## Steps

```ts
// types.ts
export interface EscapeRoad { points: [number, number][]; width: number } // XZ metres, order A→K→B
// parseTrackData.ts
export function parseTrackData(json: unknown): TrackData | TrackDataV2; // v2: escapeRoads defaults to []; throws Error on non-object or on a barrier type outside armco|tyres|wall|foam
// corners.ts
export interface CornerRun { start: number; end: number; side: Side; minRadius: number } // side = turn side
export function detectCorners(points: Point2[]): CornerRun[];
// hazards.ts
export interface BrakingCorner extends CornerRun { dropKmh: number; kind: 'heavy' | 'medium' | 'none' }
export function classifyCorners(points: Point2[]): BrakingCorner[];
export function applyPavedRunoffs(points: Point2[], runoffs: RunoffSegment[], corners: BrakingCorner[]): RunoffSegment[];
export function applyFoamBarriers(barriers: BarrierSegment[], corners: BrakingCorner[]): BarrierSegment[];
export function detectEscapeRoads(points: Point2[]): EscapeRoad[];
```

1. `classifyCorners`: vc = min(85, sqrt(1.6·9.81·minRadius)) m/s; approach = min(85, sqrt(vc² + 2·12·L)), L = arc length (m, polyline incl. closing edge) from the previous corner run's `end` to this `start` (previous of the first run is the last; with one run, the rest of the lap); dropKmh = 3.6·(approach − vc). kind `heavy`: dropKmh ≥ 70 and minRadius < 120. `medium`: not heavy and (40 ≤ dropKmh < 70, or dropKmh ≥ 70 with 120 ≤ minRadius < 150). Else `none`.
2. `applyPavedRunoffs`: per heavy corner, outside side: first remove every run-off (any surface) on that side overlapping [start − 25, end + 10]; then add `{surface:'runoff', side, start: start − 25, end: end + 10, widthMeters: clamp(10 + 0.1·dropKmh, 10, 30) rounded to 0.5}`. Others untouched. Returns a new array sorted by `start`.
3. Pipeline order in `buildTrack.ts`: `detectRunoffs` → `classifyCorners` → `applyPavedRunoffs` → `layoutBarriers` (with the new run-offs, so offsets follow the paved width) → `applyFoamBarriers`.
4. `applyFoamBarriers`: for each heavy corner, outside side, indices [start − 15, end + 10]: type becomes `foam`. For each medium corner, same indices: type becomes `foam` only where that index's barrier `offsetMeters < 20`. Keep offsets; re-merge adjacent indices of equal type+offset into one segment; new array.
5. `detectEscapeRoads`: for each pair of consecutive corner runs (wrapping) with opposite `side`, both `minRadius < 80`, arc-length gap (end of first → start of second) < 120 m: A = point at (run1.start − 10), T = unit tangent at A (central difference, as `rightNormal` in corners.ts), B = point at run2.end, K = A + T·dot(B − A, T). Polyline A→K→B, each leg sampled every 2 m (last sample of a leg is its exact end; K not duplicated), width 8. Result in track order.
6. Everything is deterministic; no randomness.

Conventions: indices wrap with positive modulo; arc length in metres; width rounding to 0.5 m half-up; span bounds inclusive; empty/short input (n < 3) returns `[]` / unchanged; inputs are not mutated; ties in run-off sorting keep input order.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rounded square: 4 straights 600 m + 4 arcs R 30 (90°), spacing 2 m, width 12, no OSM areas | build run-offs/barriers | exactly 4 paved `runoff` segments, all on the outside, width 30, each spanning its arc run start − 25 … end + 10 (± 1 index); outside barrier type `foam` over start − 15 … end + 10 (± 1) |
| AT2 | rounded square with arcs R 150 | same | no paved run-off, no `foam` |
| AT3 | fixture: straight 500 m along −Z, left arc R 40 (60°), 50 m straight, right arc R 40 (60°), straight 500 m, closed by a large loop (R 300) | build | exactly one escape road, width 8; first point within 1 m of the centerline point 10 samples before the left arc; last point within 1 m of the centerline point at the right arc's end; points before K lie within 0.5 m of the approach straight's line |
| AT4 | rebuilt monza.json | read | ≥ 2 paved run-offs from the heavy rule, ≥ 1 escape road starting within the first 1500 m, ≥ 1 `foam` barrier segment |
| AT5 | rebuilt monza/spa/silverstone vs previous JSON | compare | centerline, elevation, kerbs, pit identical; gravel segments not overlapping a heavy-corner span identical |
| AT6 | parseTrackData of a JSON without `escapeRoads` / with barrier type `foam` | parse | escapeRoads [] / accepted |

## Acceptance criteria

- [ ] AT1–AT6 pass; all ten `public/tracks/*.json` regenerated and contain `escapeRoads`.
- [ ] `npm run build:tracks` exits 0; `npm run typecheck`, `lint`, `test` pass (edits to old tests only as listed, all reported).

## Verification

```
npm run build:tracks
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Rendering, colliders, surface strips, terrain changes for escape roads (task 141); foam mesh; per-track override lists; elevation-aware speed profile; OSM parsing changes; tyre-wall rule changes; README/tasks.json.
