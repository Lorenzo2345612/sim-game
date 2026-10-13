# 096 — Close the gaps at kerb and run-off segment ends

Status: pending
Phase: 1
Depends on: 077
Complexity: complex
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer (complex adds tester-pre and tester)

## Goal

No terrain shows through (and no 0.13–0.26 m lip appears) between consecutive centerline rows at the start and end of kerb and run-off segments.

## Context

`buildTrackSurfaces` (`src/track/surfaces.ts`) builds each kerb/run-off segment as its own strip from row `start` to row `end`. Between row `end` and `end + 1` (and `start − 1` and `start`) nothing covers the band beside the asphalt, so the terrain heightfield (elevation − 0.15) is exposed: a wedge the car drops into and hits as a step on the way back. Found while verifying task 077 (e.g. Monza kerb right 294..328 at i = 328, Silverstone runoffs left 75..109 / 81..187 at i = 80). Colliders are built from the same strips (`addTrackColliders`), so fixing the strips fixes physics too.

## Files

- `src/track/surfaces.ts` — modify
- `tests/unit/track/surfaceTransitions.test.ts` — create (edge cases)
- Planner-authorised minimal edits, only where a count/radius changes because of the extra rows: `tests/unit/acceptance/031-track-surfaces-geometry.test.ts`, `tests/unit/acceptance/037-track-surface-render.test.ts`, `tests/unit/edge/031-*.test.ts`, `tests/unit/track/surfaces.test.ts`

## Steps

- Every kerb and run-off strip gets one extra row before `start` (index start − 1) and one after `end` (index end + 1), wrapping around the ring; the extra rows use the segment's own lateral extents and height rule evaluated at that index. A segment covering the whole ring (or whose extension would overlap itself) gets no extra rows.
- `v` (along-track UV) continues linearly into the extra rows (negative before `start` is fine).
- Asphalt, verges (077) and everything else unchanged.

Conventions: wrapped indices via the existing `normIndex`; inputs not mutated; strip order unchanged.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | ring fixture of 031 (R 100, N 120, width 12), left gravel runoff [10..30] width 12, no kerbs | buildTrackSurfaces | the gravel strip has 23 rows (46 vertices) covering indices 9..31; rows 9 and 31 at radial distances 106 and 118 (± 1e-5) |
| AT2 | same ring, left gravel runoffs [10..30] width 12 and [31..50] width 18, in a Rapier world via addTrackColliders | downward ray at the chord midpoint of rows 30/31 at left lateral 6.5, 12 and 17.5 m | each hits a collider with surfaceOf = 'gravel' (not the terrain heightfield) |
| AT3 | ring, left kerb [0..119] (whole ring) | buildTrackSurfaces | kerb strip has exactly 120 rows (no extension) |
| AT4 | public/tracks/monza.json, spa.json, silverstone.json with addTrackColliders | for every index i and both sides: downward rays at the chord midpoint of i and i+1 (right normal at i), lateral from half + 0.1 m to the smaller kerb/run-off outer extent of i and i+1, every 0.5 m; skip samples whose nearest centerline index is more than 3 from i and barrier hits; a heightfield hit counts only when a ray ignoring the heightfield finds no strip below (terrain above strips is task 097) | at most 2 exposed samples per track |

## Acceptance criteria

- [ ] AT1–AT4 pass; all other tests pass (protected tests edited only as listed in Files).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Tapering run-off widths, changing kerb/run-off data in `public/tracks/*.json`, verge logic, rendering materials.
