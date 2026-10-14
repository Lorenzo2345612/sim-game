# 124 — Braking marker boards

Status: pending
Phase: 2
Depends on: 088, 123
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Distance boards "150", "100" and "50" appear before every heavy braking zone of the track.

## Context

Design: `docs/plans/game-features.md` section 124. Braking zones = maximal runs of brake points from `lineActions` (123, `src/ai/lineActions.ts`; if 123 is not merged, reimplement nothing: depend on it being present). Profile from `speedProfile` (088), line from `computeRacingLine` (087, `RacingLine` in `src/ai/racingLine.ts`, `mengerCurvature` signed + = right). Track data `TrackDataV2` (`widthMeters`, `centerline`) in `src/core/types.ts`. Render code may import `three`; instanced meshes, canvas textures, `dispose()`. e2e: `tests/e2e/acceptance/124-braking-boards.spec.ts`.

## Files

- `src/ai/brakeMarkers.ts` — create.
- `src/render/brakeBoards.ts` — create.
- `src/main.ts` — modify: add boards to the session (disposed with it); `sceneStats().brakeBoards: number`.
- `tests/unit/acceptance/124-braking-boards.test.ts` — acceptance worker.

## Steps

```ts
export interface BrakeMarker { distance: number; label: 150 | 100 | 50 }
export function brakeMarkers(speeds: Float64Array, dist: Float64Array, length: number): BrakeMarker[];
export function createBrakeBoards(markers: BrakeMarker[], line: RacingLine, track: TrackDataV2, y: (x: number, z: number) => number): { object: THREE.Object3D; count: number; dispose(): void };
```

1. `brakeMarkers`: zones = maximal runs of points with action brake (wrapping; a run crossing the end is one zone). Keep zones with `speeds[start] − min(speeds in zone) > 15` m/s. For each, markers at `(dist[start] − label) mod length` for labels 150, 100, 50. Sorted by `distance` ascending (ties: label descending).
2. `createBrakeBoards`: one `InstancedMesh` of board quads 1.2 × 0.8 m on 1.2 m posts per label (3 meshes, one canvas texture each: white text on dark background); position: line point at the marker distance, moved sideways to 1.5 m beyond the track edge (`widthMeters/2 + 1.5` from the centerline) on the OUTSIDE of the next corner (opposite to the turn direction at the zone's minimum-speed point: curvature + = right turn → board on the left), facing against the direction of travel.
3. Draw calls added ≤ 6 (posts + boards per label).

Conventions: threshold strict (`> 15`); distances in metres, wrapped into [0, length); empty/constant profile returns `[]`; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rounded square (087 AT2) with 088 profile (muLat 1.5) | brakeMarkers | 12 boards (3 per corner), each label at zone start − label ± 2 m |
| AT2 | profile with one 10 m/s drop zone | brakeMarkers | [] |
| AT3 | e2e monza | sceneStats().brakeBoards | ≥ 18 (6+ heavy braking zones) and drawCalls ≤ 300 |

## Acceptance criteria

- [ ] AT1–AT3 pass.
- [ ] Boards and their textures disposed with the session (no leak on track change).

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Driving line (123), lesson logic (126), per-car board styles, boards for pit entry.
