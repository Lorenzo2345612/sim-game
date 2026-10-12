# 023 — Add inverse projection unprojectXZ

Status: done
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

`src/track/geo.ts` can convert local metres `[x, z]` back to `[lon, lat]`.

## Context

Projection is in `ai/guides/architecture.md` "Track data" (equirectangular, `R = EARTH_RADIUS_M`, `x = (lon-lon0)·cos(lat0)·R·π/180`, `z = -(lat-lat0)·R·π/180`). Reuse existing `LonLat`, `Point2`, `EARTH_RADIUS_M`.

## Files

- `src/track/geo.ts` — modify — add the function
- `tests/unit/acceptance/023-geo-unproject.test.ts` — create by the acceptance role

## Steps

1. Export `function unprojectXZ(point: Point2, origin: LonLat): LonLat` — exact inverse of `projectLonLat` for one point.
2. Do not change existing exports. No allocation beyond the returned tuple.

## Acceptance tests (defined by the planner with Opus, before coding)

Acceptance tests for this task are Vitest in `tests/unit/acceptance/`. Rows are copied verbatim; do not change them.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | origin [9.28, 45.62] | `unprojectXZ(projectLonLat([[9.281, 45.621]], o)[0], o)` | returns [9.281, 45.621] ±1e-9 |
| AT2 | origin [0, 0] | `unprojectXZ([0, -111195.08], [0,0])` | [0, 1] ±1e-6 (north = −Z) |
| AT3 | 100 random points within ±0.05° of Spa origin | round trip | max error < 1e-9° |

## Acceptance criteria

- [ ] Round trip error < 1e-9 degrees.
- [ ] typecheck, lint and tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Batch variants, ellipsoidal formulas, any other file.
