# 236 — Pit building follows the pit lane

Status: pending
Phase: 1
Depends on: 234
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11

## Goal

The pit building is a chain of grounded chord boxes that follow the pit-side offset of the pit lane, instead of one chord box sunk 0.3 m below the lowest sample.

## Context

Design: `docs/design/track-fidelity.md` ("Shared rules", "236"). Uses `groundedBase`/`placement.ts` (234) and `footprintGround`/`groundHeightAt` (233, `src/track/ground.ts`). Assumption (233 contract): non-finite terrain samples are ignored and, if none is finite, the track-plane height is used (existing fixtures have a degenerate 1x1 terrain). Side normals: right = `[−dz, dx]`, left = `[dz, −dx]` (as `sideNormal` in `pitAndStart.ts`). `EDGE_OFFSET = 10` moves to `placement.ts`.

## Files

- `src/track/placement.ts` — modify: add `PitPiece`, `pitBuildingPieces`.
- `src/render/pitAndStart.ts` — modify: `createPitBuilding` renders pieces; remove its own terrain sampling and the sink.
- `tests/unit/acceptance/236-pit-building-pieces.test.ts` — create (acceptance); edge tests by tester-pre.

## Steps

```ts
export interface PitPiece { x: number; z: number; yaw: number; length: number; depth: number; baseY: number; plinthBottom: number }
export function pitBuildingPieces(track: TrackDataV2, style?: ResolvedTrackStyle): PitPiece[]  // style default DEFAULT_TRACK_STYLE
```

1. Polyline: for each index from `pit.start` to `pit.end` (wrapping by `% n`), the centerline point moved along the per-index side normal (central-difference tangent, one-sided at the seam ends only if needed) by `halfWidthAt(track, side, i) + EDGE_OFFSET`.
2. Pieces: vertex heading = the tangent angle at that vertex. A piece starts at a vertex and ends at the last vertex whose heading differs from the start vertex heading by ≤ 8°; the next piece starts at that end vertex (minimum one segment). Pieces shorter than 6 m merge into the previous one (a lone piece is kept).
3. Each piece = chord box between its end points: `length` = chord length, `depth` = style `pitBuilding.depthMeters`, `(x, z)` = box centre (near edge pushed outward by `depth/2` along the side normal), `yaw` so that local +x runs along the chord and local +z points away from the track (three.js `rotation.y`, local frame in design "Shared rules"; left side adds π). Footprint is local `[−length/2, length/2] × [−depth/2, depth/2]`; `baseY`/`plinthBottom` from the grounding rule via `footprintGround`.
4. `createPitBuilding(track, style?)`: per piece, facade box named `pit` (height `pitBuilding.heightMeters`, from `baseY` up), doors, `pitGlass`, `pitRoof`, `pitAccent` laid out relative to the facade exactly as today; box `pitPlinth` (length x depth, from `plinthBottom` to `baseY`) only when `baseY − plinthBottom > 0.1`. Total garage count stays `max(10, floor(pitPathLength / 15))`; each piece gets `max(1, round(total · length / Σlength))` doors; `userData.garageCount` = doors created, `userData.storeys` unchanged.

Conventions: angles in radians internally (8° = 8π/180), `≤ 8°` inclusive, `< 6 m` merges; inputs not mutated; `pit.start === pit.end` returns `[]` and `createPitBuilding` returns an empty group.

Fixtures: `STRAIGHT`: centerline `[i*10, 0]`, i = 0..99, widthMeters 12, elevation 0, no kerbs/runoffs/barriers/terrain, pit `{start: 10, end: 30, side: 'right'}`. `ARC`: centerline `[200·cos(2πi/200), −200·sin(2πi/200)]`, i = 0..199, widthMeters 12, elevation 0, no terrain, pit `{start: 0, end: 50, side: 'right'}` (right = outside). `LINE`: centerline `[−90 + 2i, 0]`, i = 0..90, widthMeters 12, elevation[i] = 0.1·x_i, terrain `RAMP` = `{originX: 0, originZ: 0, sizeX: 200, sizeZ: 100, cols: 20, rows: 10}`, vertex (j, i) at x = −100 + 10j, z = −50 + 10i, height 0.1·x, heights column-major `j*(rows+1)+i`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STRAIGHT`, default style | `pitBuildingPieces` | 1 piece, length 200 (±1e-6), depth 8, centre x 200 (±1e-6), centre z on the right side at 6 + 10 + 4 = 20 from the centerline (±1e-6) |
| AT2 | `ARC` | pieces | count ≥ 11; each piece's heading change ≤ 8° + 1e-6; for every piece the midpoint of its near (track-side) edge is ≥ 6 + 9.4 from the centerline (no overlap with the track, sagitta allowance) |
| AT3 | `ARC` | pieces | sum of piece lengths within 2 % of the offset arc length between start and end |
| AT4 | `LINE`, pit `{start: 20, end: 70, side: 'right'}` | pieces | each piece `baseY` = max and `plinthBottom` = min − 0.05 of `footprintGround` over its box (±1e-9) |
| AT5 | `STRAIGHT`, default style | `createPitBuilding` | building meshes: one facade per piece; group world bbox min y ≥ −0.06 (no 0.3 m sink) |
| AT6 | every `public/tracks/<id>.json` | pieces | at least 1 piece; every piece length ≥ 6 m or it is the only piece (overlaps with other track parts are reported by 237, not tested here) |

## Planner-authorised test edits

- `tests/unit/render/pitAndStart.test.ts` "building base sits 0.3 m below the lowest sample" (elevation 2.5): rename "building base sits on the highest ground"; expect `pit` box min y 2.5 and max y 6.5 (±1e-6).
- same file "wrapping range": the 21-point fixture jumps 100 → 0 at the seam, so the walk yields several pieces. New expectation: `pit` mesh count equals `pitBuildingPieces(track).length` (≥ 1) and `garageDoor` count equals `userData.garageCount`; drop the x/z bbox asserts.
- `tests/unit/edge/174-bank-placed-geometry.post.test.ts` POST6 (left side, 10° bank, elevation 2.5): first `pit` mesh min y = 2.5 − 16·TAN (±1e-4); `pitPlinth` min y = 2.5 − 24·TAN − 0.05 (±1e-4); flat bank: `pit` min y 2.5 (±1e-6) and no `pitPlinth`.
- `tests/unit/acceptance/173-pit-range.test.ts` AT6: replace `toHaveLength(1)` by `length ≥ 1` and the bound by: group world bbox min y ≤ min of `pitBuildingPieces(track).map(p => p.baseY)` + 0.01 (every track with terrain).
- `tests/unit/edge/236-pit-building-pieces-edge.test.ts` EDGE6: replace `sum >= 50` with `sum >= 38 && sum <= 42.2` (pieces are chords of the pit-side offset polyline, 42.13 m on ZIG).
- `tests/unit/acceptance/233-ground-sampler.test.ts` AT9: drop `src/render/pitAndStart.ts` from the files required to import the ground module; keep every other file.

## Acceptance criteria

- [ ] Table rows pass; the four authorised edits applied by the worker; existing 041, 180, 182 pit tests pass unchanged.
- [ ] `createPitBuilding` has no `Math.min(...samples)` sink and no private terrain sampler.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Reading pit geometry from OSM; changing style data; moving the start gantry or lights; main.ts changes (call site is unchanged).

## Questions for the planner

- The literal "turned more than 8° since the piece start" yields 10 pieces on `ARC` (5 segments of 1.8°); step 2 uses "last vertex still within 8°" (13 pieces) to satisfy AT2 ≥ 11. Confirm.
- Degenerate 1x1 terrain fixtures need the 233 fallback stated in Context; confirm 233 implements it.

## Planner answers

- Confirmed: end the piece at the last vertex still within 8° of the piece start (13 pieces on `ARC`).
- Confirmed: 233 falls back to the track-plane height for non-finite or degenerate terrain samples (233 is a dependency).
