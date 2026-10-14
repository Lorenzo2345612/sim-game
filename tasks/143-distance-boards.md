# 143 — Distance-to-corner boards (builder data + rendering)

Status: pending
Phase: 1
Depends on: 140
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Tracks carry static "200/150/100/50" distance boards before braking zones (builder data in the track JSON) and the game renders them beside the track facing approaching cars. This replaces task 124 (`tasks/124-braking-boards.md`, speed-profile based): do not implement or edit 124/126; 126's L3 will read `boards` from the track JSON.

## Context

M1.2c, design in `docs/plans/m1.2c-realism.md` ("142–143"). Reuse task 140's `classifyCorners(points): BrakingCorner[]` from `tools/track-builder/hazards.ts` (`BrakingCorner extends CornerRun { dropKmh }`; do NOT recompute speeds). `parseTrackData` (140, `src/track/parseTrackData.ts`) must default `boards` to `[]`. Barriers/kerbs come from the built track (after 142 kerbs and 140 foam). `KERB_WIDTH` = 1.2 (`src/core/constants.ts`). Render code may import `three`; use instancing, `dispose()`, no per-frame allocations. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`. e2e: `tests/e2e/acceptance/143-distance-boards.spec.ts`.

## Files

- `src/core/types.ts` — modify: add `Board`; `TrackDataV2.boards?: Board[]`.
- `src/track/parseTrackData.ts` — modify: default `boards` to `[]` for v2 (as 140 does for `escapeRoads`).
- `tools/track-builder/boards.ts` — create.
- `tools/track-builder/buildTrack.ts` — modify: compute boards after the final barriers, write `boards` (always, `[]` if none).
- `src/render/distanceBoards.ts` — create.
- `src/main.ts` — modify: add the boards to the scene, dispose with the session, `SceneStats.distanceBoards: number`.
- `public/tracks/*.json` — regenerate with `npm run build:tracks` for ALL ten ids in `tools/track-builder/tracks.json`.
- `tests/unit/acceptance/143-distance-boards.test.ts`, `tests/e2e/acceptance/143-distance-boards.spec.ts` — create (acceptance worker).
- Minimal planner-authorised edits to existing tests that fail only because of the new `boards` field (e.g. 097 AT3 field list: ignore `boards`).

## Steps

```ts
// types.ts
export interface Board { index: number; side: Side; offset: number; label: 50 | 100 | 150 | 200 } // offset: m from the centerline, positive outward on `side`
// boards.ts
export function boardOffset(halfWidth: number, outsideBarrierOffset: number): number;
export function buildBoards(points: Point2[], widthMeters: number, barriers: BarrierSegment[]): Board[];
// distanceBoards.ts
export interface DistanceBoards { group: THREE.Group; count: number; dispose(): void }
export function createDistanceBoards(track: TrackDataV2, makeAtlas?: () => THREE.Texture): DistanceBoards;
```

1. `boardOffset` = `max(half + KERB_WIDTH + 2, min(outsideBarrierOffset − 1, half + 6))`.
2. `buildBoards`: for each corner of `classifyCorners(points)`: labels 150, 100, 50 when `dropKmh ≥ 40`, plus 200 when `dropKmh ≥ 120`. Board position = arc length `cum[start] − label` along the closed centerline (m), `index` = nearest centerline index to that arc length. Skip the board if that position lies inside the previous corner run (from its `start` to its `end`, arc length, wrapping). `side` = opposite of the corner's turn side; `offset` = `boardOffset(widthMeters/2, offset of the barrier segment covering `index` on that side)`; if no barrier covers it use `half + 7`. Output sorted by `index`, then label descending.
3. `createDistanceBoards`: `track.boards ?? []`; one shared 4-cell canvas atlas (cells in order 200, 150, 100, 50; white face, black bold numerals) from `makeAtlas` (default canvas-based; tests inject a stub); faces 1.2 × 0.8 m plane, centre 1.2 m above the track elevation at `index`, plus a 0.08 × 1.2 × 0.08 m post; one `InstancedMesh` for posts and one per label for faces (UVs select the cell). Position = centerline point + right-normal (right of travel direction, central difference of neighbours) · (±`offset`: +right, −left). Face normal points opposite the travel direction (towards approaching cars). `count` = number of boards. `dispose()` frees geometries, materials and the atlas.
4. `main.ts`: only for v2 tracks; `stats.distanceBoards = count` (0 otherwise).

Conventions: arc length in metres, indices wrap with positive modulo; `dropKmh` thresholds inclusive (`≥ 40`, `≥ 120`); positions within 2 m of the label target are acceptable; skip rule inclusive of run bounds; inputs not mutated; deterministic.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rounded square: straights 600 m, arcs R 30 | build boards | 16 boards: per arc labels 200, 150, 100, 50 at run start − label (± 2 m along the centerline), all on the outside side |
| AT2 | same with arcs R 300 / R 500 | build boards | 12 boards (150/100/50 per arc) / none |
| AT3 | outside barrier offset 9, half 6 / offset 30, half 6 | board offset | 9.2 (= max(6 + 1.2 + 2, 8)) / 12 |
| AT4 | rebuilt monza.json | read | ≥ 18 boards; every board index lies on a straight or before a corner run start (never inside a corner run) |
| AT5 | e2e `/?track=monza` | ready | `sceneStats().distanceBoards` = boards in monza.json; `drawCalls()` ≤ 300; no console errors |

## Acceptance criteria

- [ ] AT1–AT5 pass.
- [ ] All ten tracks rebuild; centerline, elevation, kerbs, barriers unchanged by this task.
- [ ] A JSON without `boards` parses with `boards: []`; the renderer tolerates undefined.

## Verification

```
npm run build:tracks
npm run typecheck
npm run lint
npm test
npx playwright test 143-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Implementing, editing or deleting tasks 124/126; speed-profile or AI braking logic.
- Changing 140's classification thresholds; kerbs (142); collision for boards (no colliders).
- Board models beyond the plane + post; README, tasks.json, milestones.json.
