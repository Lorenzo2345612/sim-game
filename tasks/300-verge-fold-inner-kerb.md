# 300 — Verge and runoff strips must not fold over the inner kerb

Status: pending
Phase: 2
Depends on: nothing
Complexity: complex
Type: bugfix
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

No grass, verge or runoff triangle rises above the kerb next to it, so driving over the inner kerb never meets a hidden ramp.

## Context

`buildTrackSurfaces` (`src/track/surfaces.ts`) clamps lateral ribbons per row (`INNER_CURVE_CLAMP`) but a row's verge/runoff can land on another part of the lap's kerb zone. The existing `nearAsphalt` filter only covers half-width − 1 m, not the kerb band. Measured: mexico left indices 1873–1881 (lap 3746–3762 m), a verge triangle from row 1903 lies over the kerb and rises from +0.04 at 1 m past the asphalt edge to +0.35 m at 3 m; monza 326–327 left a 0.10 m runoff step 1.4 m beyond the kerb; monza 307–309 right a grass ramp to +0.25 m at 6 m. Cleveland is clean.

## Files

- `src/track/surfaces.ts` — modify — after building the strips, drop (or split) every non-asphalt, non-kerb triangle with any point (vertices or centroid) inside the band `distance to centerline point j < halfWidthAt(side, j) + KERB_WIDTH + 0.3` of a row j that is not within `INNER_ARC_WINDOW` metres of the triangle's own row. Same idea as `filterStripTriangles`; extend it, do not add a second pass.
- `tests/unit/acceptance/300-verge-fold-inner-kerb.test.ts` — create (acceptance worker).
- Any frozen test whose triangle counts change: list it in a decision with old/new numbers; do not edit it.

## Acceptance tests (defined by the planner with Opus, before coding)

Probe = downward ray (`createPhysicsWorld(track)`, all colliders) at the point `centerline[i] + side normal × (halfWidthAt(side, i) + KERB_WIDTH + d)`; kerb edge y = ray hit y at `d = −0.05`.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | mexico, left, i ∈ 1873..1881 | probe d ∈ {0.5, 1, 2, 3} | hit y − kerb edge y ≤ 0.05 m |
| AT2 | monza, left i ∈ {326, 327} and right i ∈ {307, 308, 309} | probe d ∈ {0.5, 1, 2, 3, 5} | hit y − kerb edge y ≤ 0.05 m |
| AT3 | mexico, monza, cleveland: every index i where `hasKerb(track, side, i)` and `cornerCurvature` puts `side` on the inside with radius < 200 m | probe d ∈ {0.5, 1, 2} | hit y − kerb edge y ≤ 0.10 m |
| AT4 | the same three tracks | `buildTrackSurfaces` | asphalt and kerb strips are byte-identical to before (positions and indices) |

## Acceptance criteria

- [ ] AT1–AT4 pass; `npm test` has no new failures.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/300- tests/unit/acceptance/031- tests/unit/acceptance/096- tests/unit/acceptance/097- tests/unit/acceptance/155- tests/unit/acceptance/176- tests/unit/acceptance/183-
```

## Out of scope

- Track JSON, the track-builder, terrain heightfield, barriers, sausages (task 299).
