# 004 — Project lon/lat coordinates to local metres

Status: pending
Phase: 0
Depends on: 002
Roles: coder, tester, reviewer

## Goal

`src/track/geo.ts` exists with the local equirectangular projection, bbox centre and polyline length.

## Context

Formula and constants: `ai/guides/architecture.md`, section "Track data". North = -Z, east = +X. Tests: `ai/guides/testing.md`. Relative imports without extension. Minimal code comments.

## Files

- `src/track/geo.ts` — create
- `tests/unit/track/geo.test.ts` — create

## Steps

Create `src/track/geo.ts` with exactly these exports:

```ts
export const EARTH_RADIUS_M = 6371008.8;
export type LonLat = [number, number];  // [lon, lat] degrees
export type Point2 = [number, number];  // [x, z] metres
export function bboxCenter(coords: LonLat[]): LonLat;
export function projectLonLat(coords: LonLat[], origin: LonLat): Point2[];
export function polylineLength(points: Point2[], closed: boolean): number;
```

1. `bboxCenter`: `[(minLon+maxLon)/2, (minLat+maxLat)/2]`. Empty input: throw `Error('bboxCenter: empty coords')`.
2. `projectLonLat`: with `[lon0, lat0] = origin`, `k = EARTH_RADIUS_M * Math.PI / 180`: `x = (lon - lon0) * Math.cos(lat0 * Math.PI / 180) * k`; `z = -(lat - lat0) * k`. Returns a new array, same order/length.
3. `polylineLength`: sum of 2D Euclidean distances between consecutive points; if `closed` and ≥ 2 points, also add last→first. Fewer than 2 points: 0.

## Acceptance criteria

Tests in `tests/unit/track/geo.test.ts`:

- [ ] `projects 1 degree of latitude north to about -111195 m on Z`: `projectLonLat([[0,1]], [0,0])[0]`: `x` ≈ 0 (`toBeCloseTo(0, 6)`), `|z - (-111195)| < 1`.
- [ ] `east is positive X and north is negative Z`: from origin `[0,0]`, `[0.001,0]` → x > 0; `[0,0.001]` → z < 0.
- [ ] `bboxCenter returns the middle of the bounding box`: `[[0,0],[10,4],[2,8]]` → `[5,4]`.
- [ ] `polylineLength handles open and closed square`: 10×10 square: open 30, closed 40.
- [ ] `Monza closed length is about 5786.6 m`: read `assets/source/tracks/it-1922.geojson` with `node:fs` (path relative to repo root); take `features[0].geometry.coordinates`; drop the last point (duplicate of first); project with `bboxCenter(coords)`; closed `polylineLength` within ±1 of 5786.6.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Other projections, elevation, inverse conversion.
- Reading files from `src/` (only the test reads the geojson).
- Any other export.
