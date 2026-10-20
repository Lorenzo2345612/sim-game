# 301 — No kerb-zone steps on any track

Status: pending
Phase: 2
Depends on: 300
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Task 300's kerb-zone rule holds on every track, not only the four it measured.

## Context

Same probe as task 300, extended to all tracks with a bank allowance. Measured on master before 300 (rows with rise > 0.10 m; worst rise in m): bahrain 12 (0.60), baku 66 (1.51), braselton 12 (1.26), budapest 1 (0.51), daytona 1 (0.19), ermita-centro 1 (0.51), ermita-federal 5 (1.26), ermita-mixto 9 (0.76), ermita-poniente 3 (0.49), ermita-veloz 61 (2.17), fontana-roval 84 (0.86), fontana 37 (0.59), lasvegas 74 (0.67), lusail 1 (0.46), sepang 9 (3.22), silverstone 2 (0.39), singapore 200 (1.09), spa 3 (1.61), spielberg 28 (3.06); elkhart and ermita-norte clean. If 300's rule leaves rows failing, find which strip (escape road, gravel, verge, runoff) produces them and extend the same filter; do not add special cases per track.

Planner measurement 2026-10-19 (worktree after two coder runs): with the rule below only braselton right 1746 fails (runoff 0.24 m above the kerb edge). Every other excess (50 probes) had its edge probe on terrain: rows whose kerb is dropped in a tight-bend pocket, so there is no kerb edge to measure; those are out of scope here (follow-up task). lasvegas left 2545 hits another kerb ribbon, which AT2 pins.

## Files

- `src/track/surfaces.ts` — modify — only if 300's filter does not already cover all rows.
- `tests/unit/acceptance/301-kerb-zone-steps-all-tracks.test.ts` — create (acceptance worker).
- Planner-authorised edit of that test, nothing else: import `surfaceOf` from `src/physics/trackColliders`; in `probeY` also return the hit collider's surface; in `excesses` skip the row (no violation) when the edge probe's surface is not `'kerb'`, and skip a d probe when its hit surface is `'kerb'`.
- Revert the whole existing worktree diff in `surfaces.ts` (the `kerbBandQuery` change and the `raw` parameter): not needed.
- Planner decision 2026-10-19 (reviewer round): no `src` change in this task. Revert every worktree diff in `src/`. The only remaining violation, braselton right 1746, is an escape-road mouth (`escapeRoadStrips` height uses the road point's nearest centerline index, pinned by 141 EDGE2 and the 097 terrain bake); it is a known exception for a follow-up task. Planner-authorised test edit: AT1 skips exactly `braselton right 1746` with a comment naming this follow-up.

## Acceptance tests (defined by the planner with Opus, before coding)

Probe as in task 300 (world without sausages, stepped twice, downward ray at kerb outer edge + d). Excess(d) = rise(d) − d × |bankTanAt(track, i)|.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | every `public/tracks/*.json` that is a track (skip `*.style.json`, `*-env.json`) | for every i, side with `hasKerb` whose edge probe hits a `kerb` collider, probe d ∈ {0.5, 1, 2} ignoring hits on `kerb` | excess ≤ 0.20 m (except braselton right 1746, escape-road follow-up) |
| AT2 | the same tracks | `buildTrackSurfaces` | asphalt and kerb triangle counts equal to master before this task (store them in the test as literals computed once) |

## Acceptance criteria

- [ ] AT1–AT2 pass; `npm test` has no new failures.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/300- tests/unit/acceptance/301- tests/unit/acceptance/031- tests/unit/acceptance/096- tests/unit/acceptance/097- tests/unit/acceptance/155- tests/unit/acceptance/176- tests/unit/acceptance/140- tests/unit/acceptance/141- tests/unit/acceptance/174- tests/unit/acceptance/248- tests/unit/edge/141- tests/unit/edge/097- tests/unit/edge/300-
```

## Out of scope

- Track JSON, track-builder, terrain, barriers, sausages, per-track exceptions.
