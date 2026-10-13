# 082 — Painted track markings (edge lines, start/finish line)

Status: pending
Phase: 1
Depends on: 080
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

White edge lines and a start/finish line are drawn on the asphalt, render-only (no physics).

## Context

Strip geometry conventions are in `src/track/surfaces.ts` (asphalt at y = elev + 0.02, closed loop, s cumulative from point 0, right normal = towards the circle centre on the fixture). Types in `ai/guides/architecture.md`. Markings must never reach `addTrackColliders`.

## Files

- `src/track/markings.ts` — create — pure geometry.
- `src/render/trackMarkingsRenderer.ts` — create — mesh builder.
- `src/main.ts` — modify — add markings next to the surfaces.
- `tests/unit/acceptance/082-track-markings.test.ts` — create (acceptance worker).

## Steps

```ts
import type { SurfaceStrip, TrackDataV2 } from '../core/types';
export function buildTrackMarkings(track: TrackDataV2): SurfaceStrip[];
export function createTrackMarkingsObject(strips: SurfaceStrip[]): { group: THREE.Group; dispose(): void };
```

1. `buildTrackMarkings`: strips in order: left edge line, right edge line, start line. Edge line covers lateral [half − 0.12, half] on its side (`half = widthMeters / 2`), closed loop over the whole centerline, y = elevation[i] + 0.025. Start line spans lateral −half..half, from s = 0 to s = 0.6 m (two rows, interpolated along the first centerline segment), y = elev(0) + 0.025. Reuse the lateral/normal convention of `buildTrackSurfaces` (export a helper from surfaces.ts only if unavoidable; otherwise recompute locally). The `surface` field is `'asphalt'` (render-only; these strips are never passed to physics). uv = (lateral/10, s/10).
2. Empty centerline returns `[]`; input not mutated.
3. `createTrackMarkingsObject`: one merged mesh named `'markings'` in a group; `MeshStandardMaterial` colour (0.95, 0.95, 0.95), roughness 0.6, `polygonOffset: true`, `polygonOffsetFactor: -1`; `dispose()` releases geometry and material once.
4. `main.ts`: for v2 tracks add `createTrackMarkingsObject(buildTrackMarkings(track))` to the scene next to the surfaces; not passed to `addTrackColliders`.

Conventions: no rounding; closed loop like asphalt; no new per-frame allocations.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/082-track-markings.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | circle fixture (R 100, N 120, width 12, flat) | buildTrackMarkings | two edge-line strips; left line vertices at radial 105.88 and 106 (± 1e-6), right line at 94 and 94.12; y = 0.025 |
| AT2 | same | start line strip | spans lateral −6..6 and arc length 0..0.6 m (± 1e-6) |
| AT3 | any track | addTrackColliders | collider count unchanged vs before this task (markings never create colliders) |
| AT4 | markings strips | renderer | group has a mesh named 'markings' whose material has polygonOffset true and colour r,g,b ≥ 0.9 |

(The former AT5 "monza loads without console errors" is covered by the existing e2e 056/020 checks.)

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Dashed/grid-box/pit-lane markings, textures for lines, colliders or grip for markings, changes to `buildTrackSurfaces` output or `addTrackColliders`.
