# 234 — Ground grandstands and track props on the terrain

Status: pending
Phase: 1
Depends on: 233
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11 (design `docs/design/track-fidelity.md`)

## Goal

Grandstands and track props stand on the highest terrain under their footprint, with a plinth filling down to the lowest, instead of taking the centerline elevation.

## Context

Grounding rule: `baseY` = max ground over the footprint, `plinthBottom` = min ground − 0.05; the object stands on `baseY`; a plinth fills `plinthBottom..baseY` when the gap > 0.1 m. Local frame = three.js `rotation.y = yaw` (see 233). Ground sampling: `footprintGround`, `groundHeightAt`, `terrainHeightAt` from `src/track/ground.ts` (233).

## Files

- `src/track/placement.ts` — create (no `three`)
- `src/render/grandstand.ts` — modify: optional plinth
- `src/render/trackProps.ts` — modify: per-prop baseY and plinth part
- `src/main.ts` — modify: stands via `groundedBase`
- `tests/unit/acceptance/234-grounded-stands-props.test.ts` — create from the table

## Steps

```ts
export const GRANDSTAND_ROW_DEPTH = 0.9;
export interface Footprint { xMin: number; xMax: number; zMin: number; zMax: number }
export function grandstandFootprint(g: Grandstand): Footprint; // [−L/2, L/2] × [0, rows·0.9]
export function groundedBase(track: TrackDataV2, x: number, z: number, yaw: number, fp: Footprint): { baseY: number; plinthBottom: number };
export function createGrandstand(g: Grandstand, loadTexture?: (url: string) => THREE.Texture, style?: ResolvedTrackStyle, plinthHeight?: number): THREE.Group; // default 0
```

1. `groundedBase` = `footprintGround` over `fp` mapped to `{ baseY: max, plinthBottom: min − 0.05 }`. `Grandstand` is from `src/core/types.ts`.
2. `createGrandstand`: when `plinthHeight > 0.1` add a box mesh named `standPlinth` over the footprint, local y from `−plinthHeight` to 0 (x ±L/2, z 0..rows·0.9); its geometry/material are disposed with the group like the others. Otherwise output is identical to today.
3. `main.ts`: every stand (config and `extraGrandstands`) gets `position.y = baseY` and `plinthHeight = baseY − plinthBottom` from `groundedBase(track, g.x, g.z, g.yaw, grandstandFootprint(g))`. No `nearestElevation(` call may remain.
4. `createTrackProps`: for every prop except `footbridge`, footprint = local x in [−length/2, length/2], z in [0, depth] (`footprintOf`; local x = tangent·sign, z = outward, as the existing matrix basis), yaw from that x axis, `groundedBase` gives the matrix y. When `baseY − plinthBottom > 0.1`, add a box part `length × (baseY − plinthBottom) × depth` under the prop (local y −plinthHeight..0, z 0..depth) to the same merged bucket (no new meshes, no new names). Footbridge keeps `track.elevation[i]`. Skip/collision logic unchanged.

Conventions: stands/props with all-equal ground get plinthHeight 0.05 (no plinth); plinth threshold is strict (> 0.1); tracks and styles never mutated; non-finite terrain falls back via 233.

## Fixtures (tests)

- `RAMP`: terrain `{originX: 0, originZ: 0, sizeX: 200, sizeZ: 100, cols: 20, rows: 10}`, vertex (j, i) at x = −100 + 10j, z = −50 + 10i, height 0.1·x, heights column-major `j*(rows+1)+i`. `FLAT(h)`: same grid, every height `h`.
- `LINE`: centerline `[−90 + 2i, 0]`, i = 0..90, widthMeters 12, elevation[i] = 0.1·x_i, no banking, terrain `RAMP`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | g `{lengthMeters: 60, rows: 10}` | `grandstandFootprint(g)` | `{xMin: −30, xMax: 30, zMin: 0, zMax: 9}` (±1e-9) |
| AT2 | `LINE`, g `{x: 0, z: 0, yaw: 0, lengthMeters: 20, rows: 10}` | `groundedBase(track, 0, 0, 0, grandstandFootprint(g))` | `{baseY: 1.0, plinthBottom: −1.05}` (±1e-9) |
| AT3 | g `{x: 0, z: 0, yaw: 0, lengthMeters: 20, rows: 10, roof: false}` | `createGrandstand(g, stub, undefined, 2.05)` | child `standPlinth` exists; its world bbox x [−10, 10], y [−2.05, 0], z [0, 9] (±1e-6) |
| AT4 | same | `createGrandstand(g, stub, undefined, 0.05)` and with plinthHeight omitted | no `standPlinth` child |
| AT5 | every `public/tracks/<id>.json` with `terrain` (skip `*.style.json`, index) | for each grandstand, `groundedBase` | `baseY` ≥ `terrainHeightAt` at the 4 footprint corners and centre − 1e-6; `plinthBottom` ≤ each of those − 0.05 + 1e-6 |
| AT6 | source `src/main.ts` | read | uses `groundedBase(` for grandstands; no `nearestElevation(` call left |
| AT7 | `LINE`, style props `[{type: 'tent', index: 45, side: 'right', offsetMeters: 10, lengthMeters: 10}]` | `createTrackProps(track, style)` | merged prop geometry world bbox min y = −0.55 (±1e-4) (tent spans x −5..5: max ground 0.5, min −0.5) and the tent roof is above y 0.5 + 0.5·heightMeters |
| AT8 | `LINE` with terrain `FLAT(0)` and elevation 0, same prop | create | bbox min y = 0 (±1e-4): no plinth below ground |

## Acceptance criteria

- [ ] AT1–AT8 pass; `tests/unit/acceptance/{040,104,180,182,187}-*`, `tests/unit/render/grandstand.test.ts` pass unchanged.
- [ ] Plinth appears only for plinthHeight > 0.1; `dispose` frees the plinth.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Planner-authorised test edits

None: every other test builds stands/props on flat 0 terrain with elevation 0, or omits `plinthHeight`.

## Out of scope

- Pit building (236), barriers/boards (235), stand placement data or crowd changes, footbridge grounding.
