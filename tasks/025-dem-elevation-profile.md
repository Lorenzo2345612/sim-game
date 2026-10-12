# 025 — DEM sampling and centerline elevation profile

Status: pending
Phase: 1
Depends on: 022, 023, 024
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

Given a DEM grid and a centerline, produce the smoothed per-point elevation relative to the start line.

## Context

Rule in `ai/guides/phase1.md` "Builder rules" (Elevation): DEM bilinear at each point → circular moving average over 25 points → minus value at index 0. `DemGrid` comes from task 024 (`tools/dem/fetchDem.ts`). Row `i` latitude = `lat0 - i·dLat`; column `j` longitude = `lon0 + j·dLon`. Centerline `[x, z]` and the origin follow `architecture.md` "Track data"; origin is `bboxCenter` of the GeoJSON coordinates (as in `buildTrackData`).

## Files

- `tools/track-builder/elevation.ts` — create
- `tests/unit/acceptance/025-dem-elevation-profile.test.ts` — create by the acceptance role

## Steps

1. Exports:
```ts
import type { DemGrid } from '../dem/fetchDem';
import type { LonLat, Point2 } from '../../src/track/geo';
export function sampleDem(grid: DemGrid, lon: number, lat: number): number;
export function centerlineHeights(grid: DemGrid, centerline: Point2[], origin: LonLat): number[]; // sampleDem at unprojectXZ of each point
export function elevationProfile(raw: number[], window?: number): number[]; // window default 25
```
2. `sampleDem`: bilinear; coordinates outside the grid clamp to the nearest edge cell (never NaN).
3. `elevationProfile`: circular moving average centred on each index (window odd, ±(window-1)/2), then subtract the smoothed value at index 0 (so index 0 is exactly 0). Returns a new array, input untouched.
4. Import `unprojectXZ` from task 023.

## Acceptance tests (defined by the planner with Opus, before coding)

Acceptance tests for this task are Vitest in `tests/unit/acceptance/`. Rows are copied verbatim; do not change them.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | DEM grid 2×2 with heights [0,10;20,30] over 1°×1° | `sampleDem(grid, lon, lat)` at the centre | 15 ±1e-9 (bilinear) |
| AT2 | same | sample outside the grid | clamps to the nearest edge value, no NaN |
| AT3 | centerline of 100 points, raw heights all 50 except index 40 = 150 | `elevationProfile` (window 25, circular) | value at 40 = 4 ±1e-6 (smoothed 54 minus smoothed start 50); index 0 = 0 |
| AT4 | real Monza DEM + centerline | profile | max − min between 5 and 30 m |
| AT5 | real Spa DEM + centerline | profile | max − min between 80 and 120 m |

## Acceptance criteria

- [ ] Acceptance tests pass (real-DEM rows use the committed `assets/source/dem/*.json` and `public/tracks`-equivalent centerline built with `buildTrackData`).
- [ ] No `three` import; typecheck and lint clean.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Terrain grid (028); writing track JSON (030); fetching.
