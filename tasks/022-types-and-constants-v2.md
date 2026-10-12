# 022 — Add TrackData v2 types and Phase 1 constants

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

`src/core` exports the TrackData v2 types and the Phase 1 constants so later tasks can import them.

## Context

Closed design in `ai/guides/phase1.md` sections "TrackData v2" and "Constants". `ai/guides/architecture.md` for `TrackData`. `core` imports nothing.

## Files

- `src/core/types.ts` — modify — add the types
- `src/core/constants.ts` — modify — add the constants
- `tests/unit/acceptance/022-types-and-constants-v2.test.ts` — create by the acceptance role

## Steps

1. Append to `types.ts`, copied literally from `ai/guides/phase1.md` "TrackData v2": `Surface`, `Side`, `TrackSegment`, `RunoffSegment`, `BarrierSegment`, `Terrain`, `TreeSpecies`, `TreeInstances`, `Grandstand`, `PitLane`, `TrackDataV2`. Keep existing `TrackData` untouched. Segment `end` is inclusive.
   Also add the shared geometry type (render and physics import it from core, never from `track`):
   `export interface SurfaceStrip { surface: Surface; positions: Float32Array; indices: Uint32Array; uvs: Float32Array }`
   And add optional `shiftUp?: boolean; shiftDown?: boolean` to `DriverInput` (used by task 046; keeps the `types.ts` edits in this task).
2. Append to `constants.ts`, literally from `ai/guides/phase1.md` "Constants": `KERB_WIDTH`, `VERGE_WIDTH`, `BARRIER_GAP`, `CORNER_RADIUS`, `KERB_RADIUS`, `SURFACE_GRIP`, `SURFACE_DRAG`. Import `Surface` with `import type` from `./types`.

## Acceptance tests (defined by the planner with Opus, before coding)

Acceptance tests for this task are Vitest in `tests/unit/acceptance/`. Rows are copied verbatim; do not change them.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `src/core/types.ts` | import `TrackDataV2`, `Surface`, `Terrain` | compiles; a literal object matching ai/guides/phase1.md typechecks (tsc in test via a typed fixture) |
| AT2 | constants | read `SURFACE_GRIP` | asphalt 1, kerb 0.9, runoff 0.95, grass 0.45, gravel 0.35 |
| AT3 | constants | read `SURFACE_DRAG`, `KERB_WIDTH`, `VERGE_WIDTH`, `BARRIER_GAP`, `CORNER_RADIUS`, `KERB_RADIUS` | 0/0/0/0.15/0.6, 1.2, 4, 1, 400, 250 |

## Acceptance criteria

- [ ] All listed names, `SurfaceStrip` and the optional `DriverInput` fields are exported; existing exports unchanged.
- [ ] Acceptance tests pass; typecheck and lint clean.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Using the types anywhere else (031 builds `SurfaceStrip`s); changing `TrackData` or `PLACEHOLDER_CAR`.
