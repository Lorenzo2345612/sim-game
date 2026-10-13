# 086 — Continuous barriers (no gaps between segments)

Status: pending
Phase: 1
Depends on: 043, 077
Complexity: complex
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Barrier colliders and meshes form one continuous wall per side: no hole between consecutive `BarrierSegment`s, even when their offsets differ.

## Context

Bug: `addBarrierWalls` (`src/physics/trackColliders.ts`) and `createBarrierObject` (`src/render/barrierRenderer.ts`) build every segment on its own, so the quad between a segment's last index e and the next segment's first index e+1 is missing (2 m hole, up to 14 m when offsets differ, e.g. 11 to 25 m; 54 such boundaries on Monza left). The user drove through one. Types (`TrackDataV2`, `BarrierSegment`, `Side`): `src/core/types.ts`. Right normal convention: `rightNormalAt` in `trackColliders.ts` (`[-dz, dx]/len` of `P[i+1]-P[i-1]`, fallback `[0,-1]`).

## Files

- `src/track/barrierPath.ts` — create — pure, no three, no Rapier.
- `src/physics/trackColliders.ts` — modify — `addBarrierWalls` builds quads from `barrierRuns`. Export `rightNormalAt` is NOT required; `barrierPath.ts` owns an equivalent private copy.
- `src/render/barrierRenderer.ts` — modify — rails/walls built from `barrierRuns`.
- `tests/unit/barrierPath.test.ts` — create — edge cases.

## Steps

```ts
import type { BarrierSegment, Side, TrackDataV2 } from '../core/types';
export interface BarrierVertex { index: number; x: number; z: number; y: number; type: BarrierSegment['type'] }
export function barrierRuns(track: TrackDataV2, side: Side): BarrierVertex[][];
```

- Vertex at index i = `centerline[i] + sign · offsetMeters(segment covering i) · rightNormal(i)`, sign +1 right / -1 left, `y = elevation[i] ?? 0`. If several segments of the side cover i, the last one in `track.barriers` wins. Coverage of a segment: indices `start..end` inclusive, wrapping modulo n.
- A run is a maximal sequence of consecutive covered indices (mod n); the connecting quad between index e and e+1 goes diagonally from offset A to offset B. A new run starts only where no segment covers the index.
- Closed run: if every index is covered, return one run of n vertices starting at index 0; it is closed (the consumer also connects last to first). Closed is defined as `run.length === track.centerline.length`.
- A run that wraps (e.g. covers 60..119 then 0..39) starts at its first covered index (60) and ends at 39. Runs with fewer than 2 vertices produce no quad.
- Collider quad between consecutive vertices: same wall bottom `-0.3` / top `+1.0` and same winding per side as today (normals face the track); still ONE trimesh collider, created only if at least one quad exists. Quad type = type of the second vertex (colliders ignore type).
- Renderer: rail (armco) and wall meshes take their quads from the runs (quad type = type of the second vertex); armco posts every 4 m and tyre stacks every 1 m are sampled along the spans of that type, as today. Visual dimensions unchanged (rail 0.45-0.75, wall 1.0 high x 0.3 thick). Mesh names unchanged (`armco`, `armcoPosts`, `tyres`, `wall`).

Conventions: no rounding; inclusive segment ends; empty `barriers` gives `[]`; never throws; `track` is not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | ring fixture R 100, N 120, width 12; left barriers [0..59] offset 10 and [60..119] offset 20 | barrierRuns(track,'left') | exactly 1 run of 120 vertices, closed; vertex 59 at radial distance 110 ± 1e-6, vertex 60 at 120 ± 1e-6 |
| AT2 | same fixture, left barriers [0..39] and [60..119] (indices 40..59 uncovered) | barrierRuns | exactly 1 run of 100 vertices starting at index 60 and ending at index 39 (wrap joined), not closed |
| AT3 | same fixture as AT1 in a Rapier world via addTrackColliders | horizontal ray from the centre-line point halfway between indices 59 and 60 (and between 119 and 0), y 0.5, pointing outward along the left normal, length 40, filtered to non-surface colliders (surfaceOf = null) | hits, toi in [10 − 0.5, 20 + 0.5] |
| AT4 | public/tracks/monza.json, spa.json, silverstone.json with addTrackColliders | for every centerline index i and both sides: ray from the midpoint of i and i+1 at elevation + 0.5, along the side's normal, length 45, filtered to surfaceOf = null | hits for 100 % of samples |
| AT5 | AT1 fixture | createBarrierObject | the barrier geometry has a triangle using a vertex at (index 59, radius 110) and one at (index 60, radius 120) (± 1e-3) |

## Acceptance criteria

- [ ] All AT rows pass; AT4 runs on `public/tracks/monza.json`, `spa.json`, `silverstone.json`.
- [ ] Existing tests still pass. Planner-authorised minimal edits to protected tests only if they fail strictly because of the new continuity (candidates: `tests/unit/edge/032-track-colliders.post.test.ts` POST2, `tests/unit/edge/032-track-colliders-edge.test.ts` EDGE5-EDGE8, `tests/unit/acceptance/038-barrier-render.test.ts`, `tests/unit/render/barrierRenderer.test.ts`). Report any edit.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Changing barrier layout generation (`027`), offsets, heights, materials, or tyre/armco visual style.
- Splitting the trimesh into several colliders or adding collision groups.
- Pit lane barriers, other track files.
