# 031 — Build track surface geometry from TrackData v2

Status: pending
Phase: 1
Depends on: 022
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, tester-pre, tester, reviewer

## Goal

`buildTrackSurfaces(track)` turns a `TrackDataV2` into pure geometry arrays (asphalt, kerbs, run-off and gravel strips) shared by render (037) and physics (032).

## Context

Design: `ai/guides/phase1.md` (Runtime, constants). Axes and `Point2` as in `ai/guides/architecture.md` and `src/track/ribbon.ts`. The `track` layer must not import `three`. Acceptance tests: Vitest in `tests/unit/acceptance/031-track-surfaces-geometry.test.ts`.

## Files

- `src/track/surfaces.ts` — create
- `tests/unit/track/surfaces.test.ts` — create (edge cases beyond the acceptance table)

## Steps

```ts
import type { SurfaceStrip, TrackDataV2 } from '../core/types'; // SurfaceStrip is defined in core (task 022)
export function buildTrackSurfaces(track: TrackDataV2): SurfaceStrip[];
```

- Constant `KERB_WIDTH` from `../core/constants`. `w = track.widthMeters`, `N = centerline.length`, `elevation[i]` is the base height of point `i`.
- Per-point right normal as in `buildRibbon`: `d = normalize(P[i+1] - P[i-1])` (circular), `right = (-d.z, d.x)`. `left = -right`. Lateral offset `+a` = a metres to the right.
- Output order: asphalt (1 strip, closed ring like `buildRibbon`, N pairs, closing segment included), then one strip per kerb segment, then one per runoff segment, in the order of `track.kerbs` / `track.runoffs`.
- Asphalt: lateral `-w/2 … +w/2`, `y = elevation[i] + 0.02`. uv = `(lateral/10, s/10)`, `s` = cumulative centerline distance from point 0.
- Kerb segment (`TrackSegment`, `side`): lateral `w/2 … w/2 + KERB_WIDTH` on that side, `y = elevation[i] + 0.04`. uv: `u` 0 (inner) → 1 (outer); `v = s/1.5`, `s` = cumulative distance from the first point of the segment.
- Runoff segment: tag = `segment.surface`; `y = elevation[i] + 0.01`. Inner edge at point `i` = `w/2` plus `KERB_WIDTH` if a kerb on the same side covers index `i`; outer edge = inner + `widthMeters`. uv = `(lateral/10, s/10)` with `s` as for kerbs.
- Segment index range `start … end` inclusive, wrapping through N-1 → 0 when `end < start`; k points = `((end - start + N) % N) + 1`. Segments with k < 2 produce no strip. Open strips: 2k vertices (inner, outer pairs), 6 indices per quad, no closing quad.
- Winding: counter-clockwise seen from +Y for every triangle (normal y > 0), on both sides.
- Vertices must be finite (no NaN) for all inputs including wrapped segments.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/031-track-surfaces-geometry.test.ts` before the coder starts. Nobody else may change these rows or tests.

Fixture (build it in the test, no other inputs): `circleV2(elevation, kerbs, runoffs)` = `{ ...fixture }` from `tests/unit/acceptance/022-fixture-trackdatav2.ts` with `centerline`, `widthMeters` (12) and `lengthMeters` from `tests/fixtures/circleTrack.ts` (R = 100, N = 120, counter-clockwise, so **right = towards the centre**), `version: 2` and the given `elevation` (length 120), `kerbs`, `runoffs`. Radial distance of a vertex = `hypot(x, z)`. Chord between consecutive points `c = 200·sin(π/120)` ≈ 5.2353 m. Triangle (a, b, c) faces up when `((b−a)×(c−a)).y > 0`. Tolerances: positions ±1e-3, y ±1e-4.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | elevation all 0, no kerbs, no runoffs | `buildTrackSurfaces` | exactly 1 strip, `surface` 'asphalt'; 240 vertices, radial distances: one of each pair 94 and the other 106; every y = 0.02; `indices.length` = 720; every triangle faces up |
| AT2 | elevation[i] = 10·i/119, no kerbs/runoffs | asphalt strip | both vertices of point i (vertices 2i, 2i+1) have y = elevation[i] + 0.02 |
| AT3 | elevation 0, kerbs `[{start: 10, end: 30, side: 'left'}]` | strips | 2 strips; strip 1 `surface` 'kerb', 42 vertices, radial distances in {106, 107.2}, y = 0.04; uv of pair j (j = 0…20): u = 0 on the 106 vertex and 1 on the 107.2 vertex, v = j·c/1.5 ±1e-3; triangles face up |
| AT4 | elevation 0, runoffs `[{start: 50, end: 60, side: 'right', surface: 'gravel', widthMeters: 18}]`, no kerbs | strips | strip 1 `surface` 'gravel', 22 vertices, radial distances in {94, 76}, y = 0.01; triangles face up |
| AT5 | same runoff plus kerbs `[{start: 50, end: 60, side: 'right'}]` | strips | order: asphalt, kerb, gravel; kerb radial distances in {94, 92.8}; gravel radial distances in {92.8, 74.8} |
| AT6 | elevation 0, kerbs `[{start: 115, end: 5, side: 'right'}]` | kerb strip | 22 vertices (k = 11), all finite; its first pair is at point 115 (inner vertex within 1e-3 of 94·(cos, sin)(2π·115/120)); distance between inner vertices of consecutive pairs = 94/100·c ±1e-2 (continuous across index 0) |
| AT7 | kerbs `[{start: 7, end: 7, side: 'left'}]` | strips | only the asphalt strip (k = 1 produces nothing) |

## Acceptance criteria

- [ ] All rows in `tests/unit/acceptance/031-track-surfaces-geometry.test.ts` pass.
- [ ] Extra tests: right-side kerb mirrors left-side kerb; kerb of k points yields `2k` vertices; strip with k = 1 is dropped; all indices < vertex count.
- [ ] `src/track/surfaces.ts` imports no `three`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Barriers, terrain, trees (other tasks).
- Textures, materials, `three` geometries (render task 037).
- Colliders (task 032).
- Merging strips or LOD.
