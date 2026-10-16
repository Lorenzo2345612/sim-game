# 182 — Pit building and grandstand styling

Status: pending
Phase: 1
Depends on: 180
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`createPitBuilding` and `createGrandstand` read `style.pitBuilding` / `style.grandstands` (task 179 types) and change dimensions, colours and roof shapes; with the default style the output is identical to today.

## Context

Design: `docs/design/track-style.md`. The optional `style?: ResolvedTrackStyle` params already exist (task 180). Import `ResolvedTrackStyle`, `DEFAULT_TRACK_STYLE` from `../track/trackStyle`. Existing constants in `pitAndStart.ts`: `BUILDING_DEPTH 8`, `BUILDING_HEIGHT 4`, `EDGE_OFFSET 10`, `DOOR_HEIGHT 3`. Colours are set with `new THREE.MeshStandardMaterial({ color: hex })` exactly as given (tests read `material.color.getHexString()`); keep the existing `registerWhitePaint` call on the facade material (monitoring only, do not alter colours). Tests run without WebGL.

## Files

- `src/render/pitAndStart.ts` — modify (`createPitBuilding` only).
- `src/render/grandstand.ts` — modify (`createGrandstand` only).
- `tests/unit/acceptance/182-pit-grandstand-style.test.ts` — create (acceptance role).

## Steps

Pit building (values from `style.pitBuilding`, called `p`):
- Dimensions: box length = chord as today; depth `p.depthMeters`; height `max(p.heightMeters, terrain-covering height as today)`. Near face stays at `widthMeters/2 + EDGE_OFFSET` from the chord; the box centre moves to `near + depth/2`. Door height = `min(DOOR_HEIGHT, p.heightMeters / p.storeys)`. `group.userData.storeys = p.storeys`; `garageCount` formula unchanged.
- Colours: mesh `pit` = `p.facade`; every `garageDoor` = `p.doors`.
- `pitGlass` (only if `glazing > 0` and `storeys > 1`): one box on the near face, full chord length, thickness 0.2 proud of the face, height `glazing × (p.heightMeters − p.heightMeters/storeys)`, vertically centred in the upper-storey band, colour `#5b7f95`, `transparent: true`, `opacity: 0.6`, `metalness: 0.8`, `roughness: 0.2`.
- `pitRoof` (mesh, colour `p.roof ?? p.facade`, `userData.roofStyle`), min Y ≥ top of `pit`, footprint within chord × (depth + 4 m overhang toward the track), each one geometry: `flat` — only created if `p.roof !== null`, slab 0.3 thick on top; `canopy` — flat slab 0.3 thick raised 0.5 above the top, overhanging 4 m toward the track; `folded` — zigzag extrusion along the chord (4 folds across the depth, amplitude 1.5 m); `sail` — slab tilted 8° rising toward the track side, up to 2 m above the top; `curved` — half-cylinder arc across the depth, rise 2 m above the top.
- `pitAccent` (only if `p.accent`): thin box 0.6 m high, full chord, 0.15 thick on the near face just below the roof line, colour `p.accent`.

Grandstand (values from `style.grandstands`, called `s`; null fields = today's look):
- `s.structure` → colour of the `tier_*` meshes and `roofPost` meshes. `s.roof` → roof slab colour. Roof slab keeps the name `roof` when `s.roof === null && s.roofStyle === 'flat'`; otherwise it is named `standRoof`. Roof mesh `userData.roofStyle = s.roofStyle`. No roof (`g.roof` false) → none, as today.
- `roofStyle`: `flat` today's box; `sail` the slab tilted 8° rising toward the back (away from the track); `truss` flat slab plus 3 transverse thin boxes named `standTruss` under it.
- `s.seats` (non-null): crowd instance colour of instance `i` (after the existing shuffle) = `seats[i % seats.length]`, via `color.set(hex)`; other instance code unchanged. Root group name `grandstand` (task 180).

Conventions: dimensions in metres; colours exact hex; null/undefined style field → current behaviour byte-identical.

## Acceptance tests (defined by the planner with Opus, before coding)

Offsets are measured from the track edge (`widthMeters/2`), not the centerline.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza, DEFAULT style | `createPitBuilding(track, style)` | mesh `pit` material colour `#b8bcc0`; door material `#1c1c1e`; `userData.garageCount` unchanged from before the task; no mesh named `pitGlass` or `pitRoof` |
| AT2 | pitBuilding `{storeys: 3, heightMeters: 12, depthMeters: 15}` | create | mesh `pit` bounding-box height ≥ 12 - 0.01 and depth 15 ± 0.01 (local Z extent); `userData.storeys` 3 |
| AT3 | pitBuilding `{facade: '#dadada', doors: '#333333'}` | create | `pit` colour `#dadada`; every `garageDoor` colour `#333333` |
| AT4 | pitBuilding `{glazing: 0.4, storeys: 2, heightMeters: 9}` | create | a mesh `pitGlass` exists; its height = 0.4 × (9 - first-storey height) ± 0.05 where first-storey height = 9 / 2; its material is transparent or has metalness ≥ 0.5 |
| AT5 | roofStyle each of `canopy`, `folded`, `sail`, `curved` | create | a mesh `pitRoof` exists; its top (world bbox max Y) ≥ pit top; for `flat` with roof colour set: `pitRoof` exists with that colour |
| AT6 | accent `#cc0000` | create | a mesh `pitAccent` with colour `#cc0000` |
| AT7 | any style from AT2-AT6 | create | building near face stays at `widthMeters/2 + 10` m from the chord (±0.05), so the building never overlaps the track |
| AT8 | grandstands `{structure: '#cccccc', roof: '#dadada', seats: ['#1f4fbf', '#dac400'], roofStyle: 'sail'}` | `createGrandstand(g, load, style)` | structure meshes `#cccccc`; roof mesh `#dadada`; a seat mesh/InstancedMesh with instance colours drawn only from the two seat colours, both used; roof mesh named `standRoof` with `userData.roofStyle === 'sail'` |
| AT9 | DEFAULT style | createGrandstand | identical mesh names, counts and colours to calling without style |
| AT10 | dispose after AT2-AT8 | `disposeGrandstand` / group traversal dispose | every geometry and material created is disposed (spy on dispose) |

## Acceptance criteria

- [ ] All AT rows pass; protected tests (`tests/unit/render/pitAndStart.test.ts`, `grandstand.test.ts`, acceptance 040, 041, 173) stay green unedited.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Style files for circuits, `extraGrandstands` (180), floodlights, props, barrier fences, start gantry/lights, new textures, `main.ts`.
