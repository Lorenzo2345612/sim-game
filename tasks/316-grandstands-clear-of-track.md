# 316 — Grandstands follow the track and never sit on it

Status: pending
Phase: 2
Depends on: none
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Style grandstands (`extraGrandstands`) follow the curve of their section as several straight pieces instead of one chord, and no stand comes closer than 5 m to the track edge on any shipped track.

## Context

User report: grandstands sit on the track (e.g. Mexico) and should be contoured, not straight. `extraGrandstands` (`src/track/trackStyleWiring.ts`) places one stand on the chord start→end, which cuts the track in curves. Measured clearances (m): budapest builder stand #2 −4.5, budapest extra −3.2, lusail extra −5.8, mexico extra −3.1 (style 560–640 left), sepang extra −7.2, singapore extra −5.6. `pitBuildingPieces` (`src/track/placement.ts`) already splits an offset polyline into chord pieces (turn ≤ 8°, min 6 m); reuse its run splitting. Footprint (`grandstandFootprint`): local X ∈ ±length/2, Z ∈ [0, rows×0.9]; world = (x + lx·cos yaw + lz·sin yaw, z − lx·sin yaw + lz·cos yaw); the front (Z = 0) faces the track, rows go to +Z.

## Files

- `src/track/placement.ts` — modify: shared run splitter, `extraGrandstands` moves here, new exports below.
- `src/track/trackStyleWiring.ts` — modify: re-export `extraGrandstands` from `./placement` (no cycle).
- `src/main.ts` — modify: the two grandstand loops (~1096, ~1104) become one loop over `placedGrandstands(track, trackStyle)`; `stats.grandstands` and `stats.style.extraGrandstands` keep counting inputs (builder stands, style entries).
- `tests/unit/acceptance/316-grandstands-clear-of-track.test.ts` — create (acceptance worker). Planner-authorised edit (2026-10-19): AT1 count check becomes per track `stands.length ≥ inputs − 1` plus a global sum of `inputs − stands.length` ≤ 1; AT3 drops the yaw assertion (chord-to-chord turn is up to ~2×8°, plus kinks at hairpins). Also (coder applies): `tests/unit/acceptance/180-track-style-wiring.test.ts` AT8 (ring wrap 95→5) expects the multi-piece contract: ≥ 4 pieces, consecutive front-corner gaps ≤ 1 m, midpoints at the expected offset radius ±0.6 m; `tests/unit/edge/234-grounded-stands-props.post.test.ts` POST8 expects 1 `groundedBase(` call in `main.ts` (keeps the `groundHeightAt(` ban). Nothing else.

## Steps

```ts
export const STAND_MIN_CLEAR_M = 5, STAND_MAX_PUSH_M = 80;
export function standClearance(track: TrackDataV2, g: Grandstand): number;
export function clearGrandstand(track: TrackDataV2, g: Grandstand): Grandstand | null;
export function extraGrandstands(track: TrackDataV2, style: ResolvedTrackStyle): Grandstand[];
export function placedGrandstands(track: TrackDataV2, style: ResolvedTrackStyle): Grandstand[];
```
1. Factor the run splitting of `pitBuildingPieces` into an internal helper (offset polyline over start→end on a side, pieces with turn ≤ 8° and ≥ 6 m, uniform offset per piece = max over its vertices). `pitBuildingPieces` output must stay identical.
2. `extraGrandstands`: per style entry, offset per vertex = `halfWidthAt(side, k) + offsetMeters`; one `Grandstand` per piece: front edge = the piece chord, `x,z` = chord midpoint, `lengthMeters` = chord length, yaw so the front faces the track, `rows`/`roof` from the entry.
3. `standClearance`: 21×5 grid over the footprint (edges included); per sample, distance to the nearest centerline point minus max(`halfWidthAt` left, right) there; minimum over samples.
4. `clearGrandstand`: clearance ≥ 5 → return `g` (same object); else move x,z along (sin yaw, cos yaw) in 1 m steps up to 80 until clear → new object, only x,z changed; `null` if never clear.
5. `placedGrandstands`: `[...track.grandstands, ...extraGrandstands(...)]` through `clearGrandstand`, nulls dropped.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | every `public/tracks/*.json` track with its `*.style.json` when present | `placedGrandstands` | every stand `standClearance ≥ 5` (−1e-6); count = `track.grandstands.length + extraGrandstands(...).length` − dropped, with dropped summed over all tracks ≤ 1 (sepang 1449–1667 left has one 14-row piece that hits the parallel straight behind it) |
| AT2 | same tracks | `clearGrandstand(track, g)` for each `track.grandstands` stand with clearance ≥ 5 | returns `g` (`toBe`) |
| AT3 | mexico, style entry 560–640 left | `extraGrandstands` pieces of that entry | ≥ 2 pieces; each `standClearance ≥ 5` without pushing; consecutive pieces: gap between facing front corners ≤ 1.0 m |
| AT4 | synthetic circle (360 points, radius 200, width 12, other fields as `tests/unit/acceptance/022-fixture-trackdatav2.ts`), style entry start 0, end 30, offset 10, rows 8, both sides | `extraGrandstands` | per side ≥ 4 pieces; every front-edge midpoint at radius 216 (outer side) or 184 (inner side), ±0.6 m |
| AT5 | `pitBuildingPieces` on every shipped track | call | identical to master (literal snapshot stored in the test for mexico and monza: count, and x, z, yaw, length of the first piece ±1e-9) |
| AT6 | the AT4 circle and a stand at the centre, length 400, rows 10, yaw 0 | `clearGrandstand` | `null` |

## Acceptance criteria

- [ ] AT1–AT6 pass; 180, edge 234, 183, 189, 193, 196, 197, 200, 234, 235, 249 acceptance tests pass.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/316- tests/unit/acceptance/180- tests/unit/edge/234- tests/unit/acceptance/183- tests/unit/acceptance/189- tests/unit/acceptance/193- tests/unit/acceptance/196- tests/unit/acceptance/197- tests/unit/acceptance/200- tests/unit/acceptance/234- tests/unit/acceptance/235- tests/unit/acceptance/249-
```

## Out of scope

Builder or track JSON changes, curved (non-planar) stand meshes, other props, barrier/pit clearance.
