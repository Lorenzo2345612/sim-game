# 028 — Build the terrain heightfield

Status: pending
Phase: 1
Depends on: 022, 023, 024, 025
Complexity: complex
Type: feature
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Create the `Terrain` grid (DEM-based, flattened under the track) in Rapier heightfield layout.

## Context

Rule in `ai/guides/phase1.md` "Builder rules" (Terrain) and the Rapier heightfield layout in "Verified facts". `Terrain` type from `src/core/types.ts`; `DemGrid` from `tools/dem/fetchDem.ts`; `sampleDem` from `tools/track-builder/elevation.ts`; `unprojectXZ` from `src/track/geo.ts`.

## Files

- `tools/track-builder/terrain.ts` — create
- `tests/unit/acceptance/028-terrain-builder.test.ts` — create by the acceptance role

## Steps

1. Export:
```ts
import type { DemGrid } from '../dem/fetchDem';
import type { LonLat, Point2 } from '../../src/track/geo';
import type { Terrain } from '../../src/core/types';
export function buildTerrain(
  grid: DemGrid, centerline: Point2[], elevation: number[],
  origin: LonLat, widthMeters: number, maxBarrierOffset: number,
): Terrain;
```
2. Bounds: centerline bbox + 400 m margin on every side; `originX/originZ` = bounds centre, `sizeX/sizeZ` = extents. `cols = round(sizeX/8)`, `rows = round(sizeZ/8)` (spacing ≈ 8 m).
3. Layout: `heights.length = (rows+1)(cols+1)`, `index = col·(rows+1) + row`, row `i` ↔ `z = originZ − sizeZ/2 + i·sizeZ/rows`, col `j` ↔ `x = originX − sizeX/2 + j·sizeX/cols`.
4. Base height = `sampleDem(...)` at the unprojected node minus raw `sampleDem` at `centerline[0]`.
5. Corridor: `d` = distance to the nearest centerline point; `c = widthMeters/2 + maxBarrierOffset + 5`. If `d ≤ c`: `elevation[nearest] − 0.15`. For `c < d < c + 30`: linear blend from that value to the base height. Beyond: base height.
6. Use a uniform spatial grid for nearest-point lookup (brute force is too slow for ~100k nodes). Round heights to 0.01.

## Acceptance tests (defined by the planner with Opus, before coding)

Acceptance tests for this task are Vitest in `tests/unit/acceptance/`. Rows are copied verbatim; do not change them.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | flat DEM 100 m, centerline square 400 m, elevation all 0 | `buildTerrain` | rows/cols give spacing 8 ±0.5 m; bounds cover bbox + 400 m margin |
| AT2 | DEM sloped 0.1 m/m along x, track elevation 0 | terrain at a point 2 m from the centerline | = −0.15 ±0.01 (flattened corridor) |
| AT3 | same | point 30 m beyond the corridor edge | = DEM value relative to start ±0.2 |
| AT4 | any | heights array | length (rows+1)*(cols+1), column-major per ai/guides/phase1.md, no NaN |

## Acceptance criteria

- [ ] Acceptance tests pass; terrain build for Spa completes in < 20 s.
- [ ] No NaN in any output.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Writing track JSON (030), colliders, rendering, smoothing the DEM further.
