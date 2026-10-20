# 317 — City bake: buildings allowed up to the local barrier, not the lap's farthest one

Status: pending
Phase: 2
Depends on: none
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`bakeCity` keeps every building that clears the barrier of its own stretch of track, so baku, singapore and lasvegas show scenery along the whole lap.

## Context

User report: scenery only near the main straight. `bakeCity` (`tools/env/bakeCity.ts`) uses one `corridorLimit = widthMeters/2 + max barrier offsetMeters over the whole lap + 5` (≈ 49 m on baku/singapore; 38 m barriers exist only in a few run-off zones), so any building closer than 49 m anywhere is dropped. Shipped envs: baku 1 building with centroid < 100 m of the centerline (raw OSM has ~270), singapore 4, lasvegas 2. Task 157 tests (`tests/unit/acceptance/157-city-bake.test.ts`, `tests/unit/edge/157-*`) call `buildCityEnv` with `corridorLimit`; keep them green by updating their params call only where the type forces it.

## Files

- `tools/env/osmBuildings.ts` — modify: `CenterlineIndex` per-segment limit; `CityEnvParams`.
- `tools/env/bakeCity.ts` — modify: compute the per-segment corridor.
- `public/tracks/{baku,singapore,lasvegas}-env.json` — regenerate from the cached `assets/source/osm/<id>-city.json` (no network) and commit.
- `tests/unit/acceptance/317-city-bake-local-corridor.test.ts` — create (acceptance worker).
- Planner-authorised edit (2026-10-19): `tests/unit/acceptance/157-city-bake.test.ts` AT2 drops the lap-wide corridor intrusion check (replaced by 317 AT3); building count, heights, walls and water stay. The `segSegDist2` fix in `tools/env/osmBuildings.ts` is accepted. Nothing else.

## Steps

```ts
export interface CityEnvParams {
  origin: LonLat; centerline: Point2[];
  corridorAt: (segmentIndex: number) => number; // metres from centerline segment i (point i to i+1, closed)
  keepRadius: number; bbox: ExtractBbox;
}
export function corridorLimits(track: TrackDataV2): Float64Array; // in bakeCity.ts, exported for tests
```
1. `corridorLimits`: entry i = `widthMeters/2` + (max `offsetMeters` of `track.barriers` on either side whose `start ≤ i ≤ end`, wrapping when `end < start`; 8 when none) + 5.
2. `CenterlineIndex` stores one limit per segment (`corridorAt(i)`); `anyEdgeCloserThan(ring)` tests each candidate segment against its own limit (strict `<`), searching cells far enough for the largest limit. `anyPointCloserThan` and `keepRadius` unchanged.
3. `bakeCity` passes `corridorAt: (i) => limits[i]`. The scalar `corridorLimit` is removed. Ermita village bake (`bakeVillage.ts`) untouched.
4. Run `npm run build:env -- baku singapore lasvegas`; output order and rounding unchanged (deterministic).

Conventions: distances in metres; building dropped when any ring edge is `<` the limit of a nearby segment; no input mutated; no barriers → 8 m.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | centerline x = 0..1000 step 5, z = 0, width 12; barriers both sides offset 38 on the indices with x ∈ [0, 100], offset 4 elsewhere; two building ways 10×10 m with `height=10`, centred (500, 20) and (50, 20) | `buildCityEnv` | the first is kept, the second dropped |
| AT2 | rebaked `public/tracks/baku-env.json` | count buildings whose ring centroid is < 100 m from the centerline | ≥ 150 |
| AT3 | rebaked baku, singapore, lasvegas | every building ring edge vs centerline | distance ≥ the local corridor of the nearest centerline segment (−1e-6) |
| AT4 | rebaked singapore and lasvegas | same count as AT2 | singapore > 4, lasvegas > 2 |
| AT5 | bake run twice from the cache | compare files | byte-identical |

## Acceptance criteria

- [ ] AT1–AT5 pass; 157 acceptance and edge tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

Permanent circuits (task 319), render changes, ermita village bake, new building filters.
