# 300 — Verge and runoff strips must not fold over the inner kerb

Status: pending
Phase: 2
Depends on: nothing
Complexity: complex
Type: bugfix
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

No grass, gravel, verge or runoff triangle rises above the kerb next to it, so driving over the inner kerb never meets a hidden ramp.

## Context

`buildTrackSurfaces` (`src/track/surfaces.ts`) clamps lateral ribbons per row (`INNER_CURVE_CLAMP`), but a row's verge/runoff/gravel can land over another row's kerb zone; the existing `nearAsphalt` filter only covers half-width − 1 m, not the kerb band. Measured rise of the first non-kerb surface above the kerb outer edge, within 0.5–2 m past it (sausages excluded): mexico right 1028–1039 grass +0.41–0.55 m, 1364r/1533r gravel +0.16, 1483l runoff +0.18, left 1875–1878 grass +0.16–0.29; monza right 304–306 gravel +0.38–0.42, left 322 runoff +0.40; cleveland right 207–217 grass +0.22–0.46, 668r grass +0.46, 1580l runoff +0.17; detroit 77 kerbed rows, left 150–162, 364–365, 668–688 grass +0.16–0.86. A car using the full kerb hits these like a wall.

## Files

- `src/track/surfaces.ts` — modify — in the strip post-filter (`filterStripTriangles`), a non-asphalt, non-kerb triangle lying (any vertex or centroid) within `halfWidthAt(side, j) + KERB_WIDTH + 2` m of a centerline row j outside `INNER_ARC_WINDOW` m of its own row, and higher there than that row's kerb outer edge + 0.05 m, is dropped. Do not add a second pass; asphalt and kerb strips are untouched.
- `tests/unit/acceptance/300-verge-fold-inner-kerb.test.ts` — create (acceptance worker).
- Frozen tests whose triangle counts change: list them in a decision with old/new numbers; do not edit them.

## Acceptance tests (defined by the planner with Opus, before coding)

Probe: world `createPhysicsWorld({ ...track, sausages: [] })`, stepped twice; downward ray at `centerline[i] + n_side × (halfWidthAt(side, i) + KERB_WIDTH + d)`, `n_side` = right normal (central difference) for `'right'`, its negative for `'left'`. Rise(d) = hit y(d) − hit y(−0.05).

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | mexico right i ∈ 1028..1039, left i ∈ 1875..1878; cleveland right i ∈ 207..217 and 668 | probe d ∈ {0.5, 1, 2} | rise ≤ 0.10 m |
| AT2 | monza right i ∈ 304..306, left i = 322; detroit left i ∈ 150..162, 364..365, 668..688 | probe d ∈ {0.5, 1, 2} | rise ≤ 0.10 m |
| AT3 | mexico, monza, cleveland, detroit: every i and side with `hasKerb(track, side, i)` | probe d ∈ {0.5, 1, 2} | rise ≤ 0.20 m everywhere |
| AT4 | the same three tracks | `buildTrackSurfaces`, triangle count per surface | asphalt / kerb counts unchanged: mexico 4306 / 3458, monza 5788 / 4020, cleveland 3426 / 2804 |

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
