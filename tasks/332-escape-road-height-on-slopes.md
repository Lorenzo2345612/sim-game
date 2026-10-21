# 332 — Escape road height follows the track on steep slopes

Status: pending
Phase: 1
Depends on: none
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Escape roads on steep tracks sit flush with the runoff beside the kerb, so 301 AT1 passes on bathurst (maxGrade 0.2).

## Context

`escapeRoadStrips` (`src/track/surfaces.ts:579`) gives each road vertex the elevation and bank of the nearest centerline *vertex* by XZ distance. On bathurst (~15 % grade, ~2 m spacing) that is up to 0.6 m above the runoff near indices 1713–1820 (left), failing `tests/unit/acceptance/301-kerb-zone-steps-all-tracks.test.ts` AT1.

## Files

- `src/track/surfaces.ts` — modify `escapeRoadStrips` only
- `tests/unit/acceptance/332-escape-road-height.test.ts` — create (acceptance role)

## Steps

- Per road vertex: find the nearest centerline *segment* (closed loop) by XZ, project the vertex onto it (parameter t clamped to [0,1]); base = lerp of `elevation` at the segment ends + `RUNOFF_Y`; bank tan = lerp of `bankTanAt` at the ends; lateral offset measured along the lerped right normal. Same columns, rows, UVs and triangle topology as now.
- No change to any other strip, to the track builder or to track JSONs.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | straight synthetic track, 2 m spacing, constant grade 0.15, bank 0; escape road points on the centerline's left normal line at station s = 101 m (between vertices 50 and 51), 8–40 m out | `escapeRoadStrips` | every vertex y = 0.15·101 + RUNOFF_Y (±1e-4) |
| AT2 | flat track (grade 0, bank tan 0.05 constant) with an escape road | `escapeRoadStrips` | every vertex y = RUNOFF_Y + signed lateral offset·0.05 (±1e-4) |
| AT3 | every committed track | `buildTrackSurfaces` triangle counts | unchanged vs master (verification gate: 301 AT2) |
| AT4 | public/tracks/bathurst.json (maxGrade 0.2) | 301 AT1 | passes (verification gate) |
| AT5 | tracks without escape roads | `escapeRoadStrips` | returns `[]` |

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/332- tests/unit/acceptance/301-
```

## Out of scope

Escape-road detection/trimming, kerb, runoff or verge strips, any track data.
