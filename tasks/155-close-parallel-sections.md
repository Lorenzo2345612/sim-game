# 155 — Close parallel sections: per-index half-widths and shared median wall

Status: pending
Phase: 1
Depends on: 142, 140, 141, 143
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Where two non-adjacent sections run side by side (street circuits, e.g. Baku: centerlines 9.5-20 m apart, width 12), the road is narrowed on the facing side, no kerb/run-off is placed there, and one shared `wall` barrier stands on the midline, so strips, kerbs, run-offs and barriers no longer overlap.

## Context

Design in `docs/plans/m1.2c-realism.md` ("155 Close parallel sections"). Runs after 142, 140, 141 and 143 because it edits files they edit (`buildTrack.ts`, `types.ts`, `surfaces.ts`). Task 106 depends on this one. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`. Terrain clamp (097) and colliders already consume `buildTrackSurfaces`, so they follow the strips with no code change; trees are already excluded near any centerline (`placeTrees` exclusion) and need no change.

## Files

- `src/core/types.ts` — modify: `TrackDataV2.halfWidthLeft?: number[]; halfWidthRight?: number[]` (metres per centerline index).
- `src/track/surfaces.ts` — modify: export `halfWidthAt`; asphalt rows, kerb inner edge, run-off inner edge and verge use the per-side half-width.
- `src/track/markings.ts` — modify: `edgeLine` uses `halfWidthAt` per side.
- `tools/track-builder/parallel.ts` — create.
- `tools/track-builder/buildTrack.ts` — modify: call the new functions, write the arrays only when `parallel` has any masked index.
- `public/tracks/*.json` — regenerate with `npm run build:tracks` for ALL ids in `tools/track-builder/tracks.json` (ten old ones plus baku, budapest, singapore, lasvegas, spielberg); every one must rebuild without error, except the known, accepted `elkhart: length deviation 1.16% exceeds 1%` line (exit 1; JSON still written; do not fix it).
- `tests/unit/acceptance/155-close-parallel.test.ts` — create (acceptance worker).

## Steps

```ts
// parallel.ts
export interface ParallelInfo {
  halfLeft: number[]; halfRight: number[];             // per index, metres
  medianLeft: (number | null)[]; medianRight: (number | null)[]; // wall offset or null
  any: boolean;
}
export function analyzeParallel(points: Point2[], widthMeters: number): ParallelInfo;
export function stripParallel<T extends TrackSegment>(segs: T[], info: ParallelInfo): T[]; // removes masked indices per side
export function applyMedianWalls(barriers: BarrierSegment[], info: ParallelInfo, n: number): BarrierSegment[];
// surfaces.ts
export function halfWidthAt(track: TrackDataV2, side: Side, i: number): number; // array value, else widthMeters/2
```

1. `analyzeParallel`: for each index i, d = minimum point-to-segment distance from `points[i]` to the closed polyline's segments `[j, j+1]` with wrapped index distance |i − j| > 60 (and |i − (j+1)| > 60); side = the side of the tangent at i (central difference) where the closest point lies (cross-product sign; right = positive normal as `rightNormal` in `src/track/surfaces.ts`). Masked when d < widthMeters + 6.
2. Masked side: `median = floor(d/2 · 4) / 4`; `half = max(2, min(widthMeters/2, median − 0.5))`. If both sides... only the side where the other section lies is affected; the other side keeps `widthMeters/2` and `null`.
3. `stripParallel`: kerbs and run-offs are cut so they do not cover masked indices of their side (split segments; wrap-aware; same shape in/out; no mutation).
4. `applyMedianWalls`: on masked indices the barrier of that side is replaced by `{type:'wall', offsetMeters: median}`; other indices unchanged; re-merge equal neighbours; sorted by side then `start`; no mutation (also overrides `foam` and `tyres`).
5. Pipeline in `buildTrack.ts`: after the run-offs of 140 (`applyPavedRunoffs`) → `analyzeParallel` → `stripParallel` on kerbs and run-offs → `layoutBarriers` → `applyFoamBarriers` → `applyMedianWalls`. When `info.any` is false, `halfWidthLeft/Right` are omitted and nothing else changes (JSON identical to before).
6. `surfaces.ts`: `vergeInnerExtent` starts from `halfWidthAt`. On an index whose side half is below `widthMeters/2`, the verge `flat` and `outer` are capped at the offset of the barrier covering that index and side (never below `inner`). Elsewhere verge behaviour is unchanged.

Conventions: distances in metres, no rounding except `median` (floor to 0.25 m); `d < widthMeters + 6` strict; wrapped indices; closed polyline; inputs not mutated; ties (equal d) keep the lowest j; `n < 3` returns all-default info (`any` false).

## Acceptance writer: reading list

Read only: this spec, `ai/guides/testing.md`, the exports/signatures (not bodies) of `src/core/types.ts` (`TrackDataV2`, `BarrierSegment`, `TrackSegment`), `src/track/surfaces.ts` (`buildTrackSurfaces`, `rightNormal`), `src/physics/trackColliders.ts` (`addTrackColliders`) and `src/physics/physicsWorld.ts` (`initPhysics`, `createPhysicsWorld`), plus one existing fixture `tests/unit/acceptance/022-fixture-trackdatav2.ts`. Do not read the builder internals or run probe scripts. Import the not-yet-existing `tools/track-builder/parallel.ts` functions per Steps; tests are expected to fail until coding. Write the test file within the first 10 minutes, then refine.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | fixture: a long hairpin loop whose two straights run 300 m in parallel with centerlines 10 m apart, width 12 | build | on the inner side of both straights halfWidth = 4.5 (± 1e-6) along the parallel part; outer side 6 |
| AT2 | same | build | a `wall` barrier on the inner side of each straight at offset 5.0 ± 0.05; no kerb/run-off/tree on the inner sides along the parallel part |
| AT3 | same in Rapier via addTrackColliders | ray from a straight's centerline toward the other at y + 0.5 | hits a barrier collider at toi 5.0 ± 0.1 (before the other road) |
| AT4 | rebuilt baku.json | read | no two surface strips of non-adjacent sections overlap (polygon test, tolerance 0.05 m); every index with separation < 18 m has a median `wall` |
| AT5 | rebuilt monza/spa/silverstone | compare | identical to the previous JSON (no section closer than width + 6) |

## Acceptance criteria

- [ ] AT1-AT5 pass; `halfWidthLeft/Right` absent in monza/spa/silverstone JSON.
- [ ] `halfWidthAt` falls back to `widthMeters/2` when the arrays are absent (old JSON still loads).
- [ ] All ids rebuild (elkhart length line accepted); `npm test` green (only minimal edits to existing tests broken by regenerated tracks, each listed in the report).

## Verification

```
npm run typecheck
npm run lint
npm test
npm run build:tracks
```

## Out of scope

- Escape roads (140) crossing a median; ribbon (`buildRibbon`) and `grid.ts` width use; tree placement changes; changing the 60-index adjacency or the width + 6 threshold; new constants files; track data other than regeneration.
