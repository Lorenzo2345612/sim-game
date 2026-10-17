# 245 — Kerbs never fold over the asphalt

Status: pending
Phase: 1
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
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
1. In `buildTrackSurfaces`, for each kerb row at index `idx` (including the one extension row either side that `segmentRows` adds) with `inner(idx, seg.side)`: `outer = min(half + KERB_WIDTH, INNER_CURVE_CLAMP · R(idx))`. If `outer − half < 0.4` the row is dropped.
2. Other rows (outer side, straights where `cornerCurvature` is null, outer ≥ half + 0.4) are byte-identical to today (lateral `half`..`half + KERB_WIDTH`, same y, u, v).
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
| AT1 | `STADIUM(30)` + kerbs | `buildTrackSurfaces` | kerb strip vertex positions identical to the pre-change build (record baseline by computing with lateral half..half+1.2) — every kerb vertex lateral offset from its row's centerline point is 6 or 7.2 (±1e-6) |
| AT2 | `STADIUM(7.5)` + kerbs | build | kerb vertices within 10 m of a bend centre ((200,−7.5) or (0,−7.5)): all at distance ≥ 0.75 − 1e-6 from that centre; at least one such vertex exists |
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

None verified by running the suite; no known fixture combines kerbs with R < ~8 m. If a protected test fails, do not edit it: report it under Questions.

## Questions for the planner

- `src/render/kerbOuterStrip.ts` draws a 0.6 m strip beyond `half + KERB_WIDTH` with its own geometry and will still fold on tight inner corners. Add it to a follow-up?
