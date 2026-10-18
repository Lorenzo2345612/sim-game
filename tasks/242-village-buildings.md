# 242 — Synthetic village buildings for the Ermita layouts

Status: pending
Phase: 1
Depends on: 241
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

Rows of coloured flat-roof plaster houses (with rooftop water tanks and adobe walls on vacant lots) line the six Ermita tracks and the village streets, baked offline into `public/tracks/ermita-*-env.json` and rendered by the existing city path.

## Context

Design: `docs/design/ermita.md` section 242 (rules and fixture F come from there). OSM has no buildings here. Inputs (local, no network): `assets/source/osm/ermita-streets.json` `{source, license, ways:[{id, highway, coords:[lon,lat][]}]}` (all highway ways in the venue bbox, includes the roads the circuit uses); `assets/source/osm/ermita-village.json` `{polygons:[[[lon,lat]...]]}` (built-up mask). The data agent commits both before this task starts; do not edit them. `src/main.ts` already loads `/tracks/<id>-env.json` for any track (no change). The local frame origin of a track = `bboxCenter` of its geojson coordinates (`tools/track-builder/buildTrack.ts`). Baked types live twice: `src/core/types.ts` (CityEnv, lines ~81-85) and `tools/env/osmBuildings.ts` (lines 3-21); change both identically.

## Files

- `src/core/types.ts` — modify — `BuildingMaterial` adds `'plaster'`; `Building` adds `color?: number` (0xRRGGBB) and `tank?: boolean`.
- `tools/env/osmBuildings.ts` — modify — same type changes only (no logic change).
- `tools/env/villageBuildings.ts` — create (pure, no I/O, no `three`).
- `tools/env/bakeVillage.ts` — create — CLI `tsx tools/env/bakeVillage.ts <id>...`; add npm script `"build:village": "tsx tools/env/bakeVillage.ts"` in `package.json` (modify).
- `src/render/cityRenderer.ts` — modify — plaster path in `createCityObject` (and a helper for the merged plaster geometry).
- `public/tracks/ermita-{centro,federal,norte,mixto,poniente}-env.json` — create via `npm run build:village -- <ids>`.
- Tests: `tests/unit/acceptance/242-village-buildings.test.ts`.

## Contract

```ts
import type { CityEnv } from '../../src/core/types';
export const VILLAGE_PALETTE: readonly number[]; // 0xC8963E, 0xE8D8B0, 0xD98C8C, 0xB5553A, 0x8FB8C8, 0xEEE8DC, 0x9DB37A
export function villageSeed(id: string): number; // FNV-1a 32-bit of the id (UTF-16 code units), unsigned
export interface VillageParams {
  centerline: [number, number][]; halfWidthLeft: number[]; halfWidthRight: number[];
  streets: [number, number][][]; mask: [number, number][][]; exclusions: [number, number][][]; seed: number;
}
export function buildVillageEnv(p: VillageParams): CityEnv; // water: []
```

Generator rules (local metres, track frame; RNG `mulberry32` imported from `tools/track-builder/trees.ts`, one stream, fixed consumption order so equal inputs give equal output):
- Closed track loop (last point connects to first); left = opposite side of the right normal `(-dz, dx)/len`; `halfWidthLeft/Right[i]` = lateral distance to that edge at point i. Roads processed in order: track, then streets in input order; each road side separately (track: both sides; street: both sides, assumed width 7 m).
- Lots: walk along the offset polyline (track offset = `trackSetback[i]`, street offset = 5.0 from its centreline); frontage uniform [6, 14], gap 0–0.5 between consecutive lots, depth uniform [9, 16]; front face parallel to the chord of the lot on the offset line; lot is a rectangle extending away from the road. Height 3.2 (70 %) or 6.4 (30 %); colour uniform from `VILLAGE_PALETTE`; `tank: true` with probability 0.4; 10 % of lots are vacant: no house, one `Wall` (height 2.2, thickness 0.3, `line` = the two front-edge endpoints) instead.
- A lot (house or wall) is discarded when any of: a vertex outside every mask polygon; a ring vertex or edge closer than clearance to ANY road centreline (track: `trackSetback[i]` of the nearest index, street: 5.0; boundary inclusive allowed); any ring vertex within 8 m of a junction; overlap (interior, SAT, tolerance 1e-6) with an exclusion polygon or an already accepted house. Junction = intersection point of two road polylines (track–street or street–street), or a street endpoint within 3 m of another road.
- Output buildings: `ring` 4 vertices, `height`, `material: 'plaster'`, `color`, `tank` only when true.

Bake (`bakeVillage.ts`): project streets/mask with the track origin; keep street points within 700 m of the centerline; densify streets to 5 m, drop points within 10 m of the track centerline and split into pieces of ≥ 2 points (streets that are the circuit itself disappear); `halfWidthLeft/Right` = track JSON arrays when present else `widthMeters/2`; seed = `villageSeed(id)`; exclusions: (a) pit lane strip: indices `pit.start..pit.end`, lateral `halfWidth` to `halfWidth + 15` on `pit.side`; (b) each grandstand: rectangle centred at (x, z), rotated by `yaw`, size `lengthMeters + 6` × `rows * 0.9 + 6`; (c) each `water` feature of `assets/source/osm/<id>-areas.json` (line, `tags.est_width_m`): one rectangle per segment, half width `est_width_m / 2 + 3`. Writes `JSON.stringify(env)` to `public/tracks/<id>-env.json`; logs counts.

Render (`createCityObject`): plaster buildings (all, regardless of cell) go into ONE merged mesh: walls + flat roof + 0.4 m high parapet along the roof edge (thickness 0.2, reuse `emitWallStrip`), a per-vertex `color` attribute (3 floats, `new THREE.Color().setHex(color)`; default 0xE8D8B0 if absent), material `MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })` without textures. Tanks: one `InstancedMesh` (count = plaster buildings with `tank`), `CylinderGeometry(0.55, 0.55, 1.1)`, black material, centred at the building centroid, y = base + height + 0.4 + 0.55. Base y = `minTerrain` as for other buildings. `CityObject.buildings` counts plaster too; `dispose()` also disposes the plaster/tank geometries and materials. Glass/concrete/brick/stone and walls unchanged (the walls of vacant lots use the existing stone wall path).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: fixture F (straight track 400 m along +x from x=0, z=0, half width 5 both sides, 401 points; streets: one along z at x=200 from z=−80 to 80; mask: rectangle x∈[−20,420], z∈[−80,80]; no exclusions; seed 7) | call twice | outputs deep-equal; with seed 8 output differs |
| AT2 | unit: F | every building ring vertex and edge | distance to the track centerline segment ≥ 5 + 2.5 − 1e-6 m; distance to the street centreline ≥ 5.0 − 1e-6 m |
| AT3 | unit: F | project building front edges onto the x axis per side (z>0, z<0), restricted to x∈[20,180]∪[220,380] | covered length ≥ 70 % of 320 m per side |
| AT4 | unit: F with mask x∈[−20,200], z∈[−80,80] | every building centroid | inside the mask |
| AT5 | unit: F | all building rings pairwise | interiors do not overlap (SAT on the rectangles, tolerance 1e-6) |
| AT6 | unit: F | every building | ring has 4 distinct vertices forming a rectangle (angles 90°±0.1°); frontage ∈ [6,14]; depth ∈ [9,16]; height ∈ {3.2, 6.4}; material 'plaster'; color ∈ `VILLAGE_PALETTE`; ≥ 15 % have height 6.4; ≥ 5 distinct colours |
| AT7 | unit: F + exclusion square x∈[90,130], z∈[5,40] | every building | no overlap with the exclusion |
| AT8 | unit: F | every building | distance from every ring vertex to the junction point (200, 0) ≥ 8 m |
| AT9 | unit: F | walls | every wall height 2.2, thickness 0.3, at the front setback line; walls do not overlap buildings |
| AT10 | unit: each `public/tracks/ermita-*-env.json` | parse | ≥ 150 buildings, all 'plaster' with color in palette; every building ring vertex and edge is ≥ (the `offsetMeters` of that track's barrier covering the nearest centerline index on that side) + 1.0 − 1e-6 m from the track centerline |
| AT11 | unit: `createCityObject` with a mock `loadTexture` and 3 plaster buildings colours 0xC8963E, 0xD98C8C, 0x8FB8C8, 2 with `tank` | inspect group | one mesh whose material has `vertexColors` true and whose `color` attribute contains the three `THREE.Color().setHex` values; one `InstancedMesh` with count 2; `dispose()` disposes every geometry and material |
| AT12 | unit: existing `public/tracks/{baku,lasvegas,singapore}-env.json` | read | byte-identical to master |

## Existing tests that must still pass

157, 158 (city renderer/bake) acceptance and edge tests.

## Acceptance criteria

- [ ] AT1–AT12 pass; all other tests pass.
- [ ] The 6 `-env.json` files exist and load in the game (e2e not required).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Planner answers

- Output limit (decision 242-coder, two timeouts): write `tools/env/villageBuildings.ts` incrementally — first a skeleton with exported types and stub functions, then fill one function per edit (each edit < 150 lines), running the 242 acceptance tests after each. Do not design the whole file before writing; commit progress early. Order: generator → bake CLI → cityRenderer plaster path → bake env files.

## Out of scope

- street furniture, textures for plaster, roofs other than flat, interiors, LOD/instancing of houses, changing OSM bake/render of other materials, editing the input JSONs, e2e tests.

## Planner decision (barriers vs houses)

`buildVillageEnv` takes an optional `trackSetback?: number[]` (per centerline index, metres from the centerline to the house front line, same value both sides unless `trackSetbackRight` is also given). Default when absent: `halfWidth + 2.5` per side (fixtures AT1–AT9 use the default). `bakeVillage.ts` passes, per index and side, the `offsetMeters` of the barrier segment covering that index + 1.0 (walls stand between the track and the facades, as on a real street circuit). Only the AT10 row changed accordingly.
