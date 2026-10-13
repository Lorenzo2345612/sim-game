# 079 — Remove tree canopy from the DEM before building tracks

Status: pending
Phase: 1
Depends on: nothing
Complexity: standard
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Track elevation and terrain no longer include forest canopy: Monza's elevation range drops from ~22 m to ≤ 15 m and its terrain has no fake 50 m hills.

## Context

Copernicus GLO-30 is a surface model (includes tree canopy). Fix in the offline track-builder only. `DemGrid` is imported from `tools/dem/fetchDem.ts` (`heights` row-major, `rows` × `cols`, plus lon0/lat0/dLon/dLat). Pipeline code is frozen only for pipeline files; `tools/track-builder` is in scope.

## Files

- `tools/track-builder/elevation.ts` — modify — add `removeCanopy`.
- `tools/track-builder/buildTrack.ts` — modify — apply it to the loaded DEM; read `canopyRadiusCells`.
- `tools/track-builder/tracks.json` — modify — `"canopyRadiusCells": 3` for monza (others omitted = default).
- `public/tracks/*.json` — regenerate with `npm run build:tracks` and commit.
- `tests/unit/acceptance/079-dem-canopy-filter.test.ts` — create (acceptance worker).

## Steps

1. Export `function removeCanopy(grid: DemGrid, radiusCells: number): DemGrid` in elevation.ts: grey-scale morphological opening (min filter, then max filter) with a square window (2r+1)×(2r+1), edges clamped (window indices clamped to the grid). Returns a new grid with the same metadata and dimensions; the input is not mutated. Radius 0 returns an equal copy.
2. In `buildTrackV2`, replace `grid` by `removeCanopy(grid, config.canopyRadiusCells ?? 2)` before `centerlineHeights` and `buildTerrain`. Add optional `canopyRadiusCells?: number` to `TrackConfig`.
3. Run `npm run build:tracks`; commit the regenerated tracks.

Conventions: no rounding inside `removeCanopy`; window boundaries inclusive (radius r covers offsets −r..r); radius must be a non-negative integer, otherwise throw `Error`; ties irrelevant; input not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/079-dem-canopy-filter.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | 20×20 grid all 100, a 3×3 block at 125 (forest) | removeCanopy(r 2) | every cell 100 ± 1e-9 |
| AT2 | 20×20 grid, plane rising 1 per cell along cols | removeCanopy(r 2) | unchanged at interior cells (cols 2..17) ± 1e-9 |
| AT3 | broad gaussian hill: 60×60, 30 m cells, sigma 300 m, height 40 | removeCanopy(r 2) | peak drop < 2 m |
| AT4 | regenerated public/tracks/monza.json | elevation max − min | ≤ 22.5 m; terrain heights max − min ≤ 42 m (raw DEM: 22.3 / 54; the real park slopes ~20 m, grade smoothing is task 085) |
| AT5 | regenerated spa.json / silverstone.json | elevation max − min | spa 90–110 m; silverstone ≤ 15 m |
| AT6 | input grid | removeCanopy | input not mutated; returns new grid same dims |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Regenerated `public/tracks/*.json` committed; existing track tests still pass.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run build:tracks
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Fetching new DEM data, other filters (smoothing, outlier removal), runtime (src/) changes, per-track tuning other than monza = 3.
