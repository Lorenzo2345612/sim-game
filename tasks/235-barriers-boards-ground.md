# 235 — Barriers and distance boards reach the ground

Status: pending
Phase: 1
Depends on: 233
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11 (design `docs/design/track-fidelity.md`)

## Goal

Barrier walls (physics and render) and distance-board posts extend between the track plane and the terrain under them instead of floating or sinking.

## Context

Line objects keep their current `y` and extend: bottom = `min(y, ground)`, top = `max(y, ground)` + their height. `ground` = `groundHeightAt(track, x, z)` from `src/track/ground.ts` (233) when `track.terrain` exists, else exactly `y`.

## Files

- `src/track/barrierPath.ts` — modify: `BarrierVertex` gains `ground`
- `src/physics/trackColliders.ts` — modify: wall quad bottom/top
- `src/render/barrierRenderer.ts` — modify: `PathPoint` gains `ground`; wall and fence stretch
- `src/render/distanceBoards.ts` — modify: face and post
- `src/render/streetFurniture.ts` — only if it builds `BarrierVertex` objects itself (today it only reads `x, y, z`: expected untouched)
- `tests/unit/acceptance/235-barriers-boards-ground.test.ts` — create from the table

## Steps

```ts
export interface BarrierVertex { index: number; x: number; z: number; y: number; ground: number; type: BarrierSegment['type'] }
```

1. `barrierRuns`: each vertex `ground = track.terrain ? groundHeightAt(track, x, z) : y`. `y` and all run/drop logic unchanged.
2. Colliders: per vertex bottom = `min(y, ground) + WALL_BOTTOM`, top = `max(y, ground) + WALL_TOP` (existing constants).
3. `createBarrierObject`: with `lo = min(y, ground)`, `hi = max(y, ground)` per path point: wall quads span `lo` to `hi + WALL_HEIGHT` (wall band at `hi + WALL_BAND_LOW`); fence quads span `lo` to `hi + h`; rail, armco posts, tyre rows and foam blocks are placed at `hi` (foam block base at `hi`).
4. `createDistanceBoards`: `ground` as in step 1 at the board's (px, pz); face centre y = `max(y, ground) + FACE_CENTRE_Y`; the post instance spans `min(y, ground)` to `max(y, ground) + FACE_CENTRE_Y` (post geometry scaled in Y per instance). With ground ≤ y both equal today's values.

Conventions: `ground === y` exactly when no terrain; ground equal to `y` changes nothing; inputs never mutated; no new allocations in per-frame code (all of this runs at load).

## Fixtures (tests)

- `STRAIGHT`: centerline `[i*10, 0]`, i = 0..99, widthMeters 12, elevation 0, no kerbs/runoffs/barriers, pit `{start: 10, end: 30, side: 'right'}`, no terrain unless added.
- `FLAT(h)`: terrain grid `{originX: 0, originZ: 0, sizeX: 200, sizeZ: 100, cols: 20, rows: 10}`, every height `h`.
- `WALLED(h)`: `STRAIGHT` with barriers `[{start: 0, end: 99, side: 'right', type: 'wall', offsetMeters: 8}]`, terrain `FLAT(h)` re-centred on the track (`originX: 495, sizeX: 1100, sizeZ: 200`), boards `[{index: 50, side: 'right', offset: 8, label: 100}]`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `WALLED(−3)` | `barrierRuns(track, 'right')` | every vertex `y` 0, `ground` −3 (±1e-9) |
| AT2 | `STRAIGHT` + same barriers, no terrain | barrierRuns | every vertex `ground === y` |
| AT3 | `WALLED(0)` baseline collider vertices min/max y = (b0, t0) | build colliders for `WALLED(−3)` and `WALLED(2)` | −3: min y = b0 − 3, max y = t0; +2: min y = b0, max y = t0 + 2 (±1e-5) |
| AT4 | same three fixtures | `createBarrierObject` world bbox y | −3: min = baseline min − 3, max = baseline max; +2: min = baseline min, max = baseline max + 2 (±1e-4) |
| AT5 | same three fixtures | `createDistanceBoards` face instance y | −3: equal to baseline; +2: baseline + 2 (±1e-5); post instance spans down to min(0, h) |
| AT6 | every `public/tracks/<id>.json` with terrain | barrierRuns both sides | every vertex `ground` = `terrainHeightAt(terrain, x, z)` (±1e-9) |

## Acceptance criteria

- [ ] AT1–AT6 pass; tests 032, 038, 083, 086, 141, 143, 176, 185 (acceptance, edge, render, physics) pass unchanged.
- [ ] Only the test edit below; no other protected test changed.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Planner-authorised test edits

- `tests/unit/edge/174-bank-game-and-limits.post.test.ts`, test `distance board bases lift by their own signed side offset`: its fixture has real flat-0 terrain, so the left banked board (y −1.59) now sits on ground 0. Build both tracks in that test without terrain (`terrain: undefined as unknown as TrackDataV2['terrain']`) so `ground === y`; every expectation stays unchanged.
- Verified unchanged: `032-track-colliders-edge` EDGE5 (elevation 2 over flat-0 terrain: wall now spans −0.3..3.0, the cast at 1.85 and 3.5 still behave), `141-escape-foam-edge` EDGE9 (elevation 2 above ground 0), `143-distance-boards-edge` (no terrain), `174-bank-placed-geometry` POST4 (degenerate terrain, non-finite sample falls back to the plane).

## Out of scope

- Barrier colour/style, sidewalks or street furniture changes; stilts or extra tyre rows when ground is far below `y` (see question).
- Pit building (236), QA tooling (237/238).

## Planner answer (barrier parts)

Rails stay at `max(y, ground)` + their current height. Armco posts extend down to `min(y, ground)`. Tyre rows and foam blocks stay at `max(y, ground)`; when `max − min > 0.1` a plain concrete footing (box, colour `#8a8a8a`, same footprint) fills from `min(y, ground)` up to their base. No new table rows; AT4 bbox expectations already cover walls.
