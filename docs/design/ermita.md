# Ermita de Guadalupe street circuit (tasks 241–243)

Fictional street circuit in the user's home village (Ermita de Guadalupe, Jerez, Zacatecas). Six layouts share one venue: DEM `assets/source/dem/ermita.json`, ground scene `assets/source/ground/ermita-s2.jpg` (+ `.json` bounds), sources and per-layout numbers in `docs/research/tracks/mx-ermita.md`, look in `docs/research/hometown-circuit/town-look.md`. OSM has no buildings here, so the village is synthetic. The arroyo is dry in the dry season (tree band 30–50 m, sandy bed).

Data prerequisites (planner-side data agent, committed before 242): `assets/source/osm/ermita-streets.json` (all highway ways in the venue bbox, `{source, license, ways:[{id, highway, coords}]}`, no names) and `assets/source/osm/ermita-village.json` (built-up mask polygons hand-drawn from imagery, `{polygons:[[[lon,lat]...]]}`).

## 241 — Register the six layouts

| id | name | widthMeters |
|---|---|---|
| ermita-centro | Ermita Centro | 12 |
| ermita-federal | Ermita Federal | 12 |
| ermita-norte | Ermita Norte | 12 |
| ermita-mixto | Ermita Mixto | 12 |
| ermita-poniente | Ermita Poniente | 12 |
| ermita-veloz | Ermita Veloz | 12 |

Country "Mexico"; environment `desert`; DEM shared; `pit`/`grandstands` from `mx-ermita.md`; no banking; `"walls": true` (concrete walls all round, as city tracks). Ground texture per id cropped from the shared Sentinel-2 scene to each built terrain bounds (skill `track-data` step 12 tone rules). Menu, index (`build:track-index`), per-id tables (env/fog, DEM tool) as in 168/211. Existing tracks are not rebuilt.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: each of the 6 `public/tracks/<id>.json` | `parseTrackData`, closed centerline length | within ±1 % of the polyline length of `assets/source/tracks/mx-<id>.geojson` projected with `src/track/geo.ts`, and in [2400, 5100] m |
| AT2 | unit: `public/tracks/index.json` | read | the 6 ids present, consecutive in the table order above, names as above, country "Mexico"; every pre-existing entry unchanged and in the same relative order |
| AT3 | unit: `src/ui/menu.ts` `TRACK_CHOICES` | read | contains the 6 ids with the names above, consecutive, same order |
| AT4 | unit: `public/tracks/*.json` not starting with `ermita-` | compare with `git show master:<path>` at test-writing time (hash hard-coded) | byte-identical |
| AT5 | unit: each new track centerline resampled every 10 m | 3-point circumradius at every sample | ≥ 11 m |
| AT6 | unit: each new track | `widthMeters`/half widths, `environment` | width as table; environment `desert`; `bank` absent or all 0 |
| AT7 | unit: `public/textures/ground/<id>.jpg` for each id | read JPEG SOF0/SOF2 header | 2048 × 2048 |
| AT8 | unit: each new track, grandstands and pit | 233 grounding check (`groundHeightAt`) | every grandstand base within ±0.3 m of ground; pit range inside [0, length) after wrap |
| AT9 | e2e: menu | select "Ermita Federal", start race, wait 3 s | canvas renders, no console errors, car speed reading present |
| AT10 | unit: `ASSETS_LICENSES.md` | read | rows naming `ermita.json` (DEM), each `ground/ermita-*.jpg` (Sentinel-2) and the `mx-ermita-*` OSM files |

## 242 — Synthetic village buildings

New pure generator `tools/env/villageBuildings.ts`:
`buildVillageEnv({ centerline: [x,z][], halfWidthLeft: number[], halfWidthRight: number[], streets: [x,z][][], mask: [x,z][][], exclusions: [x,z][][], seed: number }): CityEnv` (all local metres, track frame). Bake script `tools/env/bakeVillage.ts <id>` writes `public/tracks/<id>-env.json` (loaded by `src/main.ts` like the OSM cities) for the 6 ermita ids; exclusions = pit lane box, grandstand footprints (+3 m), arroyo corridors (`water` features of `<id>-areas.json`, width + 6 m).

Rules: row houses along both sides of the track and of every street (assumed width 7 m) inside the mask. Front face parallel to the road, setback: track → `halfWidth + 2.5` m from the centerline (sidewalk); street → 5.0 m from its centreline. Frontage uniform in [6, 14] m, depth [9, 16] m, gap between houses 0–0.5 m, height 3.2 m (70 %) or 6.4 m (30 %). No house within 8 m of a junction (track–street or street–street). 10 % of lots stay vacant and get an adobe wall (`Wall`, height 2.2, thickness 0.3) along the front. Seeded RNG (mulberry32 of seed); seed per id = FNV-1a of the id.

Types: `BuildingMaterial` gains `'plaster'`; `Building` gains optional `color?: number` (0xRRGGBB) and `tank?: boolean` (≈40 % of plaster houses). `VILLAGE_PALETTE` (exported): 0xC8963E ochre, 0xE8D8B0 cream, 0xD98C8C pink, 0xB5553A terracotta, 0x8FB8C8 pale blue, 0xEEE8DC white, 0x9DB37A pale green.

Render (`src/render/cityRenderer.ts`): plaster houses in one merged mesh with vertex colours (`THREE.Color.setHex`), rough plaster material (roughness 0.95, no texture required), flat roof with 0.4 m parapet; tanks as one `InstancedMesh` (black cylinder r 0.55 m, h 1.1 m on the roof). Glass/brick/stone paths unchanged.

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

## 243 — Dry arroyo and bridges

Builder input: `water` features of `assets/source/osm/<id>-areas.json` (lines with `widthMeters`, polygons). Only tracks whose config has `"arroyo": true` (the 6 ermita ids) use it; every other track output unchanged.

- Terrain: inside each corridor (line buffered by width/2, or polygon) the heightfield is lowered by `depth` = 2.0 m with a cosine bank of 3 m outside the corridor edge.
- Crossings: where the centerline crosses a corridor, a bridge spans the corridor plus 5 m abutments each side. Track elevation over the span is linear between the abutment ends (their original elevations).
- Output in track JSON: `bridges?: { from: number; to: number }[]` (centerline indices, inclusive) and `arroyos?: { line: [x,z][]; width: number }[]`; barriers: `wall` segments, offset = half width + 1.25, on both sides over every bridge span.
- Render: bed with the existing gravel/sand runoff material; deck slab 0.6 m thick, width = track width + 2 m, under the track; concrete deck (the real crossings are concrete causeways with masonry sides, per the user); stone-masonry parapets 0.7 m high, 0.5 m thick, centred at half width + 1.25; stone-masonry side walls on both sides along the span from the bed up to the deck top; no piers. Tree density on banks (within 15 m of the corridor edge) ×3 the biome density.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: fixture G (straight track along +x, x∈[0,1000] every 1 m, flat DEM 0, half width 6; one water line along z at x=500 from z=−300 to 300, width 30; `arroyo: true`) | build | exactly one bridge; its x range = [480, 520] ± 1 m |
| AT2 | unit: G with DEM sloping 0.01 along x | build | elevation over the bridge span is linear (abs second difference ≤ 1e-6) and equals the no-arroyo elevation at both abutment ends ± 1e-6 |
| AT3 | unit: G | sample terrain heights at (500, 200) and (500 ± 21, 200) and (500 ± 30, 200) | (500,200) = −2.0 ± 0.1; ±21 between −2.0 and 0; ±30 = 0 ± 0.05 |
| AT4 | unit: G | elevation per index outside the bridge span | equal to the same build without water ± 1e-9 |
| AT5 | unit: G with `arroyo` absent | build | output deep-equal to the build of G without water; no `bridges`/`arroyos` keys |
| AT6 | unit: G | barriers | `wall` segments on left and right covering the bridge index range, offset 7.25 ± 0.01 |
| AT7 | unit: render bridge builder on G's bridge | inspect | two stone parapets (meshes or instances) of length 40 ± 0.5, 0.7 ± 0.01 high above the deck top, 0.5 thick, centred at lateral offset half width + 1.25 ± 0.01; two stone side walls along the span whose bottom at mid-span is ≤ `terrainY` + 0.05 and top = deck top ± 0.01; parapet and side-wall materials use the stone texture set (`textures/stone/old-wall`); deck top within 0.05 m below the track surface; no piers |
| AT8 | unit: `public/tracks/ermita-federal.json` and `ermita-poniente.json` | read `bridges` | federal has a bridge whose midpoint is within 30 m of the real OSM bridge crossing listed in `mx-ermita.md`; poniente likewise |
| AT9 | unit: every non-ermita `public/tracks/*.json` | compare with master | byte-identical |
| AT10 | unit: each ermita track | trees within 15 m of an arroyo corridor edge | density ≥ 2× the density 50–100 m away |
