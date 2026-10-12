# 031 — Build track surface geometry from TrackData v2

Status: pending
Phase: 1
Depends on: 022
Complexity: complex
Type: feature
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

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | straight fixture track width 12, elevation 0 | `buildTrackSurfaces` | asphalt strip 12 m wide at y 0.02; triangles face up |
| AT2 | fixture elevation rising 0→10 m | asphalt vertices | y = elevation + 0.02 at each point ±1e-6 |
| AT3 | one kerb on the left of indices 10–30 | kerb strip | lies between 6 and 7.2 m left of the centerline, y elevation + 0.04; uv.v advances 1 per 1.5 m |
| AT4 | gravel runoff 18 m right | strip | from 6 m (or 7.2 with kerb) to 24 m (or 25.2) right, tagged `gravel`, y + 0.01 |
| AT5 | wrapped segment (end < start) | strips | continuous across index 0, no NaN |

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
