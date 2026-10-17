# 233 — Ground sampler shared by main, pit and later placement

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer
Milestone: M1.11 (track fidelity; design `docs/design/track-fidelity.md`)

## Goal

One three-free module answers "ground height at (x, z)" and "min/max ground under a footprint". `main.ts` and `pitAndStart.ts` stop carrying their own copies.

## Context

Shared rule: `groundHeightAt` = terrain height when the track has `terrain`, else the track-plane height at the nearest centerline point (today's `nearestElevation` of `src/main.ts`, banking included via `bankTanAt` from `src/track/surfaces.ts`). Local frame = three.js `rotation.y = yaw`: local (lx, lz) -> world (x + lx·cos yaw + lz·sin yaw, z − lx·sin yaw + lz·cos yaw). Terrain layout: `Terrain` in `src/core/types.ts` (heights column-major `j*(rows+1)+i`, origin = centre).

## Files

- `src/track/ground.ts` — create (no import from `three`; may import `bankTanAt` from `./surfaces`)
- `src/main.ts` — modify: delete `makeTerrainY`, `nearestElevation`; drop imports left unused (e.g. `bankTanAt`)
- `src/render/pitAndStart.ts` — modify: delete local `terrainY`, call `terrainHeightAt`
- `tests/unit/acceptance/233-ground-sampler.test.ts` — create from the table

## Steps

```ts
export function terrainHeightAt(t: Terrain, x: number, z: number): number;
export function groundHeightAt(track: TrackDataV2, x: number, z: number): number;
export function footprintGround(
  track: TrackDataV2, x: number, z: number, yaw: number,
  xMin: number, xMax: number, zMin: number, zMax: number, step?: number, // default 2
): { min: number; max: number };
```

1. `terrainHeightAt`: bilinear, coordinates clamped to the grid; identical maths to the old `makeTerrainY`/`terrainY`. Degenerate grids return NaN (no special handling); `pitAndStart` keeps dropping non-finite samples.
2. `groundHeightAt`: terrain via `terrainHeightAt` when `track.terrain` exists and the sample is finite; otherwise the plane height of the old `nearestElevation` (nearest centerline index, elevation + signed lateral · `bankTanAt`). The non-finite fallback is needed by test fixtures with degenerate terrain.
3. `footprintGround`: samples a regular grid over the local box (per axis `max(1, ceil(extent/step))` intervals, edges and corners included), maps each to world by the local frame, takes min/max of `groundHeightAt`.
4. `main.ts`: one local `const terrainY = (x, z) => terrainHeightAt(track.terrain, x, z)` replaces every `makeTerrainY(track.terrain)` call; both grandstand loops use `groundHeightAt(track, g.x, g.z)` instead of `nearestElevation`. Touch nothing else (the `applyEnvironment(` call must stay as is).

Conventions: no rounding; `min`/`max` inclusive of all samples; `xMin > xMax` or `zMin > zMax` or `step <= 0` throws `RangeError` (equal bounds allowed); tracks are never mutated.

## Fixtures (tests)

- `RAMP`: terrain `{originX: 0, originZ: 0, sizeX: 200, sizeZ: 100, cols: 20, rows: 10}`, vertex (col j, row i) at x = −100 + 10j, z = −50 + 10i, height 0.1·x, heights column-major `j*(rows+1)+i`.
- `STRAIGHT`: centerline `[i*10, 0]`, i = 0..99, widthMeters 12, elevation 0, no kerbs/runoffs/barriers, pit `{start: 10, end: 30, side: 'right'}`, no terrain unless the row adds one.
- `LINE`: centerline `[−90 + 2i, 0]`, i = 0..90, widthMeters 12, elevation[i] = 0.1·x_i, no banking, terrain `RAMP`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `RAMP` | `terrainHeightAt` at vertex j = 3, i = 4 (x −70, z −10) | −7 (±1e-9) |
| AT2 | `RAMP` | at (5, 7) | 0.5 (±1e-9) |
| AT3 | `RAMP` | at (500, 0) and (−500, 0) | 10 and −10 (clamped, ±1e-9) |
| AT4 | `STRAIGHT` with elevation[i] = 0.5·i, no terrain | `groundHeightAt(track, 40, 3)` | 2.0 (±1e-9) |
| AT5 | `LINE` (terrain `RAMP`) | `groundHeightAt(track, 5, 7)` | equals `terrainHeightAt(RAMP, 5, 7)` (±1e-12) |
| AT6 | `LINE` | `footprintGround(track, 0, 0, 0, −10, 10, 0, 10)` | `{min: −1, max: 1}` (±1e-9) |
| AT7 | `LINE` | same with yaw = π/2 | `{min: 0, max: 1}` (±1e-9) |
| AT8 | `LINE` | `footprintGround(track, 0, 0, 0, 10, −10, 0, 10)` | throws `RangeError` |
| AT9 | sources | read `src/main.ts`, `src/render/pitAndStart.ts`, `src/track/ground.ts` | main.ts has no `function makeTerrainY` / `function nearestElevation`; pitAndStart.ts has no `function terrainY`; both import from the ground module; ground.ts has no `from 'three'` |

## Acceptance criteria

- [ ] AT1–AT9 pass; existing suites (pit, edge 043/054/070 source tests) pass unchanged.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Grounding rule, plinths, `placement.ts` (234); barriers and boards (235); pit building (236).
