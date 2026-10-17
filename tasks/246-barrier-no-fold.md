# 246 — Barriers never fold onto the inner kerb

Status: pending
Phase: 1
Depends on: 235
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11 (design `docs/design/track-fidelity.md`, "Wave 2")

## Goal

`barrierRuns` (and therefore barrier colliders and render) clamps the offset on the inside of corners and drops vertices that would land within the kerb band or on a track part, so walls no longer sit on kerbs.

## Context

Audit `docs/research/track-audit-kerbs.md` §3. Colliders and `createBarrierObject` already follow `barrierRuns`, nothing else to change there. `cornerCurvature` is exported from `src/track/surfaces.ts` by task 245; this task does not depend on 245, so export it here too if it is not exported yet (one-word change; skip it if already exported). Median walls (task 155) are untouched. No JSON rebuild.

## Files

- `src/track/barrierPath.ts` — modify: new clamp and drop rules.
- `src/track/surfaces.ts` — modify only to `export function cornerCurvature` if not yet exported.
- `tests/unit/acceptance/246-barrier-no-fold.test.ts` — create from the table; edge tests by tester-pre.

## Steps

Signatures unchanged (`barrierRuns(track: TrackDataV2, side: Side): BarrierVertex[][]`, `BarrierVertex` from 235).
1. For each non-median vertex at index `i` with `inner(i, side)` (corner `side` equals the barrier side): effective offset = `min(offsetMeters, 0.8 · R(i))`; x, z and y (bank lift) use the effective offset. If `0.8 · R(i) < half(side, i) + KERB_WIDTH + 0.5` the vertex is dropped.
2. Then drop every non-median vertex with `clearance < halfNear + KERB_WIDTH + 0.5` over all centerline indices (no `NEAR_INDEX_SPAN` exemption for this test). Use exact nearest-point distance (ties: lowest index); the existing grid works if its cell size is at least the largest threshold (no point found in the 3×3 cells ⇒ not dropped).
3. Runs split at dropped vertices and pieces under 2 vertices vanish, exactly as today. The existing `crossesTrack` rule stays. Median walls: `isMedianWall` vertices skip both new rules.

Conventions: distances in metres; drop tests strict (`<`); `cornerCurvature` null ⇒ no clamp; sides not mutated; no `three` import.

## Fixtures (tests)

- `STADIUM(R)`: closed loop, width 12, flat elevation 0, no terrain, no runoffs/barriers/sausages/kerbs unless the row adds them. Straight A (0,0)→(200,0) every 2 m (endpoint excluded); semicircle centred (200,−R) from (200,0) to (200,−2R), m = max(12, ceil(π·R)) points at angles π·j/m, j = 0..m−1; straight B (200,−2R)→(0,−2R) every 2 m; semicircle centred (0,−R) back to (0,0), same m. Every bend is a left turn (inside = left). Kerbs, when a row says "kerbs", cover every index on both sides.
- Shared definitions: `R(i)` = `cornerCurvature(centerline, i).radius` (`src/track/surfaces.ts`); `inner(i, side)` = that corner's `side` equals `side`; `half(side, i)` = `halfWidthAt(track, side, i)`; `clearance(p)` = XZ distance from p to the nearest centerline sample point (any index); `halfNear(p)` = min of both half-widths at that nearest index.
- "armco both sides, offset 12" = barriers `[{start: 0, end: n−1, side, type: 'armco', offsetMeters: 12}]` per side; "pre-change output" = recorded from the code before the edit (inline expected arrays or computed by the unchanged legacy logic in the test).
- 155 median-wall fixture = the one in `tests/unit/acceptance/155-close-parallel.test.ts` (reuse it by copy).
- "Every track" = every id in `public/tracks/index.json`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STADIUM(30)` + armco both sides, offset 12 | `barrierRuns` both sides | identical to the pre-change output (vertex count and x/z/y ±1e-9) |
| AT2 | `STADIUM(30)` + left armco offset 27 | barrierRuns('left') | vertices in the bends at distance 6 ± 1e-6 from the bend centre; straight vertices at offset 27 ± 1e-6 |
| AT3 | `STADIUM(8)` + left armco offset 12 | barrierRuns('left') | no vertex with `clearance < 7.7 − 1e-6`; ≥ 2 runs; right side (offset 12 outside) unchanged vs pre-change |
| AT4 | 155 median-wall fixture (existing test) | barrierRuns | unchanged vs pre-change |
| AT5 | every track in `public/tracks/index.json` | barrierRuns both sides | every non-median vertex `clearance ≥ halfNear + KERB_WIDTH + 0.5 − 1e-6` |
| AT6 | source `src/track/barrierPath.ts` | read | no `from 'three'` |

## Acceptance criteria

- [ ] AT1–AT6 pass; every existing barrier test (incl. 086, 155, 235) passes unchanged.
- [ ] No protected test file edited.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Trees, boards, street furniture and grandstands that read `offsetMeters` directly; builder `layoutBarriers`; barrier colour or style.
- JSON rebuild; QA report (249).

## Planner-authorised test edits

None verified by running the suite. If a protected test fails, do not edit it: report it under Questions.

## Questions for the planner

- `cornerCurvature` export clash with 245 (both add `export`): the later merge is a no-op. Confirm acceptable.
