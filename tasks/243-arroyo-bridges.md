# 243 — Dry arroyo and bridges on the Ermita tracks

Status: pending
Phase: 1
Depends on: 241
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

Where an Ermita track crosses the river or a stream (`water` features of `assets/source/osm/<id>-areas.json`), the builder carves a 2 m dry bed into the terrain, raises a bridge over it (linear track elevation, wall barriers) and the renderer draws bed, deck, parapets and piers; trees densify on the banks.

## Context

Design: `docs/design/ermita.md` section 243. Areas file water feature: `{id, kind:'water', closed:false, tags:{est_width_m:number,...}, ring:[lon,lat][]}` (lines; the width is `tags.est_width_m`; polygons, if any, have `closed:true`; `kind:'bridge'` features are ignored). Local frame: `projectLonLat(ring, origin)` with origin = `bboxCenter` of the track geojson (as `loadGravelPolygons` in `tools/track-builder/osmAreas.ts`). Only tracks whose `tools/track-builder/tracks.json` entry has `"arroyo": true` use this; every other track's output must stay byte-identical. Real bridge crossings (federal MEX 23 way 1553277736, poniente way 911201276) are listed in `docs/research/tracks/mx-ermita.md` "River crossings".

## Files

- `tools/track-builder/arroyo.ts` — create (pure, no `three`; contract below).
- `tools/track-builder/buildTrack.ts` — modify — `TrackConfig.arroyo?: boolean`; in `buildTrackV2`, only when `arroyo`: `loadArroyos`, then `findBridges`; after `elevation` is computed apply `applyBridgeElevation`; pass `bridges` to `layoutBarriers` and `arroyos` to `buildTerrain` and `placeTrees`; add `bridges`/`arroyos` to the output (only when arroyo is true and the lists are non-empty; otherwise the keys are absent).
- `tools/track-builder/terrain.ts` — modify — `buildTerrain(..., bank?, arroyos?: Arroyo[], bridges?: Bridge[])` (rules below).
- `tools/track-builder/barriers.ts` — modify — `layoutBarriers(..., environment?, bridges?: Bridge[])`.
- `tools/track-builder/trees.ts` — modify — `placeTrees(..., biome, arroyos?: Arroyo[])`.
- `src/core/types.ts` — modify — `TrackDataV2.bridges?: { from: number; to: number }[]`, `arroyos?: { line: [number, number][]; width: number }[]`.
- `src/render/bridgeRenderer.ts` — create — `createBridgeObject(track: TrackDataV2, terrainY: (x: number, z: number) => number): { group: THREE.Group; dispose(): void }`; `src/main.ts` — modify — add it to the scene next to `createBarrierObject` (~line 613) and push to `disposables`.
- `tools/track-builder/tracks.json` — modify — `"arroyo": true` on the 5 ermita entries only. Rebuild only those: `npm run build:tracks -- ermita-centro ermita-federal ermita-norte ermita-mixto ermita-poniente`.
- Tests: `tests/unit/acceptance/243-arroyo-bridges.test.ts`.

## Contract (`arroyo.ts`)

```ts
import type { LonLat, Point2 } from '../../src/track/geo';
export interface Arroyo { line: Point2[]; width: number }   // polyline in local metres; width = full corridor width
export interface Bridge { from: number; to: number }        // centerline indices, inclusive
export const ARROYO_DEPTH = 2.0, ARROYO_BANK = 3, ABUTMENT = 5;
export function loadArroyos(areasJsonPath: string, origin: LonLat): Arroyo[];       // [] when the file is missing
export function findBridges(centerline: Point2[], arroyos: Arroyo[]): Bridge[];
export function applyBridgeElevation(elevation: number[], bridges: Bridge[]): number[]; // new array
export function arroyoDepthAt(arroyos: Arroyo[], x: number, z: number): number;      // metres >= 0 to subtract
```

Rules:
- Corridor = line buffered by `width / 2` (distance to the nearest segment ≤ `width/2`, inclusive). Closed (polygon) water features are skipped (none exist in the data).
- `findBridges`: maximal runs of centerline indices (2 m spacing) inside any corridor; extend each run by `ABUTMENT` m of arc length at both ends (rounded outward to indices); merge overlapping or touching spans; sorted by `from`; a run touching index 0 or N−1 throws `Error`. Fixture G: corridor x∈[485,515] → bridge x∈[480,520] ±1.
- `applyBridgeElevation`: inside `[from, to]` elevation is linear in index between `elevation[from]` and `elevation[to]`; everything outside is copied unchanged.
- `arroyoDepthAt`: `ARROYO_DEPTH` when distance d to the nearest corridor line ≤ `width/2`; for d in (`width/2`, `width/2 + ARROYO_BANK`) `ARROYO_DEPTH · 0.5 · (1 + cos(π (d − width/2) / ARROYO_BANK))`; else 0; max over arroyos.
- `buildTerrain(..., bank?, arroyos?: Arroyo[], bridges?: Bridge[])`: after the existing per-node logic subtract `arroyoDepthAt` from the node, except nodes whose nearest-centerline distance ≤ `widthMeters / 2 + 5` and whose nearest centerline index lies outside every bridge span (they keep the road-corridor height). Round like the existing code (`Math.round(h * 100) / 100`). Without `arroyos` the output is unchanged.
- `layoutBarriers` with bridges: for every index in a bridge span on both sides the barrier is `type: 'wall'`, `offsetMeters = widthMeters / 2 + 0.3`; neighbouring segments are split at the span boundaries (inclusive indices); outside spans the output is unchanged.
- `placeTrees`: density multiplier ×3 for candidate points within 15 m of a corridor edge (distance to the line ≤ `width/2 + 15`); keep the 6000 cap and the centerline exclusion.

Render (`bridgeRenderer.ts`), per bridge span (deck follows the track elevation at the two end indices of the span): deck slab 0.6 m thick, width `widthMeters + 2`, top 0.05 m below the track surface, concrete material (`createSurfaceMaterial('concrete', ...)`); two parapets 1.0 m high above the deck top, 0.3 m thick, along both deck edges, length = span length; piers 1.2 m square from the deck underside to `terrainY` every 15 m along the span when the span length > 20 m (count = `floor(spanLength / 15)` centred, span 40 → 2); bed: for each `track.arroyos` line a strip of its `width` draped at `terrainY + 0.05` using `createSurfaceMaterial('gravel', ...)`. Dispose all geometries and materials.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: fixture G (straight track along +x, x∈[0,1000] every 1 m, flat DEM 0, half width 6; one water line along z at x=500 from z=−300 to 300, width 30; `arroyo: true`) | build | exactly one bridge; its x range = [480, 520] ± 1 m |
| AT2 | unit: G with DEM sloping 0.01 along x | build | elevation over the bridge span is linear (abs second difference ≤ 1e-6) and equals the no-arroyo elevation at both abutment ends ± 1e-6 |
| AT3 | unit: G | sample terrain heights at (500, 200) and (500 ± 21, 200) and (500 ± 30, 200) | (500,200) = −2.0 ± 0.1; ±21 between −2.0 and 0; ±30 = 0 ± 0.05 |
| AT4 | unit: G | elevation per index outside the bridge span | equal to the same build without water ± 1e-9 |
| AT5 | unit: G with `arroyo` absent | build | output deep-equal to the build of G without water; no `bridges`/`arroyos` keys |
| AT6 | unit: G | barriers | `wall` segments on left and right covering the bridge index range, offset 6.3 ± 0.01 |
| AT7 | unit: render bridge builder on G's bridge | inspect | two parapet meshes (or instances) of length 40 ± 0.5, height 1.0 above the deck top; deck top within 0.05 m below the track surface; piers count = floor-based rule (span 40 → 2) |
| AT8 | unit: `public/tracks/ermita-federal.json` and `ermita-poniente.json` | read `bridges` | federal has a bridge whose midpoint is within 30 m of the real OSM bridge crossing listed in `mx-ermita.md`; poniente likewise |
| AT9 | unit: every non-ermita `public/tracks/*.json` | compare with master | byte-identical |
| AT10 | unit: each ermita track | trees within 15 m of an arroyo corridor edge | density ≥ 2× the density 50–100 m away |

Test note: "build" for G means calling the units above (`loadArroyos` bypassed by constructing `Arroyo[]` directly, `findBridges`, `applyBridgeElevation`, `buildTerrain`, `layoutBarriers`, `placeTrees`) on the fixture, since `buildTrackV2` reads files; the acceptance worker composes them like `buildTrackV2` does.

## Existing tests that must still pass

All terrain/barrier/tree/builder tests (131, 142, 176 and edge suites).

## Acceptance criteria

- [ ] AT1–AT10 pass; all other tests pass.
- [ ] The 5 ermita JSONs rebuilt with `bridges` and `arroyos`; no other `public/tracks/*.json` changes.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Water rendering/flow, culvert-specific visuals, bridge physics beyond the wall barriers, kerbs/runoff changes on spans, polygon water, non-ermita tracks, village buildings (242), e2e tests.
