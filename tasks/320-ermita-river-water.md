# 320 — Ermita river with water (streams stay dry)

Status: pending
Phase: 2
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

On the ermita layouts the river is drawn with a water surface in its bed where it reaches the circuit; intermittent streams stay dry gravel beds.

## Context

User: the river must show water, not a dry bed. `loadArroyos` (`tools/track-builder/arroyo.ts`) reads `assets/source/osm/<id>-areas.json` water features into `track.arroyos` (`{ line, width }`, type in `src/core/types.ts`). Feature `tags`: river = `waterway: 'river'`, `est_width_m` 25 (some also `seasonal: 'yes'`, still water); streams = `waterway: 'stream'`, `intermittent: 'yes'`, width 6. `createBridgeObject` (`src/render/bridgeRenderer.ts`) draws every arroyo as a gravel bed (`buildBed`), `ARROYO_DEPTH` 2 m. Planner measurement: the river crosses centro, federal, poniente, veloz (bridges), passes 103 m from mixto and 175 m from norte.

## Files

- `tools/track-builder/arroyo.ts` — modify: `Arroyo.water?: boolean` = `tags.waterway === 'river' && tags.intermittent !== 'yes'`; set only when true.
- `src/core/types.ts` — modify: `arroyos?: { line; width; water?: boolean }[]`.
- `src/render/bridgeRenderer.ts` — modify: `buildArroyoWater`, one mesh per water arroyo.
- `public/tracks/ermita-{centro,federal,mixto,norte,poniente,veloz}.json` — modify: regenerate only `arroyos` (builder or one-off script; every other field byte-identical).
- `tests/unit/acceptance/320-ermita-river-water.test.ts` — create (acceptance worker).

## Steps

```ts
export function buildArroyoWater(line: [number, number][], width: number, terrainY: (x: number, z: number) => number): THREE.BufferGeometry;
```
1. Ribbon along `line`: half-width `0.35 × width` perpendicular to the local direction (miter-free, per-vertex normal averaged from adjacent segments). Both edge vertices of a station take y = `terrainY(x, z)` of the centre-line vertex `− ARROYO_DEPTH + 0.6`. Normals up; two triangles per segment.
2. `createBridgeObject`: for each arroyo with `water === true` and ≥ 2 points, add one mesh using one shared `MeshStandardMaterial` per group: colour `#2f5d62`, roughness 0.15, metalness 0, `transparent: true`, opacity 0.85. Push its geometry and the material to the disposal lists; no shadow cast.
3. Do not touch physics or the gravel bed meshes.

Conventions: `src/` must not import from `tools/`; add a local `const ARROYO_DEPTH = 2` in `bridgeRenderer.ts` (same value as the builder's). Arroyos without `water` are dry; a line with < 2 points yields no mesh.

Planner-authorised test edits (reviewer/coder round 2026-10-19), nothing else: in `tests/unit/acceptance/247-sausage-fit-corner.test.ts`, `248-pit-clears-runoff.test.ts` and `250-bollard-placement.test.ts`, where shipped track JSONs are compared with the merge-base, also delete `water` from every `arroyos[]` entry of the shipped copy before comparing. Failures that also occur on master (147, 254, 269, 270, 224, 093) are not this task's.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `loadArroyos` on `assets/source/osm/ermita-centro-areas.json` | load | arroyos with width 25 have `water: true`; width-6 intermittent ones have no `water` or `false` |
| AT2 | shipped `public/tracks/ermita-*.json` (excluding `*-env.json`, `*.style.json`) | compare with master after removing every `arroyos[].water` | deep-equal; every width-25 arroyo has `water: true` |
| AT3 | line `[[0,0],[50,0],[100,0]]`, width 25, `terrainY ≡ 10` | `buildArroyoWater` | every vertex y = 8.6 (±1e-6); z extent ±8.75 (±1e-6) |
| AT4 | arroyo group for ermita-poniente and ermita-norte | build | water mesh count equals the number of `water: true` arroyos of each track |
| AT5 | the group's `dispose()` | call | water geometry and material `dispose` each called once (spies) |

## Acceptance criteria

- [ ] AT1–AT5 pass; 243 acceptance tests still pass.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

River physics, flow animation, reflections, other tracks, changing any track JSON field other than `arroyos`.
