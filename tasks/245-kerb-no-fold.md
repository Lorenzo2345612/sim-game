# 245 — Kerbs never fold over the asphalt

Status: pending
Phase: 1
Depends on: nothing
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11 (design `docs/design/track-fidelity.md`, "Wave 2")

## Goal

Kerb strips on the inside of a tight corner are capped by the corner radius (and dropped when too thin), so no kerb triangle lies on asphalt. Render and physics both use `buildTrackSurfaces`, so both change.

## Context

Audit `docs/research/track-audit-kerbs.md` §1: kerb ribbons use constant lateral `half .. half + KERB_WIDTH` and fold past the centre of curvature in corners with R below about 7.2 m (city hairpins). Verified: `src/physics/trackColliders.ts` builds kerb colliders from `buildTrackSurfaces(track)`, so no second code path. Runoff/verge already clamp with `INNER_CURVE_CLAMP = 0.9` in the same file. No JSON rebuild.

## Files

- `src/track/surfaces.ts` — modify: `export` the existing `cornerCurvature`; apply the kerb rule.
- `tests/unit/acceptance/245-kerb-no-fold.test.ts` — create from the table; edge tests by tester-pre.

## Steps

```ts
export function cornerCurvature(cx: [number, number][], i: number): { side: Side; radius: number } | null  // existing, now exported
```
1. In `buildTrackSurfaces`, for each kerb row at index `idx` (including the one extension row either side that `segmentRows` adds) with an effective inner radius `Reff(idx, seg.side)` (see Planner answers, neighbourhood minimum): `outer = min(half + KERB_WIDTH, INNER_CURVE_CLAMP · Reff)`. If `outer − half < 0.4` the row is dropped.
2. Other rows (no inner corner within the window, or outer ≥ half + KERB_WIDTH after the cap) are geometrically identical to today (lateral `half`..`half + KERB_WIDTH`, same y, u, v).
3. Dropping rows splits a segment's strip: each maximal run of kept consecutive rows with ≥ 2 rows becomes its own `kerb` strip carrying the same `segment: {kind: 'kerb', index}`; `v` coordinates keep the values they would have had unsplit. Implement by giving `segmentRows` an optional row filter and emitting one strip per run.
4. The kerb exemption in `filterStripTriangles` stays unchanged.

Conventions: lateral values in metres; drop threshold `< 0.4` strict (outer − half = 0.4 keeps the row); `R` from `cornerCurvature` (null ⇒ rule not applied); `buildTrackSurfaces` does not mutate its input; no `three` import.

## Fixtures (tests)

- `STADIUM(R)`: closed loop, width 12, flat elevation 0, no terrain, no runoffs/barriers/sausages/kerbs unless the row adds them. Straight A (0,0)→(200,0) every 2 m (endpoint excluded); semicircle centred (200,−R) from (200,0) to (200,−2R), m = max(12, ceil(π·R)) points at angles π·j/m, j = 0..m−1; straight B (200,−2R)→(0,−2R) every 2 m; semicircle centred (0,−R) back to (0,0), same m. Every bend is a left turn (inside = left). Kerbs, when a row says "kerbs", cover every index on both sides.
- Shared definitions: `R(i)` = `cornerCurvature(centerline, i).radius` (`src/track/surfaces.ts`); `inner(i, side)` = that corner's `side` equals `side`; `half(side, i)` = `halfWidthAt(track, side, i)`; `clearance(p)` = XZ distance from p to the nearest centerline sample point (any index); `halfNear(p)` = min of both half-widths at that nearest index.
- "Every track" = every id in `public/tracks/index.json`, loaded with `parseTrackData` from `public/tracks/<id>.json`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STADIUM(30)` + kerbs | `buildTrackSurfaces` | kerb strip vertex positions identical to the pre-change build (record baseline by computing with lateral half..half+1.2) — every kerb vertex lateral offset from its row's centerline point is 6 or 7.2 (±1e-4, Float32 storage) |
| AT2 | `STADIUM(7.5)` + kerbs | build | kerb vertices within 10 m of a bend centre ((200,−7.5) or (0,−7.5)): all at distance ≥ 0.75 − 1e-4 from that centre (Float32); at least one such vertex exists |
| AT3 | `STADIUM(7)` + kerbs | build | no kerb vertex within 6.5 m of a bend centre (inner kerb dropped in both bends); outer-side kerb rows in the bends still present (vertices at 13 and 14.2 m ± 1e-6 from the centre) |
| AT4 | `STADIUM(30)`, `STADIUM(7.5)`, `STADIUM(7)` + kerbs | build | every kerb triangle centroid has `clearance ≥ 6 − 1e-6` |
| AT5 | every track in `public/tracks/index.json` | build | every kerb triangle centroid has `clearance ≥ halfNear − 0.3` |
| AT6 | source `src/track/surfaces.ts` | read | no `from 'three'` |

## Acceptance criteria

- [ ] AT1–AT6 pass; every existing surfaces, collider and kerb test passes unchanged.
- [ ] No protected test file edited.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Kerb rendering elsewhere (`src/render/kerbOuterStrip.ts` outer colour strip, `src/track/markings.ts`): not changed here.
- Builder kerb detection (`detectKerbs`), JSON rebuild, runoff/verge rules, QA report (249).

## Planner-authorised test edits

- `tests/unit/acceptance/245-kerb-no-fold.test.ts` AT1: tolerance 1e-6 → 1e-4 (table updated; Float32 positions).
- `tests/unit/edge/245-kerb-no-fold.test.ts` EDGE2: identify a row's inner vertex by its lateral offset (smallest distance to the row's centerline point), not by vertex order.
- `tests/unit/edge/245-kerb-no-fold.test.ts` EDGE7: the 0.9·R rule is a cap — assert no outer-strip vertex beyond `0.9·R + 1e-6` from the circle centre on inner rows, instead of a vertex exactly at 0.9·R.
- `tests/unit/acceptance/245-kerb-no-fold.test.ts` AT2: tolerance 1e-6 → 1e-4 (table updated; measured 0.7499981, Float32).
- `tests/unit/edge/245-kerb-no-fold.test.ts` EDGE2, EDGE3, EDGE7: expected row counts and bounds use `Reff` (minimum radius within ±10 m arc, same side) instead of the local radius, since tester-pre wrote them before the neighbourhood rule (e.g. EDGE2/EDGE3 expect 202 rows, Reff drops to 182; EDGE7 lower bound 15.2999 vs 15.2918). Compute expectations from the same rule, do not hard-code the new numbers.
- No other acceptance or edge edits: AT3, AT5 must pass with the neighbourhood-minimum radius below.

## Questions for the planner

- `src/render/kerbOuterStrip.ts` draws a 0.6 m strip beyond `half + KERB_WIDTH` with its own geometry and will still fold on tight inner corners. Add it to a follow-up?

## Planner answers

- In scope: apply the same rule to `src/render/kerbOuterStrip.ts` — no strip on dropped kerb rows; on inner rows its outer edge is clamped to `0.9·R(i)` and the row is dropped when the remaining width < 0.1 m. Extend AT4/AT5's centroid check to the outer-strip triangles in a unit test (not an acceptance edit).
- Neighbourhood minimum (fixes junction and apex-adjacent rows, decision 245-coder): `Reff(i, side)` = min of `cornerCurvature(centerline, j).radius` over every j whose arc distance to i (wrapping) is ≤ 10 m and whose corner side equals `side`; when no such j exists the row is not an inner row and stays unchanged. Use `Reff` for the kerb rule (Step 1) and for `kerbOuterStrip` (cap `outer ≤ 0.9·Reff`). Precompute per index once per build (no per-row window scan in render loops). Straight rows next to a bend therefore get clamped or dropped too; this is intended (AT3: inner kerb fully gone around a R 7 bend).

## Planner answers (round 7, supersedes the EDGE7 note above)

Implementation is close; 4 tests left. Work in small steps, one test at a time, and run only that test after each edit.
1. AT2: apply the authorised edit now — threshold `0.75 - 1e-4` (the test still uses 0.749999).
2. EDGE2/EDGE3: authorised to set the expected vertex count to 182 (Reff drops 5 more rows each side: 10 m window at 2 m spacing) with a one-line comment saying so; no computed helper needed.
3. EDGE7: keep the `15.3 - 1e-4` bound and the `outerSide > 0` check (no test edit). My earlier note was wrong: in `circle(7.5)` the right (outer) kerb rows are not inner rows, so Reff must not touch them. A vertex at 15.2918 is an `src/render/kerbOuterStrip.ts` bug: print the offending row index, then check the closed-loop wrap / run-end rows (point normal vs segment normal) and that the outer side uses `half + KERB_WIDTH .. + 0.6` unchanged.
4. Then run the full 245 acceptance + edge files and `tests/unit/render/kerbOuterStripClearance.test.ts`, then `npm test`.

## Planner answers (round 8, final; supersedes round-7 item 3)

Planner error: in `circle(7.5)` the outer strip spans radial 14.7..15.3, so `>= 15.3` can never hold. Do exactly these edits, then stop thinking and run the tests:
1. EDGE7 `both` loop: `toBeGreaterThanOrEqual(14.7 - 1e-4)` and add `toBeLessThanOrEqual(15.3 + 1e-4)`; count `outerSide` with `Math.abs(d - 15.3) < 1e-2`. Nothing else in EDGE7. No `src/` change for EDGE7.
2. AT2: `0.75 - 1e-4`.
3. EDGE2 and EDGE3: expected vertex count 182 (comment: "Reff drops 5 more rows each side").
4. Run the three 245 test files, then `npm test`, then write the report. Budget: 10 minutes; no exploration beyond these files.

## Planner answers (round 9)

All authorised, nothing else; no `src` change beyond what is already done:
- `tests/unit/edge/245-kerb-no-fold.test.ts:191`: expected `left[0].uvs[1]` = v of the first kept row (6.667 for s = 10), tolerance 1e-3.
- `tests/unit/edge/245-kerb-no-fold.test.ts:304`: lower bound 14.7 − 1e-2 (same tolerance as `outerSide`).
- `tests/unit/edge/174-track-banking-edge.test.ts` EDGE8: expected kerb row count = the count after the 10 m Reff drop on the R = 3.2 fixture (measure, list old/new in the report). 240 AT9 follows.
- `tests/unit/acceptance/176-track-geometry-overlaps.test.ts` AT3: exclude centerline indices where kerb rows were dropped by the Reff rule (lasvegas ~1084); list excluded indices in the report.
- `tests/unit/acceptance/096-surface-transitions.test.ts` (~255): exclude rows where the kerb was clamped to 0.9·Reff from the exposed count; the 3-exposed tolerance stays for all other rows.
- 253 AT6: not yours (task 256).
